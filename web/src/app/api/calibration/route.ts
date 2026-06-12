import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/calibration?studentId=xxx
 *
 * Aggregates `attempts.confidences` × `attempts.results` to produce:
 *   - buckets:   per-confidence-level (1..5) total / correct / accuracy %
 *   - dangerous: high-confidence wrong (conf ≥ 4 & !isCorrect), top 10 most recent
 *   - shaky:     low-confidence right (conf ≤ 2 & isCorrect), top 10 most recent
 *   - overall:   counts so the UI can hide / show empty states
 */
export async function GET(req: NextRequest) {
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("attempts")
    .select("id, kind, exam_type, title, questions, confidences, results, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Q = { id: number; concept?: string; question?: string; sourceChapter?: number };
  type R = { questionId: number; isCorrect: boolean };
  type Row = {
    id: number;
    kind: "quiz" | "exam";
    exam_type: "midterm" | "final" | null;
    title: string;
    questions: Q[];
    confidences: Record<string, number> | null;
    results: R[];
    created_at: string;
  };

  const buckets: Record<number, { confidence: number; total: number; correct: number; accuracy: number }> = {};
  for (let v = 1; v <= 5; v++) buckets[v] = { confidence: v, total: 0, correct: 0, accuracy: 0 };

  type Flagged = {
    attemptId: number;
    attemptTitle: string;
    attemptCreatedAt: string;
    questionId: number;
    concept: string;
    sourceChapter: number | null;
    questionPreview: string;
    confidence: number;
  };
  const dangerous: Flagged[] = [];
  const shaky: Flagged[] = [];

  let totalAnswered = 0;
  let totalWithConfidence = 0;

  for (const a of (data ?? []) as Row[]) {
    const confMap = a.confidences ?? {};
    const qById = new Map(a.questions.map((q) => [q.id, q] as const));
    for (const r of a.results) {
      totalAnswered++;
      const c = confMap[String(r.questionId)];
      if (typeof c !== "number" || c < 1 || c > 5) continue;
      totalWithConfidence++;

      const b = buckets[Math.round(c) as 1 | 2 | 3 | 4 | 5];
      b.total++;
      if (r.isCorrect) b.correct++;

      const q = qById.get(r.questionId);
      const entry: Flagged = {
        attemptId: a.id,
        attemptTitle: a.title || (a.kind === "exam" ? "考試模擬" : "自動測驗"),
        attemptCreatedAt: a.created_at,
        questionId: r.questionId,
        concept: q?.concept ?? "",
        sourceChapter: q?.sourceChapter ?? null,
        questionPreview: (q?.question ?? "").slice(0, 80),
        confidence: c,
      };
      if (c >= 4 && !r.isCorrect) dangerous.push(entry);
      else if (c <= 2 && r.isCorrect) shaky.push(entry);
    }
  }

  for (const b of Object.values(buckets)) {
    b.accuracy = b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0;
  }

  return NextResponse.json({
    totalAnswered,
    totalWithConfidence,
    buckets: Object.values(buckets),
    dangerous: dangerous.slice(0, 10),
    shaky: shaky.slice(0, 10),
  });
}
