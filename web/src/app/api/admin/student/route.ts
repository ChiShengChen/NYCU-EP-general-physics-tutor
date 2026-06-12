import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { estimateCost } from "@/lib/usage-log";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/admin/student?id=<uuid>
 *
 * Drilldown view for one student row in the admin Usage tab. Returns
 * everything the panel needs to render an inline detail card without a
 * second roundtrip:
 *
 *  - profile     basic identity (email / display_name / created_at)
 *  - daily       last 30 days of token_usage bucketed by date
 *  - endpoints   which AI routes this student hit, with cost breakdown
 *  - chatSessions  recent chat_messages grouped by session_id, with the
 *                  first user message as a preview so admins can scan
 *                  what the student was working on
 *  - attempts    recent quiz/exam attempts with score / chapter
 *
 * Privacy: this is admin-only (gated by ADMIN_EMAILS) and returns chat
 * message content. Do not expose without auth.
 */

const WINDOW_DAYS = 30;
const RECENT_CHAT_MSGS = 200;     // cap raw rows pulled before grouping
const RECENT_SESSIONS = 30;       // sessions shown in the panel
const RECENT_ATTEMPTS = 25;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UsageRow {
  endpoint: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

interface ChatRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  session_id: string | null;
  created_at: string;
}

interface AttemptRow {
  id: number;
  kind: "quiz" | "exam";
  exam_type: string | null;
  title: string;
  total_score: number;
  max_score: number;
  grade: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  const [
    { data: profile },
    { data: usageRows, error: usageErr },
    { data: chatRows, error: chatErr },
    { data: attemptRows, error: attemptErr },
  ] = await Promise.all([
    supabase
      .from("student_profiles")
      .select("id, email, display_name, created_at, last_signed_in_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("token_usage")
      .select("endpoint, model, prompt_tokens, completion_tokens, total_tokens, created_at")
      .eq("student_id", id)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(20_000),
    supabase
      .from("chat_messages")
      .select("id, role, content, session_id, created_at")
      .eq("student_id", id)
      .order("created_at", { ascending: false })
      .limit(RECENT_CHAT_MSGS),
    supabase
      .from("attempts")
      .select("id, kind, exam_type, title, total_score, max_score, grade, created_at")
      .eq("student_id", id)
      .order("created_at", { ascending: false })
      .limit(RECENT_ATTEMPTS),
  ]);

  if (usageErr) return NextResponse.json({ error: usageErr.message }, { status: 500 });
  if (chatErr) return NextResponse.json({ error: chatErr.message }, { status: 500 });
  if (attemptErr) return NextResponse.json({ error: attemptErr.message }, { status: 500 });

  const usage = (usageRows ?? []) as UsageRow[];
  const chats = (chatRows ?? []) as ChatRow[];
  const attempts = (attemptRows ?? []) as AttemptRow[];

  // ─── Daily token totals + endpoint breakdown ───────────────
  const byDay = new Map<string, { tokens: number; calls: number; cost: number }>();
  const byEndpoint = new Map<string, { calls: number; tokens: number; cost: number }>();
  let totalCalls = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const r of usage) {
    const c = estimateCost(r.model, r.prompt_tokens, r.completion_tokens);
    totalCalls += 1;
    totalTokens += r.total_tokens;
    totalCost += c;

    const day = r.created_at.slice(0, 10);
    const d = byDay.get(day) ?? { tokens: 0, calls: 0, cost: 0 };
    d.tokens += r.total_tokens;
    d.calls += 1;
    d.cost += c;
    byDay.set(day, d);

    const e = byEndpoint.get(r.endpoint) ?? { calls: 0, tokens: 0, cost: 0 };
    e.calls += 1;
    e.tokens += r.total_tokens;
    e.cost += c;
    byEndpoint.set(r.endpoint, e);
  }

  const daily = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      tokens: v.tokens,
      calls: v.calls,
      costUsd: Number(v.cost.toFixed(4)),
    }));

  const endpoints = Array.from(byEndpoint.entries())
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([endpoint, v]) => ({
      endpoint,
      calls: v.calls,
      tokens: v.tokens,
      costUsd: Number(v.cost.toFixed(4)),
    }));

  // ─── Group chat_messages into sessions ─────────────────────
  // Legacy rows have session_id=null (pre-migration 004). Bucket those
  // under "__legacy__" so they still show up rather than silently
  // dropping the conversation history.
  type SessionAgg = {
    sessionId: string | null;
    startedAt: string;
    lastAt: string;
    messageCount: number;
    firstUserMessage: string | null;
  };
  const sessions = new Map<string, SessionAgg>();
  // chats are DESC by created_at — reverse-iterate so startedAt is the
  // oldest, lastAt is the newest, and the first 'user' message we see
  // for each session is the actual first one.
  for (let i = chats.length - 1; i >= 0; i--) {
    const m = chats[i];
    const key = m.session_id ?? "__legacy__";
    const s = sessions.get(key) ?? {
      sessionId: m.session_id,
      startedAt: m.created_at,
      lastAt: m.created_at,
      messageCount: 0,
      firstUserMessage: null,
    };
    s.lastAt = m.created_at;
    s.messageCount += 1;
    if (!s.firstUserMessage && m.role === "user") {
      s.firstUserMessage = m.content.slice(0, 240);
    }
    sessions.set(key, s);
  }
  const chatSessions = Array.from(sessions.values())
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, RECENT_SESSIONS);

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    profile: profile
      ? {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          createdAt: profile.created_at,
          lastSignedInAt: profile.last_signed_in_at,
        }
      : null,
    totals: {
      calls: totalCalls,
      totalTokens,
      costUsd: Number(totalCost.toFixed(4)),
    },
    daily,
    endpoints,
    chatSessions,
    attempts: attempts.map((a) => ({
      id: a.id,
      kind: a.kind,
      examType: a.exam_type,
      title: a.title,
      totalScore: a.total_score,
      maxScore: a.max_score,
      grade: a.grade,
      createdAt: a.created_at,
    })),
  });
}
