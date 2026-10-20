/**
 * Pure helpers for 考古題模式 (past exam questions).
 *
 * A past-exam question is just a `teacher_questions` row whose `tags`
 * contains `考古題` plus one "year-term" tag such as `2024-期中` or
 * `2023-期末`. No extra table / migration: the teacher adds the two tags in
 * the 📚 題庫 tab (or the CSV `tags` column) and the question shows up in
 * the student-facing picker grouped by that year-term tag.
 *
 * Everything here is DB-free so it can be unit-tested; the Supabase reads
 * and LLM calls live in `app/api/past-exams/route.ts`.
 */

/** The marker tag every past-exam question must carry. */
export const PAST_EXAM_TAG = "考古題";

/** Bucket for 考古題 rows that forgot their year-term tag, so they still show up. */
export const UNSORTED_SET_TAG = "未分年度";

/** `2024-期中`, `2023-期末`, `2022-第一次期中` … — a 4-digit year, a dash, then a term label. */
const SET_TAG_RE = /^(\d{4})-(\S{1,20})$/;

export function isSetTag(tag: string): boolean {
  return SET_TAG_RE.test(tag.trim());
}

/** The year-term tag of a row, or null when it only has the marker tag. */
export function pickSetTag(tags: readonly string[] | null | undefined): string | null {
  for (const t of tags ?? []) {
    const trimmed = t.trim();
    if (isSetTag(trimmed)) return trimmed;
  }
  return null;
}

/** Later in the academic year sorts first inside the same year. */
function termRank(term: string): number {
  if (term.includes("期末")) return 3;
  if (term.includes("期中")) return 2;
  return 1;
}

/**
 * Newest first: year desc, then 期末 before 期中, then plain string desc so
 * the order is total. `UNSORTED_SET_TAG` always goes last.
 */
export function compareSetTags(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNSORTED_SET_TAG) return 1;
  if (b === UNSORTED_SET_TAG) return -1;
  const ma = a.match(SET_TAG_RE);
  const mb = b.match(SET_TAG_RE);
  if (ma && mb) {
    const ya = Number(ma[1]);
    const yb = Number(mb[1]);
    if (ya !== yb) return yb - ya;
    const ra = termRank(ma[2]);
    const rb = termRank(mb[2]);
    if (ra !== rb) return rb - ra;
  } else if (ma) {
    return -1;
  } else if (mb) {
    return 1;
  }
  return b.localeCompare(a, "zh-Hant");
}

export interface PastExamSet {
  tag: string;
  count: number;
  /** Distinct chapters in the set, ascending. */
  chapters: number[];
}

/**
 * Group rows by their year-term tag. Rows that carry `考古題` but no
 * year-term tag land in `UNSORTED_SET_TAG` rather than being dropped, so a
 * teacher's typo is visible instead of silent.
 */
export function groupPastExamSets(rows: readonly { chapter: number; tags: readonly string[] | null }[]): PastExamSet[] {
  const byTag = new Map<string, { count: number; chapters: Set<number> }>();
  for (const r of rows) {
    const tag = pickSetTag(r.tags) ?? UNSORTED_SET_TAG;
    const slot = byTag.get(tag) ?? { count: 0, chapters: new Set<number>() };
    slot.count += 1;
    slot.chapters.add(r.chapter);
    byTag.set(tag, slot);
  }
  return Array.from(byTag.entries())
    .sort(([a], [b]) => compareSetTags(a, b))
    .map(([tag, v]) => ({ tag, count: v.count, chapters: Array.from(v.chapters).sort((x, y) => x - y) }));
}

/** True when `row` belongs to `setTag` (either its year-term tag or the unsorted bucket). */
export function rowInSet(tags: readonly string[] | null | undefined, setTag: string): boolean {
  return (pickSetTag(tags) ?? UNSORTED_SET_TAG) === setTag;
}

/**
 * Normalize a multiple-choice answer to a single letter A–D, or null when
 * the input isn't one. Accepts the same sloppy forms the teacher CSV
 * import tolerates (`(b)`, `B.`, `b：`), plus a full option string copied
 * from the UI like `B. 5 m/s^2` (only the leading letter matters).
 */
export function normalizeMcAnswer(raw: string): "A" | "B" | "C" | "D" | null {
  const m = raw.trim().match(/^[(（]?\s*([A-Da-d])(?:[)）。．.、:：\s]|$)/);
  if (!m) return null;
  return m[1].toUpperCase() as "A" | "B" | "C" | "D";
}

/** Same 0.6 / 0.4 blend `/api/quiz` and `/api/exam` use when a result lands. */
export function blendMastery(current: number, score: number): number {
  return Math.min(1, Math.max(0, 0.6 * current + 0.4 * score));
}

/** First ~N characters of a lecture chunk, whitespace collapsed, for the locate chips. */
export function snippetOf(content: string, max = 160): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
