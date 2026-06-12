import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { estimateCost } from "@/lib/usage-log";
import { toCsv, csvResponse } from "@/lib/csv";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/admin/export/class?kind=attempts|tokens&days=N
 *
 * Whole-class flat CSVs for offline analysis. Distinct from the
 * usage / single-student exports:
 *
 *  - kind=attempts    one row per attempt (every student, every test
 *                     they took in the window), joined with the
 *                     student's email so the spreadsheet doesn't need
 *                     a vlookup against the profile table.
 *  - kind=tokens      one row per token_usage entry (every API call).
 *                     The "Usage" export aggregates per student; this
 *                     one is the raw event stream for power-users who
 *                     want pivot tables.
 *
 * Capped at 20k rows for tokens / 5k for attempts to keep CSVs in
 * spreadsheet-openable range. If you hit the cap you'll see "TRUNCATED"
 * as the last data row so it's obvious from the file.
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const TOKEN_ROW_CAP = 20_000;
const ATTEMPT_ROW_CAP = 5_000;

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const kind = req.nextUrl.searchParams.get("kind") ?? "attempts";
  if (kind !== "attempts" && kind !== "tokens") {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(1, Math.floor(daysParam)), MAX_DAYS) : DEFAULT_DAYS;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const supabase = createServiceClient();
  // Pre-fetch profiles once and join in JS — Supabase JS doesn't expose
  // a nice cross-table select that handles deleted-profile edge cases.
  const { data: profiles } = await supabase
    .from("student_profiles")
    .select("id, email, display_name");
  const profilesById = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      { email: p.email as string | null, name: p.display_name as string | null },
    ]),
  );
  const labelFor = (sid: string | null): string => {
    if (!sid) return "已刪除帳號";
    const p = profilesById.get(sid);
    return p?.email ?? p?.name ?? `匿名 ${sid.slice(0, 8)}`;
  };

  if (kind === "attempts") {
    const { data, error } = await supabase
      .from("attempts")
      .select("id, student_id, kind, exam_type, title, total_score, max_score, grade, overall_feedback, created_at")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(ATTEMPT_ROW_CAP);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []).map((r) => [
      r.id,
      r.student_id,
      labelFor(r.student_id),
      r.kind,
      r.exam_type ?? "",
      r.title,
      r.total_score,
      r.max_score,
      r.max_score > 0 ? Number((r.total_score / r.max_score).toFixed(3)) : 0,
      r.grade ?? "",
      r.overall_feedback ?? "",
      r.created_at,
    ]);
    if (data && data.length === ATTEMPT_ROW_CAP) {
      rows.push(["TRUNCATED", "", "", "", "", `> ${ATTEMPT_ROW_CAP} rows; tighten ?days=`, "", "", "", "", "", ""]);
    }
    const csv = toCsv(
      [
        "attempt_id",
        "student_id",
        "student_label",
        "kind",
        "exam_type",
        "title",
        "total_score",
        "max_score",
        "score_ratio",
        "grade",
        "overall_feedback",
        "created_at",
      ],
      rows,
    );
    return csvResponse(`class_attempts_${today}_${days}d.csv`, csv);
  }

  // kind === "tokens"
  const { data, error } = await supabase
    .from("token_usage")
    .select("student_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens, created_at")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(TOKEN_ROW_CAP);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []).map((r) => [
    r.student_id ?? "",
    labelFor(r.student_id ?? null),
    r.endpoint,
    r.model,
    r.prompt_tokens,
    r.completion_tokens,
    r.total_tokens,
    estimateCost(r.model, r.prompt_tokens, r.completion_tokens).toFixed(4),
    r.created_at,
  ]);
  if (data && data.length === TOKEN_ROW_CAP) {
    rows.push(["TRUNCATED", `> ${TOKEN_ROW_CAP} rows; tighten ?days=`, "", "", "", "", "", "", ""]);
  }
  const csv = toCsv(
    [
      "student_id",
      "student_label",
      "endpoint",
      "model",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "cost_usd",
      "created_at",
    ],
    rows,
  );
  return csvResponse(`class_tokens_${today}_${days}d.csv`, csv);
}
