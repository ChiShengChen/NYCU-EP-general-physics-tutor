import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { estimateCost } from "@/lib/usage-log";
import { toCsv, csvResponse } from "@/lib/csv";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/admin/export/usage?days=30
 *
 * CSV download of the student × token-usage breakdown for the
 * last N days (default 30, clamped to [1, 365]). One row per
 * student so the admin can paste it into Sheets / Excel and
 * sort / filter on real columns instead of working from the panel.
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

interface UsageRow {
  student_id: string | null;
  endpoint: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(1, Math.floor(daysParam)), MAX_DAYS) : DEFAULT_DAYS;

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  const [{ data: rows, error: usageErr }, { data: profiles }] = await Promise.all([
    supabase
      .from("token_usage")
      .select("student_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens, created_at")
      .gte("created_at", cutoff)
      .limit(50_000),
    supabase
      .from("student_profiles")
      .select("id, email, display_name, created_at, last_signed_in_at"),
  ]);

  if (usageErr) return NextResponse.json({ error: usageErr.message }, { status: 500 });

  const usage = (rows ?? []) as UsageRow[];
  const profilesById = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        email: p.email as string | null,
        name: p.display_name as string | null,
        createdAt: p.created_at as string,
        lastSignedInAt: p.last_signed_in_at as string | null,
      },
    ]),
  );

  type Agg = { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; cost: number };
  const byStudent = new Map<string, Agg>();
  for (const r of usage) {
    const sid = r.student_id ?? "__deleted__";
    const c = estimateCost(r.model, r.prompt_tokens, r.completion_tokens);
    const a = byStudent.get(sid) ?? { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
    a.calls += 1;
    a.promptTokens += r.prompt_tokens;
    a.completionTokens += r.completion_tokens;
    a.totalTokens += r.total_tokens;
    a.cost += c;
    byStudent.set(sid, a);
  }

  const sorted = Array.from(byStudent.entries()).sort(([, a], [, b]) => b.totalTokens - a.totalTokens);

  const rowsOut = sorted.map(([sid, a]) => {
    if (sid === "__deleted__") {
      return ["", "已刪除帳號", "anon", a.calls, a.promptTokens, a.completionTokens, a.totalTokens, a.cost.toFixed(4), "", ""];
    }
    const p = profilesById.get(sid);
    return [
      sid,
      p?.email ?? p?.name ?? `匿名 ${sid.slice(0, 8)}`,
      p?.email ? "auth" : "anon",
      a.calls,
      a.promptTokens,
      a.completionTokens,
      a.totalTokens,
      a.cost.toFixed(4),
      p?.createdAt ?? "",
      p?.lastSignedInAt ?? "",
    ];
  });

  const csv = toCsv(
    [
      "student_id",
      "label",
      "auth_type",
      "calls",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "cost_usd",
      "profile_created_at",
      "last_signed_in_at",
    ],
    rowsOut,
  );

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(`usage_${today}_${days}d.csv`, csv);
}
