import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/daily-review?studentId=xxx
 *
 * Pulls 3–5 "due" questions for a quick spaced-repetition session:
 *   - Source: past wrong-answered questions from attempts (last 60 days).
 *   - Filter (forgetting curve): only include if it's been ≥ 1 day since the
 *     student saw this question. Older mistakes weight higher.
 *   - Dedupe by question text so the same item doesn't appear twice if it
 *     was missed across multiple attempts.
 *   - No AI generation — pure data shuffling, instant + $0.
 *
 * POST /api/daily-review (action=record)
 *   Body: { studentId, items: [{ concept, knewIt: -1 | 0 | 1 }] }
 *   Nudges student_state.mastery_score based on the self-rating:
 *      knewIt = 1   (我會)   → +0.10
 *      knewIt = 0   (有點忘) →  0
 *      knewIt = -1  (完全忘) → -0.20
 */

type Q = {
  id: number;
  type: "multiple_choice" | "short_answer";
  concept?: string;
  question?: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  sourceChapter?: number;
};

type R = { questionId: number; isCorrect: boolean; feedback?: string };

type AttemptRow = {
  id: number;
  title: string;
  kind: "quiz" | "exam";
  questions: Q[];
  results: R[];
  created_at: string;
};

export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("attempts")
    .select("id, title, kind, questions, results, created_at")
    .eq("student_id", studentId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const seenQuestions = new Set<string>();
  const candidates: {
    attemptId: number;
    attemptTitle: string;
    daysSinceMistake: number;
    question: Q;
    feedback: string;
  }[] = [];

  const now = Date.now();
  for (const a of (data ?? []) as AttemptRow[]) {
    const qById = new Map(a.questions.map((q) => [q.id, q] as const));
    for (const r of a.results) {
      if (r.isCorrect) continue;
      const q = qById.get(r.questionId);
      if (!q || !q.question) continue;
      const key = q.question.slice(0, 200);
      if (seenQuestions.has(key)) continue;
      seenQuestions.add(key);

      const daysSinceMistake = (now - new Date(a.created_at).getTime()) / 86400_000;
      // Forgetting-curve: too fresh (<1 day) → skip (let the brain consolidate first).
      if (daysSinceMistake < 1) continue;

      candidates.push({
        attemptId: a.id,
        attemptTitle: a.title || (a.kind === "exam" ? "考試模擬" : "自動測驗"),
        daysSinceMistake,
        question: q,
        feedback: r.feedback ?? "",
      });
    }
  }

  // Higher priority for items the student missed longer ago (more forgetting expected).
  candidates.sort((a, b) => b.daysSinceMistake - a.daysSinceMistake);
  const picks = candidates.slice(0, 5);

  return NextResponse.json({
    count: picks.length,
    items: picks.map((c) => ({
      attemptId: c.attemptId,
      attemptTitle: c.attemptTitle,
      daysSinceMistake: Math.round(c.daysSinceMistake),
      question: c.question,
      feedback: c.feedback,
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (body.action !== "record") return NextResponse.json({ error: "invalid action" }, { status: 400 });
  const studentId = String(body.studentId ?? "");
  const items: { concept?: string; knewIt: -1 | 0 | 1 }[] = Array.isArray(body.items) ? body.items : [];
  if (!studentId || items.length === 0) return NextResponse.json({ ok: true });

  const supabase = createServiceClient();
  const deltaByConcept = new Map<string, number>();
  const countByConcept = new Map<string, number>();
  for (const it of items) {
    if (!it.concept) continue;
    const d = it.knewIt === 1 ? 0.10 : it.knewIt === -1 ? -0.20 : 0;
    deltaByConcept.set(it.concept, (deltaByConcept.get(it.concept) ?? 0) + d);
    countByConcept.set(it.concept, (countByConcept.get(it.concept) ?? 0) + 1);
  }

  for (const [concept, delta] of deltaByConcept.entries()) {
    const { data: existing } = await supabase
      .from("student_state")
      .select("mastery_score, attempt_count")
      .eq("student_id", studentId)
      .eq("concept", concept)
      .single();

    const cur = existing?.mastery_score ?? 0.3;  // unseen → assume shaky baseline
    const newMastery = Math.min(1, Math.max(0, cur + delta));
    const attempts = (existing?.attempt_count ?? 0) + (countByConcept.get(concept) ?? 0);

    await supabase.from("student_state").upsert({
      student_id: studentId,
      concept,
      mastery_score: newMastery,
      attempt_count: attempts,
      updated_at: new Date().toISOString(),
    }, { onConflict: "student_id,concept" });
  }

  return NextResponse.json({ ok: true });
}
