import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { CHAPTER_NODES, findPrereqChapters } from "@/lib/concept-graph";

export const maxDuration = 15;

/**
 * GET /api/prereq-path?studentId=X&chapter=N
 *
 * For target chapter N, walks the chapter dependency graph backwards to
 * collect every transitive prereq, then scores how prepared the student
 * is for each one based on their past attempts.
 *
 * "Preparedness" uses attempts data rather than student_state.mastery,
 * because attempts cleanly tag each question with `sourceChapter` while
 * mastery_score is keyed by free-form concept name (which doesn't always
 * line up with concepts.json labels). Accuracy in the chapter is the most
 * defensible signal we currently have.
 *
 * Status thresholds were picked to give a useful tri-color UI:
 *   - unseen: no attempts in this chapter ever                  → grey
 *   - weak:   <50% correct over the attempts                    → red
 *   - ok:     50–75% correct                                    → amber
 *   - strong: ≥75% correct                                      → green
 *
 * `weakConcepts` lists distinct concept names from wrong answers in this
 * chapter (capped at 5) so the UI can show concrete things to revisit.
 */

type Q = {
  id: number;
  concept?: string;
  question?: string;
  sourceChapter?: number;
};
type R = { questionId: number; isCorrect: boolean };
type AttemptRow = { questions: Q[]; results: R[] };

type PrereqStatus = "strong" | "ok" | "weak" | "unseen";

interface PrereqEntry {
  chapter: number;
  title: string;
  status: PrereqStatus;
  attemptsTotal: number;
  attemptsCorrect: number;
  accuracy: number | null;
  weakConcepts: string[];
}

function statusFor(total: number, accuracy: number | null): PrereqStatus {
  if (total === 0 || accuracy === null) return "unseen";
  if (accuracy >= 0.75) return "strong";
  if (accuracy >= 0.5) return "ok";
  return "weak";
}

export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  const chapterParam = req.nextUrl.searchParams.get("chapter");
  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }
  const chapter = chapterParam ? parseInt(chapterParam) : NaN;
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 36) {
    return NextResponse.json({ error: "invalid chapter (1..36)" }, { status: 400 });
  }

  const targetMeta = CHAPTER_NODES.find((n) => n.chapter === chapter);
  if (!targetMeta) {
    return NextResponse.json({ error: "unknown chapter" }, { status: 400 });
  }
  const prereqChapters = findPrereqChapters(chapter);
  const target = { chapter, title: targetMeta.label };

  // No prereqs in graph → just tell the client. This is normal for entry
  // chapters like Ch01, Ch17, Ch21.
  if (prereqChapters.length === 0) {
    return NextResponse.json({ target, prereqs: [] satisfies PrereqEntry[] });
  }

  // Pull recent attempts (a 120-day window is enough to be representative
  // without dragging in stale data from prior semesters).
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - 120 * 86400_000).toISOString();
  const { data: attemptsData, error } = await supabase
    .from("attempts")
    .select("questions, results")
    .eq("student_id", studentId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate per chapter.
  type Agg = { total: number; correct: number; weakConcepts: Set<string> };
  const perChapter = new Map<number, Agg>();
  for (const ch of prereqChapters) {
    perChapter.set(ch, { total: 0, correct: 0, weakConcepts: new Set() });
  }

  for (const a of (attemptsData ?? []) as AttemptRow[]) {
    const qById = new Map(a.questions.map((q) => [q.id, q] as const));
    for (const r of a.results) {
      const q = qById.get(r.questionId);
      const ch = q?.sourceChapter;
      if (!ch) continue;
      const agg = perChapter.get(ch);
      if (!agg) continue;
      agg.total += 1;
      if (r.isCorrect) {
        agg.correct += 1;
      } else if (q?.concept && agg.weakConcepts.size < 5) {
        agg.weakConcepts.add(q.concept);
      }
    }
  }

  const prereqs: PrereqEntry[] = prereqChapters.map((ch) => {
    const meta = CHAPTER_NODES.find((n) => n.chapter === ch);
    const agg = perChapter.get(ch)!;
    const accuracy = agg.total > 0 ? agg.correct / agg.total : null;
    return {
      chapter: ch,
      title: meta?.label ?? `Ch${ch}`,
      status: statusFor(agg.total, accuracy),
      attemptsTotal: agg.total,
      attemptsCorrect: agg.correct,
      accuracy,
      weakConcepts: Array.from(agg.weakConcepts),
    };
  });

  return NextResponse.json({ target, prereqs });
}
