import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextResponse } from "next/server";

export const maxDuration = 15;

const ALLOWED_REASONS = new Set([
  "unclear",
  "wrong_answer",
  "bad_explanation",
  "too_easy",
  "too_hard",
  "off_topic",
  "other",
]);

/**
 * POST /api/question-report
 * Body: {
 *   studentId?: string,
 *   attemptId?: number,
 *   questionId?: number,
 *   question?: { question?, correctAnswer?, sourceChapter? },
 *   reason: string,        // one of ALLOWED_REASONS
 *   detail?: string,
 * }
 *
 * Lightweight write-only endpoint — no aggregation, no AI calls.
 * Aggregation can run as a Supabase query when we want to audit later.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const reason = String(body.reason ?? "");
  if (!ALLOWED_REASONS.has(reason)) {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }

  const q = (body.question ?? {}) as { question?: string; correctAnswer?: string; sourceChapter?: number };

  // Resolve from auth so a malicious caller can't file reports under
  // someone else's name (which would muddy the moderation signal).
  const { studentId } = await resolveStudentId(body.studentId);

  const supabase = createServiceClient();
  const { error } = await supabase.from("question_reports").insert({
    student_id: studentId,
    attempt_id: typeof body.attemptId === "number" ? body.attemptId : null,
    question_id: typeof body.questionId === "number" ? body.questionId : null,
    source_chapter: typeof q.sourceChapter === "number" ? q.sourceChapter : null,
    question_text: typeof q.question === "string" ? q.question.slice(0, 4000) : null,
    correct_answer: typeof q.correctAnswer === "string" ? q.correctAnswer.slice(0, 2000) : null,
    reason,
    detail: typeof body.detail === "string" ? body.detail.slice(0, 1000) : null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
