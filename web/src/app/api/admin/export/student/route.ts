import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { estimateCost } from "@/lib/usage-log";
import { toCsv, csvResponse } from "@/lib/csv";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/admin/export/student?id=<uuid>&kind=usage|chats|attempts&days=30
 *
 * Per-student CSV exports. Three kinds so an admin can pick what they
 * actually want to spreadsheet — exporting all three as one wide file
 * would be unreadable in Excel (chat content rows are 1-2KB each).
 *
 *  - usage     one row per token_usage entry (timestamps, endpoint, tokens, cost)
 *  - chats     one row per chat_messages entry (role, content, session)
 *  - attempts  one row per attempt (quiz/exam) with score
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  const kind = req.nextUrl.searchParams.get("kind") ?? "usage";
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(1, Math.floor(daysParam)), MAX_DAYS) : DEFAULT_DAYS;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const sidShort = id.slice(0, 8);

  const supabase = createServiceClient();

  if (kind === "usage") {
    const { data, error } = await supabase
      .from("token_usage")
      .select("created_at, endpoint, model, prompt_tokens, completion_tokens, total_tokens")
      .eq("student_id", id)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(20_000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const csv = toCsv(
      ["created_at", "endpoint", "model", "prompt_tokens", "completion_tokens", "total_tokens", "cost_usd"],
      (data ?? []).map((r) => [
        r.created_at,
        r.endpoint,
        r.model,
        r.prompt_tokens,
        r.completion_tokens,
        r.total_tokens,
        estimateCost(r.model, r.prompt_tokens, r.completion_tokens).toFixed(4),
      ]),
    );
    return csvResponse(`student_${sidShort}_usage_${today}.csv`, csv);
  }

  if (kind === "chats") {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, session_id, role, content, created_at")
      .eq("student_id", id)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const csv = toCsv(
      ["id", "session_id", "role", "content", "created_at"],
      (data ?? []).map((r) => [r.id, r.session_id ?? "", r.role, r.content, r.created_at]),
    );
    return csvResponse(`student_${sidShort}_chats_${today}.csv`, csv);
  }

  if (kind === "attempts") {
    const { data, error } = await supabase
      .from("attempts")
      .select("id, kind, exam_type, title, total_score, max_score, grade, overall_feedback, created_at")
      .eq("student_id", id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const csv = toCsv(
      ["id", "kind", "exam_type", "title", "total_score", "max_score", "grade", "overall_feedback", "created_at"],
      (data ?? []).map((r) => [
        r.id,
        r.kind,
        r.exam_type ?? "",
        r.title,
        r.total_score,
        r.max_score,
        r.grade ?? "",
        r.overall_feedback ?? "",
        r.created_at,
      ]),
    );
    return csvResponse(`student_${sidShort}_attempts_${today}.csv`, csv);
  }

  return NextResponse.json({ error: "invalid kind" }, { status: 400 });
}
