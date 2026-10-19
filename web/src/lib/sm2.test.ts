import { describe, expect, it } from "vitest";
import {
  SM2_DEFAULT_EASE,
  SM2_MIN_EASE,
  clampQuality,
  qualityFromGrade,
  sm2Update,
  type Sm2Card,
} from "./sm2";

const NOW = new Date("2026-10-19T08:00:00.000Z");
const DAY_MS = 86_400_000;

function fresh(): Sm2Card {
  return { ease: SM2_DEFAULT_EASE, intervalDays: 0, repetitions: 0, lapses: 0 };
}

/** Run a sequence of grades, returning the state after each one. */
function run(qualities: number[], start: Sm2Card = fresh()) {
  const states: ReturnType<typeof sm2Update>[] = [];
  let card: Sm2Card = start;
  for (const q of qualities) {
    const next = sm2Update(card, q, NOW);
    states.push(next);
    card = next;
  }
  return states;
}

/* ─── Textbook sequences ─── */

describe("sm2Update — textbook sequences", () => {
  it("q=4 every time: 1 → 6 → 15 → 38 days with ease unchanged", () => {
    const s = run([4, 4, 4, 4]);
    expect(s.map((x) => x.intervalDays)).toEqual([1, 6, 15, 38]);
    expect(s.map((x) => x.repetitions)).toEqual([1, 2, 3, 4]);
    expect(s.every((x) => x.ease === 2.5)).toBe(true);
    expect(s.every((x) => x.lapses === 0 && !x.lapsed)).toBe(true);
  });

  it("q=5 every time: ease climbs +0.1 per review and intervals stretch", () => {
    const s = run([5, 5, 5, 5]);
    expect(s.map((x) => x.ease)).toEqual([2.6, 2.7, 2.8, 2.9]);
    // 3rd interval uses the ease *before* this review (2.7): round(6 × 2.7) = 16
    // 4th: round(16 × 2.8) = 45
    expect(s.map((x) => x.intervalDays)).toEqual([1, 6, 16, 45]);
  });

  it("q=3 every time: passes, but ease decays −0.14 per review", () => {
    const s = run([3, 3, 3]);
    expect(s.map((x) => x.ease)).toEqual([2.36, 2.22, 2.08]);
    // round(6 × 2.22) = 13
    expect(s.map((x) => x.intervalDays)).toEqual([1, 6, 13]);
    expect(s[2].repetitions).toBe(3);
  });

  it("a lapse resets repetitions + interval, bumps lapses, and still lowers ease", () => {
    const s = run([4, 4, 1]);
    const lapse = s[2];
    expect(lapse.lapsed).toBe(true);
    expect(lapse.repetitions).toBe(0);
    expect(lapse.intervalDays).toBe(1);
    expect(lapse.lapses).toBe(1);
    expect(lapse.ease).toBeCloseTo(2.5 - 0.54, 6);
    expect(lapse.lastQuality).toBe(1);
  });

  it("recovery after a lapse restarts at 1 → 6 using the reduced ease", () => {
    const s = run([4, 4, 1, 4, 4, 4]);
    expect(s.slice(3).map((x) => x.intervalDays)).toEqual([1, 6, Math.round(6 * 1.96)]);
    expect(s.slice(3).map((x) => x.repetitions)).toEqual([1, 2, 3]);
    expect(s[5].lapses).toBe(1);
  });

  it("every grade below 3 counts as a lapse (0, 1, 2)", () => {
    for (const q of [0, 1, 2]) {
      const r = sm2Update({ ease: 2.5, intervalDays: 15, repetitions: 3, lapses: 2 }, q, NOW);
      expect(r.lapsed).toBe(true);
      expect(r.repetitions).toBe(0);
      expect(r.intervalDays).toBe(1);
      expect(r.lapses).toBe(3);
    }
  });

  it("ease deltas per quality match the SM-2 formula", () => {
    const deltas = [0, 1, 2, 3, 4, 5].map((q) => sm2Update(fresh(), q, NOW).ease - 2.5);
    expect(deltas.map((d) => Math.round(d * 100) / 100)).toEqual([-0.8, -0.54, -0.32, -0.14, 0, 0.1]);
  });
});

/* ─── Edge cases ─── */

describe("sm2Update — edge cases", () => {
  it("never lets ease drop below 1.3", () => {
    const r1 = sm2Update({ ...fresh(), ease: 1.3 }, 0, NOW);
    expect(r1.ease).toBe(SM2_MIN_EASE);
    const r2 = sm2Update({ ...fresh(), ease: 1.5 }, 0, NOW);
    expect(r2.ease).toBe(SM2_MIN_EASE);
    // A pass at the floor keeps it at the floor (3 → −0.14 clamped)
    const r3 = sm2Update({ ...fresh(), ease: 1.3 }, 3, NOW);
    expect(r3.ease).toBe(SM2_MIN_EASE);
  });

  it("computes dueAt = now + intervalDays and stamps lastReviewedAt", () => {
    const r = sm2Update({ ease: 2.5, intervalDays: 6, repetitions: 2, lapses: 0 }, 4, NOW);
    expect(r.intervalDays).toBe(15);
    expect(r.dueAt.getTime()).toBe(NOW.getTime() + 15 * DAY_MS);
    expect(r.lastReviewedAt.getTime()).toBe(NOW.getTime());
  });

  it("a lapse is due tomorrow", () => {
    const r = sm2Update({ ease: 2.5, intervalDays: 38, repetitions: 4, lapses: 0 }, 2, NOW);
    expect(r.dueAt.getTime()).toBe(NOW.getTime() + DAY_MS);
  });

  it("clamps out-of-range / non-integer quality into 0..5", () => {
    expect(clampQuality(7)).toBe(5);
    expect(clampQuality(-3)).toBe(0);
    expect(clampQuality(3.6)).toBe(4);
    expect(clampQuality(NaN)).toBe(0);
    expect(clampQuality("4")).toBe(0);
    expect(sm2Update(fresh(), 9, NOW).lastQuality).toBe(5);
  });

  it("treats a corrupt ease (0 / NaN) as the default 2.5", () => {
    const r = sm2Update({ ease: 0, intervalDays: 6, repetitions: 2, lapses: 0 }, 4, NOW);
    expect(r.intervalDays).toBe(15);
    expect(r.ease).toBe(2.5);
    const r2 = sm2Update({ ease: NaN, intervalDays: 0, repetitions: 0, lapses: 0 }, 5, NOW);
    expect(r2.ease).toBe(2.6);
  });

  it("a stored interval of 0 on a card with repetitions ≥ 2 still yields ≥ 1 day", () => {
    const r = sm2Update({ ease: 2.5, intervalDays: 0, repetitions: 5, lapses: 0 }, 4, NOW);
    expect(r.intervalDays).toBe(1);
  });

  it("does not mutate the input card", () => {
    const card = fresh();
    sm2Update(card, 5, NOW);
    expect(card).toEqual(fresh());
  });

  it("rounds ease to two decimals so float4 round-trips are stable", () => {
    const r = sm2Update({ ...fresh(), ease: 2.3599999 }, 4, NOW);
    expect(r.ease).toBe(2.36);
  });
});

/* ─── qualityFromGrade ─── */

describe("qualityFromGrade", () => {
  it("plain wrong answer → 1", () => {
    expect(qualityFromGrade({ isCorrect: false, score: 0 })).toBe(1);
    expect(qualityFromGrade({ isCorrect: false })).toBe(1);
  });

  it("partially-right short answer (score ≥ 0.5 but not correct) → 2", () => {
    expect(qualityFromGrade({ isCorrect: false, score: 0.5 })).toBe(2);
  });

  it("confident misconception (confidence ≥ 4 + wrong) drops one step", () => {
    expect(qualityFromGrade({ isCorrect: false, score: 0, confidence: 5 })).toBe(0);
    expect(qualityFromGrade({ isCorrect: false, score: 0.5, confidence: 4 })).toBe(1);
    // low confidence + wrong is just a normal miss
    expect(qualityFromGrade({ isCorrect: false, score: 0, confidence: 2 })).toBe(1);
  });

  it("correct with a hint → 3 (boolean or hint level)", () => {
    expect(qualityFromGrade({ isCorrect: true, score: 1, hintUsed: true })).toBe(3);
    expect(qualityFromGrade({ isCorrect: true, score: 1, hintUsed: 2 })).toBe(3);
    expect(qualityFromGrade({ isCorrect: true, score: 1, hintUsed: 0 })).toBe(4);
  });

  it("correct but partial score (e.g. oral 0.7) → 3", () => {
    expect(qualityFromGrade({ isCorrect: true, score: 0.7 })).toBe(3);
  });

  it("clean correct → 4, clean correct + confident → 5", () => {
    expect(qualityFromGrade({ isCorrect: true, score: 1 })).toBe(4);
    expect(qualityFromGrade({ isCorrect: true })).toBe(4);
    expect(qualityFromGrade({ isCorrect: true, score: 1, confidence: 3 })).toBe(4);
    expect(qualityFromGrade({ isCorrect: true, score: 1, confidence: 4 })).toBe(5);
    expect(qualityFromGrade({ isCorrect: true, score: 1, confidence: 5 })).toBe(5);
  });

  it("a hint beats confidence: confident + hinted is still 3", () => {
    expect(qualityFromGrade({ isCorrect: true, score: 1, hintUsed: true, confidence: 5 })).toBe(3);
  });
});
