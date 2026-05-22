import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { NextResponse } from "next/server";

export const maxDuration = 30;

const SingleQuestionSchema = z.object({
  question: z.object({
    id: z.number(),
    type: z.enum(["multiple_choice", "short_answer"]),
    concept: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    question: z.string(),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string(),
    explanation: z.string(),
    sourceChapter: z.number(),
    points: z.number().optional(),
  }),
});

/**
 * POST /api/regen-question
 * Body: { previous: <question>, reason?: string }
 *   `previous` is the question to replace; we re-generate a fresh one on
 *   the same chapter / concept / type / difficulty but with new content.
 *   Optional `reason` is one of the question_reports reasons, included in
 *   the prompt so the new version explicitly avoids the prior pitfall.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const prev = body.previous as {
    id: number;
    type: "multiple_choice" | "short_answer";
    concept?: string;
    difficulty?: "easy" | "medium" | "hard";
    question?: string;
    sourceChapter?: number;
    points?: number;
  } | null;
  if (!prev || !prev.id || !prev.type) {
    return NextResponse.json({ error: "previous question required" }, { status: 400 });
  }
  const reason: string = typeof body.reason === "string" ? body.reason : "";

  // RAG context on the same chapter.
  const chunks = await retrieveChunks(
    `${prev.concept ?? ""} ${prev.question?.slice(0, 200) ?? ""}`.trim() || "physics concept",
    { matchCount: 8, matchThreshold: 0.3, filterChapter: prev.sourceChapter },
  );
  const context = formatChunksForPrompt(chunks);

  const reasonHint: Record<string, string> = {
    wrong_answer:    "上一版的「正確答案」可能是錯的，請特別小心驗算 correctAnswer 跟題目的物理一致性。",
    bad_explanation: "上一版的 explanation 不清楚，請寫得更逐步、邏輯更完整。",
    unclear:         "上一版的題目敘述不清楚，請用更具體的物理情境、明確的單位與初始條件重寫。",
    off_topic:       "上一版可能超出本章節範圍，請確定題目核心概念來自第 " + prev.sourceChapter + " 章。",
    too_easy:        "上一版太簡單，請提升一個難度等級；如已是 hard 請出更綜合或計算更繁的題型。",
    too_hard:        "上一版太難 / 超綱，請出符合普物範圍、解法 1–2 步內可完成的版本。",
    other:           "請完全重新出一題，不要重複上一版的問法。",
  };

  const { object } = await generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: SingleQuestionSchema,
    prompt: `你是交通大學電物系「普通物理」課程的 AI 助教，請**重新生成一題**取代學生回報有問題的題目。

要被取代的舊題目（請避免雷同）：
- 章節：Ch${String(prev.sourceChapter ?? 0).padStart(2, "0")}
- 概念：${prev.concept ?? "未指定"}
- 類型：${prev.type === "multiple_choice" ? "選擇題（4 選項 A/B/C/D）" : "簡答題"}
- 難度：${prev.difficulty ?? "medium"}
- 原題：${prev.question?.slice(0, 300) ?? ""}

學生回報的問題：${reason || "未指定"}
${reasonHint[reason] ?? "請出一題完全不同的版本。"}

教材內容：
${context}

請生成 1 題：
- 保持 type = ${prev.type}、difficulty = ${prev.difficulty ?? "medium"}、sourceChapter = ${prev.sourceChapter}
- question.id 維持 ${prev.id}
- ${prev.points ? `points 維持 ${prev.points}` : ""}
- 題目不能與舊版雷同
- 公式用 LaTeX（$..$ / $$..$$）
- ${prev.type === "multiple_choice" ? "options 共 4 個（A/B/C/D），correctAnswer 寫字母 A/B/C/D" : "correctAnswer 寫完整參考答案"}
- explanation 需引用教材具體段落，逐步說明
- 全部繁體中文`,
  });

  return NextResponse.json({ question: restoreLatexInObject(object.question) });
}
