import { google } from "@ai-sdk/google";
import { pickModel } from "@/lib/models";
import { initBreadcrumbs } from "@/lib/sentry";
import { generateText } from "ai";
import { createServiceClient } from "@/lib/supabase/server";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { checkIpRateLimit, ipRateLimitedResponse } from "@/lib/rate-limit";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 45;

/**
 * GET /api/export-report?studentId=xxx
 *
 * Generates a single Markdown document covering this student's entire
 * learning history: stats, top wrong-answered concepts, mastery profile,
 * recent attempts, and an AI-written summary at the end. Returned as text
 * (Content-Type: text/markdown) so the browser triggers a download.
 */
export async function GET(req: NextRequest) {
  initBreadcrumbs();
  // Auth-derived studentId wins — the report contains a full dump of a
  // student's attempts + reflections + chat, so we must not let a caller
  // download another user's history by guessing their UUID.
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

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

  // Pull data in parallel
  const [attemptsResp, stateResp, reflectionsResp] = await Promise.all([
    supabase
      .from("attempts")
      .select("id, kind, exam_type, title, total_score, max_score, grade, results, questions, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("student_state")
      .select("concept, mastery_score, attempt_count, last_misconception, updated_at")
      .eq("student_id", studentId)
      .order("mastery_score", { ascending: true }),
    supabase
      .from("reflections")
      .select("content, ai_feedback, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  type Q = { id: number; concept?: string; sourceChapter?: number; question?: string };
  type R = { questionId: number; isCorrect: boolean };
  type Attempt = {
    id: number;
    kind: "quiz" | "exam";
    exam_type: "midterm" | "final" | null;
    title: string;
    total_score: number;
    max_score: number;
    grade: string | null;
    results: R[];
    questions: Q[];
    created_at: string;
  };

  const attempts = (attemptsResp.data ?? []) as Attempt[];
  const state = stateResp.data ?? [];
  const reflections = reflectionsResp.data ?? [];

  // Aggregate per-concept wrong counts
  const wrongByConcept: Record<string, { count: number; chapters: Set<number> }> = {};
  let totalCorrect = 0, totalAnswered = 0;
  for (const a of attempts) {
    const qById = new Map(a.questions.map((q) => [q.id, q] as const));
    for (const r of a.results) {
      totalAnswered++;
      if (r.isCorrect) totalCorrect++;
      else {
        const q = qById.get(r.questionId);
        const c = q?.concept ?? "(未標註)";
        wrongByConcept[c] ??= { count: 0, chapters: new Set() };
        wrongByConcept[c].count++;
        if (q?.sourceChapter) wrongByConcept[c].chapters.add(q.sourceChapter);
      }
    }
  }
  const topWrong = Object.entries(wrongByConcept)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  // AI-written summary
  const summaryPrompt = `你是交通大學電物系「普通物理」課程的 AI 助教，請為一位學生寫一份**期末學習報告**的「整體總結 + 給未來自己的建議」段落。

學生的整體答題狀況：
- 完成測驗 / 考試：${attempts.length} 份
- 總題數 / 答對：${totalAnswered} / ${totalCorrect}（正確率 ${totalAnswered > 0 ? Math.round(totalCorrect/totalAnswered*100) : 0}%）

最常答錯的概念（前 5）：
${topWrong.slice(0, 5).map(([c, v]) => `- ${c}：錯 ${v.count} 次 (章節 ${[...v.chapters].join(", ")})`).join("\n") || "（無）"}

概念掌握度分布（前 10 個最弱）：
${state.slice(0, 10).map((s) => `- ${s.concept}: ${(s.mastery_score * 100).toFixed(0)}%${s.last_misconception ? ` — 迷思：${s.last_misconception}` : ""}`).join("\n") || "（尚無資料）"}

最近的反思：
${reflections.slice(0, 3).map((r) => `> ${r.content.slice(0, 150)}${r.content.length > 150 ? "..." : ""}`).join("\n\n") || "（無）"}

請寫 4–6 段 Markdown：
1. 一段「整體進步觀察」（指出進步與努力痕跡，具體不空話）
2. 一段「弱點地圖」（把上面的概念用物理直覺串成故事，例如「動量 / 角動量類題容易混淆向量方向」）
3. 一段「下學期 / 期末考前的具體建議」（3–5 個 bullet，可操作）
4. 一段「給未來自己的鼓勵話」（短，不肉麻）

寫繁體中文。公式用 LaTeX（$..$ 或 $$..$$）。`;

  let aiSummary = "（AI 總結生成失敗）";
  try {
    const { text } = await generateText({
      model: google(pickModel("export")),
      prompt: summaryPrompt,
    });
    aiSummary = text;
  } catch (err) {
    console.error("export-report AI summary error", err);
  }

  // Build Markdown
  const now = new Date();
  const lines: string[] = [];
  lines.push(`# 普通物理學習報告`);
  lines.push("");
  lines.push(`> 自動匯出於 ${now.toLocaleString("zh-TW")}`);
  lines.push(`> NYCU 電物系 · 普通物理（楊本立老師）AI 助教`);
  lines.push("");

  lines.push("## 📊 整體數據");
  lines.push("");
  lines.push(`- **完成測驗 / 考試**：${attempts.length} 份`);
  lines.push(`- **總答題數**：${totalAnswered} 題`);
  lines.push(`- **答對率**：${totalAnswered > 0 ? Math.round(totalCorrect/totalAnswered*100) : 0}%（${totalCorrect} / ${totalAnswered}）`);
  lines.push(`- **練過的概念**：${state.length} 個`);
  const avgMastery = state.length > 0 ? (state.reduce((s, r) => s + r.mastery_score, 0) / state.length) : 0;
  lines.push(`- **平均掌握度**：${Math.round(avgMastery * 100)}%`);
  lines.push("");

  if (topWrong.length > 0) {
    lines.push("## ❌ 最常錯的概念 (Top 10)");
    lines.push("");
    lines.push("| 概念 | 錯誤次數 | 涉及章節 |");
    lines.push("| :--- | :--- | :--- |");
    for (const [c, v] of topWrong) {
      lines.push(`| ${c} | ${v.count} | ${[...v.chapters].sort((a, b) => a - b).map((n) => `Ch${String(n).padStart(2, "0")}`).join(", ") || "—"} |`);
    }
    lines.push("");
  }

  if (state.length > 0) {
    lines.push("## 🎯 概念掌握度");
    lines.push("");
    lines.push("| 概念 | 掌握度 | 練習次數 | 迷思 |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const s of state.slice(0, 30)) {
      const pct = Math.round(s.mastery_score * 100);
      const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
      lines.push(`| ${s.concept} | ${bar} ${pct}% | ${s.attempt_count} | ${s.last_misconception ?? "—"} |`);
    }
    if (state.length > 30) lines.push(`| _...還有 ${state.length - 30} 個概念_ | | | |`);
    lines.push("");
  }

  if (attempts.length > 0) {
    lines.push("## 🧪 最近 20 次測驗 / 考試");
    lines.push("");
    lines.push("| 日期 | 類型 | 標題 | 分數 | 等第 |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const a of attempts.slice(0, 20)) {
      const date = new Date(a.created_at).toLocaleDateString("zh-TW");
      const kind = a.kind === "exam" ? `考試模擬 (${a.exam_type === "midterm" ? "期中" : "期末"})` : "自動測驗";
      const score = `${a.total_score.toFixed(a.kind === "exam" ? 0 : 1)} / ${a.max_score.toFixed(0)}`;
      lines.push(`| ${date} | ${kind} | ${a.title} | ${score} | ${a.grade ?? "—"} |`);
    }
    lines.push("");
  }

  if (reflections.length > 0) {
    lines.push("## 🪞 最近的反思");
    lines.push("");
    for (const r of reflections) {
      lines.push(`**${new Date(r.created_at).toLocaleDateString("zh-TW")}**`);
      lines.push("");
      lines.push("> " + r.content.split("\n").join("\n> "));
      lines.push("");
      if (r.ai_feedback) {
        lines.push(`_AI 回饋：${r.ai_feedback}_`);
        lines.push("");
      }
    }
  }

  lines.push("## ✨ AI 個人化總結");
  lines.push("");
  lines.push(aiSummary);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_本報告由 NYCU EP 普通物理 AI 助教自動生成。可作為複習依據、家教 / 老師討論材料或學期末自我存檔。_");

  const md = lines.join("\n");
  const filename = `physics-report-${now.toISOString().slice(0, 10)}.md`;
  return new NextResponse(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
