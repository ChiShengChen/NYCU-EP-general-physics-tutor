import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 20;

/**
 * GET /api/admin/student/chat?id=<student_uuid>&session=<session_uuid>
 *
 * Full chat transcript for one (student, session) pair. The student
 * detail drawer lists sessions with a one-line preview; this endpoint
 * is for "expand" → render the whole back-and-forth so an admin can
 * audit what the model said, look for misuse, debug a complaint, etc.
 *
 * `session=__legacy__` is a sentinel for the pre-session_id rows
 * (chat_messages.session_id IS NULL, from before migration 004).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGES = 500;

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  const session = req.nextUrl.searchParams.get("session");
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!session || (session !== "__legacy__" && !UUID_RE.test(session))) {
    return NextResponse.json({ error: "invalid session" }, { status: 400 });
  }

  const supabase = createServiceClient();
  let q = supabase
    .from("chat_messages")
    .select("id, role, content, chunks_used, created_at")
    .eq("student_id", id)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  q = session === "__legacy__" ? q.is("session_id", null) : q.eq("session_id", session);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ messages: data ?? [] });
}
