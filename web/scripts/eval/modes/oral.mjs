// Mode: oral — /api/oral-exam (口試模擬).
//
//   start  { action: "start", chapters, studentId }
//     → { sessionId, examPayload, questions[{ id, kind, concept, question, sourceChapter }], chapters }
//   turn   { action: "turn", examPayload, questionIndex, transcript, studentText, studentId }
//     → { reply, action: "followup" | "next", followUpsUsed }
//   finish { action: "finish", examPayload, transcripts, skipped, elapsed, studentId }
//     → { result: { results[], totalScore, maxScore, grade, overallFeedback, questions[] } }
//
// Flow: start → for each question: canned answer, follow the examiner's
// follow-ups with canned replies (bounded) → a synthetic cap probe that
// pre-fills a transcript with MAX_FOLLOWUPS examiner turns and asserts
// the route short-circuits to "next" → finish.

import {
  loadGolden, postJson, makeResult, failedResult, isZhDominant,
  GRADE_LETTERS, sum, bodyBytes, validateBody,
} from "../lib.mjs";

export const name = "oral";
const KINDS = ["concept", "derivation", "application"];
const START_CHECKS = ["http", "threeQuestions", "kindsInOrder", "noModelAnswer", "chapterScope", "hasPayload"];
const TURN_CHECKS = ["http", "actionValid", "replyNonEmpty", "replyZh", "followUpsCounted"];
const CAP_CHECKS = ["http", "capHonored"];
const FINISH_CHECKS = ["http", "threeResults", "subScoresInRange", "earnedConsistent", "totals", "gradeLetter", "feedbackZh", "revealsModelAnswer"];

export function buildStartBody(golden, ctx) {
  return { action: "start", chapters: golden.chapters, studentId: ctx.studentId };
}

export function buildTurnBody(ctx, examPayload, questionIndex, transcript, studentText) {
  return { action: "turn", examPayload, questionIndex, transcript, studentText, studentId: ctx.studentId };
}

export function buildFinishBody(ctx, examPayload, questions, transcripts, elapsedSeconds) {
  const elapsed = Object.fromEntries(questions.map((q) => [String(q.id), elapsedSeconds]));
  return { action: "finish", examPayload, transcripts, skipped: [], elapsed, studentId: ctx.studentId };
}

function cannedAnswer(golden, kind, nth) {
  const a = golden.cannedAnswers ?? {};
  if (nth === 0) return a[kind] ?? a.default ?? "我想這題的重點是先寫出牛頓第二定律，再看合力與加速度的關係。";
  const fu = Array.isArray(a.followup) ? a.followup : [a.followup ?? "補充一下：這個結論的前提是系統只受保守力作用，且摩擦可以忽略。"];
  return fu[(nth - 1) % fu.length];
}

/** Transcript with N examiner turns already spent (for the cap probe). */
function cappedTranscript(question, maxFollowUps) {
  const t = [{ role: "examiner", text: question.question }, { role: "student", text: "我先講到這裡。" }];
  for (let i = 0; i < maxFollowUps; i++) {
    t.push({ role: "examiner", text: `（追問 ${i + 1}）可以再說清楚一點嗎？` });
    t.push({ role: "student", text: "嗯，我再補充一點。" });
  }
  return t;
}

/* ─── dry-run fixture ─── */
function fixtureStart(golden) {
  const ch = golden.chapters[0];
  return {
    sessionId: "00000000-0000-4000-8000-0000000000a1",
    examPayload: "fixture.payload.signature",
    questions: KINDS.map((kind, i) => ({ id: i + 1, kind, concept: `概念 ${i + 1}`, question: `固定口試題 ${i + 1}`, sourceChapter: ch })),
    chapters: golden.chapters,
  };
}

export function plan(ctx) {
  const golden = loadGolden("oral");
  const out = [];
  const start = buildStartBody(golden, ctx);
  const startProblems = validateBody(start, ["action", "chapters", "studentId"]);
  if (!Array.isArray(start.chapters) || start.chapters.some((c) => !Number.isInteger(c) || c < 1 || c > 37)) startProblems.push("chapters must be integers in 1..37");
  out.push({ mode: name, step: "start", method: "POST", path: "/api/oral-exam", body: start, bytes: bodyBytes(start), problems: startProblems });

  const fx = fixtureStart(golden);
  const transcripts = [];
  fx.questions.forEach((q, i) => {
    const transcript = [{ role: "examiner", text: q.question }];
    const body = buildTurnBody(ctx, fx.examPayload, i, transcript, cannedAnswer(golden, q.kind, 0));
    const problems = validateBody(body, ["action", "examPayload", "questionIndex", "transcript", "studentText", "studentId"]);
    if (!body.studentText.trim()) problems.push("studentText empty");
    if (body.questionIndex !== i) problems.push("questionIndex mismatch");
    out.push({ mode: name, step: `turn q${q.id} (${q.kind}, fixture)`, method: "POST", path: "/api/oral-exam", body, bytes: bodyBytes(body), problems });
    transcripts.push([...transcript, { role: "student", text: body.studentText }, { role: "examiner", text: "好，這題到這裡。" }]);
  });

  const cap = buildTurnBody(ctx, fx.examPayload, 0, cappedTranscript(fx.questions[0], golden.maxFollowUps ?? 2), "再補充一句。");
  const capProblems = validateBody(cap, ["action", "examPayload", "questionIndex", "transcript", "studentText"]);
  const examinerTurns = cap.transcript.filter((t) => t.role === "examiner").length;
  if (examinerTurns - 1 !== (golden.maxFollowUps ?? 2)) capProblems.push("cap probe transcript does not carry exactly maxFollowUps follow-ups");
  out.push({ mode: name, step: "turn cap-probe (fixture)", method: "POST", path: "/api/oral-exam", body: cap, bytes: bodyBytes(cap), problems: capProblems });

  const finish = buildFinishBody(ctx, fx.examPayload, fx.questions, transcripts, golden.elapsedSeconds ?? 60);
  const finishProblems = validateBody(finish, ["action", "examPayload", "transcripts", "skipped", "elapsed", "studentId"]);
  if (finish.transcripts.length !== 3) finishProblems.push("transcripts must have 3 entries");
  if (Object.keys(finish.elapsed).length !== 3) finishProblems.push("elapsed must have 3 entries");
  out.push({ mode: name, step: "finish (fixture)", method: "POST", path: "/api/oral-exam", body: finish, bytes: bodyBytes(finish), problems: finishProblems });
  return out;
}

export async function run(ctx) {
  const golden = loadGolden("oral");
  const maxFollowUps = golden.maxFollowUps ?? 2;
  const results = [];

  /* ── start ── */
  ctx.log("▸ [oral] start");
  let start;
  try {
    start = await postJson(ctx.base, "/api/oral-exam", buildStartBody(golden, ctx));
  } catch (err) {
    results.push(failedResult({ mode: name, label: "start", checkNames: START_CHECKS, reason: err }));
    return results;
  }
  const questions = Array.isArray(start.json?.questions) ? start.json.questions : [];
  const examPayload = start.json?.examPayload;
  if (!start.ok || questions.length === 0 || !examPayload) {
    results.push(failedResult({ mode: name, label: "start", checkNames: START_CHECKS, httpStatus: start.status, reason: start.json?.error ?? start.text, durationMs: start.durationMs }));
    return results;
  }
  const scope = new Set(golden.chapters);
  results.push(makeResult({
    mode: name,
    label: "start",
    checks: {
      http: true,
      threeQuestions: questions.length === 3,
      kindsInOrder: questions.length === 3 && questions.every((q, i) => q.kind === KINDS[i]),
      noModelAnswer: questions.every((q) => !("modelAnswer" in q) && !("rubric" in q)),
      chapterScope: questions.every((q) => scope.has(q.sourceChapter)),
      hasPayload: typeof examPayload === "string" && examPayload.length > 0,
    },
    durationMs: start.durationMs,
    httpStatus: start.status,
    usage: start.usage,
    extra: { kinds: questions.map((q) => q.kind), chapters: questions.map((q) => q.sourceChapter), concepts: questions.map((q) => q.concept) },
  }));

  /* ── turns ── */
  const transcripts = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const transcript = [{ role: "examiner", text: q.question }];
    let nth = 0;
    let lastAction = null;
    let lastReply = "";
    let lastFollowUpsUsed = null;
    let turns = 0;
    let turnMs = 0;
    let status = null;
    let reason;
    let actionsSeen = [];
    // Natural loop: answer, then keep replying to follow-ups until the
    // examiner says "next" (bounded by maxFollowUps + 1 student turns).
    while (nth <= maxFollowUps) {
      const studentText = cannedAnswer(golden, q.kind, nth);
      ctx.log(`▸ [oral] turn q${q.id} (${q.kind}) #${nth + 1}`);
      let res;
      try {
        res = await postJson(ctx.base, "/api/oral-exam", buildTurnBody(ctx, examPayload, i, transcript, studentText));
      } catch (err) {
        reason = String(err);
        break;
      }
      turns++;
      turnMs += res.durationMs;
      status = res.status;
      if (!res.ok || !res.json) { reason = res.json?.error ?? res.text; break; }
      transcript.push({ role: "student", text: studentText });
      lastAction = res.json.action;
      lastReply = typeof res.json.reply === "string" ? res.json.reply : "";
      lastFollowUpsUsed = res.json.followUpsUsed;
      actionsSeen.push(lastAction);
      transcript.push({ role: "examiner", text: lastReply });
      if (lastAction !== "followup") break;
      nth++;
    }
    transcripts.push(transcript);
    const examinerReplies = transcript.filter((t) => t.role === "examiner").slice(1).map((t) => t.text).join("\n");
    if (reason) {
      results.push(failedResult({ mode: name, label: `turn q${q.id} (${q.kind})`, checkNames: TURN_CHECKS, httpStatus: status, reason, durationMs: turnMs }));
      continue;
    }
    results.push(makeResult({
      mode: name,
      label: `turn q${q.id} (${q.kind})`,
      checks: {
        http: true,
        actionValid: actionsSeen.length > 0 && actionsSeen.every((a) => a === "followup" || a === "next"),
        replyNonEmpty: lastReply.trim().length > 0,
        replyZh: isZhDominant(examinerReplies, 0.5),
        // followUpsUsed reported on the last call must equal the examiner
        // turns we had already sent beyond the opener.
        followUpsCounted: lastFollowUpsUsed === Math.min(nth, maxFollowUps),
      },
      durationMs: turnMs,
      httpStatus: status,
      extra: { turns, actions: actionsSeen, finalAction: lastAction, followUpsUsed: lastFollowUpsUsed, lastReply: lastReply.slice(0, 120) },
    }));
  }

  /* ── cap probe: transcript already carrying maxFollowUps follow-ups
   *    must be closed by the route without an LLM call. ── */
  ctx.log("▸ [oral] turn cap-probe");
  try {
    const cap = await postJson(ctx.base, "/api/oral-exam", buildTurnBody(ctx, examPayload, 0, cappedTranscript(questions[0], maxFollowUps), "再補充一句。"));
    results.push(makeResult({
      mode: name,
      label: "turn cap-probe",
      checks: {
        http: cap.ok,
        capHonored: cap.json?.action === "next" && cap.json?.followUpsUsed === maxFollowUps,
      },
      durationMs: cap.durationMs,
      httpStatus: cap.status,
      reason: cap.ok ? undefined : (cap.json?.error ?? cap.text),
      extra: { action: cap.json?.action ?? null, followUpsUsed: cap.json?.followUpsUsed ?? null, reply: cap.json?.reply ?? null },
    }));
  } catch (err) {
    results.push(failedResult({ mode: name, label: "turn cap-probe", checkNames: CAP_CHECKS, reason: err }));
  }

  /* ── finish ── */
  ctx.log("▸ [oral] finish");
  let fin;
  try {
    fin = await postJson(ctx.base, "/api/oral-exam", buildFinishBody(ctx, examPayload, questions, transcripts, golden.elapsedSeconds ?? 60));
  } catch (err) {
    results.push(failedResult({ mode: name, label: "finish", checkNames: FINISH_CHECKS, reason: err }));
    return results;
  }
  const result = fin.json?.result;
  if (!fin.ok || !result) {
    results.push(failedResult({ mode: name, label: "finish", checkNames: FINISH_CHECKS, httpStatus: fin.status, reason: fin.json?.error ?? fin.text, durationMs: fin.durationMs }));
    return results;
  }
  const rs = Array.isArray(result.results) ? result.results : [];
  const inRange = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  const feedbackText = [result.overallFeedback ?? "", ...rs.map((r) => r.feedback ?? "")].join("\n");
  results.push(makeResult({
    mode: name,
    label: "finish",
    checks: {
      http: true,
      threeResults: rs.length === 3 && rs.every((r, i) => r.questionId === questions[i]?.id),
      subScoresInRange: rs.every((r) => inRange(r.correctness, 4) && inRange(r.completeness, 3) && inRange(r.clarity, 3)),
      earnedConsistent: rs.every((r) => r.earnedPoints === r.correctness + r.completeness + r.clarity && Math.abs(r.score - r.earnedPoints / 10) < 1e-6),
      totals: result.totalScore === sum(rs.map((r) => r.earnedPoints)) && result.maxScore === questions.length * 10,
      gradeLetter: GRADE_LETTERS.includes(result.grade),
      feedbackZh: feedbackText.trim().length > 0 && isZhDominant(feedbackText, 0.5),
      revealsModelAnswer: Array.isArray(result.questions) && result.questions.length === 3 && result.questions.every((q) => typeof q.modelAnswer === "string" && q.modelAnswer.length > 0),
    },
    durationMs: fin.durationMs,
    httpStatus: fin.status,
    usage: fin.usage,
    extra: {
      totalScore: result.totalScore,
      maxScore: result.maxScore,
      grade: result.grade,
      subScores: rs.map((r) => [r.correctness, r.completeness, r.clarity]),
    },
  }));
  return results;
}
