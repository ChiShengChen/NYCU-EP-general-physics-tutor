#!/usr/bin/env node
// Prompt eval harness — runs the golden sets under scripts/eval/golden/
// against a deployed (or local) app and grades each response with the
// cheap, dependency-free checks in modes/*.mjs:
//
//   preview  /api/preview     shape + recall per chapter
//   chat     /api/chat        繁中 ratio, chapter cite, no meta leak, LaTeX balance, length
//   exam     /api/exam        generate (midterm + final) → grade with canned answers
//   oral     /api/oral-exam   start → turn ×3 (+ follow-ups) → cap probe → finish
//
// Intentionally NOT wired into CI. Each run burns Gemini tokens via the
// real routes, so it's opt-in:
//
//   PROMPT_EVAL_BASE_URL=https://nycu-ep-...vercel.app \
//   PROMPT_EVAL_VERSION=v2 \
//   node scripts/eval/run.mjs [--only chat,exam] [--student-id <uuid>]
//
// or against local dev:
//   PROMPT_EVAL_BASE_URL=http://localhost:3000 node scripts/eval/run.mjs
//
// `--dry-run` validates every request builder against fixtures and
// prints the plan without touching the server (no BASE_URL needed).
//
// Output is a single JSON blob to stdout + a human summary table to
// stderr so you can pipe to a file for later diffing. Any failed check
// exits non-zero.

import { DEFAULT_STUDENT_ID, isUuid } from "./lib.mjs";
import * as preview from "./modes/preview.mjs";
import * as chat from "./modes/chat.mjs";
import * as exam from "./modes/exam.mjs";
import * as oral from "./modes/oral.mjs";

const MODES = { preview, chat, exam, oral };
const MODE_ORDER = ["preview", "chat", "exam", "oral"];

/* ───────────────────────── CLI ───────────────────────── */

function usage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`Usage: node scripts/eval/run.mjs [options]

Options:
  --only <modes>        Comma-separated subset of: ${MODE_ORDER.join(", ")} (default: all)
  --student-id <uuid>   studentId sent with every request (default: ${DEFAULT_STUDENT_ID})
  --chapter <n>         preview only: run just this golden chapter (env: PROMPT_EVAL_ONLY)
  --base-url <url>      overrides PROMPT_EVAL_BASE_URL
  --dry-run             validate request builders + print the plan; no server calls
  -h, --help            this text

Environment:
  PROMPT_EVAL_BASE_URL  required unless --dry-run / --base-url
  PROMPT_EVAL_VERSION   label stored in the JSON output (default: unspecified)
  PROMPT_EVAL_ONLY      legacy alias for --chapter`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    only: null,
    studentId: DEFAULT_STUDENT_ID,
    chapter: process.env.PROMPT_EVAL_ONLY ?? null,
    base: process.env.PROMPT_EVAL_BASE_URL ?? "",
    dryRun: false,
  };
  const need = (flag, i) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
      console.error(`${flag} requires a value`);
      usage(2);
    }
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage(0);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--only") { opts.only = need(a, i); i++; }
    else if (a.startsWith("--only=")) opts.only = a.slice(7);
    else if (a === "--student-id") { opts.studentId = need(a, i); i++; }
    else if (a.startsWith("--student-id=")) opts.studentId = a.slice(13);
    else if (a === "--chapter") { opts.chapter = need(a, i); i++; }
    else if (a.startsWith("--chapter=")) opts.chapter = a.slice(10);
    else if (a === "--base-url") { opts.base = need(a, i); i++; }
    else if (a.startsWith("--base-url=")) opts.base = a.slice(11);
    else {
      console.error(`Unknown argument: ${a}`);
      usage(2);
    }
  }
  opts.base = opts.base.replace(/\/$/, "");
  opts.modes = opts.only
    ? opts.only.split(",").map((s) => s.trim()).filter(Boolean)
    : [...MODE_ORDER];
  const bad = opts.modes.filter((m) => !MODES[m]);
  if (bad.length) {
    console.error(`Unknown mode(s): ${bad.join(", ")} — expected one of ${MODE_ORDER.join(", ")}`);
    process.exit(2);
  }
  if (!isUuid(opts.studentId)) {
    console.error(`--student-id must be a UUID (student_profiles.id is uuid): ${opts.studentId}`);
    process.exit(2);
  }
  return opts;
}

/* ───────────────────────── table rendering ───────────────────────── */

/** East-Asian wide chars take two columns; pad by display width. */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    w += (cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
      || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd))) ? 2 : 1;
  }
  return w;
}

function pad(s, width, right = false) {
  const str = String(s);
  const fill = " ".repeat(Math.max(0, width - displayWidth(str)));
  return right ? fill + str : str + fill;
}

function renderTable(headers, rows, rightAlign = new Set()) {
  const widths = headers.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i]))));
  const line = (cells) => cells.map((c, i) => pad(c, widths[i], rightAlign.has(i))).join("  ");
  const sep = widths.map((w) => "─".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "–";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtTokens(u) {
  return u ? `${u.inputTokens}+${u.outputTokens}` : "n/a";
}

function fmtCost(c) {
  return typeof c === "number" ? `$${c.toFixed(4)}` : "n/a";
}

function checksCell(checks) {
  const entries = Object.entries(checks);
  const passed = entries.filter(([, v]) => v).length;
  const failed = entries.filter(([, v]) => !v).map(([k]) => k);
  return failed.length ? `${passed}/${entries.length} ✗ ${failed.join(",")}` : `${passed}/${entries.length} ✓`;
}

/* ───────────────────────── dry run ───────────────────────── */

function dryRun(opts) {
  const ctx = { base: opts.base || "(dry-run)", studentId: opts.studentId, chapterFilter: opts.chapter, log: () => {} };
  const plan = opts.modes.flatMap((m) => MODES[m].plan(ctx));
  const rows = plan.map((p) => [
    p.mode,
    p.step,
    `${p.method} ${p.path}`,
    Object.keys(p.body).join(","),
    String(p.bytes),
    p.problems.length ? `✗ ${p.problems.join("; ")}` : "✓",
  ]);
  console.error(`Dry run — ${plan.length} request(s) across ${opts.modes.join(", ")} (studentId ${opts.studentId})`);
  console.error("");
  console.error(renderTable(["mode", "step", "request", "body keys", "bytes", "builder"], rows, new Set([4])));
  const broken = plan.filter((p) => p.problems.length);
  console.error("");
  console.error(broken.length ? `✗ ${broken.length} builder(s) invalid` : `✓ all ${plan.length} builders valid — no server calls made`);
  console.log(JSON.stringify({
    dryRun: true,
    studentId: opts.studentId,
    modes: opts.modes,
    requests: plan.map(({ mode, step, method, path, bytes, problems, body }) => ({ mode, step, method, path, bytes, problems, bodyKeys: Object.keys(body) })),
  }, null, 2));
  process.exit(broken.length ? 1 : 0);
}

/* ───────────────────────── main ───────────────────────── */

const opts = parseArgs(process.argv.slice(2));
if (opts.dryRun) dryRun(opts);

if (!opts.base) {
  console.error("PROMPT_EVAL_BASE_URL (or --base-url) is required, e.g. http://localhost:3000 — or pass --dry-run");
  process.exit(2);
}

const VERSION = process.env.PROMPT_EVAL_VERSION ?? "unspecified";
const ctx = {
  base: opts.base,
  studentId: opts.studentId,
  chapterFilter: opts.chapter,
  log: (msg) => console.error(msg),
};

const results = [];
const perMode = {};
for (const m of opts.modes) {
  const t0 = Date.now();
  let rows;
  try {
    rows = await MODES[m].run(ctx);
  } catch (err) {
    // A mode module throwing is itself a failure, not a crash of the run.
    rows = [{ mode: m, label: `${m} (harness error)`, ok: false, checks: { harness: false }, durationMs: Date.now() - t0, httpStatus: null, reason: String(err), usage: null, costUsd: null }];
  }
  results.push(...rows);
  perMode[m] = {
    ran: rows.length,
    passed: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok).length,
    durationMs: Date.now() - t0,
  };
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const totalCost = results.reduce((s, r) => s + (typeof r.costUsd === "number" ? r.costUsd : 0), 0);
const anyUsage = results.some((r) => r.usage);

const summary = {
  version: VERSION,
  base: opts.base,
  studentId: opts.studentId,
  modes: perMode,
  ran: results.length,
  passed,
  failed,
  ...(anyUsage ? { approxCostUsd: Number(totalCost.toFixed(5)) } : {}),
  results,
};

console.error("");
console.error(renderTable(
  ["mode", "case", "result", "checks", "latency", "tokens in+out", "≈cost"],
  results.map((r) => [
    r.mode,
    r.label,
    r.ok ? "PASS" : "FAIL",
    checksCell(r.checks),
    fmtMs(r.durationMs),
    fmtTokens(r.usage),
    fmtCost(r.costUsd),
  ]),
  new Set([4, 5, 6]),
));
console.error("");
console.error(`Version: ${VERSION}`);
console.error(`Base:    ${opts.base}`);
console.error(`Student: ${opts.studentId}`);
console.error(`Passed:  ${passed} / ${results.length}` + (anyUsage ? `   ≈cost $${totalCost.toFixed(4)}` : "   (routes don't return usage — see admin 🧪 Prompt 版本用量 for cost)"));
if (failed > 0) {
  for (const r of results.filter((x) => !x.ok)) {
    const failedChecks = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(", ");
    console.error(`  ✗ [${r.mode}] ${r.label}: ${failedChecks}${r.httpStatus ? ` http=${r.httpStatus}` : ""}${r.reason ? ` reason=${r.reason}` : ""}`);
  }
}
console.log(JSON.stringify(summary, null, 2));
process.exit(failed > 0 ? 1 : 0);
