import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { estimateCost, getDailyLimit, startOfDayTaipei } from "@/lib/usage-log";
import { NextRequest, NextResponse } from "next/server";

/** GET /api/usage/me?studentId=xxx
 *  Returns this-month token usage + cost estimate, grouped by endpoint. */
export async function GET(req: NextRequest) {
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();

  // First day of current month (UTC) for the headline monthly total.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // Start of "7 days ago" (UTC midnight) for the sparkline. Query window is
  // min(monthStart, sevenDaysAgo) so one DB read serves both needs.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCHours(0, 0, 0, 0);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  const queryStart = monthStart.getTime() < sevenDaysAgo.getTime() ? monthStart : sevenDaysAgo;

  const { data: rows, error } = await supabase
    .from("token_usage")
    .select("endpoint, model, prompt_tokens, completion_tokens, total_tokens, created_at")
    .eq("student_id", studentId)
    .gte("created_at", queryStart.toISOString());
  if (error) {
    console.error("[usage/me] read error:", error);
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }

  // Aggregate two ways from the same row set:
  //   - monthly: only rows from monthStart onwards (headline totals + endpoints)
  //   - daily: last 7 days bucketed by UTC date (sparkline)
  const byEndpoint = new Map<string, { calls: number; prompt: number; completion: number; total: number; costUsd: number }>();
  let totalCalls = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCost = 0;

  // Pre-seed the 7-day buckets with zeros so days with no usage still show.
  const dailyMap = new Map<string, { tokens: number; costUsd: number }>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setUTCDate(d.getUTCDate() + i);
    dailyMap.set(d.toISOString().slice(0, 10), { tokens: 0, costUsd: 0 });
  }

  const monthStartMs = monthStart.getTime();
  const sevenDaysAgoMs = sevenDaysAgo.getTime();
  // Compute today's usage inline from the same row set we already pulled,
  // so we don't need to fire a second token_usage scan from
  // checkDailyQuota. Saves one round-trip per dashboard render.
  const todayStartMs = new Date(startOfDayTaipei()).getTime();
  let todayUsed = 0;

  for (const r of rows ?? []) {
    const rowCost = estimateCost(r.model, r.prompt_tokens, r.completion_tokens);
    const tsMs = new Date(r.created_at).getTime();

    if (tsMs >= monthStartMs) {
      const slot = byEndpoint.get(r.endpoint) ?? { calls: 0, prompt: 0, completion: 0, total: 0, costUsd: 0 };
      slot.calls += 1;
      slot.prompt += r.prompt_tokens;
      slot.completion += r.completion_tokens;
      slot.total += r.total_tokens;
      slot.costUsd += rowCost;
      byEndpoint.set(r.endpoint, slot);

      totalCalls += 1;
      totalPrompt += r.prompt_tokens;
      totalCompletion += r.completion_tokens;
      totalCost += rowCost;
    }

    if (tsMs >= sevenDaysAgoMs) {
      const dayKey = new Date(r.created_at).toISOString().slice(0, 10);
      const bucket = dailyMap.get(dayKey);
      if (bucket) {
        bucket.tokens += r.total_tokens;
        bucket.costUsd += rowCost;
      }
    }

    if (tsMs >= todayStartMs) {
      todayUsed += r.total_tokens ?? 0;
    }
  }

  const endpoints = Array.from(byEndpoint.entries())
    .map(([endpoint, v]) => ({
      endpoint,
      calls: v.calls,
      promptTokens: v.prompt,
      completionTokens: v.completion,
      totalTokens: v.total,
      costUsd: Number(v.costUsd.toFixed(4)),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,                          // YYYY-MM-DD (UTC)
      tokens: v.tokens,
      costUsd: Number(v.costUsd.toFixed(4)),
    }));

  // Tier lookup only — `todayUsed` already computed above from the same
  // row set, so we don't pay a second `token_usage` scan that
  // `checkDailyQuota` would otherwise do.
  const { limit, isAuthenticated } = await getDailyLimit(studentId);
  const remaining = Math.max(0, limit - todayUsed);
  const resetAt = new Date(new Date(startOfDayTaipei()).getTime() + 24 * 60 * 60 * 1000).toISOString();

  return NextResponse.json({
    studentId,
    periodStart: monthStart.toISOString(),
    totals: {
      calls: totalCalls,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      costUsd: Number(totalCost.toFixed(4)),
    },
    endpoints,
    daily,
    quota: {
      used: todayUsed,
      limit,
      remaining,
      isAuthenticated,
      resetAt,
    },
  });
}
