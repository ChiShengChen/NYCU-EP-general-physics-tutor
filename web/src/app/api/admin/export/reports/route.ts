import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { toCsv, csvResponse } from "@/lib/csv";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/admin/export/reports?status=open|resolved|all
 *
 * CSV of the question_reports queue. Includes the offending question
 * text and the resolution metadata so the admin can audit / archive
 * outside the panel. Capped at 5000 rows to avoid OOM if the queue
 * ever balloons — the panel itself only shows the most recent 200.
 */

const ALLOWED_STATUS = new Set(["open", "resolved", "all"]);
const MAX_ROWS = 5000;

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const status = req.nextUrl.searchParams.get("status") ?? "open";
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const supabase = createServiceClient();
  let q = supabase
    .from("question_reports")
    .select(
      "id, student_id, source_chapter, question_text, correct_answer, reason, detail, created_at, resolved_at, resolved_by_email, resolution_note",
    )
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (status === "open") q = q.is("resolved_at", null);
  if (status === "resolved") q = q.not("resolved_at", "is", null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rowsOut = (data ?? []).map((r) => [
    r.id,
    r.student_id ?? "",
    r.source_chapter ?? "",
    r.reason,
    r.question_text ?? "",
    r.correct_answer ?? "",
    r.detail ?? "",
    r.created_at,
    r.resolved_at ?? "",
    r.resolved_by_email ?? "",
    r.resolution_note ?? "",
  ]);

  const csv = toCsv(
    [
      "id",
      "student_id",
      "chapter",
      "reason",
      "question_text",
      "correct_answer",
      "detail",
      "created_at",
      "resolved_at",
      "resolved_by_email",
      "resolution_note",
    ],
    rowsOut,
  );

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(`reports_${status}_${today}.csv`, csv);
}
