import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 15;

/**
 * GET /api/home-stats?studentId=xxx
 *
 * Returns a small payload of headline numbers for the homepage strip:
 *   - attemptsCount        total quiz + exam attempts
 *   - avgAccuracy          % across all attempts (correct / total questions)
 *   - reviewedConcepts     distinct concepts in student_state
 *   - avgMastery           mean mastery_score (0..1) across student_state
 *   - dailyDueCount        how many wrong questions are due for today's review
 */
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();

  // 1) attempts → count + accuracy
  const { data: attempts } = await supabase
    .from("attempts")
    .select("results, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(200);

  let totalQ = 0;
  let correctQ = 0;
  for (const a of (attempts ?? []) as { results: { isCorrect: boolean }[] }[]) {
    if (!Array.isArray(a.results)) continue;
    totalQ += a.results.length;
    correctQ += a.results.filter((r) => r.isCorrect).length;
  }
  const attemptsCount = (attempts ?? []).length;
  const avgAccuracy = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : null;

  // 2) student_state → reviewed concepts + mean mastery
  const { data: state } = await supabase
    .from("student_state")
    .select("mastery_score")
    .eq("student_id", studentId);
  const reviewedConcepts = (state ?? []).length;
  const avgMastery = reviewedConcepts > 0
    ? Math.round(((state ?? []).reduce((s, r) => s + (r.mastery_score ?? 0), 0) / reviewedConcepts) * 100)
    : null;

  // 3) daily due — mirror the /api/daily-review filter (wrong + ≥1 day ago, deduped)
  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: dueAttempts } = await supabase
    .from("attempts")
    .select("questions, results, created_at")
    .eq("student_id", studentId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(200);

  const seen = new Set<string>();
  let dailyDueCount = 0;
  const now = Date.now();
  for (const a of (dueAttempts ?? []) as {
    questions: { id: number; question?: string }[];
    results: { questionId: number; isCorrect: boolean }[];
    created_at: string;
  }[]) {
    const daysSince = (now - new Date(a.created_at).getTime()) / 86400_000;
    if (daysSince < 1) continue;
    const qById = new Map(a.questions.map((q) => [q.id, q] as const));
    for (const r of a.results) {
      if (r.isCorrect) continue;
      const q = qById.get(r.questionId);
      if (!q?.question) continue;
      const key = q.question.slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      dailyDueCount++;
      if (dailyDueCount >= 5) break;  // matches daily-review cap
    }
    if (dailyDueCount >= 5) break;
  }

  return NextResponse.json({
    attemptsCount,
    avgAccuracy,
    reviewedConcepts,
    avgMastery,
    dailyDueCount,
  });
}
