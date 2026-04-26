import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/** GET /api/dashboard?studentId=xxx — fetch all dashboard data for a student */
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 1. Concept mastery data (for radar chart)
  const { data: masteryData } = await supabase
    .from("student_state")
    .select("concept, mastery_score, attempt_count, last_misconception, updated_at")
    .eq("student_id", studentId)
    .order("concept");

  // 2. Chat messages (for activity heatmap + learning time)
  const { data: chatData } = await supabase
    .from("chat_messages")
    .select("role, created_at, content")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  // 3. Compute activity heatmap (messages per day)
  const activityMap: Record<string, number> = {};
  const dailyTopics: Record<string, string[]> = {};
  for (const msg of chatData ?? []) {
    const day = msg.created_at.slice(0, 10); // YYYY-MM-DD
    activityMap[day] = (activityMap[day] ?? 0) + 1;
  }

  const activityHeatmap = Object.entries(activityMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 4. Compute mastery trend over time (from student_state updated_at snapshots)
  // Group mastery by date of last update
  const masteryTrend: Record<string, { total: number; count: number }> = {};
  for (const s of masteryData ?? []) {
    const day = s.updated_at.slice(0, 10);
    if (!masteryTrend[day]) masteryTrend[day] = { total: 0, count: 0 };
    masteryTrend[day].total += s.mastery_score;
    masteryTrend[day].count += 1;
  }

  const trendLine = Object.entries(masteryTrend)
    .map(([date, { total, count }]) => ({
      date,
      avgMastery: Math.round((total / count) * 100),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 5. Summary stats
  const totalMessages = (chatData ?? []).filter((m) => m.role === "user").length;
  const concepts = masteryData ?? [];
  const avgMastery =
    concepts.length > 0
      ? Math.round((concepts.reduce((s, c) => s + c.mastery_score, 0) / concepts.length) * 100)
      : 0;
  const weakConcepts = concepts.filter((c) => c.mastery_score < 0.6);
  const strongConcepts = concepts.filter((c) => c.mastery_score >= 0.8);

  // 6. Study sessions (estimate from chat message timestamps — gaps > 30min = new session)
  let studySessions = 0;
  let totalStudyMinutes = 0;
  let sessionStart: string | null = null;
  let lastTimestamp: string | null = null;

  for (const msg of chatData ?? []) {
    const ts = msg.created_at;
    if (!lastTimestamp) {
      sessionStart = ts;
      studySessions = 1;
    } else {
      const gap = (new Date(ts).getTime() - new Date(lastTimestamp).getTime()) / 60000;
      if (gap > 30) {
        // End previous session
        totalStudyMinutes += (new Date(lastTimestamp).getTime() - new Date(sessionStart!).getTime()) / 60000;
        sessionStart = ts;
        studySessions++;
      }
    }
    lastTimestamp = ts;
  }
  // Close last session
  if (sessionStart && lastTimestamp) {
    totalStudyMinutes += (new Date(lastTimestamp).getTime() - new Date(sessionStart).getTime()) / 60000;
  }
  totalStudyMinutes = Math.max(Math.round(totalStudyMinutes), totalMessages); // at least 1 min per message

  return NextResponse.json({
    mastery: concepts.map((c) => ({
      concept: c.concept,
      score: Math.round(c.mastery_score * 100),
      attempts: c.attempt_count,
      misconception: c.last_misconception,
    })),
    activityHeatmap,
    trendLine,
    stats: {
      totalMessages,
      totalConcepts: concepts.length,
      avgMastery,
      weakCount: weakConcepts.length,
      strongCount: strongConcepts.length,
      studySessions,
      totalStudyMinutes,
    },
  });
}
