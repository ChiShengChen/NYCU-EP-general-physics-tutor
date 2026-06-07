import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { withLLMRetry } from "@/lib/llm-retry";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { NextResponse } from "next/server";

export const maxDuration = 30;

const MODEL_NAME = process.env.CHAT_MODEL ?? "gemini-2.5-flash";

const CompareSchema = z.object({
  rows: z.array(
    z.object({
      dimension: z.string().describe("比較維度（繁體中文），例：定義、公式、守恆條件、向量 vs 純量、物理直覺、容易混淆處、典型題型"),
      a: z.string().describe("概念 A 在這個維度的描述（可含 LaTeX）"),
      b: z.string().describe("概念 B 在這個維度的描述（可含 LaTeX）"),
    }),
  ).min(5).max(8),
  similarities: z.array(z.string()).min(2).max(4).describe("兩概念的相似處 / 共通結構（繁中）"),
  differences: z.array(z.string()).min(2).max(4).describe("兩概念最關鍵的差異（繁中）"),
  pitfalls: z.array(z.string()).min(1).max(3).describe("學生最常搞混的地方 / 常見錯誤（繁中）"),
});

/**
 * POST /api/concept-compare
 * Body: { conceptA: string, conceptB: string }
 *
 * Returns a structured side-by-side comparison table — the core trick in
 * discrimination learning. Students who confuse 動量 vs 角動量 / 電場 vs
 * 電位 / 動能 vs 位能 see exactly where they overlap and where they don't.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const conceptA = String(body.conceptA ?? "").trim().slice(0, 200);
  const conceptB = String(body.conceptB ?? "").trim().slice(0, 200);
  const studentId = typeof body.studentId === "string" ? body.studentId : null;
  if (!conceptA || !conceptB) {
    return NextResponse.json({ error: "both conceptA and conceptB required" }, { status: 400 });
  }

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  // Pull RAG context on each concept in parallel so the model grounds in
  // actual lecture material rather than its own priors.
  const [chunksA, chunksB] = await Promise.all([
    retrieveChunks(conceptA, { matchCount: 5, matchThreshold: 0.35 }),
    retrieveChunks(conceptB, { matchCount: 5, matchThreshold: 0.35 }),
  ]);
  const contextA = formatChunksForPrompt(chunksA);
  const contextB = formatChunksForPrompt(chunksB);

  const { object } = await withLLMRetry(() => generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: CompareSchema,
    prompt: `你是交通大學電物系「普通物理」課程的 AI 助教，請為兩個概念做一份**並列對比表**幫學生釐清。
這是 discrimination learning（區辨學習）— 學生看到兩個概念並列、知道哪裡像哪裡不像，才能深度理解。

概念 A：${conceptA}
概念 B：${conceptB}

A 的相關教材：
${contextA}

B 的相關教材：
${contextB}

請輸出：
1. **rows**：5–8 個比較維度，每行給出「維度名稱」+「A 的描述」+「B 的描述」。維度要挑「真的能區辨兩者」的角度，不要寫廢話。建議考慮：
   - 定義（這是什麼物理量 / 現象）
   - 核心公式（LaTeX）
   - 向量 vs 純量、保守 vs 非保守、與時間關係、與路徑關係
   - 守恆條件 / 適用範圍
   - 物理直覺 / 想像場景
   - 典型考題的解題策略
2. **similarities**：2–4 點兩者的相似 / 共通結構（學生混淆的原因通常在這裡）
3. **differences**：2–4 點最關鍵的差異（這是 discrimination 重點）
4. **pitfalls**：1–3 點學生最常搞混的地方、常見錯誤

要求：
- 全部用繁體中文，公式用 LaTeX（$..$ 行內、$$...$$ 獨立）
- 描述要具體可驗證，不要抽象口號
- 若兩個概念本來就沒什麼關係（例如「重力 vs 介電質」），直接在 differences 提醒「這兩者沒有直接關聯」並建議學生改比較哪些對`,
  }), { studentId, endpoint: "/api/concept-compare", model: MODEL_NAME, label: "concept-compare" });

  return NextResponse.json({ comparison: restoreLatexInObject(object), conceptA, conceptB });
}
