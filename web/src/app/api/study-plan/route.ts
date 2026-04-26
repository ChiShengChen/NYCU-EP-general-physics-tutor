import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const StudyPlanSchema = z.object({
  summary: z.string().describe("一句話總結學習狀況"),
  reviewConcepts: z.array(z.object({
    concept: z.string(),
    reason: z.string(),
    suggestedChapter: z.number(),
    priority: z.enum(["high", "medium", "low"]),
  })).describe("建議複習的概念"),
  strengthenConcepts: z.array(z.object({
    concept: z.string(),
    reason: z.string(),
    suggestedChapter: z.number(),
    exercise: z.string().describe("具體的練習建議"),
  })).describe("建議加強的概念"),
  weeklyPlan: z.string().describe("本週學習計畫，用 Markdown 格式"),
  encouragement: z.string().describe("鼓勵的話"),
});

/** GET /api/study-plan?studentId=xxx */
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();

  // Fetch mastery data
  const { data: mastery } = await supabase
    .from("student_state")
    .select("concept, mastery_score, attempt_count, last_misconception, updated_at")
    .eq("student_id", studentId)
    .order("mastery_score", { ascending: true });

  const concepts = mastery ?? [];
  if (concepts.length === 0) {
    return NextResponse.json({ empty: true, message: "尚無學習紀錄" });
  }

  // Spaced repetition: find concepts needing review
  // Forgetting curve: concepts not practiced in N days lose effective mastery
  const now = Date.now();
  const reviewDue = concepts.map((c) => {
    const daysSince = (now - new Date(c.updated_at).getTime()) / 86400000;
    // Retention = mastery * e^(-daysSince / halfLife), halfLife = 7 days
    const retention = c.mastery_score * Math.exp(-daysSince / 7);
    return { ...c, daysSince: Math.round(daysSince), retention: Math.round(retention * 100) };
  }).filter((c) => c.retention < 50 || c.mastery_score < 0.6);

  // Generate AI study plan
  const { object: plan } = await generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: StudyPlanSchema,
    prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，請根據學生的學習數據生成個人化學習計畫。

學生的概念掌握狀況：
${concepts.map((c) => `- ${c.concept}：掌握度 ${(c.mastery_score * 100).toFixed(0)}%，練習 ${c.attempt_count} 次${c.last_misconception ? `，迷思：${c.last_misconception}` : ""}`).join("\n")}

需要複習的概念（根據遺忘曲線，記憶衰退到 50% 以下）：
${reviewDue.map((c) => `- ${c.concept}：${c.daysSince} 天前練習，預估記憶保持 ${c.retention}%`).join("\n") || "（無）"}

請生成：
1. reviewConcepts：需要複習的概念（記憶衰退或掌握度低的）
2. strengthenConcepts：需要加強的概念（有迷思或掌握度 < 60%），附帶具體練習建議
3. weeklyPlan：本週學習計畫（具體到每天做什麼，用繁體中文 Markdown）
4. 用繁體中文回答，語氣友善鼓勵`,
  });

  return NextResponse.json({
    plan,
    reviewDue: reviewDue.map((c) => ({
      concept: c.concept,
      daysSince: c.daysSince,
      retention: c.retention,
      mastery: Math.round(c.mastery_score * 100),
    })),
  });
}
