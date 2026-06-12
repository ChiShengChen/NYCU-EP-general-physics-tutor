#!/usr/bin/env node
// Eval harness — minimal version.
//
// Hits the deployed (or local) /api/preview endpoint for every case in
// scripts/eval/golden/preview.json and grades the response on:
//
//   * shape:   responded with N..M concepts as declared in the golden
//   * recall:  the concept array (after stringifying) mentions at least
//              one of the case's `mustMentionAny` anchors.
//
// Intentionally NOT wired into CI. Each run burns Gemini tokens via the
// real route, so it's opt-in:
//
//   PROMPT_EVAL_BASE_URL=https://nycu-ep-...vercel.app \
//   PROMPT_EVAL_VERSION=v2 \
//   node scripts/eval/run.mjs
//
// or against local dev:
//   PROMPT_EVAL_BASE_URL=http://localhost:3000 node scripts/eval/run.mjs
//
// Output is a single JSON blob to stdout + a human summary to stderr so
// you can pipe to a file for later diffing. Failures exit non-zero.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.PROMPT_EVAL_BASE_URL ?? "").replace(/\/$/, "");
const VERSION = process.env.PROMPT_EVAL_VERSION ?? "unspecified";
const ONLY = process.env.PROMPT_EVAL_ONLY;

if (!BASE) {
  console.error("PROMPT_EVAL_BASE_URL is required (e.g. http://localhost:3000)");
  process.exit(2);
}

const golden = JSON.parse(readFileSync(join(HERE, "golden", "preview.json"), "utf8"));

const results = [];
for (const c of golden.cases) {
  if (ONLY && String(c.chapter) !== ONLY) continue;

  const url = `${BASE}/api/preview?chapter=${c.chapter}&force=1`;
  console.error(`▸ ${c.label}`);
  let preview;
  let httpStatus = null;
  let took = 0;
  try {
    const t0 = Date.now();
    // Cache-bust by GET-then-POST. The route streams on POST.
    const postRes = await fetch(`${BASE}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter: c.chapter }),
    });
    httpStatus = postRes.status;
    if (!postRes.ok) {
      results.push({ ...c, ok: false, httpStatus, reason: await postRes.text() });
      continue;
    }
    // streamObject's response is the text stream protocol. The simplest
    // way to grab the final object outside the SDK is to wait for the
    // GET endpoint to have it cached after stream completes — but the
    // POST handler does the upsert in a fire-and-forget. So instead
    // we drain the body and parse what we can.
    const body = await postRes.text();
    // Best-effort JSON extraction: find the last balanced JSON object
    // in the streamed text. Robust enough for the smoke test.
    const lastBrace = body.lastIndexOf("}");
    let parsed = null;
    if (lastBrace > 0) {
      const firstBrace = body.indexOf("{");
      try {
        parsed = JSON.parse(body.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through — re-fetch from cache as a second attempt.
      }
    }
    if (!parsed) {
      const getRes = await fetch(`${BASE}/api/preview?chapter=${c.chapter}`);
      const getBody = await getRes.json();
      parsed = getBody?.content ?? null;
    }
    preview = parsed;
    took = Date.now() - t0;
    void url;
  } catch (err) {
    results.push({ ...c, ok: false, reason: String(err) });
    continue;
  }

  const concepts = Array.isArray(preview?.concepts)
    ? preview.concepts
    : Array.isArray(preview)
      ? preview
      : [];
  const shapeOk =
    concepts.length >= c.minConcepts &&
    concepts.length <= c.maxConcepts;

  const haystack = JSON.stringify(concepts).toLowerCase();
  const recallOk = c.mustMentionAny.some((needle) =>
    haystack.includes(String(needle).toLowerCase()),
  );

  results.push({
    chapter: c.chapter,
    label: c.label,
    ok: shapeOk && recallOk,
    shapeOk,
    recallOk,
    conceptCount: concepts.length,
    durationMs: took,
  });
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

const summary = {
  version: VERSION,
  base: BASE,
  ran: results.length,
  passed,
  failed,
  results,
};

console.error("");
console.error(`Version: ${VERSION}`);
console.error(`Passed:  ${passed} / ${results.length}`);
if (failed > 0) {
  for (const r of results.filter((x) => !x.ok)) {
    console.error(`  ✗ ${r.label}: shape=${r.shapeOk} recall=${r.recallOk} count=${r.conceptCount} reason=${r.reason ?? ""}`);
  }
}
console.log(JSON.stringify(summary, null, 2));
process.exit(failed > 0 ? 1 : 0);
