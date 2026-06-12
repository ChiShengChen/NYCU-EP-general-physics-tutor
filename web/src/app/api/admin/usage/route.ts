import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { estimateCost } from "@/lib/usage-log";
import { NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/admin/usage
 *
 * System-wide token usage breakdown for the admin panel. Aggregates the
 * most recent 30-day window of `token_usage` rows three ways at once
 * (top students, top endpoints, daily totals) so the panel doesn't fan
 * out into three separate fetches that each scan the same table.
 *
 * Privacy: student labels are taken from `student_profiles.email` /
 * `display_name` when available, otherwise the leading 8 chars of the
 * UUID. We don't expose full UUIDs in the response because the admin
 * may copy/paste this panel during a triage session and we'd rather
 * not have profile ids leaking into chat logs.
 */

const WINDOW_DAYS = 30;
const TOP_STUDENTS = 25;

interface UsageRow {
  student_id: string;
  endpoint: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

export async function GET() {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  // Pull everything we need in one shot — both queries hit indexes (the
  // token_usage scan by created_at, the profiles lookup by id).
  const [{ data: rows, error: usageErr }, { data: profiles }] = await Promise.all([
    supabase
      .from("token_usage")
      .select("student_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens, created_at")
      .gte("created_at", cutoff)
      .limit(50_000),
    supabase
      .from("student_profiles")
      .select("id, email, display_name"),
  ]);

  if (usageErr) {
    return NextResponse.json({ error: usageErr.message }, { status: 500 });
  }
  const usage = (rows ?? []) as UsageRow[];
  const profilesById = new Map(
    (profiles ?? []).map((p) => [p.id as string, { email: p.email as string | null, name: p.display_name as string | null }]),
  );

  type StudentSlot = { calls: number; total: number; cost: number };
  type EndpointSlot = { calls: number; total: number; cost: number };
  const byStudent = new Map<string, StudentSlot>();
  const byEndpoint = new Map<string, EndpointSlot>();
  const byDay = new Map<string, { tokens: number; cost: number }>();

  let totalCalls = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const r of usage) {
    const c = estimateCost(r.model, r.prompt_tokens, r.completion_tokens);
    totalCalls += 1;
    totalTokens += r.total_tokens;
    totalCost += c;

    // token_usage.student_id is `on delete set null`, so a row whose
    // profile has been deleted shows up with student_id=null. Bucket
    // those under a sentinel so the panel still totals them rather than
    // crashing on `null.slice(...)` later.
    const sid = r.student_id ?? "__deleted__";
    const s = byStudent.get(sid) ?? { calls: 0, total: 0, cost: 0 };
    s.calls += 1;
    s.total += r.total_tokens;
    s.cost += c;
    byStudent.set(sid, s);

    const e = byEndpoint.get(r.endpoint) ?? { calls: 0, total: 0, cost: 0 };
    e.calls += 1;
    e.total += r.total_tokens;
    e.cost += c;
    byEndpoint.set(r.endpoint, e);

    const day = r.created_at.slice(0, 10);
    const dayEntry = byDay.get(day) ?? { tokens: 0, cost: 0 };
    dayEntry.tokens += r.total_tokens;
    dayEntry.cost += c;
    byDay.set(day, dayEntry);
  }

  // Sort + tag students. Hide raw UUIDs — the panel only needs
  // a human-readable label and a short suffix to disambiguate when two
  // anonymous profiles share a display name.
  const topStudents = Array.from(byStudent.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, TOP_STUDENTS)
    .map(([sid, v]) => {
      if (sid === "__deleted__") {
        return {
          label: "已刪除帳號",
          isAuthenticated: false,
          calls: v.calls,
          totalTokens: v.total,
          costUsd: Number(v.cost.toFixed(4)),
        };
      }
      const p = profilesById.get(sid);
      const label = p?.email ?? p?.name ?? `匿名 ${sid.slice(0, 8)}`;
      return {
        label,
        isAuthenticated: !!p?.email,
        calls: v.calls,
        totalTokens: v.total,
        costUsd: Number(v.cost.toFixed(4)),
      };
    });

  const endpoints = Array.from(byEndpoint.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([endpoint, v]) => ({
      endpoint,
      calls: v.calls,
      totalTokens: v.total,
      costUsd: Number(v.cost.toFixed(4)),
    }));

  const daily = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      tokens: v.tokens,
      costUsd: Number(v.cost.toFixed(4)),
    }));

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    totals: {
      calls: totalCalls,
      totalTokens,
      costUsd: Number(totalCost.toFixed(4)),
      distinctStudents: byStudent.size,
    },
    topStudents,
    endpoints,
    daily,
  });
}
