// Mode: chat — /api/chat (自由問答, Q&A branch).
//
// Body shape mirrors what DefaultChatTransport sends from
// src/components/chat.tsx: UIMessage[] with `parts`, plus studentId /
// sessionId / socratic. No `mode` key → the route takes the RAG Q&A
// branch (teaching / feynman are the only other modes).
//
// The reply is an AI SDK UI message stream; we collect `text-delta`
// chunks and grade the concatenated text.

import { randomUUID } from "node:crypto";
import {
  loadGolden, postStream, readUiMessageStream, makeResult, failedResult,
  cjkRatio, latexBalanced, hasMetaLeak, citesChapter, bodyBytes, validateBody,
} from "../lib.mjs";

export const name = "chat";
const CHECKS = ["http", "nonEmpty", "zhDominant", "citesChapter", "noMetaLeak", "latexBalanced", "length", "recall"];

export function buildBody(c, ctx, sessionId = randomUUID()) {
  return {
    messages: [
      {
        id: `eval-${c.id}`,
        role: "user",
        parts: [{ type: "text", text: c.question }],
      },
    ],
    studentId: ctx.studentId,
    sessionId,
    socratic: false,
  };
}

function limits(golden, c) {
  const d = golden.defaults ?? {};
  return {
    minChars: c.minChars ?? d.minChars ?? 80,
    maxChars: c.maxChars ?? d.maxChars ?? 6000,
    minCjkRatio: c.minCjkRatio ?? d.minCjkRatio ?? 0.5,
  };
}

export function plan(ctx) {
  const golden = loadGolden("chat");
  // Fixed session id in dry-run so the plan is reproducible.
  const sessionId = "00000000-0000-4000-8000-00000000d3ad";
  return golden.cases.map((c) => {
    const body = buildBody(c, ctx, sessionId);
    const problems = validateBody(body, ["messages", "studentId", "sessionId"]);
    const part = body.messages?.[0]?.parts?.[0];
    if (!part || part.type !== "text" || !part.text?.trim()) problems.push("first user part is not non-empty text");
    return { mode: name, step: c.label, method: "POST", path: "/api/chat", body, bytes: bodyBytes(body), problems };
  });
}

export async function run(ctx) {
  const golden = loadGolden("chat");
  const results = [];
  // One session for the whole run so the rows group together in 對話歷史.
  const sessionId = randomUUID();

  for (const c of golden.cases) {
    ctx.log(`▸ [chat] ${c.label}`);
    const lim = limits(golden, c);
    let res;
    try {
      res = await postStream(ctx.base, "/api/chat", buildBody(c, ctx, sessionId));
    } catch (err) {
      results.push(failedResult({ mode: name, label: c.label, checkNames: CHECKS, reason: err }));
      continue;
    }
    if (!res.ok) {
      results.push(failedResult({ mode: name, label: c.label, checkNames: CHECKS, httpStatus: res.status, reason: res.text, durationMs: res.durationMs }));
      continue;
    }

    const stream = readUiMessageStream(res.text);
    const text = stream.text.trim();
    const ratio = cjkRatio(text);
    const recallOk = Array.isArray(c.mustMentionAny) && c.mustMentionAny.length > 0
      ? c.mustMentionAny.some((n) => text.toLowerCase().includes(String(n).toLowerCase()))
      : true;

    results.push(makeResult({
      mode: name,
      label: c.label,
      checks: {
        http: !stream.errorText,
        nonEmpty: text.length > 0,
        zhDominant: ratio >= lim.minCjkRatio,
        citesChapter: citesChapter(text),
        noMetaLeak: !hasMetaLeak(text),
        latexBalanced: latexBalanced(text),
        length: text.length >= lim.minChars && text.length <= lim.maxChars,
        recall: recallOk,
      },
      durationMs: res.durationMs,
      httpStatus: res.status,
      reason: stream.errorText ?? undefined,
      usage: stream.usage,
      extra: {
        topic: c.topic,
        misconception: Boolean(c.misconception),
        chars: text.length,
        cjkRatio: Number(ratio.toFixed(3)),
        chunks: stream.chunkCount,
        excerpt: text.slice(0, 160),
      },
    }));
  }
  return results;
}
