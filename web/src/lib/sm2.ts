/**
 * SM-2 spaced-repetition scheduler for 每日 5 分鐘小複習.
 *
 * Pure functions only — no DB, no Date.now() — so the route handler stays
 * thin and the scheduling math is unit-testable (see sm2.test.ts). The
 * persisted state lives in `review_cards` (migration 022); this module
 * reads / returns the same field names in camelCase.
 *
 * Algorithm (SuperMemo SM-2, Wozniak 1990, the variant most flashcard
 * apps implement):
 *
 *   quality q ∈ 0..5
 *     0  完全空白 (blackout)
 *     1  答錯，看到答案才想起來
 *     2  答錯，但覺得答案很眼熟
 *     3  答對，但很吃力
 *     4  答對，稍微猶豫
 *     5  答對，秒答
 *
 *   q < 3  → lapse: repetitions = 0, interval = 1 day, lapses += 1
 *   q ≥ 3  → repetitions += 1 and
 *              1st success  → 1 day
 *              2nd success  → 6 days
 *              later        → round(previous interval × ease)
 *
 *   ease += 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02), floored at 1.3.
 *   (q=5 → +0.10, 4 → 0, 3 → −0.14, 2 → −0.32, 1 → −0.54, 0 → −0.80.)
 *   Ease is updated on every grade, including lapses, so a card the
 *   student keeps missing grows its intervals more slowly after it
 *   recovers — the behaviour Anki / Mnemosyne users expect.
 */

export const SM2_MIN_EASE = 1.3;
export const SM2_DEFAULT_EASE = 2.5;

export type Sm2Quality = 0 | 1 | 2 | 3 | 4 | 5;

/** The scheduling state we keep per card (subset of a review_cards row). */
export interface Sm2Card {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

/** What sm2Update returns — the fields the route writes back to the row. */
export interface Sm2Update extends Sm2Card {
  dueAt: Date;
  lastReviewedAt: Date;
  lastQuality: Sm2Quality;
  /** True when this grade reset the card (q < 3). */
  lapsed: boolean;
}

const DAY_MS = 86_400_000;

/** Clamp + integer-ise anything the client sends into 0..5. */
export function clampQuality(q: unknown): Sm2Quality {
  const n = typeof q === "number" && Number.isFinite(q) ? Math.round(q) : 0;
  return Math.min(5, Math.max(0, n)) as Sm2Quality;
}

/**
 * Apply one review of quality `q` (0..5) to `card` at time `now`.
 * Returns the updated scheduling fields; the input is not mutated.
 */
export function sm2Update(card: Sm2Card, quality: number, now: Date = new Date()): Sm2Update {
  const q = clampQuality(quality);
  const prevEase = Number.isFinite(card.ease) && card.ease > 0 ? card.ease : SM2_DEFAULT_EASE;
  const prevInterval = Math.max(0, Math.floor(card.intervalDays ?? 0));
  const prevReps = Math.max(0, Math.floor(card.repetitions ?? 0));
  const prevLapses = Math.max(0, Math.floor(card.lapses ?? 0));

  let repetitions: number;
  let intervalDays: number;
  let lapses = prevLapses;
  const lapsed = q < 3;

  if (lapsed) {
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    if (prevReps === 0) intervalDays = 1;
    else if (prevReps === 1) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(prevInterval * prevEase));
    repetitions = prevReps + 1;
  }

  // Ease deltas are multiples of 0.02, so two decimals is exact; rounding
  // also keeps the value stable through the `real` (float4) column.
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const ease = Math.max(SM2_MIN_EASE, Math.round((prevEase + delta) * 100) / 100);

  return {
    ease,
    intervalDays,
    repetitions,
    lapses,
    lapsed,
    lastQuality: q,
    lastReviewedAt: now,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
  };
}

/**
 * Translate the app's grading signals into an SM-2 quality.
 *
 *   isCorrect   from attempts.results (quiz / exam / oral grading)
 *   score       0..1 per-question score (0.5 = partial on short answers,
 *               oral = (correctness + completeness + clarity) / 10)
 *   hintUsed    boolean, or the hint level 0..3 from attempts.hint_usage
 *   confidence  optional 1..5 self-rating from attempts.confidences
 *
 * Mapping (documented so the thresholds are easy to tune later):
 *
 *   wrong,  score < 0.5             → 1  (看到答案才想起來)
 *   wrong,  score ≥ 0.5 (partial)   → 2  (方向對了但沒答到)
 *   wrong + confidence ≥ 4          → one step lower (0 or 1): a
 *                                      confident misconception is the
 *                                      most dangerous kind and deserves
 *                                      the harshest ease penalty
 *   right,  used a hint or score < 1 → 3  (答對但吃力)
 *   right,  clean, confidence ≤ 3    → 4
 *   right,  clean, confidence ≥ 4    → 5  (確定又答對 = 秒答)
 *
 * A clean correct answer without a confidence rating is 4, not 5, so the
 * ease only climbs when the student also *felt* sure — otherwise every
 * lucky multiple-choice guess would inflate the interval.
 */
export function qualityFromGrade(g: {
  isCorrect: boolean;
  score?: number;
  hintUsed?: boolean | number;
  confidence?: number;
}): Sm2Quality {
  const score = typeof g.score === "number" && Number.isFinite(g.score) ? g.score : (g.isCorrect ? 1 : 0);
  const hint = typeof g.hintUsed === "number" ? g.hintUsed > 0 : !!g.hintUsed;
  const confident = typeof g.confidence === "number" && g.confidence >= 4;

  if (!g.isCorrect) {
    const base = score >= 0.5 ? 2 : 1;
    return (confident ? base - 1 : base) as Sm2Quality;
  }
  if (hint || score < 1) return 3;
  return confident ? 5 : 4;
}
