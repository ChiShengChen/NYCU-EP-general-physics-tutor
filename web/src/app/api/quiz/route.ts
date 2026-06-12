import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { withLLMRetry } from "@/lib/llm-retry";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextResponse, after } from "next/server";

export const maxDuration = 60;

const MODEL_NAME = process.env.CHAT_MODEL ?? "gemini-2.5-flash";

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
    .describe("4 plain option strings for multiple choice — do NOT prepend 'A.' / 'B.' etc., the UI adds the letter prefix when rendering. Null for short answer."),
  correctAnswer: z.string().describe("The correct answer: A/B/C/D for MC, or expected answer for short answer"),
  explanation: z.string().describe("Detailed explanation of why the answer is correct, with LaTeX if needed"),
  sourceChapter: z.number().describe("Which chapter (1..32) this question is based on"),
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

  // Resolve identity from auth (preferred) before quota or AI work so a
  // logged-in user can't burn another student's quota by passing their
  // UUID in the body. Anonymous tier still accepts body-supplied id.
  const { studentId } = await resolveStudentId(body.studentId);
  body.studentId = studentId;  // downstream handlers read body.studentId

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  if (action === "generate") return handleGenerate(body);
  if (action === "grade") return handleGrade(body);

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/* ─── Generate Quiz ─── */

async function handleGenerate(body: { studentId?: string; chapter?: number; chapters?: number[] }) {
  const { studentId, chapter, chapters } = body;
  const supabase = createServiceClient();

  // === Multi-chapter applied (synthesis) quiz ===
  // Generates 5 problems that REQUIRE combining concepts from 2–3 chapters
  // — the most exam-critical kind of question that single-chapter quizzes
  // can't capture (e.g. rolling-ball = energy + angular momentum;
  // RLC = SHM + circuit laws).
  if (Array.isArray(chapters) && chapters.length >= 2 && chapters.length <= 3 && chapters.every((c) => Number.isInteger(c) && c >= 1 && c <= 37)) {
    const sortedChapters = [...chapters].sort((a, b) => a - b);
    const chunksPerChapter = await Promise.all(
      sortedChapters.map((ch) =>
        retrieveChunks(
          "key concepts, formulas, derivations, worked examples",
          { matchCount: 8, matchThreshold: 0.3, filterChapter: ch },
        ),
      ),
    );
    const allChunks = chunksPerChapter.flat();
    const seen = new Set<number>();
    const uniqueChunks = allChunks.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    const context = formatChunksForPrompt(uniqueChunks);
    const chLabels = sortedChapters.map((ch) => `Ch${String(ch).padStart(2, "0")}`).join(" + ");

    // Cross-chapter synthesis questions each need heavy multi-chapter
    // reasoning, so a single 5-question call could run 40-50s and trip
    // the 60s budget. Split into 2 parallel batches.
    const buildSynthesisPrompt = (
      label: string,
      breakdown: string,
      difficultyDist: string,
      idStart: number,
    ) => `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，請出一份**跨章節綜合應用測驗**的「${label}」。

涵蓋章節：${chLabels}（即 ${sortedChapters.join(", ")}）

**最重要的規則：每一題都必須需要綜合運用至少 2 個章節的概念才能解出來**，而不是任何一章單獨就能搞定。
舉例（普物經典綜合題）：
- 滾動圓盤上斜面 → 能量守恆 + 角動量
- 帶電粒子在磁場中圓周運動 → 牛二 + 圓周運動 + 磁力
- RLC 共振 → 簡諧運動類比 + 電磁感應 + 電容/電感
- 流體中物體浮沉 + 簡諧振盪
- 熱機效率 + 卡諾循環

以下是相關教材內容：
${context}

請生成 ${breakdown}：
- title 訂為「${chLabels} 綜合應用」
- 題目 id 從 ${idStart} 開始連續編號
- 難度分布：${difficultyDist}
- 每題在 explanation 開頭寫一行「綜合考點」，列出涉及哪些章節哪些概念
- sourceChapter 填**最主要**的那一章（從 ${sortedChapters.join(", ")} 中選）
- 題目用繁體中文，公式用 LaTeX
- 概念要真正交織，不要做成「第一段考 ChA、第二段考 ChB」的拼接`;

    const synthModel = google(process.env.CHAT_MODEL ?? "gemini-2.5-flash");
    const synthBatches = await Promise.all([
      withLLMRetry(() => generateObject({
        model: synthModel,
        schema: QuizSchema,
        prompt: buildSynthesisPrompt(
          "選擇題部分",
          "3 題選擇題（multiple_choice），每題 4 個選項（A/B/C/D），場景需要結合 2+ 章節",
          "1 題 medium、2 題 hard",
          1,
        ),
      }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/synthesis-MC" }),
      withLLMRetry(() => generateObject({
        model: synthModel,
        schema: QuizSchema,
        prompt: buildSynthesisPrompt(
          "簡答推導部分",
          "2 題簡答題（short_answer），完整推導題，明確需要用到多章節的概念",
          "2 題 hard",
          4,
        ),
      }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/synthesis-SA" }),
    ]);

    const synthMerged = synthBatches.flatMap((b) => b.object.questions)
      .map((q, idx) => ({ ...q, id: idx + 1 }));  // re-id 1..5
    const quiz = {
      title: synthBatches.find((b) => b.object.title)?.object.title ?? `${chLabels} 綜合應用`,
      description: synthBatches.find((b) => b.object.description)?.object.description ?? `${chLabels} 跨章節綜合應用 5 題`,
      questions: synthMerged,
    };

    return NextResponse.json({ quiz: restoreLatexInObject(quiz), isIntroQuiz: false, chapters: sortedChapters });
  }

  // === Chapter-scoped quiz: skip weak-concept logic, retrieve only from that chapter ===
  // Generate 20 questions in two parallel batches to stay under Vercel's 60s limit.
  if (chapter && Number.isInteger(chapter) && chapter >= 1 && chapter <= 37) {
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

    // Split into 4 parallel batches of 5 questions each. Smaller batches
    // finish faster (each ~10-15s instead of 25-40s for a 10-question call),
    // dropping total wall time enough to stay clear of Vercel's 60s budget.
    const model = google(process.env.CHAT_MODEL ?? "gemini-2.5-flash");
    const batches = await Promise.all([
      withLLMRetry(() => generateObject({
        model,
        schema: QuizSchema,
        prompt: buildPrompt("基礎概念", 3, 2, 1, "2 題 easy、2 題 medium、1 題 hard"),
      }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/chapter-1" }),
      withLLMRetry(() => generateObject({
        model,
        schema: QuizSchema,
        prompt: buildPrompt("公式應用", 3, 2, 6, "1 題 easy、2 題 medium、2 題 hard"),
      }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/chapter-2" }),
      withLLMRetry(() => generateObject({
        model,
        schema: QuizSchema,
        prompt: buildPrompt("推導與綜合", 3, 2, 11, "1 題 easy、2 題 medium、2 題 hard"),
      }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/chapter-3" }),
      withLLMRetry(() => generateObject({
        model,
        schema: QuizSchema,
        prompt: buildPrompt("進階應用", 3, 2, 16, "2 題 medium、3 題 hard"),
      }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/chapter-4" }),
    ]);

    const merged = batches.flatMap((b) => b.object.questions)
      .map((q, idx) => ({ ...q, id: idx + 1 }));  // re-id 1..20
    const quiz = {
      title: batches.find((b) => b.object.title)?.object.title ?? `${chLabel} 章節測驗`,
      description: batches.find((b) => b.object.description)?.object.description ?? `針對第 ${chapter} 章的 20 題測驗`,
      questions: merged,
    };

    return NextResponse.json({ quiz: restoreLatexInObject(quiz), isIntroQuiz: false, chapter });
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
    conceptQueries.slice(0, 5).map((q) => retrieveChunks(q, { matchCount: 4, matchThreshold: 0.5 })),
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

  // Generate 20 questions in two parallel batches (10+10) to stay under 60s.
  const buildFullPrompt = (
    label: string,
    mcCount: number,
    saCount: number,
    idStart: number,
    difficultyDist: string,
    extraGuidance: string,
  ) => `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，請根據以下資訊生成測驗的「${label}」。

${weakConceptInfo}

以下是相關教材內容：
${context}

請生成 ${mcCount + saCount} 題：
- title 訂為「全範圍綜合測驗」
- ${mcCount} 題選擇題（multiple_choice）：每題 4 個選項（A/B/C/D）
- ${saCount} 題簡答題（short_answer）：需要簡短的文字、公式或數值回答
- 題目 id 從 ${idStart} 開始連續編號
- 難度分布：${difficultyDist}
- 題目用繁體中文，公式用 LaTeX（$..$ 行內，$$...$$ 獨立）
- 每題都要有詳細解釋，引用教材的具體章節（Ch 幾）
- sourceChapter 必須填入 1..32 之間的章節編號
${extraGuidance}`;

  // 4 parallel batches of 5 questions to stay well clear of the 60s budget.
  const model = google(process.env.CHAT_MODEL ?? "gemini-2.5-flash");
  const basicHint = isIntroQuiz
    ? "- 對新同學請以基本概念建立題為主"
    : "- 重點放在掌握度最低的概念上，幫學生鞏固基礎";
  const advancedHint = isIntroQuiz
    ? "- 出一些應用題與公式運算題，但仍以基礎概念為核心"
    : "- 偏向應用、推導與多概念綜合題；如有迷思概念請針對它設計糾正題";
  const batches = await Promise.all([
    withLLMRetry(() => generateObject({
      model,
      schema: QuizSchema,
      prompt: buildFullPrompt("基礎概念", 3, 2, 1, "2 題 easy、2 題 medium、1 題 hard", basicHint),
    }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/full-1" }),
    withLLMRetry(() => generateObject({
      model,
      schema: QuizSchema,
      prompt: buildFullPrompt("公式應用", 3, 2, 6, "1 題 easy、2 題 medium、2 題 hard", basicHint),
    }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/full-2" }),
    withLLMRetry(() => generateObject({
      model,
      schema: QuizSchema,
      prompt: buildFullPrompt("推導與綜合", 3, 2, 11, "1 題 easy、2 題 medium、2 題 hard", advancedHint),
    }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/full-3" }),
    withLLMRetry(() => generateObject({
      model,
      schema: QuizSchema,
      prompt: buildFullPrompt("進階應用", 3, 2, 16, "2 題 medium、3 題 hard", advancedHint),
    }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/full-4" }),
  ]);

  const merged = batches.flatMap((b) => b.object.questions)
    .map((q, idx) => ({ ...q, id: idx + 1 }));  // re-id 1..20
  const quiz = {
    title: batches.find((b) => b.object.title)?.object.title ?? "全範圍綜合測驗",
    description: batches.find((b) => b.object.description)?.object.description ?? "依薄弱概念出 20 題綜合測驗",
    questions: merged,
  };

  return NextResponse.json({ quiz: restoreLatexInObject(quiz), isIntroQuiz });
}

/* ─── Grade Quiz ─── */

async function handleGrade(body: {
  studentId?: string;
  questions: z.infer<typeof QuizSchema>["questions"];
  answers: Record<number, string>;
  confidences?: Record<number, number>;
  hintUsage?: Record<number, number>;
  quizTitle?: string;
}) {
  const { studentId, questions, answers, confidences, hintUsage, quizTitle } = body;

  // Build grading prompt
  const questionsWithAnswers = questions.map((q) => ({
    id: q.id,
    type: q.type,
    concept: q.concept,
    question: q.question,
    correctAnswer: q.correctAnswer,
    studentAnswer: answers[q.id] ?? "(未作答)",
  }));

  const { object: gradeResultRaw } = await withLLMRetry(() => generateObject({
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
  }), { studentId, endpoint: "/api/quiz", model: MODEL_NAME, label: "quiz/grade" });
  const gradeResult = restoreLatexInObject(gradeResultRaw);

  // Persist mastery + attempts AFTER the response goes out. The LLM grading
  // alone can eat 40+s of the 60s Vercel budget, so serial DB writes here
  // were tripping FUNCTION_INVOCATION_TIMEOUT. Move them off the hot path
  // via after() and parallelise across concepts.
  if (studentId) {
    after(async () => {
      const supabase = createServiceClient();

      // Group results by concept so a quiz that tests the same concept twice
      // only triggers one read-modify-write per concept (avoids a within-
      // request race where both writes SELECT the same baseline mastery
      // and the second silently overwrites the first).
      const byConcept = new Map<string, { scores: number[]; firstMisconception: string | null }>();
      for (const r of gradeResult.results) {
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
            .from("student_state")
            .select("mastery_score, attempt_count")
            .eq("student_id", studentId)
            .eq("concept", concept)
            .single();

          const currentMastery = existing?.mastery_score ?? 0;
          const currentAttempts = existing?.attempt_count ?? 0;

          // Weighted update: blend current mastery with quiz performance
          // New mastery = 0.6 * current + 0.4 * quiz_score (quiz has meaningful weight)
          const newMastery = Math.min(1, Math.max(0, 0.6 * currentMastery + 0.4 * avgScore));

          await supabase.from("student_state").upsert(
            {
              student_id: studentId,
              concept,
              mastery_score: newMastery,
              attempt_count: currentAttempts + 1,
              last_misconception: firstMisconception,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "student_id,concept" },
          );
        }),
      );

      // Persist the full attempt for later review. Score = sum of per-question scores
      // expressed as a percentage (max_score = number of questions; total = sum of scores).
      const total = gradeResult.results.reduce((s, r) => s + r.score, 0);
      const maxScore = questions.length;
      const { error: insertErr } = await supabase.from("attempts").insert({
        student_id: studentId,
        kind: "quiz",
        exam_type: null,
        title: quizTitle ?? "自動測驗",
        questions,
        answers,
        confidences: confidences ?? {},
        hint_usage: hintUsage ?? {},
        results: gradeResult.results,
        total_score: total,
        max_score: maxScore,
        grade: null,
        overall_feedback: gradeResult.overallFeedback,
      });
      if (insertErr) console.error("Quiz attempt persist error:", insertErr);
    });
  }

  return NextResponse.json({ gradeResult });
}
