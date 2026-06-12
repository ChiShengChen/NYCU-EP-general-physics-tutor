import { google } from "@ai-sdk/google";
import { pickModel } from "@/lib/models";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { restoreLatexEscapes } from "@/lib/restore-latex";
import { withLLMRetry } from "@/lib/llm-retry";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { checkIpRateLimit, ipRateLimitedResponse } from "@/lib/rate-limit";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextResponse } from "next/server";

export const maxDuration = 30;

const MODEL_NAME = pickModel("hint");

const HintSchema = z.object({
  hint: z.string().describe(
    "繁體中文，1–3 句。一定要遵守該層級的指引深度（見 prompt）— 不可在此層級給出完整答案。" +
    "如果有公式可用 LaTeX 包成 $..$ 或 $$..$$。",
  ),
});

/**
 * POST /api/hint
 * Body: { question, correctAnswer, draftAnswer?, sourceChapter?, level: 1|2|3 }
 *
 * Returns a scaffolded hint at the requested level:
 *   1 (方向)   — point to which physics principle / strategy to consider
 *   2 (公式)   — give the relevant formula or symmetry / setup, no plug-in
 *   3 (下手點) — first concrete step (variable choice / equation to write),
 *                 still leaving the final answer for the student to derive
 *
 * The student already has the correct answer locked in question state on the
 * client; we pass it server-side only so the hint can stay coherent with it,
 * never echo it back. Prompt explicitly forbids leaking the full answer.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const question = String(body.question ?? "").slice(0, 4000);
  const correctAnswer = String(body.correctAnswer ?? "").slice(0, 2000);
  const draftAnswer = String(body.draftAnswer ?? "").slice(0, 2000);
  const sourceChapter = typeof body.sourceChapter === "number" ? body.sourceChapter : null;
  const level = Math.max(1, Math.min(3, Number(body.level) || 1)) as 1 | 2 | 3;
  const { studentId } = await resolveStudentId(body.studentId);

  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const rate = checkIpRateLimit(req);
  if (!rate.allowed) {
    const ipResp = ipRateLimitedResponse(rate);
    return NextResponse.json(ipResp.body, { status: ipResp.status });
  }

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  // Pull a little RAG context from the relevant chapter so hints can cite
  // actual lecture wording.
  const chunks = await retrieveChunks(
    question.slice(0, 500),
    { matchCount: 5, matchThreshold: 0.3, filterChapter: sourceChapter ?? undefined },
  );
  const context = formatChunksForPrompt(chunks);

  const levelGuide: Record<1 | 2 | 3, string> = {
    1: `LEVEL 1 — 方向（最克制）
- 只提示「該想哪個物理原理 / 守恆律 / 策略」，不寫公式、不點任何具體變數
- 例：「想一下這個系統有什麼是不變的？」「先決定要用哪個座標系」
- 嚴格禁止：寫出任何具體公式、任何數值、任何最終答案`,
    2: `LEVEL 2 — 公式 / 對稱性
- 可以寫出該用的公式（LaTeX），或指出可利用的對稱性 / 邊界條件
- 但不要代入數字、不要解方程式
- 例：「動量守恆：$\\vec{p}_i = \\vec{p}_f$。把 $\\vec{p}_i$、$\\vec{p}_f$ 各自寫出來」
- 嚴格禁止：給出代入後的中間步驟、最終答案`,
    3: `LEVEL 3 — 具體下手點
- 給出第一個具體動作：寫哪個方程式、設哪個變數、用哪個座標
- 可以演示「第一步」是什麼，但不要繼續推導到答案
- 例：「設碰撞前甲速度為 $v_1$、碰撞後共同速度為 $v_f$。寫出 $m_1 v_1 = (m_1 + m_2) v_f$，然後解 $v_f$」
- 嚴格禁止：把方程式解到最後給出數值答案`,
  };

  const draftHint = draftAnswer
    ? `\n學生目前已寫的草稿（請參考它的卡關方向，但不評分）：\n${draftAnswer}\n`
    : "";

  const { object } = await withLLMRetry(() => generateObject({
    model: google(pickModel("hint")),
    schema: HintSchema,
    prompt: `你是交通大學電物系「普通物理」課程的 AI 助教，學生在做題卡住了，請給一個**有層級的提示**幫他自己推到答案，**絕對不要直接給答案**。

題目：
${question}

正確答案（僅供你參考避免提示矛盾，**禁止洩漏**）：
${correctAnswer}
${draftHint}
教材內容（可在提示中引用）：
${context}

請給 LEVEL ${level} 的提示。

${levelGuide[level]}

最終輸出：1–3 句的繁體中文提示，公式用 LaTeX。`,
  }), { studentId, endpoint: "/api/hint", model: MODEL_NAME, label: "hint" });

  return NextResponse.json({ hint: restoreLatexEscapes(object.hint), level });
}
