// Mode: preview — /api/preview (章節預習卡). Unchanged logic from the
// original single-mode harness: shape + recall per golden case.

import { loadGolden, postStream, makeResult, failedResult, bodyBytes, validateBody } from "../lib.mjs";

export const name = "preview";
const CHECKS = ["http", "shape", "recall"];

function buildBody(c, ctx) {
  return { chapter: c.chapter, studentId: ctx.studentId };
}

function selectCases(golden, ctx) {
  return golden.cases.filter((c) => !ctx.chapterFilter || String(c.chapter) === String(ctx.chapterFilter));
}

/** Dry run: one POST per golden case. */
export function plan(ctx) {
  const golden = loadGolden("preview");
  return selectCases(golden, ctx).map((c) => {
    const body = buildBody(c, ctx);
    return {
      mode: name,
      step: c.label,
      method: "POST",
      path: "/api/preview",
      body,
      bytes: bodyBytes(body),
      problems: validateBody(body, ["chapter", "studentId"]),
    };
  });
}

export async function run(ctx) {
  const golden = loadGolden("preview");
  const results = [];

  for (const c of selectCases(golden, ctx)) {
    ctx.log(`▸ [preview] ${c.label}`);
    let preview = null;
    let httpStatus = null;
    let took = 0;
    try {
      const t0 = Date.now();
      // The route streams on POST (streamObject text stream protocol).
      const postRes = await postStream(ctx.base, "/api/preview", buildBody(c, ctx));
      httpStatus = postRes.status;
      if (!postRes.ok) {
        results.push(failedResult({ mode: name, label: c.label, checkNames: CHECKS, httpStatus, reason: postRes.text, durationMs: postRes.durationMs }));
        continue;
      }
      const body = postRes.text;
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
        const getRes = await fetch(`${ctx.base}/api/preview?chapter=${c.chapter}`);
        const getBody = await getRes.json();
        parsed = getBody?.content ?? null;
      }
      preview = parsed;
      took = Date.now() - t0;
    } catch (err) {
      results.push(failedResult({ mode: name, label: c.label, checkNames: CHECKS, httpStatus, reason: err }));
      continue;
    }

    const concepts = Array.isArray(preview?.concepts)
      ? preview.concepts
      : Array.isArray(preview)
        ? preview
        : [];
    const shapeOk = concepts.length >= c.minConcepts && concepts.length <= c.maxConcepts;
    const haystack = JSON.stringify(concepts).toLowerCase();
    const recallOk = c.mustMentionAny.some((needle) => haystack.includes(String(needle).toLowerCase()));

    results.push(makeResult({
      mode: name,
      label: c.label,
      checks: { http: true, shape: shapeOk, recall: recallOk },
      durationMs: took,
      httpStatus,
      // Legacy fields kept so the jq diff recipe in README still works.
      extra: { chapter: c.chapter, shapeOk, recallOk, conceptCount: concepts.length },
    }));
  }
  return results;
}
