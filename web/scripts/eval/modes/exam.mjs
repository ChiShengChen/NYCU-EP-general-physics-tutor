// Mode: exam — /api/exam (期中 / 期末模擬考).
//
//   generate { action: "generate", examType, studentId }
//     → { exam: { title, questions[] }, examType, timeLimit }
//   grade    { action: "grade", examType, examTitle, questions, answers,
//              confidences, hintUsage, opticsResults?, studentId }
//     → { result: { results[], totalScore, maxScore, grade, overallFeedback } }
//
// Canned answers: every multiple_choice gets "A" (the UI stores the
// letter), every short_answer gets a short plausible sentence, and any
// interactive_optics question (not produced by /api/exam today, but the
// quiz route emits them for Ch33/34 and the exam route may follow) gets
// its sliders submitted at their initial values via `opticsResults`.

import {
  loadGolden, postJson, makeResult, failedResult, isZhDominant,
  GRADE_LETTERS, sum, approxEqual, bodyBytes, validateBody,
} from "../lib.mjs";

export const name = "exam";
const GEN_CHECKS = ["http", "count", "idsSequential", "mcOptions", "chapterRange", "pointsSum"];
const GRADE_CHECKS = ["http", "perQuestion", "earnedWithinPoints", "totals", "gradeLetter", "feedbackZh"];

export function buildGenerateBody(c, ctx) {
  return { action: "generate", examType: c.examType, studentId: ctx.studentId };
}

function isOptics(q) {
  return q?.type === "interactive_optics" && q.optics && Array.isArray(q.optics.adjustable);
}

/** Initial slider values for an interactive optics task. */
export function opticsInitialValues(task) {
  return Object.fromEntries(task.adjustable.map((p) => [p.key, p.initial]));
}

export function buildGradeBody(c, ctx, golden, exam) {
  const answers = {};
  const opticsResults = {};
  for (const q of exam.questions) {
    if (isOptics(q)) {
      opticsResults[String(q.id)] = { values: opticsInitialValues(q.optics) };
    } else if (q.type === "multiple_choice") {
      answers[q.id] = "A";
    } else {
      answers[q.id] = golden.cannedShortAnswer?.[c.examType] ?? golden.cannedShortAnswer?.default ?? "先寫出相關定律，代入條件後化簡並檢查單位。";
    }
  }
  const body = {
    action: "grade",
    examType: c.examType,
    examTitle: exam.title,
    questions: exam.questions,
    answers,
    confidences: {},
    hintUsage: {},
    studentId: ctx.studentId,
  };
  if (Object.keys(opticsResults).length > 0) body.opticsResults = opticsResults;
  return body;
}

/* ─── dry-run fixture: 15 regular questions + 1 optics question so the
 *     builder's optics path is exercised without a server. ─── */
function fixtureExam(c) {
  const [lo, hi] = c.chapterRange;
  const questions = [];
  for (let i = 1; i <= 12; i++) {
    questions.push({
      id: i, type: "multiple_choice", concept: `概念 ${i}`, difficulty: "easy",
      question: `固定題 ${i}`, options: ["甲", "乙", "丙", "丁"], correctAnswer: "A",
      explanation: "—", sourceChapter: lo + (i % (hi - lo + 1)), points: 5,
    });
  }
  for (let i = 13; i <= 15; i++) {
    questions.push({
      id: i, type: "short_answer", concept: `概念 ${i}`, difficulty: "hard",
      question: `推導題 ${i}`, correctAnswer: "—", explanation: "—", sourceChapter: hi, points: 10,
    });
  }
  if (c.examType === "final") {
    questions.push({
      id: 16, type: "interactive_optics", concept: "薄透鏡成像", difficulty: "medium",
      question: "調整物距使成像為倒立實像", correctAnswer: "d_o > f", explanation: "—", sourceChapter: 34, points: 5,
      optics: {
        sim: "lens",
        adjustable: [{ key: "dO", label: "物距 d_o", unit: "cm", min: 2, max: 40, step: 0.5, initial: 20 }],
        fixed: [{ key: "f", label: "焦距 f", unit: "cm", value: 10 }],
        target: [{ description: "實像", check: { quantity: "isReal", op: "eq", value: 1 } }],
      },
    });
  }
  return { title: `普通物理 ${c.examType === "midterm" ? "(I) 期中考" : "(II) 期末考"}模擬試題`, questions };
}

export function plan(ctx) {
  const golden = loadGolden("exam");
  const out = [];
  for (const c of golden.cases) {
    const gen = buildGenerateBody(c, ctx);
    out.push({
      mode: name, step: `${c.label} · generate`, method: "POST", path: "/api/exam",
      body: gen, bytes: bodyBytes(gen), problems: validateBody(gen, ["action", "examType", "studentId"]),
    });
    const exam = fixtureExam(c);
    const grade = buildGradeBody(c, ctx, golden, exam);
    const problems = validateBody(grade, ["action", "examType", "questions", "answers", "studentId"]);
    const regular = exam.questions.filter((q) => !isOptics(q));
    if (Object.keys(grade.answers).length !== regular.length) problems.push("answers count != non-optics question count");
    if (regular.some((q) => q.type === "multiple_choice" && grade.answers[q.id] !== "A")) problems.push("MC answer is not 'A'");
    const optics = exam.questions.filter(isOptics);
    if (optics.length > 0) {
      if (!grade.opticsResults) problems.push("optics question present but opticsResults missing");
      else for (const q of optics) {
        const v = grade.opticsResults[String(q.id)]?.values;
        if (!v || q.optics.adjustable.some((p) => v[p.key] !== p.initial)) problems.push(`opticsResults[${q.id}] not at initial values`);
      }
    }
    out.push({
      mode: name, step: `${c.label} · grade (fixture)`, method: "POST", path: "/api/exam",
      body: grade, bytes: bodyBytes(grade), problems,
    });
  }
  return out;
}

function checkGenerate(c, golden, exam) {
  const qs = Array.isArray(exam?.questions) ? exam.questions : [];
  const regular = qs.filter((q) => !isOptics(q));
  const ids = qs.map((q) => q.id);
  const [lo, hi] = c.chapterRange;
  const expected = c.expectedQuestions ?? golden.defaults?.expectedQuestions ?? 15;
  const [pLo, pHi] = c.pointsRange ?? golden.defaults?.pointsRange ?? [80, 100];
  const points = sum(regular.map((q) => q.points));
  return {
    checks: {
      http: true,
      count: regular.length === expected,
      idsSequential: ids.length > 0 && ids.every((id, i) => id === i + 1),
      mcOptions: regular.filter((q) => q.type === "multiple_choice").every((q) => Array.isArray(q.options) && q.options.length === 4),
      chapterRange: qs.length > 0 && qs.every((q) => Number.isInteger(q.sourceChapter) && q.sourceChapter >= lo && q.sourceChapter <= hi),
      pointsSum: points >= pLo && points <= pHi,
    },
    extra: {
      questionCount: qs.length,
      opticsCount: qs.length - regular.length,
      mcCount: regular.filter((q) => q.type === "multiple_choice").length,
      pointsSum: points,
      chapters: [...new Set(qs.map((q) => q.sourceChapter))].sort((a, b) => a - b),
      outOfRange: qs.filter((q) => !(q.sourceChapter >= lo && q.sourceChapter <= hi)).map((q) => `#${q.id}→Ch${q.sourceChapter}`),
    },
  };
}

function checkGrade(exam, result) {
  const qs = exam.questions;
  const rs = Array.isArray(result?.results) ? result.results : [];
  const qIds = new Set(qs.map((q) => q.id));
  const rIds = rs.map((r) => r.questionId);
  const pointsOf = new Map(qs.map((q) => [q.id, q.points]));
  const earned = sum(rs.map((r) => r.earnedPoints));
  const maxExpected = sum(qs.map((q) => q.points));
  const feedbackText = [result?.overallFeedback ?? "", ...rs.map((r) => r.feedback ?? "")].join("\n");
  return {
    checks: {
      http: true,
      perQuestion: rs.length === qs.length && new Set(rIds).size === qs.length && rIds.every((id) => qIds.has(id)),
      earnedWithinPoints: rs.every((r) => Number.isFinite(r.earnedPoints) && r.earnedPoints >= 0 && r.earnedPoints <= (pointsOf.get(r.questionId) ?? Infinity) + 0.01
        && Number.isFinite(r.score) && r.score >= 0 && r.score <= 1),
      totals: approxEqual(result?.totalScore, earned, 1) && approxEqual(result?.maxScore, maxExpected, 1),
      gradeLetter: GRADE_LETTERS.includes(result?.grade),
      feedbackZh: feedbackText.trim().length > 0 && isZhDominant(feedbackText, 0.5),
    },
    extra: {
      resultCount: rs.length,
      totalScore: result?.totalScore ?? null,
      maxScore: result?.maxScore ?? null,
      earnedSum: earned,
      grade: result?.grade ?? null,
    },
  };
}

export async function run(ctx) {
  const golden = loadGolden("exam");
  const results = [];

  for (const c of golden.cases) {
    ctx.log(`▸ [exam] ${c.label} · generate`);
    let gen;
    try {
      gen = await postJson(ctx.base, "/api/exam", buildGenerateBody(c, ctx));
    } catch (err) {
      results.push(failedResult({ mode: name, label: `${c.label} · generate`, checkNames: GEN_CHECKS, reason: err }));
      results.push(failedResult({ mode: name, label: `${c.label} · grade`, checkNames: GRADE_CHECKS, reason: "skipped: generate failed" }));
      continue;
    }
    const exam = gen.json?.exam;
    if (!gen.ok || !exam || !Array.isArray(exam.questions)) {
      results.push(failedResult({ mode: name, label: `${c.label} · generate`, checkNames: GEN_CHECKS, httpStatus: gen.status, reason: gen.json?.error ?? gen.text, durationMs: gen.durationMs }));
      results.push(failedResult({ mode: name, label: `${c.label} · grade`, checkNames: GRADE_CHECKS, reason: "skipped: generate failed" }));
      continue;
    }
    const g = checkGenerate(c, golden, exam);
    results.push(makeResult({ mode: name, label: `${c.label} · generate`, checks: g.checks, durationMs: gen.durationMs, httpStatus: gen.status, usage: gen.usage, extra: g.extra }));

    ctx.log(`▸ [exam] ${c.label} · grade`);
    let graded;
    try {
      graded = await postJson(ctx.base, "/api/exam", buildGradeBody(c, ctx, golden, exam));
    } catch (err) {
      results.push(failedResult({ mode: name, label: `${c.label} · grade`, checkNames: GRADE_CHECKS, reason: err }));
      continue;
    }
    const result = graded.json?.result;
    if (!graded.ok || !result) {
      results.push(failedResult({ mode: name, label: `${c.label} · grade`, checkNames: GRADE_CHECKS, httpStatus: graded.status, reason: graded.json?.error ?? graded.text, durationMs: graded.durationMs }));
      continue;
    }
    const r = checkGrade(exam, result);
    results.push(makeResult({ mode: name, label: `${c.label} · grade`, checks: r.checks, durationMs: graded.durationMs, httpStatus: graded.status, usage: graded.usage, extra: r.extra }));
  }
  return results;
}
