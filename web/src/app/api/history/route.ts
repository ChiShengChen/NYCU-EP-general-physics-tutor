import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/** GET /api/history?studentId=xxx — fetch chat history grouped by sessions */
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group messages into sessions (gap > 30 min = new session)
  const sessions: {
    id: number;
    startTime: string;
    endTime: string;
    messages: typeof data;
    preview: string;
  }[] = [];

  let currentSession: typeof data = [];
  let sessionIdx = 0;

  for (const msg of data ?? []) {
    if (currentSession.length > 0) {
      const last = currentSession[currentSession.length - 1];
      const gap =
        (new Date(msg.created_at).getTime() -
          new Date(last.created_at).getTime()) /
        60000;
      if (gap > 30) {
        // Finalize previous session
        const firstUserMsg = currentSession.find((m) => m.role === "user");
        sessions.push({
          id: sessionIdx++,
          startTime: currentSession[0].created_at,
          endTime: currentSession[currentSession.length - 1].created_at,
          messages: currentSession,
          preview: firstUserMsg?.content?.slice(0, 80) ?? "（無預覽）",
        });
        currentSession = [];
      }
    }
    currentSession.push(msg);
  }

  // Push last session
  if (currentSession.length > 0) {
    const firstUserMsg = currentSession.find((m) => m.role === "user");
    sessions.push({
      id: sessionIdx,
      startTime: currentSession[0].created_at,
      endTime: currentSession[currentSession.length - 1].created_at,
      messages: currentSession,
      preview: firstUserMsg?.content?.slice(0, 80) ?? "（無預覽）",
    });
  }

  // Reverse so newest first
  sessions.reverse();

  return NextResponse.json({ sessions, totalMessages: (data ?? []).length });
}
