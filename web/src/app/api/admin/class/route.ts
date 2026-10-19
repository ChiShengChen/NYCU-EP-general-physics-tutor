import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/admin/class?days=30
 *
 * Class-level dashboard data for the admin panel's 班級 tab. Aggregates
 * across all students who attempted anything in the window:
 *
 *  - perChapter      avg correctness ratio per source_chapter, derived
 *                    by walking each attempt's questions[].sourceChapter
 *                    against results[].isCorrect (with earnedPoints
 *                    fallback for partial-credit scoring on exam-style
 *                    rubric questions).
 *  - weakConcepts    top N lowest-mastery concepts from student_state,
 *                    averaged across students. Concept is free-form text
 *                    so we group by exact-match name.
 *  - activeStudents  count of distinct student_ids with ≥1 attempt in
 *                    the window.
 *  - totalAttempts / avgScore for the headline tiles.
 *  - errorTypes      class-wide rollup of the AI 錯題分析 cache
 *                    (attempt_analyses). Each analysed wrong question
 *                    carries an errorType (concept / calculation /
 *                    reading / incomplete / unanswered) and 1–3 cited
 *                    lecture pages; we count types per sourceChapter
 *                    (looked up from the parent attempt's questions[])
 *                    and tally which (chapter, page) gets cited most.
 *
 * Same gating + window semantics as /api/admin/usage so toggling range
 * in the panel feels consistent.
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const ALL_DAYS = 365 * 5;
const ATTEMPT_LIMIT = 1000;
const ANALYSIS_LIMIT = 1000;
const WEAK_CONCEPTS_TOP = 20;
const TOP_PAGES = 15;

const ERROR_TYPES = ["concept", "calculation", "reading", "incomplete", "unanswered"] as const;
type ErrorType = (typeof ERROR_TYPES)[number];
type ErrorCounts = Record<ErrorType, number>;

function emptyCounts(): ErrorCounts {
  return { concept: 0, calculation: 0, reading: 0, incomplete: 0, unanswered: 0 };
}
function isErrorType(v: unknown): v is ErrorType {
  return typeof v === "string" && (ERROR_TYPES as readonly string[]).includes(v);
}

interface AttemptRow {
  student_id: string;
  questions: unknown;
  results: unknown;
  total_score: number;
  max_score: number;
  created_at: string;
}

interface QuestionShape {
  id?: number | string;
  sourceChapter?: number | null;
}
interface ResultShape {
  questionId?: number | string;
  isCorrect?: boolean;
  earnedPoints?: number;
  score?: number;
}

/** attempt_analyses row with the parent attempt embedded. attempt_id is
 *  the PK so PostgREST returns the parent as a single object, but we
 *  tolerate the array form in case the relationship cache ever flips. */
interface AnalysisRow {
  attempt_id: number;
  student_id: string;
  analysis: unknown;
  attempts: { questions: unknown } | { questions: unknown }[] | null;
}
/** Subset of AttemptAnalysis["questions"][number] (lib/attempt-analysis)
 *  we read here. Kept loose — rows written by older prompt versions are
 *  still counted, so don't trust the shape blindly. */
interface AnalysedQuestionShape {
  questionId?: number | string;
  errorType?: string;
  lecturePages?: { chapter?: unknown; page?: unknown; sectionTitle?: unknown }[];
}

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const raw = req.nextUrl.searchParams.get("days") ?? "";
  const days = raw === "all"
    ? ALL_DAYS
    : Number.isFinite(Number(raw))
      ? Math.min(Math.max(1, Math.floor(Number(raw))), MAX_DAYS)
      : DEFAULT_DAYS;
  const reportedDays = raw === "all" ? 0 : days;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  const supabase = createServiceClient();

  const [
    { data: attemptRows, error: attemptErr },
    { data: stateRows, error: stateErr },
    { count: totalStudents },
    { data: analysisRows, error: analysisErr },
  ] = await Promise.all([
    supabase
      .from("attempts")
      .select("student_id, questions, results, total_score, max_score, created_at")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(ATTEMPT_LIMIT),
    supabase
      .from("student_state")
      .select("concept, mastery_score, attempt_count"),
    supabase
      .from("student_profiles")
      .select("id", { count: "exact", head: true }),
    // `attempts!inner` + a filter on the embedded column keeps the window
    // anchored to when the test was taken, not when the analysis was
    // (re)generated — a prompt-version bump re-analyses old attempts and
    // shouldn't make last semester's errors look like this month's.
    supabase
      .from("attempt_analyses")
      .select("attempt_id, student_id, analysis, attempts!inner(questions)")
      .gte("attempts.created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(ANALYSIS_LIMIT),
  ]);

  if (attemptErr) return NextResponse.json({ error: attemptErr.message }, { status: 500 });
  if (stateErr) return NextResponse.json({ error: stateErr.message }, { status: 500 });
  if (analysisErr) return NextResponse.json({ error: analysisErr.message }, { status: 500 });

  const attempts = (attemptRows ?? []) as AttemptRow[];
  const analyses = (analysisRows ?? []) as unknown as AnalysisRow[];

  // ─── Per-chapter correctness ratio ────────────────────────
  type ChapterAgg = { correct: number; total: number; students: Set<string> };
  const byChapter = new Map<number, ChapterAgg>();
  const studentIdsWithAttempts = new Set<string>();
  let totalScoreSum = 0;
  let totalMaxSum = 0;

  for (const a of attempts) {
    studentIdsWithAttempts.add(a.student_id);
    totalScoreSum += a.total_score;
    totalMaxSum += a.max_score;

    const questions = Array.isArray(a.questions) ? (a.questions as QuestionShape[]) : [];
    const results = Array.isArray(a.results) ? (a.results as ResultShape[]) : [];
    // Map results by questionId — exam attempts use a stable per-question
    // id, so lookup is straightforward. Skip silently if shapes drift.
    const resultsById = new Map<string, ResultShape>();
    for (const r of results) {
      if (r.questionId !== undefined) resultsById.set(String(r.questionId), r);
    }

    for (const q of questions) {
      const ch = typeof q.sourceChapter === "number" ? q.sourceChapter : null;
      if (ch == null || ch < 1 || ch > 50) continue;
      const slot = byChapter.get(ch) ?? { correct: 0, total: 0, students: new Set<string>() };
      slot.total += 1;
      slot.students.add(a.student_id);
      // Treat partial-credit (earnedPoints / score above half max) as
      // correct for the heatmap. The dashboard cares about "did the
      // class generally get this chapter" not the exact rubric.
      const r = q.id !== undefined ? resultsById.get(String(q.id)) : undefined;
      if (r) {
        if (r.isCorrect === true) slot.correct += 1;
        else if (typeof r.earnedPoints === "number" && r.earnedPoints > 0) slot.correct += r.earnedPoints > 0.5 ? 1 : 0;
        else if (typeof r.score === "number" && r.score >= 0.5) slot.correct += 1;
      }
      byChapter.set(ch, slot);
    }
  }

  const perChapter = Array.from(byChapter.entries())
    .sort(([a], [b]) => a - b)
    .map(([chapter, slot]) => ({
      chapter,
      correct: slot.correct,
      total: slot.total,
      correctRatio: slot.total > 0 ? Number((slot.correct / slot.total).toFixed(3)) : 0,
      students: slot.students.size,
    }));

  // ─── Weak-concept rollup from student_state ───────────────
  type StateAgg = { sumMastery: number; count: number; attempts: number };
  const byConcept = new Map<string, StateAgg>();
  for (const s of (stateRows ?? []) as { concept: string; mastery_score: number; attempt_count: number }[]) {
    if (!s.concept) continue;
    const slot = byConcept.get(s.concept) ?? { sumMastery: 0, count: 0, attempts: 0 };
    slot.sumMastery += s.mastery_score;
    slot.count += 1;
    slot.attempts += s.attempt_count;
    byConcept.set(s.concept, slot);
  }
  const weakConcepts = Array.from(byConcept.entries())
    .filter(([, v]) => v.count >= 2)  // need at least 2 students for "class-level"
    .map(([concept, v]) => ({
      concept,
      avgMastery: Number((v.sumMastery / v.count).toFixed(3)),
      studentCount: v.count,
      attemptCount: v.attempts,
    }))
    .sort((a, b) => a.avgMastery - b.avgMastery)
    .slice(0, WEAK_CONCEPTS_TOP);

  // ─── Error-type rollup from attempt_analyses ──────────────
  // analysis.questions[] only contains the wrong questions, so every
  // entry is one classified mistake. Chapter comes from the parent
  // attempt's questions[].sourceChapter (matched by questionId); for
  // older rows without sourceChapter we fall back to the chapter of the
  // first cited lecture page, which the analyser restricted to the same
  // chapter anyway.
  type PageAgg = { chapter: number; page: number; sectionTitle: string; count: number };
  const overallErrors = emptyCounts();
  const errorsByChapter = new Map<number, ErrorCounts>();
  const pageHits = new Map<string, PageAgg>();
  const analysedStudents = new Set<string>();

  for (const row of analyses) {
    analysedStudents.add(row.student_id);
    const analysis = row.analysis as { questions?: unknown } | null;
    const analysed = Array.isArray(analysis?.questions)
      ? (analysis.questions as AnalysedQuestionShape[])
      : [];
    const parent = Array.isArray(row.attempts) ? row.attempts[0] : row.attempts;
    const questions = Array.isArray(parent?.questions) ? (parent.questions as QuestionShape[]) : [];
    const chapterByQuestionId = new Map<string, number>();
    for (const q of questions) {
      if (q.id !== undefined && typeof q.sourceChapter === "number") {
        chapterByQuestionId.set(String(q.id), q.sourceChapter);
      }
    }

    for (const qa of analysed) {
      if (!isErrorType(qa.errorType)) continue;
      overallErrors[qa.errorType] += 1;

      const pages = Array.isArray(qa.lecturePages) ? qa.lecturePages : [];
      const firstCited = pages.find((p) => typeof p.chapter === "number")?.chapter as number | undefined;
      const ch = chapterByQuestionId.get(String(qa.questionId)) ?? firstCited ?? null;
      if (ch != null && ch >= 1 && ch <= 50) {
        const slot = errorsByChapter.get(ch) ?? emptyCounts();
        slot[qa.errorType] += 1;
        errorsByChapter.set(ch, slot);
      }

      for (const p of pages) {
        if (typeof p.chapter !== "number" || typeof p.page !== "number") continue;
        const key = `${p.chapter}:${p.page}`;
        const hit = pageHits.get(key) ?? { chapter: p.chapter, page: p.page, sectionTitle: "", count: 0 };
        hit.count += 1;
        // First non-empty title wins; the analyser copies section_title
        // verbatim from the chunk so they should all agree anyway.
        if (!hit.sectionTitle && typeof p.sectionTitle === "string") hit.sectionTitle = p.sectionTitle;
        pageHits.set(key, hit);
      }
    }
  }

  const errorTypes = {
    analysedAttempts: analyses.length,
    analysedStudents: analysedStudents.size,
    overall: overallErrors,
    byChapter: Array.from(errorsByChapter.entries())
      .sort(([a], [b]) => a - b)
      .map(([chapter, c]) => ({
        chapter,
        total: ERROR_TYPES.reduce((sum, t) => sum + c[t], 0),
        ...c,
      })),
    topPages: Array.from(pageHits.values())
      .sort((a, b) => b.count - a.count || a.chapter - b.chapter || a.page - b.page)
      .slice(0, TOP_PAGES),
  };

  return NextResponse.json({
    windowDays: reportedDays,
    totals: {
      registeredStudents: totalStudents ?? 0,
      activeStudents: studentIdsWithAttempts.size,
      totalAttempts: attempts.length,
      avgScoreRatio: totalMaxSum > 0 ? Number((totalScoreSum / totalMaxSum).toFixed(3)) : 0,
    },
    perChapter,
    weakConcepts,
    errorTypes,
  });
}
