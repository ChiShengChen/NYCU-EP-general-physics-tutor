import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/** GET /api/history?studentId=xxx — fetch chat history grouped by sessions.
 *
 *  New rows carry an explicit session_id (set by the chat client when a fresh
 *  chat starts) and are grouped exactly by that. Legacy rows pre-dating
 *  migration 004 have a NULL session_id; for those we fall back to the
 *  original 30-minute-gap heuristic so old conversations still display.
 */
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at, session_id")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Msg = { id: number; role: "user" | "assistant"; content: string; created_at: string; session_id: string | null };
  type Session = {
    id: number;             // index used by the UI as React key
    sessionId: string | null;  // real session_id from DB (null for legacy)
    startTime: string;
    endTime: string;
    messages: Msg[];
    preview: string;
  };

  const sessions: Session[] = [];
  let sessionIdx = 0;
  const finalize = (msgs: Msg[]) => {
    const firstUser = msgs.find((m) => m.role === "user");
    sessions.push({
      id: sessionIdx++,
      sessionId: msgs[0].session_id,
      startTime: msgs[0].created_at,
      endTime: msgs[msgs.length - 1].created_at,
      messages: msgs,
      preview: firstUser?.content?.slice(0, 80) ?? "（無預覽）",
    });
  };

  // Bucket rows by explicit session_id when present; collect null rows separately.
  const explicitBuckets: Map<string, Msg[]> = new Map();
  const legacyRows: Msg[] = [];

  for (const m of (data ?? []) as Msg[]) {
    if (m.session_id) {
      const arr = explicitBuckets.get(m.session_id) ?? [];
      arr.push(m);
      explicitBuckets.set(m.session_id, arr);
    } else {
      legacyRows.push(m);
    }
  }

  // Apply 30-min gap rule to legacy null rows (pre-migration data).
  let cur: Msg[] = [];
  for (const m of legacyRows) {
    if (cur.length > 0) {
      const gap = (new Date(m.created_at).getTime() - new Date(cur[cur.length - 1].created_at).getTime()) / 60000;
      if (gap > 30) {
        finalize(cur);
        cur = [];
      }
    }
    cur.push(m);
  }
  if (cur.length > 0) finalize(cur);

  // Add explicit-session-id buckets (each is one session).
  for (const msgs of explicitBuckets.values()) {
    finalize(msgs);
  }

  // Newest session first.
  sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  // Re-stamp the React-key id after sort so it's stable / contiguous.
  sessions.forEach((s, i) => { s.id = i; });

  return NextResponse.json({ sessions, totalMessages: (data ?? []).length });
}
