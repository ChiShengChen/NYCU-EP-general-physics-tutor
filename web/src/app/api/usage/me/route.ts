import { createServiceClient } from "@/lib/supabase/server";
import { estimateCost } from "@/lib/usage-log";
import { NextRequest, NextResponse } from "next/server";

/** GET /api/usage/me?studentId=xxx
 *  Returns this-month token usage + cost estimate, grouped by endpoint. */
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();

  // First day of current month (UTC) — anything from then forward counts as
  // "this month" for the headline number.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: rows, error } = await supabase
    .from("token_usage")
    .select("endpoint, model, prompt_tokens, completion_tokens, total_tokens, created_at")
    .eq("student_id", studentId)
    .gte("created_at", monthStart.toISOString());
  if (error) {
    console.error("[usage/me] read error:", error);
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }

  // Aggregate by endpoint.
  const byEndpoint = new Map<string, { calls: number; prompt: number; completion: number; total: number; costUsd: number }>();
  let totalCalls = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCost = 0;

  for (const r of rows ?? []) {
    const slot = byEndpoint.get(r.endpoint) ?? { calls: 0, prompt: 0, completion: 0, total: 0, costUsd: 0 };
    const rowCost = estimateCost(r.model, r.prompt_tokens, r.completion_tokens);
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
  });
}
