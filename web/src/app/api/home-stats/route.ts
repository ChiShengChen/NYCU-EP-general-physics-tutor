import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
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
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
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

  // 3) daily due — SM-2 cards whose due_at has passed (same source of
  //    truth as /api/daily-review). Cards are seeded by that route's sync
  //    step, so a student who has never opened 每日複習 may see 0 here
  //    even with wrong answers on record; the banner copy covers that.
  //    Capped at 5 to match the daily-review batch size.
  const { count: dueCardCount } = await supabase
    .from("review_cards")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .lte("due_at", new Date().toISOString());
  const dailyDueCount = Math.min(5, dueCardCount ?? 0);

  return NextResponse.json({
    attemptsCount,
    avgAccuracy,
    reviewedConcepts,
    avgMastery,
    dailyDueCount,
  });
}
