import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/wrong-questions?studentId=xxx
 *   Returns every question this student has gotten wrong (across all
 *   quiz/exam attempts), most recent first. Each entry carries the full
 *   question, the student's answer, the correct answer, AI feedback, and
 *   provenance (which attempt, when, source chapter).
 *
 * Optional: ?chapter=N to filter to a single chapter.
 */
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const studentId = req.nextUrl.searchParams.get("studentId");
  const chapterParam = req.nextUrl.searchParams.get("chapter");

  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("attempts")
    .select("id, kind, exam_type, title, questions, answers, results, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Question = {
    id: number;
    type: "multiple_choice" | "short_answer";
    concept?: string;
    question: string;
    options?: string[];
    correctAnswer: string;
    explanation?: string;
    sourceChapter?: number;
    points?: number;
  };

  type Result = {
    questionId: number;
    isCorrect: boolean;
    score: number;
    earnedPoints?: number;
    feedback: string;
  };

  type Attempt = {
    id: number;
    kind: "quiz" | "exam";
    exam_type: "midterm" | "final" | null;
    title: string;
    questions: Question[];
    answers: Record<string, string>;
    results: Result[];
    created_at: string;
  };

  const wantedChapter = chapterParam ? parseInt(chapterParam) : null;
  const wrong: Array<{
    attemptId: number;
    attemptTitle: string;
    attemptKind: "quiz" | "exam";
    attemptCreatedAt: string;
    question: Question;
    studentAnswer: string;
    score: number;
    feedback: string;
  }> = [];

  // Track per-concept counts so the UI can highlight chronic weak spots.
  const conceptCounts: Record<string, number> = {};
  const chapterCounts: Record<number, number> = {};

  for (const a of (data ?? []) as Attempt[]) {
    const qById = new Map(a.questions.map((q) => [q.id, q]));
    for (const r of a.results) {
      if (r.isCorrect) continue;
      const q = qById.get(r.questionId);
      if (!q) continue;
      if (wantedChapter !== null && q.sourceChapter !== wantedChapter) continue;

      const studentAnswer = a.answers[String(q.id)] ?? "(未作答)";
      wrong.push({
        attemptId: a.id,
        attemptTitle: a.title || (a.kind === "exam" ? "考試模擬" : "自動測驗"),
        attemptKind: a.kind,
        attemptCreatedAt: a.created_at,
        question: q,
        studentAnswer,
        score: r.score,
        feedback: r.feedback,
      });

      if (q.concept) conceptCounts[q.concept] = (conceptCounts[q.concept] ?? 0) + 1;
      if (q.sourceChapter) chapterCounts[q.sourceChapter] = (chapterCounts[q.sourceChapter] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    total: wrong.length,
    items: wrong,
    conceptCounts,
    chapterCounts,
  });
}
