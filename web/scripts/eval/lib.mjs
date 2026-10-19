// Shared helpers for the prompt eval harness. Plain Node ESM, no deps.
//
// Every mode module (modes/*.mjs) uses the same primitives:
//   * postJson / postStream  — fetch wrappers that time the call and
//                               surface http status + a parsed body
//   * readUiMessageStream     — drain an AI SDK v6 UI message stream
//                               (SSE, `text-delta` events) into plain text
//   * text checks             — CJK ratio, LaTeX balance, meta-commentary
//                               leak, chapter citation
//   * usage / cost            — pull a `usage` object out of a response
//                               when the route happens to carry one, and
//                               price it with the same table as
//                               src/lib/usage-log.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const HERE = dirname(fileURLToPath(import.meta.url));

/** Fixed UUID so every harness run is attributable in `token_usage` /
 *  `chat_messages` / `attempts`. Override with --student-id. */
export const DEFAULT_STUDENT_ID = "0000e7a1-0000-4000-8000-000000000001";

/** Per-request wall-clock budget. Routes declare maxDuration = 60s;
 *  exam generation fans out four generateObject calls and is the slowest. */
export const REQUEST_TIMEOUT_MS = 120_000;

export const GRADE_LETTERS = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];

/** Mirror of MODEL_RATES in src/lib/usage-log.ts (USD per 1M tokens).
 *  Kept here instead of imported because this script runs outside the
 *  Next/TS toolchain. Update both when Google changes pricing. */
export const MODEL_RATES = {
  "gemini-2.5-flash": { input: 0.075, output: 0.30 },
  "gemini-2.5-flash-lite": { input: 0.0375, output: 0.15 },
  "gemini-2.5-pro": { input: 1.25, output: 5.0 },
};

/** Default tier per route, mirroring src/lib/models.ts. Only used to
 *  price a `usage` block when a response carries one. */
export const MODE_MODEL = {
  preview: "gemini-2.5-flash-lite",
  chat: "gemini-2.5-flash",
  exam: "gemini-2.5-pro",
  oral: "gemini-2.5-flash",
};

export function loadGolden(name) {
  return JSON.parse(readFileSync(join(HERE, "golden", `${name}.json`), "utf8"));
}

/* ───────────────────────── HTTP ───────────────────────── */

async function timedFetch(url, init) {
  const t0 = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { res, t0 };
}

/** POST a JSON body, parse a JSON reply. Never throws on HTTP errors —
 *  the caller decides what a 4xx/5xx means for its checks. */
export async function postJson(base, path, body) {
  const { res, t0 } = await timedFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return {
    ok: res.ok,
    status: res.status,
    json,
    text,
    durationMs: Date.now() - t0,
    usage: extractUsage(json),
  };
}

/** POST a JSON body and return the raw body text of a streamed reply
 *  (text stream or UI message stream) plus timing. */
export async function postStream(base, path, body) {
  const { res, t0 } = await timedFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    text,
    headers: res.headers,
    durationMs: Date.now() - t0,
  };
}

/* ───────────────── UI message stream (AI SDK v6) ───────────────── */

/**
 * `toUIMessageStreamResponse()` emits SSE: one `data: {json}` per chunk,
 * terminated by `data: [DONE]`. We only need the assistant text, which
 * arrives as `{ type: "text-delta", id, delta }`. Tool chunks, reasoning
 * and step markers are ignored. A `finish` chunk may carry
 * `messageMetadata` (only when the route opts in — /api/chat doesn't
 * today), so usage is best-effort.
 */
export function readUiMessageStream(raw) {
  const texts = new Map(); // text part id → accumulated text
  const order = [];
  let usage = null;
  let errorText = null;
  let chunkCount = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { continue; }
    chunkCount++;
    switch (chunk.type) {
      case "text-start":
        if (!texts.has(chunk.id)) { texts.set(chunk.id, ""); order.push(chunk.id); }
        break;
      case "text-delta": {
        const id = chunk.id ?? "_";
        if (!texts.has(id)) { texts.set(id, ""); order.push(id); }
        texts.set(id, texts.get(id) + (chunk.delta ?? ""));
        break;
      }
      case "error":
        errorText = typeof chunk.errorText === "string" ? chunk.errorText : JSON.stringify(chunk);
        break;
      case "finish":
      case "message-metadata":
      case "finish-step":
        usage = usage ?? extractUsage(chunk);
        break;
      default:
        break;
    }
  }

  // Fallback: a plain text stream (no SSE framing) — treat the body as text.
  if (chunkCount === 0 && raw.trim() && !raw.includes("data:")) {
    return { text: raw, usage: null, errorText: null, chunkCount: 0 };
  }

  const text = order.map((id) => texts.get(id)).join("\n");
  return { text, usage, errorText, chunkCount };
}

/* ───────────────────────── text checks ───────────────────────── */

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;
const LATIN_RE = /[A-Za-z]/g;

/** Strip $$…$$, $…$, fenced and inline code so formula symbols and
 *  variable names don't count as "English prose". */
export function stripMathAndCode(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\\\(([\s\S]*?)\\\)/g, " ")
    .replace(/\\\[([\s\S]*?)\\\]/g, " ")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/** Fraction of "letter-like" characters that are CJK, after removing
 *  math and code. 1.0 = pure Chinese prose; 0 = pure Latin prose. */
export function cjkRatio(text) {
  const prose = stripMathAndCode(text);
  const cjk = (prose.match(CJK_RE) ?? []).length;
  const latin = (prose.match(LATIN_RE) ?? []).length;
  if (cjk + latin === 0) return 0;
  return cjk / (cjk + latin);
}

export function isZhDominant(text, min = 0.5) {
  return cjkRatio(text) >= min;
}

/** `$` count (ignoring escaped `\$`) must be even, and `$$` pairs
 *  must be balanced on their own. */
export function latexBalanced(text) {
  const s = String(text).replace(/\\\$/g, "");
  const doubles = (s.match(/\$\$/g) ?? []).length;
  const singles = (s.replace(/\$\$/g, "").match(/\$/g) ?? []).length;
  return doubles % 2 === 0 && singles % 2 === 0;
}

/** Narrated planning that the chat prompt's OUTPUT_DISCIPLINE block is
 *  meant to suppress. Case-sensitive on purpose: "the user" can
 *  legitimately appear mid-sentence in an English physics quote. */
export const META_LEAK_RE = /\b(The user|Now I|I will|I need to|I should|My plan|Let me (?:now|first|start))\b/;

export function hasMetaLeak(text) {
  return META_LEAK_RE.test(String(text));
}

/** "Ch04", "Ch 12", "第 4 章", "第四章". */
export const CHAPTER_CITE_RE = /\bCh\s?\d{1,2}\b|第\s*[\d一二三四五六七八九十〇零]{1,3}\s*章/;

export function citesChapter(text) {
  return CHAPTER_CITE_RE.test(String(text));
}

/* ───────────────────────── usage / cost ───────────────────────── */

/** Deep-search an object for a `usage`-shaped block and normalise it to
 *  { inputTokens, outputTokens, totalTokens }. Returns null if absent. */
export function extractUsage(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  const direct = obj.usage ?? obj.messageMetadata?.usage ?? null;
  const norm = normaliseUsage(direct) ?? normaliseUsage(obj);
  if (norm) return norm;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = extractUsage(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function normaliseUsage(u) {
  if (!u || typeof u !== "object") return null;
  const input = u.inputTokens ?? u.promptTokens ?? u.prompt_tokens;
  const output = u.outputTokens ?? u.completionTokens ?? u.completion_tokens;
  if (typeof input !== "number" && typeof output !== "number") return null;
  const inputTokens = typeof input === "number" ? input : 0;
  const outputTokens = typeof output === "number" ? output : 0;
  return { inputTokens, outputTokens, totalTokens: u.totalTokens ?? inputTokens + outputTokens };
}

export function estimateCostUsd(model, usage) {
  if (!usage) return null;
  const rate = MODEL_RATES[model] ?? MODEL_RATES["gemini-2.5-flash"];
  return (usage.inputTokens / 1e6) * rate.input + (usage.outputTokens / 1e6) * rate.output;
}

/* ───────────────────────── results ───────────────────────── */

/**
 * Canonical per-row result. `checks` is an ordered map of check name →
 * boolean; `ok` is the AND of all checks. Extra fields (chapter,
 * conceptCount, …) are allowed so the JSON stays diff-friendly.
 */
export function makeResult({ mode, label, checks, durationMs = 0, httpStatus = null, reason, usage = null, extra = {} }) {
  const entries = Object.entries(checks);
  const ok = entries.length > 0 && entries.every(([, v]) => v === true);
  const model = MODE_MODEL[mode];
  const costUsd = estimateCostUsd(model, usage);
  return {
    mode,
    label,
    ok,
    checks,
    durationMs,
    httpStatus,
    ...(reason ? { reason: String(reason).slice(0, 500) } : {}),
    usage,
    costUsd,
    ...extra,
  };
}

/** A row for a request that never produced a usable body. Every
 *  expected check is marked false so the table still lists them. */
export function failedResult({ mode, label, checkNames, httpStatus, reason, durationMs = 0 }) {
  const checks = Object.fromEntries(checkNames.map((n) => [n, false]));
  return makeResult({ mode, label, checks, durationMs, httpStatus, reason });
}

/* ───────────────────────── dry-run helpers ───────────────────────── */

/**
 * Validate a request builder's output: must be JSON-serialisable, must
 * carry the listed keys, and must not contain undefined/NaN. Returns a
 * list of problems (empty = fine).
 */
export function validateBody(body, requiredKeys = []) {
  const problems = [];
  if (!body || typeof body !== "object") return ["body is not an object"];
  for (const k of requiredKeys) {
    if (!(k in body) || body[k] === undefined) problems.push(`missing key "${k}"`);
  }
  let encoded;
  try {
    encoded = JSON.stringify(body);
  } catch (err) {
    return [...problems, `not JSON-serialisable: ${err}`];
  }
  const walk = (v, path) => {
    if (v === undefined) problems.push(`${path} is undefined`);
    else if (typeof v === "number" && !Number.isFinite(v)) problems.push(`${path} is not finite`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(body, "body");
  return problems.length ? problems : (encoded ? [] : ["empty encoding"]);
}

export function bodyBytes(body) {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

/* ───────────────────────── misc ───────────────────────── */

export function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));
}

export function sum(nums) {
  return nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

export function approxEqual(a, b, tol = 1) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
}
