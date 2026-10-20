import { google } from "@ai-sdk/google";
import { pickModel } from "@/lib/models";
import { initBreadcrumbs } from "@/lib/sentry";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { withLLMRetry } from "@/lib/llm-retry";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { checkIpRateLimit, ipRateLimitedResponse } from "@/lib/rate-limit";
import { resolveStudentId } from "@/lib/resolve-student-id";
import {
  evaluateOpticsTask,
  formatOpticsAnswer,
  formatQuantity,
  generateOpticsTask,
  seededRng,
  OPTICS_TEMPLATE_COUNT,
  type OpticsSimKind,
} from "@/lib/optics";
import { NextResponse, after } from "next/server";
import { TEACHER_MIX_RATIO, mixTeacherQuestions, pickTeacherQuestions } from "@/lib/teacher-questions";

export const maxDuration = 60;

const MODEL_NAME = pickModel("exam");

const ExamSchema = z.object({
  title: z.string(),
  questions: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["multiple_choice", "short_answer"]),
      concept: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      question: z.string(),
      options: z.array(z.string()).optional().describe("4 plain option strings — do NOT prepend 'A.' / 'B.' etc., the UI adds the letter prefix when rendering."),
      correctAnswer: z.string(),
      explanation: z.string(),
      sourceChapter: z.number(),
      points: z.number().describe("配分：選擇題每題 8 分，簡答題每題 10 分"),
    }),
  ),
});

/* Interactive optics tasks are NOT produced by the LLM (the prompts below are
 * untouched) — the server appends them with generateOpticsTask() after the
 * LLM batches on the final exam. These schemas describe the response shape
 * and validate the task payload the client echoes back at grading time
 * (same shape as /api/quiz, plus `points`). */

const OpticsTaskSchema = z.object({
  sim: z.enum(["lens", "mirror", "refraction"]),
  adjustable: z.array(z.object({
    key: z.string(), label: z.string(), unit: z.string().optional(),
    min: z.number(), max: z.number(), step: z.number(), initial: z.number(),
  })),
  fixed: z.array(z.object({ key: z.string(), label: z.string(), unit: z.string().optional(), value: z.number() })),
  target: z.array(z.object({
    description: z.string(),
    check: z.object({
      quantity: z.string(),
      op: z.enum(["eq", "gte", "lte", "between"]),
      value: z.number(),
      value2: z.number().optional(),
      tolerance: z.number().optional(),
    }),
  })),
});

const InteractiveOpticsQuestionSchema = z.object({
  id: z.number(),
  type: z.literal("interactive_optics"),
  concept: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  question: z.string(),
  /** Short textual description of one valid configuration. */
  correctAnswer: z.string(),
  explanation: z.string(),
  sourceChapter: z.number(),
  points: z.number(),
  optics: OpticsTaskSchema,
});

type ExamLLMQuestion = z.infer<typeof ExamSchema>["questions"][number];
type ExamResponseQuestion = ExamLLMQuestion | z.infer<typeof InteractiveOpticsQuestionSchema>;

/** Client → server payload for interactive questions: final slider values
 *  plus the client's own verdict (informational only — never trusted). */
const OpticsResultsSchema = z.record(
  z.string(),
  z.object({ values: z.record(z.string(), z.number()), isCorrect: z.boolean().optional() }),
);

const GradeSchema = z.object({
  results: z.array(
    z.object({
      questionId: z.number(),
      isCorrect: z.boolean(),
      score: z.number().min(0).max(1),
      earnedPoints: z.number(),
      feedback: z.string(),
    }),
  ),
  totalScore: z.number(),
  maxScore: z.number(),
  grade: z.string().describe("A+/A/B+/B/C+/C/D/F"),
  overallFeedback: z.string(),
});

type GradeResultItem = z.infer<typeof GradeSchema>["results"][number];

/* ─── Interactive optics helpers ─── */

/** Points per interactive optics task on the final (15 LLM questions = 90 pts,
 *  + 2 × 5 = 100 pts total). */
const OPTICS_POINTS = 5;

/**
 * Two interactive tasks for the final: one lens-or-mirror task (Ch34) and
 * one refraction task (Ch33). Sim + template are drawn from a fresh
 * per-exam seed; the task itself is deterministic given the seed.
 * Ids are placeholders — the caller re-ids the merged list.
 */
function buildFinalOpticsQuestions(): ExamResponseQuestion[] {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const rng = seededRng(seed);
  const picks: { sim: OpticsSimKind; chapter: number }[] = [
    { sim: rng() < 0.5 ? "lens" : "mirror", chapter: 34 },
    { sim: "refraction", chapter: 33 },
  ];
  return picks.map(({ sim, chapter }) => {
    const templateIndex = Math.floor(rng() * OPTICS_TEMPLATE_COUNT[sim]);
    const g = generateOpticsTask(sim, rng, templateIndex);
    return {
      id: 0,
      type: "interactive_optics" as const,
      concept: g.concept,
      difficulty: g.difficulty,
      question: g.question,
      correctAnswer: g.correctAnswer,
      explanation: g.explanation,
      sourceChapter: chapter,
      points: OPTICS_POINTS,
      optics: g.task,
    };
  });
}

function isInteractive(q: ExamResponseQuestion): q is z.infer<typeof InteractiveOpticsQuestionSchema> {
  return q.type === "interactive_optics";
}

/** Same thresholds the grading prompt states (percentage of maxScore). */
function letterGrade(totalScore: number, maxScore: number): string {
  const pct = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
  if (pct >= 90) return "A+";
  if (pct >= 85) return "A";
  if (pct >= 80) return "B+";
  if (pct >= 75) return "B";
  if (pct >= 70) return "C+";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}

export async function POST(req: Request) {
  initBreadcrumbs();
  const body = await req.json();
  const { action } = body;

  // Auth-derived studentId beats body-supplied so a logged-in student
  // can't burn another student's daily quota by passing their UUID here.
  const { studentId } = await resolveStudentId(body.studentId);
  body.studentId = studentId;

  const rate = await checkIpRateLimit(req);
  if (!rate.allowed) {
    const ipResp = ipRateLimitedResponse(rate);
    return NextResponse.json(ipResp.body, { status: ipResp.status });
  }

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  if (action === "generate") return handleGenerate(body);
  if (action === "grade") return handleGrade(body);
  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

async function handleGenerate(body: { examType: string; studentId?: string }) {
  const { examType, studentId } = body as { examType: "midterm" | "final"; studentId?: string };

  const isMidterm = examType === "midterm";
  const chapterRange = isMidterm ? "Ch01–Ch16（力學、振盪、流體、波動、聲學）" : "Ch17–Ch37（熱學、電磁學、電路、電磁波、光學、相對論）";

  // Topic blurb for the prompt (full breadth shown to the model).
  const topicListForPrompt = isMidterm
    ? "Kinematics, Newton's Laws, Work & Energy, Conservation of Energy, Momentum & Collisions, Rotational Motion, Angular Momentum, Static Equilibrium, Gravitation, Simple Harmonic Motion, Fluid Mechanics, Mechanical Waves, Sound"
    : "Temperature & Heat, Ideal Gas, First Law of Thermodynamics, Second Law of Thermodynamics, Electric Field, Gauss's Law, Electric Potential, Capacitance, Current & Resistance, DC Circuits, Magnetic Field, Ampere's Law, Electromagnetic Induction, Inductance, AC Circuits, Maxwell's Equations, Electromagnetic Waves";

  // Retrieval queries: collapsed to 4 broad themes (was 14–15 fine-grained,
  // which exhausted the 60s Vercel Hobby timeout).
  const retrievalQueries = isMidterm
    ? [
        "kinematics, Newton's laws, free-body diagrams, friction",
        "work, kinetic energy, potential energy, conservation of energy, momentum, collisions",
        "rotational motion, torque, angular momentum, static equilibrium, gravitation",
        "simple harmonic motion, fluid mechanics, mechanical waves, sound, beats, Doppler",
      ]
    : [
        "temperature, heat, ideal gas, kinetic theory, equipartition",
        "first and second laws of thermodynamics, entropy, heat engines, Carnot cycle",
        "electric charge, electric field, Gauss's law, electric potential, capacitance, dielectrics",
        "current, resistance, DC circuits, magnetic field, Ampere's law, electromagnetic induction, inductance, AC circuits",
        "Maxwell's equations, displacement current, electromagnetic waves, Poynting vector, polarization",
      ];

  const allChunks = await Promise.all(
    retrievalQueries.map((q) => retrieveChunks(q, { matchCount: 6, matchThreshold: 0.45 })),
  );
  const seen = new Set<number>();
  const uniqueChunks = allChunks.flat().filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
  const context = formatChunksForPrompt(uniqueChunks);

  // Generate 15 questions in four parallel batches to stay well under 60s.
  // Batches 1-3: 4 MC each (5 pts each = 20 pts per batch, 60 pts total).
  // Batch 4: 3 short-answer (10 pts each = 30 pts).
  // Total 15 questions, 90 pts. Smaller batches finish faster (~10-15s vs
  // ~30-40s for the old 8-question call) and avoid FUNCTION_INVOCATION_TIMEOUT.
  const buildPrompt = (
    label: string,
    count: number,
    breakdown: string,
    difficultyDist: string,
    idStart: number,
  ) => `你是交通大學電物系「普通物理」課程（楊本立老師）的出題教授，請出一份${isMidterm ? "期中考" : "期末考"}模擬試題的「${label}」。

範圍：${chapterRange}
主要主題：${topicListForPrompt}

要求：
- 共 ${count} 題：${breakdown}
- 難度分布：${difficultyDist}
- 題目 id 從 ${idStart} 開始連續編號
- 選擇題每題 4 個選項 A/B/C/D
- 簡答題需要完整推導或解釋
- 數學公式用 LaTeX
- 題目用繁體中文，專有名詞可附英文
- 每題標注對應的 sourceChapter（1..32）
- 整份試題的 title 訂為「普通物理 ${isMidterm ? "(I) 期中考" : "(II) 期末考"}模擬試題」

教材內容：
${context}`;

  // 老師題庫: kick the DB sample off now so it overlaps the LLM batches;
  // up to 30% of the 15 LLM questions get swapped for teacher questions
  // from the exam's chapter range (MC↔MC, SA↔SA, points inherited from
  // the replaced slot so the paper still totals the same).
  const examChapters = isMidterm
    ? Array.from({ length: 16 }, (_, i) => i + 1)
    : Array.from({ length: 21 }, (_, i) => i + 17);
  const teacherPoolPromise = pickTeacherQuestions({
    chapters: examChapters,
    count: Math.round(15 * TEACHER_MIX_RATIO),
  });

  const model = google(pickModel("exam"));
  const batches = await Promise.all([
    withLLMRetry(() => generateObject({
      model,
      schema: ExamSchema,
      prompt: buildPrompt(
        "基礎選擇題",
        4,
        "4 題選擇題（每題 5 分，總計 20 分）",
        "3 題 easy、1 題 medium",
        1,
      ),
    }), { studentId, endpoint: "/api/exam", model: MODEL_NAME, label: "exam/gen-1" }),
    withLLMRetry(() => generateObject({
      model,
      schema: ExamSchema,
      prompt: buildPrompt(
        "中階選擇題",
        4,
        "4 題選擇題（每題 5 分，總計 20 分）",
        "1 題 easy、3 題 medium",
        5,
      ),
    }), { studentId, endpoint: "/api/exam", model: MODEL_NAME, label: "exam/gen-2" }),
    withLLMRetry(() => generateObject({
      model,
      schema: ExamSchema,
      prompt: buildPrompt(
        "進階選擇題",
        4,
        "4 題選擇題（每題 5 分，總計 20 分）",
        "1 題 medium、3 題 hard",
        9,
      ),
    }), { studentId, endpoint: "/api/exam", model: MODEL_NAME, label: "exam/gen-3" }),
    withLLMRetry(() => generateObject({
      model,
      schema: ExamSchema,
      prompt: buildPrompt(
        "簡答推導",
        3,
        "3 題簡答題（每題 10 分，總計 30 分）",
        "1 題 medium、2 題 hard",
        13,
      ),
    }), { studentId, endpoint: "/api/exam", model: MODEL_NAME, label: "exam/gen-4" }),
  ]);

  // The final gets two interactive optics tasks (Ch33 / Ch34) on top of the
  // 15 LLM questions — deterministic, graded server-side with physics
  // formulas. Midterm (Ch01–Ch16) has no optics, so nothing is appended.
  const finalOptics = isMidterm ? [] : buildFinalOpticsQuestions();
  const llmQuestions = mixTeacherQuestions(batches.flatMap((b) => b.object.questions), await teacherPoolPromise);
  const merged = ([...llmQuestions, ...finalOptics] as ExamResponseQuestion[])
    .map((q, idx) => ({ ...q, id: idx + 1 }));  // re-id 1..N just in case the model drifted
  const exam = {
    title: batches.find((b) => b.object.title)?.object.title ?? `普通物理 ${isMidterm ? "(I) 期中考" : "(II) 期末考"}模擬試題`,
    questions: merged,
  };

  return NextResponse.json({ exam: restoreLatexInObject(exam), examType, timeLimit: isMidterm ? 75 : 90 });
}

/**
 * Deterministic grading for one interactive optics question. The client's
 * verdict is ignored; we re-run evaluateOpticsTask on the submitted slider
 * values (clamped to the task's ranges inside the evaluator). All-or-nothing:
 * every target must pass to earn the task's points.
 */
function gradeOpticsQuestion(
  q: z.infer<typeof InteractiveOpticsQuestionSchema>,
  submission: { values: Record<string, number> } | undefined,
): GradeResultItem {
  const targetList = q.optics.target.map((t) => `「${t.description}」`).join("、");
  if (!submission) {
    return { questionId: q.id, isCorrect: false, score: 0, earnedPoints: 0, feedback: `未提交任何設定。目標是 ${targetList}；參考設定：${q.correctAnswer}。` };
  }
  const verdict = evaluateOpticsTask(q.optics, submission.values);
  const achievedLines = verdict.perTarget
    .map((t, i) => `${t.ok ? "✓" : "✗"} ${t.description} → 實際 ${formatQuantity(q.optics.target[i].check.quantity, t.actual)}`)
    .join("\n");
  const feedback = verdict.isCorrect
    ? `你的設定（${formatOpticsAnswer(q.optics, submission.values)}）達成了所有目標：\n${achievedLines}`
    : `你的設定（${formatOpticsAnswer(q.optics, submission.values)}）還沒達成全部目標：\n${achievedLines}\n\n參考設定：${q.correctAnswer}。`;
  return {
    questionId: q.id,
    isCorrect: verdict.isCorrect,
    score: verdict.isCorrect ? 1 : 0,
    earnedPoints: verdict.isCorrect ? q.points : 0,
    feedback,
  };
}

async function handleGrade(body: {
  studentId?: string;
  questions: ExamResponseQuestion[];
  answers: Record<number, string>;
  confidences?: Record<number, number>;
  hintUsage?: Record<number, number>;
  /** Interactive optics submissions keyed by question id (see OpticsResultsSchema). */
  opticsResults?: unknown;
  examType: string;
  examTitle?: string;
}) {
  const { studentId, questions, answers, confidences, hintUsage, examType, examTitle } = body;

  // Split interactive optics questions out of the LLM payload: they are
  // graded here with physics formulas, then merged back by questionId.
  const opticsResults = OpticsResultsSchema.safeParse(body.opticsResults ?? {});
  const submissions = opticsResults.success ? opticsResults.data : {};
  const opticsGraded: GradeResultItem[] = [];
  const llmQuestions: ExamLLMQuestion[] = [];
  for (const q of questions) {
    if (!isInteractive(q)) { llmQuestions.push(q); continue; }
    const parsed = InteractiveOpticsQuestionSchema.safeParse(q);
    if (!parsed.success) {
      opticsGraded.push({ questionId: q.id, isCorrect: false, score: 0, earnedPoints: 0, feedback: "這題的模擬器資料損毀，無法批改。" });
      continue;
    }
    const submission = submissions[String(q.id)];
    opticsGraded.push(gradeOpticsQuestion(parsed.data, submission));
    // Make sure the persisted answers column reads sensibly even if the
    // client only sent raw slider values.
    if (submission && !answers[q.id]) answers[q.id] = formatOpticsAnswer(parsed.data.optics, submission.values);
  }

  const qa = llmQuestions.map((q) => ({
    id: q.id, type: q.type, concept: q.concept, question: q.question,
    correctAnswer: q.correctAnswer, studentAnswer: answers[q.id] ?? "(未作答)", points: q.points,
  }));

  // Skip the LLM entirely when every question was interactive (keeps the
  // 60s budget and avoids an empty-payload prompt).
  const llmGrade: z.infer<typeof GradeSchema> = llmQuestions.length === 0
    ? { results: [], totalScore: 0, maxScore: 0, grade: "F", overallFeedback: "這份試卷全部是光學操作題，已用物理公式自動批改。想加強的話可以回到模擬器多玩幾組物距 / 焦距組合。" }
    : restoreLatexInObject((await withLLMRetry(() => generateObject({
      model: google(pickModel("exam")),
      schema: GradeSchema,
      prompt: `批改${examType === "midterm" ? "期中考" : "期末考"}模擬試題。

${JSON.stringify(qa, null, 2)}

批改規則：
- 選擇題：正確得滿分，錯誤 0 分
- 簡答題：完全正確得滿分，部分正確依比例給分，完全錯誤 0 分
- earnedPoints = score * points
- 計算 totalScore 和 maxScore
- grade 依照：90+ A+, 85+ A, 80+ B+, 75+ B, 70+ C+, 60+ C, 50+ D, <50 F（以百分比計）
- 每題給繁體中文回饋
- 整體回饋包含學習建議`,
    }), { studentId, endpoint: "/api/exam", model: MODEL_NAME, label: "exam/grade" })).object);

  // Merge deterministic optics results with the LLM's, ordered by id so the
  // client / attempts row read like a single grading pass. Totals and the
  // letter grade are recomputed here from the merged list (the LLM only saw
  // its own subset, and its arithmetic is not something to rely on anyway).
  const pointsById = new Map(questions.map((q) => [q.id, q.points]));
  const normalisedLLM = llmGrade.results.map((r) => {
    const points = pointsById.get(r.questionId) ?? 0;
    const earned = Math.min(points, Math.max(0, Math.round(r.score * points * 10) / 10));
    return { ...r, earnedPoints: earned };
  });
  const results = [...normalisedLLM, ...opticsGraded].sort((a, b) => a.questionId - b.questionId);
  const totalScore = Math.round(results.reduce((s, r) => s + r.earnedPoints, 0) * 10) / 10;
  const maxScore = questions.reduce((s, q) => s + q.points, 0);
  const result: z.infer<typeof GradeSchema> = {
    results,
    totalScore,
    maxScore,
    grade: letterGrade(totalScore, maxScore),
    overallFeedback: llmGrade.overallFeedback,
  };

  // Persist DB writes AFTER the response goes out — grading LLM already
  // burns most of the 60s Vercel budget, so serial DB calls here were
  // tripping FUNCTION_INVOCATION_TIMEOUT. Run them off the hot path.
  if (studentId) {
    after(async () => {
      const supabase = createServiceClient();

      // Group by concept so an exam that tests the same concept across
      // multiple questions does one read-modify-write per concept rather
      // than racing within the same request.
      const byConcept = new Map<string, { scores: number[]; firstMisconception: string | null }>();
      for (const r of result.results) {
        const q = questions.find((x) => x.id === r.questionId);
        if (!q) continue;
        const slot = byConcept.get(q.concept) ?? { scores: [], firstMisconception: null };
        slot.scores.push(r.score);
        if (!r.isCorrect && !slot.firstMisconception) slot.firstMisconception = r.feedback.slice(0, 200);
        byConcept.set(q.concept, slot);
      }

      await Promise.all(
        Array.from(byConcept.entries()).map(async ([concept, { scores, firstMisconception }]) => {
          const avgScore = scores.reduce((s, x) => s + x, 0) / scores.length;
          const { data: existing } = await supabase
            .from("student_state").select("mastery_score, attempt_count")
            .eq("student_id", studentId).eq("concept", concept).single();
          const cur = existing?.mastery_score ?? 0;
          const attempts = existing?.attempt_count ?? 0;
          const newMastery = Math.min(1, Math.max(0, 0.6 * cur + 0.4 * avgScore));
          await supabase.from("student_state").upsert({
            student_id: studentId, concept, mastery_score: newMastery,
            attempt_count: attempts + 1,
            last_misconception: firstMisconception,
            updated_at: new Date().toISOString(),
          }, { onConflict: "student_id,concept" });
        }),
      );

      // Persist the full attempt for later review.
      const { error: insertErr } = await supabase.from("attempts").insert({
        student_id: studentId,
        kind: "exam",
        exam_type: examType,
        title: examTitle ?? (examType === "midterm" ? "期中考模擬" : "期末考模擬"),
        questions,
        answers,
        confidences: confidences ?? {},
        hint_usage: hintUsage ?? {},
        results: result.results,
        total_score: result.totalScore,
        max_score: result.maxScore,
        grade: result.grade,
        overall_feedback: result.overallFeedback,
      });
      if (insertErr) console.error("Exam attempt persist error:", insertErr);
    });
  }

  return NextResponse.json({ result });
}
