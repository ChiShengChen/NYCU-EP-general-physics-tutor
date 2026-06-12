import { google } from "@ai-sdk/google";
import { pickModel } from "@/lib/models";
import { initBreadcrumbs } from "@/lib/sentry";
import { generateText } from "ai";
import { createServiceClient } from "@/lib/supabase/server";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { checkIpRateLimit, ipRateLimitedResponse } from "@/lib/rate-limit";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * 反思日誌 — metacognition journal.
 *
 * GET  /api/reflection?studentId=xxx          → list (most-recent first)
 * POST /api/reflection { studentId, content, promptUsed? }
 *      → AI reads the entry plus the student's recent mastery state,
 *        returns 3–5 sentence feedback pointing out patterns / blind
 *        spots / a concrete next step. Saves both to DB.
 */
export async function GET(req: NextRequest) {
  initBreadcrumbs();
  // Reflections can be deeply personal — don't let a caller list someone
  // else's reflections by guessing their UUID. Auth-derived id wins.
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("reflections")
    .select("id, content, ai_feedback, prompt_used, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reflections: data ?? [] });
}

export async function POST(req: Request) {
  initBreadcrumbs();
  const body = await req.json();
  const content = String(body.content ?? "").trim().slice(0, 5000);
  const promptUsed = String(body.promptUsed ?? "").slice(0, 500);

  // Resolve from auth so a logged-in caller can't write a reflection into
  // another user's journal by passing their UUID in the body.
  const { studentId } = await resolveStudentId(body.studentId);
  if (!studentId || !content) {
    return NextResponse.json({ error: "studentId + content required" }, { status: 400 });
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

  const supabase = createServiceClient();

  // Pull a short snapshot of the student's current strengths & weaknesses
  // so the AI feedback is personalised, not generic.
  const { data: stateRows } = await supabase
    .from("student_state")
    .select("concept, mastery_score, last_misconception, updated_at")
    .eq("student_id", studentId)
    .order("mastery_score", { ascending: true })
    .limit(8);

  const weak = (stateRows ?? []).filter((r) => r.mastery_score < 0.6);
  const strong = (stateRows ?? []).filter((r) => r.mastery_score >= 0.7);

  const stateSummary = (stateRows ?? []).length === 0
    ? "（學生還沒有累積足夠的測驗資料）"
    : `學生目前的概念掌握度（從掌握度低到高）：
${(stateRows ?? []).map((r) => `- ${r.concept}: ${(r.mastery_score * 100).toFixed(0)}%${r.last_misconception ? `（迷思：${r.last_misconception}）` : ""}`).join("\n")}`;

  const { text: aiFeedback } = await generateText({
    model: google(pickModel("reflection")),
    prompt: `你是交通大學電物系「普通物理」課程的 AI 助教，正在幫學生看他的本週「反思日誌」。
這是後設認知（metacognition）訓練 — 學生願意寫下自己學什麼、卡哪裡，是非常珍貴的事。

學生這次的反思內容：
"""
${content}
"""

${promptUsed ? `（學生用的引導題目：${promptUsed}）\n` : ""}

${stateSummary}

請給 3–5 句的回饋，**繁體中文**，原則：
1. **先 acknowledge** 學生願意反思這件事本身（1 句，不要太肉麻）
2. 從反思內容指出 1 個你觀察到的**模式 / 盲點 / 進步**（具體，不要空話）
3. 如果學生提到的卡關點對得上他的弱概念（${weak.length > 0 ? weak.map((r) => r.concept).join("、") : "無"}），點出來、給一個**具體下一步**（例：「下次做 Ch10 章節測驗時試試先...」）
4. 如果反思裡有迷思 / 認知扭曲（例如「我永遠不會...」「我太笨...」），溫和指出並 reframe
5. 結尾用 1 句鼓勵 / 提問引導下一步反思

不要：
- 條列式 1234，請用自然段落
- 用「同學你好」這種過於正式的開頭
- 引用學生的弱點清單像是 dashboard（學生不愛被當成數據看）

公式如需要可用 LaTeX。長度控制在 4–6 句之間。`,
  });

  const { data: inserted, error } = await supabase.from("reflections").insert({
    student_id: studentId,
    content,
    ai_feedback: aiFeedback,
    prompt_used: promptUsed || null,
  }).select("id, content, ai_feedback, prompt_used, created_at").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void strong;  // strong concepts could be referenced too; reserved for later use.
  return NextResponse.json({ reflection: inserted });
}
