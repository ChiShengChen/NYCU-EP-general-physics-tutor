import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { CHAPTER_NODES } from "@/lib/concept-graph";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * GET /api/cohort-stats?studentId=X
 *
 * Anonymous peer comparison: returns the cohort's average accuracy per
 * chapter (across all students who attempted it) alongside the calling
 * student's own accuracy. The dashboard uses the pair to show "you vs
 * everyone else" without ever naming another student.
 *
 * Privacy floor: chapters with fewer than `MIN_COHORT_STUDENTS` distinct
 * students get null cohort numbers — one or two students contributing
 * to a chapter would make their data effectively re-identifiable through
 * differential inspection.
 *
 * The query pulls a 90-day window from `attempts`. With ~100 students
 * × ~20 attempts each that's ~2000 rows, each carrying JSONB questions
 * and results; we read everything once and aggregate in memory rather
 * than per-chapter to keep the round-trip count at 1.
 */

const WINDOW_DAYS = 90;
const MIN_COHORT_STUDENTS = 3;

interface Question {
  id: number;
  sourceChapter?: number;
}
interface Result {
  questionId: number;
  isCorrect: boolean;
}
interface AttemptRow {
  student_id: string;
  questions: Question[];
  results: Result[];
}

interface PerChapter {
  chapter: number;
  title: string;
  cohortAccuracy: number | null;
  cohortAttempts: number | null;
  cohortStudents: number;
  yourAccuracy: number | null;
  yourAttempts: number;
}

export async function GET(req: NextRequest) {
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("attempts")
    .select("student_id, questions, results")
    .gte("created_at", cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate per (chapter, student): correct count + total count.
  // Two-stage map so we can derive both averages cleanly.
  type Tally = { correct: number; total: number };
  const cohort = new Map<number, Map<string, Tally>>();

  for (const a of (data ?? []) as AttemptRow[]) {
    const qById = new Map(a.questions.map((q) => [q.id, q] as const));
    for (const r of a.results) {
      const q = qById.get(r.questionId);
      const chapter = q?.sourceChapter;
      if (!chapter) continue;
      let perStudent = cohort.get(chapter);
      if (!perStudent) {
        perStudent = new Map();
        cohort.set(chapter, perStudent);
      }
      const tally = perStudent.get(a.student_id) ?? { correct: 0, total: 0 };
      tally.total += 1;
      if (r.isCorrect) tally.correct += 1;
      perStudent.set(a.student_id, tally);
    }
  }

  const perChapter: PerChapter[] = [];
  for (const node of CHAPTER_NODES) {
    const ch = node.chapter;
    const perStudent = cohort.get(ch);
    if (!perStudent) {
      perChapter.push({
        chapter: ch,
        title: node.label,
        cohortAccuracy: null,
        cohortAttempts: null,
        cohortStudents: 0,
        yourAccuracy: null,
        yourAttempts: 0,
      });
      continue;
    }

    let cohortCorrect = 0;
    let cohortTotal = 0;
    for (const [, t] of perStudent) {
      cohortCorrect += t.correct;
      cohortTotal += t.total;
    }
    const cohortStudents = perStudent.size;
    const myTally = perStudent.get(studentId);

    // Apply the privacy floor: hide cohort numbers when too few students
    // have attempted this chapter.
    const passesFloor = cohortStudents >= MIN_COHORT_STUDENTS;

    perChapter.push({
      chapter: ch,
      title: node.label,
      cohortAccuracy: passesFloor ? cohortCorrect / cohortTotal : null,
      cohortAttempts: passesFloor ? cohortTotal : null,
      cohortStudents,
      yourAccuracy: myTally ? myTally.correct / myTally.total : null,
      yourAttempts: myTally?.total ?? 0,
    });
  }

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    minCohortStudents: MIN_COHORT_STUDENTS,
    perChapter,
  });
}
