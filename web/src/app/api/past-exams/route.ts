import { google } from "@ai-sdk/google";
import { pickModel } from "@/lib/models";
import { captureRouteError, initBreadcrumbs } from "@/lib/sentry";
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
  PAST_EXAM_TAG,
  blendMastery,
  groupPastExamSets,
  normalizeMcAnswer,
  rowInSet,
  snippetOf,
} from "@/lib/past-exams";
import { NextRequest, NextResponse, after } from "next/server";

export const maxDuration = 30;

const ENDPOINT = "/api/past-exams";
const SIMILAR_MODEL = pickModel("regen");
const GRADE_MODEL = pickModel("quiz");

/**
 * 考古題模式 — student-facing view of the teacher question bank.
 *
 * A past-exam question is a `teacher_questions` row tagged `考古題` plus a
 * year-term tag (`2024-期中`, `2023-期末`, …). See `lib/past-exams.ts`.
 *
 * GET  /api/past-exams
 *      → { sets: [{ tag, count, chapters }], total }      newest first
 * GET  /api/past-exams?set=2024-期中[&reveal=1]
 *      → { set, questions: [...] }                        chapter, then id
 *      `correct_answer` / `explanation` are withheld unless `reveal=1`, so
 *      the list a student loads up front can't be read for the key.
 *
 * POST /api/past-exams   { action, questionId, studentId?, ... }
 *      action = "locate"  → { pages: [{ chapter, page, sectionTitle, snippet }] }
 *                           top-3 lecture pages via RAG on the question's
 *                           chapter — embedding only, no LLM.
 *      action = "similar" → { question }   one `regen`-tier LLM call that
 *                           writes a fresh variant on the same concept /
 *                           type / chapter.
 *      action = "check"   → { isCorrect, score, feedback, correctAnswer, explanation }
 *                           MC: deterministic. Short answer: one `quiz`-tier
 *                           grade call (score 0 / 0.5 / 1). Pass `variant`
 *                           (the object `similar` returned) instead of
 *                           relying on `questionId` to grade a variant.
 *
 * Reads use the service role (RLS has no student policy on the table).
 * `resolveStudentId` is for quota + mastery only — there is no admin gate.
 * Nothing is written to `attempts`; mastery in `student_state` is blended
 * with the same 0.6 / 0.4 weights the quiz / exam routes use.
 */

const ROW_COLUMNS = "id, chapter, type, concept, difficulty, question, options, correct_answer, explanation, points, tags";
const FETCH_LIMIT = 2000;
const SET_TAG_MAX = 50;
const ANSWER_MAX = 5000;

interface Row {
  id: number;
  chapter: number;
  type: "multiple_choice" | "short_answer";
  concept: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  points: number;
  tags: string[];
}

/** What the client sees for one question (answer key only when `reveal`). */
function toClientQuestion(r: Row, reveal: boolean) {
  return {
    id: r.id,
    chapter: r.chapter,
    type: r.type,
    concept: r.concept,
    difficulty: r.difficulty,
    question: r.question,
    options: r.type === "multiple_choice" && Array.isArray(r.options) ? r.options : null,
    points: r.points,
    tags: r.tags ?? [],
    ...(reveal ? { correctAnswer: r.correct_answer, explanation: r.explanation } : {}),
  };
}

async function fetchPastExamRows(): Promise<{ rows: Row[]; error: string | null }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("teacher_questions")
    .select(ROW_COLUMNS)
    .eq("is_active", true)
    .contains("tags", [PAST_EXAM_TAG])
    .limit(FETCH_LIMIT);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as Row[], error: null };
}

/* ─── GET ─── */

export async function GET(req: NextRequest) {
  initBreadcrumbs();
  const params = req.nextUrl.searchParams;
  const set = (params.get("set") ?? "").trim();
  if (set.length > SET_TAG_MAX) return NextResponse.json({ error: "invalid set" }, { status: 400 });
  const reveal = params.get("reveal") === "1";

  const { rows, error } = await fetchPastExamRows();
  if (error) return NextResponse.json({ error }, { status: 500 });

  if (!set) {
    const sets = groupPastExamSets(rows);
    return NextResponse.json({ sets, total: rows.length });
  }

  const questions = rows
    .filter((r) => rowInSet(r.tags, set))
    .sort((a, b) => a.chapter - b.chapter || a.id - b.id)
    .map((r) => toClientQuestion(r, reveal));
  return NextResponse.json({ set, questions });
}

/* ─── POST ─── */

const VariantSchema = z.object({
  type: z.enum(["multiple_choice", "short_answer"]),
  concept: z.string().max(200).default(""),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  question: z.string().min(1).max(5000),
  options: z.array(z.string().max(1000)).length(4).optional(),
  correctAnswer: z.string().min(1).max(5000),
  explanation: z.string().max(10000).default(""),
  sourceChapter: z.number().int().min(1).max(37),
});

const BodySchema = z.object({
  action: z.enum(["locate", "similar", "check"]),
  questionId: z.number().int().positive().optional(),
  answer: z.string().max(ANSWER_MAX).optional(),
  variant: VariantSchema.optional(),
  studentId: z.unknown().optional(),
});

/** LLM output for `similar` — same shape as /api/regen-question minus the id. */
const VariantOutputSchema = z.object({
  question: z.object({
    type: z.enum(["multiple_choice", "short_answer"]),
    concept: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    question: z.string(),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string(),
    explanation: z.string(),
    sourceChapter: z.number(),
  }),
});

const GradeSchema = z.object({
  isCorrect: z.boolean(),
  score: z.number().min(0).max(1).describe("0=wrong, 0.5=partial, 1=correct"),
  feedback: z.string().describe("Specific feedback for this answer in Traditional Chinese"),
});

/** The thing being located / varied / graded: a bank row or a client-echoed variant. */
interface Target {
  type: "multiple_choice" | "short_answer";
  concept: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  chapter: number;
}

function rowToTarget(r: Row): Target {
  return {
    type: r.type,
    concept: r.concept,
    difficulty: r.difficulty,
    question: r.question,
    options: r.type === "multiple_choice" && Array.isArray(r.options) ? r.options : null,
    correctAnswer: r.correct_answer,
    explanation: r.explanation,
    chapter: r.chapter,
  };
}

function conceptLabel(t: Target): string {
  return t.concept.trim() || `Ch${String(t.chapter).padStart(2, "0")} 考古題`;
}

export async function POST(req: Request) {
  initBreadcrumbs();
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const body = parsed.data;
  const { studentId } = await resolveStudentId(body.studentId);

  const rate = await checkIpRateLimit(req);
  if (!rate.allowed) {
    const ipResp = ipRateLimitedResponse(rate);
    return NextResponse.json(ipResp.body, { status: ipResp.status });
  }

  // Resolve the target before the quota check so a bad id is a 404, not a
  // wasted quota round-trip. `check` may grade a variant the client got
  // from `similar` — it echoes the whole object back, nothing to look up.
  let target: Target;
  if (body.action === "check" && body.variant) {
    const v = body.variant;
    target = {
      type: v.type,
      concept: v.concept,
      difficulty: v.difficulty,
      question: v.question,
      options: v.type === "multiple_choice" ? (v.options ?? null) : null,
      correctAnswer: v.correctAnswer,
      explanation: v.explanation,
      chapter: v.sourceChapter,
    };
  } else {
    if (!body.questionId) return NextResponse.json({ error: "questionId required" }, { status: 400 });
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("teacher_questions")
      .select(ROW_COLUMNS)
      .eq("id", body.questionId)
      .eq("is_active", true)
      .contains("tags", [PAST_EXAM_TAG])
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    target = rowToTarget(data as Row);
  }

  const answer = (body.answer ?? "").trim();
  // MC checks and empty short answers never touch Gemini (or the embedding
  // model), so they stay usable after the daily quota is gone.
  const needsQuota = body.action !== "check" || (target.type === "short_answer" && answer.length > 0);
  if (needsQuota) {
    const quota = await checkDailyQuota(studentId);
    if (quota.blocked) {
      const r = quotaExceededResponse(quota);
      return NextResponse.json(r.body, { status: r.status });
    }
  }

  try {
    if (body.action === "locate") return await handleLocate(target);
    if (body.action === "similar") return await handleSimilar(target, studentId);
    return await handleCheck(target, answer, studentId);
  } catch (err) {
    captureRouteError(err, { endpoint: ENDPOINT, studentId, meta: { action: body.action, questionId: body.questionId ?? null } });
    return NextResponse.json({ error: "考古題系統暫時無法回應，請稍後再試" }, { status: 500 });
  }
}

/* ─── locate ─── */

async function handleLocate(target: Target) {
  const query = `${target.concept} ${target.question.slice(0, 300)}`.trim() || "physics concept";
  // Ask for a few more than we show: several chunks can share one slide.
  const chunks = await retrieveChunks(query, { matchCount: 8, matchThreshold: 0.3, filterChapter: target.chapter });
  const seen = new Set<string>();
  const pages: { chapter: number; page: number; sectionTitle: string; snippet: string }[] = [];
  for (const c of chunks) {
    const key = `${c.chapter_number}-${c.page_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push({
      chapter: c.chapter_number,
      page: c.page_number,
      sectionTitle: c.section_title ?? "",
      snippet: snippetOf(c.content),
    });
    if (pages.length >= 3) break;
  }
  return NextResponse.json({ pages });
}

/* ─── similar ─── */

async function handleSimilar(target: Target, studentId: string | null) {
  const chunks = await retrieveChunks(
    `${target.concept} ${target.question.slice(0, 200)}`.trim() || "physics concept",
    { matchCount: 8, matchThreshold: 0.3, filterChapter: target.chapter },
  );
  const context = formatChunksForPrompt(chunks);
  const chLabel = `Ch${String(target.chapter).padStart(2, "0")}`;

  const { object } = await withLLMRetry(() => generateObject({
    model: google(SIMILAR_MODEL),
    schema: VariantOutputSchema,
    prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教。學生正在練習一題**歷年考古題**，請出一題**同概念、同題型、同難度的類似題**讓他再練一次。

原考古題（請保留考點，但換情境 / 數值 / 問法，不可雷同）：
- 章節：${chLabel}
- 概念：${target.concept || "未指定"}
- 類型：${target.type === "multiple_choice" ? "選擇題（4 選項 A/B/C/D）" : "簡答題"}
- 難度：${target.difficulty}
- 原題：${target.question.slice(0, 600)}
${target.type === "multiple_choice" && target.options ? `- 原選項：${target.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("；")}` : ""}

教材內容：
${context}

請生成 1 題：
- type = ${target.type}、difficulty = ${target.difficulty}、sourceChapter = ${target.chapter}
- concept 填「${target.concept || "（依題目判斷）"}」
- 考同一個物理觀念，但題目不能與原題雷同（換物理情境、數值或問法）
- 公式用 LaTeX（$..$ / $$..$$）
- ${target.type === "multiple_choice" ? "options 共 4 個純文字選項（不要自己加 A. / B. 前綴），correctAnswer 寫字母 A/B/C/D" : "correctAnswer 寫完整參考答案"}
- explanation 逐步說明，並引用教材的具體段落
- 全部繁體中文`,
  }), { studentId, endpoint: ENDPOINT, model: SIMILAR_MODEL, label: "past-exams/similar" });

  const q = restoreLatexInObject(object.question);
  const question = {
    ...q,
    // Defensive: the model is told these, but the client grades MC locally
    // against `options`, so pin the ones we actually know.
    type: target.type,
    sourceChapter: target.chapter,
    options: target.type === "multiple_choice" ? (q.options ?? []).slice(0, 4) : undefined,
    source: "variant" as const,
  };
  return NextResponse.json({ question });
}

/* ─── check ─── */

async function handleCheck(target: Target, answer: string, studentId: string | null) {
  let isCorrect: boolean;
  let score: number;
  let feedback: string;

  if (target.type === "multiple_choice") {
    const picked = normalizeMcAnswer(answer);
    const key = normalizeMcAnswer(target.correctAnswer) ?? target.correctAnswer.trim().toUpperCase();
    isCorrect = picked !== null && picked === key;
    score = isCorrect ? 1 : 0;
    feedback = picked === null
      ? `未作答。正確答案是 ${key}。`
      : isCorrect
        ? `答對了！正確答案是 ${key}。`
        : `答錯了。你選 ${picked}，正確答案是 ${key}。`;
  } else if (answer.length === 0) {
    isCorrect = false;
    score = 0;
    feedback = "未作答。先看參考答案與解析，再按「出一題類似的」練一次。";
  } else {
    const { object } = await withLLMRetry(() => generateObject({
      model: google(GRADE_MODEL),
      schema: GradeSchema,
      prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，請批改學生對一題歷年考古題的作答。

題目：
${target.question}

參考答案（老師提供）：
${target.correctAnswer}
${target.explanation ? `\n老師的解析：\n${target.explanation}\n` : ""}
學生的作答：
${answer}

批改規則：
- 完全正確 score=1，部分正確 score=0.5，完全錯誤 score=0；isCorrect 只在 score=1 時為 true
- 評分寬鬆一些，只要核心概念正確即可；數值題允許合理的四捨五入與等價的單位寫法
- 給具體的繁體中文回饋，解釋為什麼對或錯
- 如果學生答錯，引用正確的概念和公式，但不要只是照抄參考答案`,
    }), { studentId, endpoint: ENDPOINT, model: GRADE_MODEL, label: "past-exams/check" });
    const graded = restoreLatexInObject(object);
    score = graded.score >= 0.75 ? 1 : graded.score >= 0.25 ? 0.5 : 0;
    isCorrect = score === 1;
    feedback = graded.feedback;
  }

  // Mastery only — this mode deliberately doesn't create `attempts` rows.
  if (studentId) {
    const concept = conceptLabel(target);
    const finalScore = score;
    const misconception = isCorrect ? null : feedback.slice(0, 200);
    after(async () => {
      const supabase = createServiceClient();
      const { data: existing } = await supabase
        .from("student_state")
        .select("mastery_score, attempt_count")
        .eq("student_id", studentId)
        .eq("concept", concept)
        .maybeSingle();
      const { error } = await supabase.from("student_state").upsert(
        {
          student_id: studentId,
          concept,
          mastery_score: blendMastery(existing?.mastery_score ?? 0, finalScore),
          attempt_count: (existing?.attempt_count ?? 0) + 1,
          last_misconception: misconception,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,concept" },
      );
      if (error) console.error("past-exams mastery upsert error:", error);
    });
  }

  return NextResponse.json({
    isCorrect,
    score,
    feedback,
    correctAnswer: target.correctAnswer,
    explanation: target.explanation,
  });
}
