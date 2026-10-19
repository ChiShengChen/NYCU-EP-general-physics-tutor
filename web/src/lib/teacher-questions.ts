import { createServiceClient } from "@/lib/supabase/server";

/**
 * Teacher question bank → quiz / exam integration.
 *
 * `pickTeacherQuestions` samples active rows from `teacher_questions` for a
 * set of chapters and maps them onto the question shape the quiz / exam
 * routes already emit, so grading, the wrong-answer notebook and the
 * attempts table need no special cases. `mixTeacherQuestions` is the pure
 * half: it swaps LLM questions out for teacher ones type-for-type so a
 * quiz keeps its MC / short-answer balance.
 *
 * Wiring it into a generator is three lines:
 *
 *   const pool = await pickTeacherQuestions({ chapters, count: Math.round(n * TEACHER_MIX_RATIO) });
 *   const mixed = mixTeacherQuestions(llmQuestions, pool);
 *   const merged = mixed.map((q, idx) => ({ ...q, id: idx + 1 }));
 */

/**
 * Share of a generated quiz that teacher questions may replace when the
 * bank has rows for the requested chapters. 0.3 → 6 of 20 chapter-quiz
 * questions, 2 of 5 synthesis questions. Override via env for A/B.
 */
export const TEACHER_MIX_RATIO = (() => {
  const v = Number(process.env.TEACHER_MIX_RATIO);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.3;
})();

export type TeacherQuestionType = "multiple_choice" | "short_answer";

/** Quiz-shaped question produced from a `teacher_questions` row. */
export interface TeacherQuizQuestion {
  id: number;
  type: TeacherQuestionType;
  concept: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  sourceChapter: number;
  points?: number;
  /** Lets the client render the 「👩‍🏫 老師題」 badge. */
  source: "teacher";
  /** DB id, for de-duplication (`exclude`) and future per-question stats. */
  teacherQuestionId: number;
}

/** Minimal shape `mixTeacherQuestions` needs from an LLM question. */
export interface MixableQuestion {
  type: string;
  sourceChapter: number;
  points?: number;
}

export interface TeacherQuestionRow {
  id: number;
  chapter: number;
  type: TeacherQuestionType;
  concept: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  points: number;
}

export function rowToQuizQuestion(row: TeacherQuestionRow): TeacherQuizQuestion {
  const q: TeacherQuizQuestion = {
    id: 0,  // placeholder — the caller re-ids the merged list
    type: row.type,
    concept: row.concept || `Ch${String(row.chapter).padStart(2, "0")} 老師題`,
    difficulty: row.difficulty,
    question: row.question,
    correctAnswer: row.correct_answer,
    explanation: row.explanation,
    sourceChapter: row.chapter,
    points: row.points,
    source: "teacher",
    teacherQuestionId: row.id,
  };
  if (row.type === "multiple_choice" && Array.isArray(row.options)) q.options = row.options;
  return q;
}

/** Fisher–Yates on a copy; `rng` is injectable so tests stay deterministic. */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Hard cap on rows pulled per request before sampling in memory. */
const POOL_FETCH_LIMIT = 400;

/**
 * Random sample of up to `count` active teacher questions for `chapters`.
 * Returns [] (and logs) on any DB error — including the table not existing
 * yet — so a quiz still generates when migration 023 hasn't been applied.
 */
export async function pickTeacherQuestions(opts: {
  chapters: number[];
  count: number;
  /** teacher_questions.id values to skip (e.g. already in this quiz). */
  exclude?: number[];
  rng?: () => number;
}): Promise<TeacherQuizQuestion[]> {
  const chapters = Array.from(new Set(opts.chapters.filter((c) => Number.isInteger(c))));
  if (chapters.length === 0 || opts.count <= 0) return [];

  try {
    const supabase = createServiceClient();
    let q = supabase
      .from("teacher_questions")
      .select("id, chapter, type, concept, difficulty, question, options, correct_answer, explanation, points")
      .eq("is_active", true)
      .in("chapter", chapters)
      .limit(POOL_FETCH_LIMIT);
    if (opts.exclude && opts.exclude.length > 0) {
      q = q.not("id", "in", `(${opts.exclude.join(",")})`);
    }
    const { data, error } = await q;
    if (error) {
      console.warn("pickTeacherQuestions: query failed, skipping teacher mix:", error.message);
      return [];
    }
    const rows = (data ?? []) as TeacherQuestionRow[];
    return shuffle(rows, opts.rng).slice(0, opts.count).map(rowToQuizQuestion);
  } catch (err) {
    console.warn("pickTeacherQuestions: unexpected error, skipping teacher mix:", err);
    return [];
  }
}

/**
 * Replace up to `round(llm.length × ratio)` LLM questions with teacher
 * questions, swapping MC for MC and short-answer for short-answer so the
 * quiz keeps its type balance. Within a type we prefer a slot from the same
 * chapter (matters for multi-chapter quizzes) and otherwise take the first
 * free slot. Replaced slots keep their position; when the replaced LLM
 * question carried `points` (exams) the teacher question inherits them so
 * the paper still totals the same. Teacher questions with no matching slot
 * are simply not used. Ids are left alone — re-id after calling.
 */
export function mixTeacherQuestions<T extends MixableQuestion>(
  llm: T[],
  pool: TeacherQuizQuestion[],
  ratio: number = TEACHER_MIX_RATIO,
): (T | TeacherQuizQuestion)[] {
  const target = Math.min(pool.length, Math.round(llm.length * ratio));
  if (target <= 0) return [...llm];

  const out: (T | TeacherQuizQuestion)[] = [...llm];
  const replaced = new Set<number>();
  let swapped = 0;

  for (const tq of pool) {
    if (swapped >= target) break;
    const candidates = llm
      .map((q, idx) => ({ q, idx }))
      .filter(({ q, idx }) => !replaced.has(idx) && q.type === tq.type);
    if (candidates.length === 0) continue;
    const slot = candidates.find(({ q }) => q.sourceChapter === tq.sourceChapter) ?? candidates[0];
    const inheritedPoints = slot.q.points;
    out[slot.idx] = inheritedPoints !== undefined ? { ...tq, points: inheritedPoints } : tq;
    replaced.add(slot.idx);
    swapped += 1;
  }
  return out;
}
