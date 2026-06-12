import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 20;

/**
 * GET  /api/admin/reports?status=open|resolved|all → list reports
 *      Returns most-recent first, capped at 200 to keep the panel
 *      snappy. `status=open` is the default since that's what an
 *      admin actually wants to triage.
 *
 * POST /api/admin/reports { id, action: "resolve" | "reopen", note? }
 *      Marks (or un-marks) a report as triaged. Stamps the admin's
 *      email so we keep an audit trail without needing a separate
 *      audit_log table.
 */

const ALLOWED_STATUS = new Set(["open", "resolved", "all"]);

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
    .limit(200);
  if (status === "open") q = q.is("resolved_at", null);
  if (status === "resolved") q = q.not("resolved_at", "is", null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(req: Request) {
  const { isAdmin, email } = await getAdminContext();
  if (!isAdmin || !email) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  const action = String(body?.action ?? "");
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
  if (!Number.isInteger(id) || (action !== "resolve" && action !== "reopen")) {
    return NextResponse.json({ error: "invalid id or action" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const update =
    action === "resolve"
      ? {
          resolved_at: new Date().toISOString(),
          resolved_by_email: email,
          resolution_note: note,
        }
      : { resolved_at: null, resolved_by_email: null, resolution_note: null };

  const { error } = await supabase.from("question_reports").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
