import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 60;

/* ─── Zod schemas for structured quiz output ─── */

const QuizQuestionSchema = z.object({
  id: z.number().describe("Question number starting from 1"),
  type: z.enum(["multiple_choice", "short_answer"]),
  concept: z.string().describe("The physics concept this question tests"),
  difficulty: z.enum(["easy", "medium", "hard"]),
  question: z.string().describe("The question text, may include LaTeX"),
  options: z
    .array(z.string())
    .optional()
    .describe("4 options for multiple choice (A/B/C/D), null for short answer"),
  correctAnswer: z.string().describe("The correct answer: A/B/C/D for MC, or expected answer for short answer"),
  explanation: z.string().describe("Detailed explanation of why the answer is correct, with LaTeX if needed"),
  sourceChapter: z.number().describe("Which chapter (1..31) this question is based on"),
});

const QuizSchema = z.object({
  title: z.string().describe("Quiz title in Traditional Chinese"),
  description: z.string().describe("Brief description of what this quiz covers"),
  questions: z.array(QuizQuestionSchema).describe("5 quiz questions"),
});

const GradeResultSchema = z.object({
  results: z.array(
    z.object({
      questionId: z.number(),
      isCorrect: z.boolean(),
      score: z.number().min(0).max(1).describe("0=wrong, 0.5=partial, 1=correct"),
      feedback: z.string().describe("Specific feedback for this answer in Traditional Chinese"),
    }),
  ),
  overallFeedback: z.string().describe("Overall encouragement and study advice in Traditional Chinese"),
});

/* ─── POST /api/quiz — Generate or Grade ─── */

export async function POST(req: Request) {
  const body = await req.json();
  const { action } = body;

  if (action === "generate") return handleGenerate(body);
  if (action === "grade") return handleGrade(body);

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/* ─── Generate Quiz ─── */

async function handleGenerate(body: { studentId?: string; chapter?: number }) {
  const { studentId, chapter } = body;
  const supabase = createServiceClient();

  // === Chapter-scoped quiz: skip weak-concept logic, retrieve only from that chapter ===
  // Generate 20 questions in two parallel batches to stay under Vercel's 60s limit.
  if (chapter && Number.isInteger(chapter) && chapter >= 1 && chapter <= 31) {
    const chunks = await retrieveChunks(
      "key concepts, formulas, derivations, worked examples",
      { matchCount: 16, matchThreshold: 0.3, filterChapter: chapter },
    );
    const context = formatChunksForPrompt(chunks);
    const chLabel = `Ch${String(chapter).padStart(2, "0")}`;

    const buildPrompt = (
      label: string,
      mcCount: number,
      saCount: number,
      idStart: number,
      difficultyDist: string,
    ) => `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，請出一份**${chLabel} 章節測驗**的「${label}」。

範圍限定：第 ${chapter} 章（${chLabel}）。所有題目都必須以這一章的內容為主，不可超出範圍。

以下是該章節的教材內容：
${context}

請生成 ${mcCount + saCount} 題：
- title 訂為「${chLabel} 章節測驗」
- ${mcCount} 題選擇題（multiple_choice）：每題 4 個選項（A/B/C/D）
- ${saCount} 題簡答題（short_answer）：需要簡短的文字、公式或數值回答
- 題目 id 從 ${idStart} 開始連續編號
- 難度分布：${difficultyDist}
- 題目用繁體中文，公式用 LaTeX（$..$ 行內，$$...$$ 獨立）
- 每題都要有詳細解釋
- 所有題目的 sourceChapter 都填 ${chapter}
- 同一份內題目主題盡量分散，不要集中考同一個觀念`;

    const model = google(process.env.CHAT_MODEL ?? "gemini-2.5-flash");
    const [partA, partB] = await Promise.all([
      generateObject({
        model,
        schema: QuizSchema,
        prompt: buildPrompt("選擇題部分", 6, 4, 1, "3 題 easy、4 題 medium、3 題 hard"),
      }),
      generateObject({
        model,
        schema: QuizSchema,
        prompt: buildPrompt("進階與應用部分", 6, 4, 11, "1 題 easy、4 題 medium、5 題 hard"),
      }),
    ]);

    const merged = [...partA.object.questions, ...partB.object.questions]
      .map((q, idx) => ({ ...q, id: idx + 1 }));  // re-id 1..20
    const quiz = {
      title: partA.object.title || partB.object.title || `${chLabel} 章節測驗`,
      description: partA.object.description || `針對第 ${chapter} 章的 20 題測驗`,
      questions: merged,
    };

    return NextResponse.json({ quiz, isIntroQuiz: false, chapter });
  }

  // === Default: full-range quiz driven by weak concepts ===
  let weakConcepts: { concept: string; mastery_score: number; last_misconception: string | null }[] = [];

  if (studentId) {
    const { data } = await supabase
      .from("student_state")
      .select("concept, mastery_score, last_misconception")
      .eq("student_id", studentId)
      .lt("mastery_score", 0.6)
      .order("mastery_score", { ascending: true })
      .limit(5);

    weakConcepts = data ?? [];
  }

  const isIntroQuiz = weakConcepts.length === 0;
  const conceptQueries = isIntroQuiz
    ? ["Newton's Laws of Motion", "Conservation of Energy", "Conservation of Momentum", "Gauss's Law", "Faraday's Law"]
    : weakConcepts.map((wc) => wc.concept);

  const allChunks = await Promise.all(
    conceptQueries.slice(0, 5).map((q) => retrieveChunks(q, { matchCount: 3, matchThreshold: 0.5 })),
  );
  const mergedChunks = allChunks.flat();

  const seen = new Set<number>();
  const uniqueChunks = mergedChunks.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  const context = formatChunksForPrompt(uniqueChunks);

  const weakConceptInfo = isIntroQuiz
    ? "這是新同學的入門測驗，請出基礎題目。"
    : `學生的薄弱概念：\n${weakConcepts.map((wc) => `- ${wc.concept}（掌握度：${(wc.mastery_score * 100).toFixed(0)}%${wc.last_misconception ? `，迷思概念：${wc.last_misconception}` : ""}）`).join("\n")}`;

  const { object: quiz } = await generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: QuizSchema,
    prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，請根據以下資訊生成測驗。

${weakConceptInfo}

以下是相關教材內容：
${context}

請生成一份包含 5 題的測驗：
- 3 題選擇題（multiple_choice）：每題 4 個選項（A/B/C/D）
- 2 題簡答題（short_answer）：需要簡短的文字、公式或數值回答
- 難度根據學生掌握度調整：掌握度低的概念出簡單題幫助建立信心，掌握度中等的出有挑戰性的題目
- 題目用繁體中文，公式用 LaTeX（$..$ 行內，$$...$$ 獨立）
- 每題都要有詳細解釋，引用教材的具體章節（Ch 幾）
- sourceChapter 必須填入 1..31 之間的章節編號
- 如果學生有迷思概念，請針對該迷思設計題目來糾正`,
  });

  return NextResponse.json({ quiz, isIntroQuiz });
}

/* ─── Grade Quiz ─── */

async function handleGrade(body: {
  studentId?: string;
  questions: z.infer<typeof QuizSchema>["questions"];
  answers: Record<number, string>;
  quizTitle?: string;
}) {
  const { studentId, questions, answers, quizTitle } = body;

  // Build grading prompt
  const questionsWithAnswers = questions.map((q) => ({
    id: q.id,
    type: q.type,
    concept: q.concept,
    question: q.question,
    correctAnswer: q.correctAnswer,
    studentAnswer: answers[q.id] ?? "(未作答)",
  }));

  const { object: gradeResult } = await generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: GradeResultSchema,
    prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，請批改以下測驗。

學生的作答：
${JSON.stringify(questionsWithAnswers, null, 2)}

批改規則：
- 選擇題：完全正確 score=1，錯誤 score=0
- 簡答題：完全正確 score=1，部分正確 score=0.5，完全錯誤 score=0
- 簡答題評分寬鬆一些，只要核心概念正確即可
- 每題給具體的繁體中文回饋，解釋為什麼對或錯
- 如果學生答錯，引用正確的概念和公式
- 整體回饋要鼓勵學生，並建議接下來可以複習哪些概念`,
  });

  // Update student mastery scores based on quiz results
  if (studentId) {
    const supabase = createServiceClient();

    for (const result of gradeResult.results) {
      const question = questions.find((q) => q.id === result.questionId);
      if (!question) continue;

      // Fetch current mastery
      const { data: existing } = await supabase
        .from("student_state")
        .select("mastery_score, attempt_count")
        .eq("student_id", studentId)
        .eq("concept", question.concept)
        .single();

      const currentMastery = existing?.mastery_score ?? 0;
      const currentAttempts = existing?.attempt_count ?? 0;

      // Weighted update: blend current mastery with quiz performance
      // New mastery = 0.6 * current + 0.4 * quiz_score (quiz has meaningful weight)
      const newMastery = Math.min(1, Math.max(0, 0.6 * currentMastery + 0.4 * result.score));

      await supabase.from("student_state").upsert(
        {
          student_id: studentId,
          concept: question.concept,
          mastery_score: newMastery,
          attempt_count: currentAttempts + 1,
          last_misconception: result.isCorrect ? null : result.feedback.slice(0, 200),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,concept" },
      );
    }

    // Persist the full attempt for later review. Score = sum of per-question scores
    // expressed as a percentage (max_score = number of questions; total = sum of scores).
    const total = gradeResult.results.reduce((s, r) => s + r.score, 0);
    const maxScore = questions.length;
    await supabase.from("attempts").insert({
      student_id: studentId,
      kind: "quiz",
      exam_type: null,
      title: quizTitle ?? "自動測驗",
      questions,
      answers,
      results: gradeResult.results,
      total_score: total,
      max_score: maxScore,
      grade: null,
      overall_feedback: gradeResult.overallFeedback,
    });
  }

  return NextResponse.json({ gradeResult });
}
