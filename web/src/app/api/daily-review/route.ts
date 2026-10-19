import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { clampQuality, qualityFromGrade, sm2Update, type Sm2Quality } from "@/lib/sm2";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * 每日 5 分鐘小複習 — SM-2 spaced repetition over past wrong answers.
 *
 * Every wrong question a student has produced (quiz / exam / oral) becomes
 * a card in `review_cards` (migration 022) with its own ease / interval /
 * due date, scheduled by `lib/sm2.ts`. This replaces the old stateless
 * forgetting-curve ranking: reviewing a card now actually pushes it out
 * (1d → 6d → 15d …) and failing it pulls it back to tomorrow.
 *
 * GET /api/daily-review?studentId=xxx
 *   1. sync   — scan the student's attempts (newest 200) and insert a card
 *               for every wrong question that has none yet (`on conflict
 *               do nothing`, due now). This is how cards get seeded without
 *               the grading routes knowing about this table: one SELECT on
 *               attempts (already needed for hydration) + one SELECT on
 *               review_cards + at most one bulk upsert. Cheap enough to
 *               run on every request; it's a no-op after the first visit
 *               following each new attempt.
 *   2. due    — cards with due_at ≤ now, oldest-due first, limit 5,
 *               hydrated with the question text, the student's original
 *               answer and the grader's feedback from attempts.questions /
 *               answers / results.
 *   3. stats  — dueCount, nextDueAt (earliest card not yet due) and a tiny
 *               forecast {today, tomorrow, next7Days} for the header.
 *   Response: { count, items, dueCount, nextDueAt, forecast, totalCards }
 *
 * POST /api/daily-review
 *   Body: { studentId?, cardId, quality 0..5 }
 *     or  { studentId?, cardId, isCorrect, score?, hintUsed?, confidence? }
 *         (mapped to a quality by qualityFromGrade).
 *   Applies sm2Update, writes the card back and returns the new schedule
 *   so the UI can say 「下次 3 天後再見」. Also nudges the concept's
 *   student_state.mastery_score (q ≥ 4 → +0.10, q = 3 → 0, q < 3 → −0.20)
 *   so this loop keeps feeding the study plan & dashboard like before.
 *   No AI call anywhere in this route — pure data, instant, $0.
 */

const DUE_LIMIT = 5;
const ATTEMPT_SCAN_LIMIT = 200;
const DAY_MS = 86_400_000;
// Day boundaries for the forecast are computed in Asia/Taipei (UTC+8):
// the server runs in UTC but every student is on campus time, and a card
// due at 23:30 Taipei should count as "today", not "tomorrow".
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

type Q = {
  id: number;
  /** multiple_choice | short_answer | oral | interactive_optics */
  type: string;
  concept?: string;
  question?: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  sourceChapter?: number;
};

type R = { questionId: number; isCorrect: boolean; score?: number; feedback?: string };

type AttemptRow = {
  id: number;
  title: string;
  kind: "quiz" | "exam" | "oral";
  questions: Q[];
  answers: Record<string, string>;
  results: R[];
  created_at: string;
};

type CardRow = {
  id: number;
  attempt_id: number;
  question_id: number;
  concept: string | null;
  source_chapter: number | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string;
  last_reviewed_at: string | null;
  last_quality: number | null;
  lapses: number;
};

function attemptTitle(a: Pick<AttemptRow, "title" | "kind">): string {
  if (a.title) return a.title;
  return a.kind === "exam" ? "考試模擬" : a.kind === "oral" ? "口試模擬" : "自動測驗";
}

/** Start of the Taipei calendar day that contains `t`, as a UTC epoch ms. */
function taipeiDayStart(t: number): number {
  return Math.floor((t + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
}

export async function GET(req: NextRequest) {
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();
  const now = new Date();
  const nowMs = now.getTime();

  // ── 1. sync: attempts → review_cards ──────────────────────────────
  const { data: attemptsData, error: attemptsErr } = await supabase
    .from("attempts")
    .select("id, title, kind, questions, answers, results, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(ATTEMPT_SCAN_LIMIT);
  if (attemptsErr) return NextResponse.json({ error: attemptsErr.message }, { status: 500 });

  const attempts = (attemptsData ?? []) as AttemptRow[];
  const attemptById = new Map(attempts.map((a) => [a.id, a] as const));

  const { data: existingData, error: existingErr } = await supabase
    .from("review_cards")
    .select("attempt_id, question_id")
    .eq("student_id", studentId);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

  const existing = new Set((existingData ?? []).map((c) => `${c.attempt_id}:${c.question_id}`));
  const toInsert: {
    student_id: string;
    attempt_id: number;
    question_id: number;
    concept: string | null;
    source_chapter: number | null;
    due_at: string;
  }[] = [];
  for (const a of attempts) {
    const qById = new Map((a.questions ?? []).map((q) => [q.id, q] as const));
    for (const r of a.results ?? []) {
      if (r.isCorrect) continue;
      const q = qById.get(r.questionId);
      // Skip questions with no text — there's nothing to show on a card.
      if (!q || !q.question) continue;
      if (existing.has(`${a.id}:${q.id}`)) continue;
      toInsert.push({
        student_id: studentId,
        attempt_id: a.id,
        question_id: q.id,
        concept: q.concept ?? null,
        source_chapter: q.sourceChapter ?? null,
        due_at: now.toISOString(),
      });
    }
  }
  if (toInsert.length > 0) {
    // ignoreDuplicates → ON CONFLICT DO NOTHING, so two concurrent GETs
    // (e.g. SWR revalidate + focus) can't double-insert.
    const { error: upsertErr } = await supabase
      .from("review_cards")
      .upsert(toInsert, { onConflict: "student_id,attempt_id,question_id", ignoreDuplicates: true });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // ── 2. all cards (small rows) → due picks + forecast in one query ──
  const { data: cardsData, error: cardsErr } = await supabase
    .from("review_cards")
    .select("id, attempt_id, question_id, concept, source_chapter, ease, interval_days, repetitions, due_at, last_reviewed_at, last_quality, lapses")
    .eq("student_id", studentId)
    .order("due_at", { ascending: true });
  if (cardsErr) return NextResponse.json({ error: cardsErr.message }, { status: 500 });

  const cards = (cardsData ?? []) as CardRow[];
  const due = cards.filter((c) => new Date(c.due_at).getTime() <= nowMs);

  // ── 3. forecast ───────────────────────────────────────────────────
  const tomorrowStart = taipeiDayStart(nowMs) + DAY_MS;
  const dayAfterStart = tomorrowStart + DAY_MS;
  const weekEnd = nowMs + 7 * DAY_MS;
  let today = 0, tomorrow = 0, next7Days = 0;
  let nextDueAt: string | null = null;
  for (const c of cards) {
    const t = new Date(c.due_at).getTime();
    if (t < tomorrowStart) today += 1;           // overdue + rest of today
    else if (t < dayAfterStart) tomorrow += 1;
    if (t < weekEnd) next7Days += 1;             // cumulative, incl. overdue
    if (t > nowMs && nextDueAt === null) nextDueAt = c.due_at;  // cards are sorted by due_at
  }

  // ── 4. hydrate the due cards ──────────────────────────────────────
  // The sync scan already holds the newest 200 attempts; a due card can
  // point at something older, so fetch stragglers in one extra query.
  const missingIds = Array.from(new Set(due.map((c) => c.attempt_id).filter((id) => !attemptById.has(id))));
  if (missingIds.length > 0) {
    const { data: extra } = await supabase
      .from("attempts")
      .select("id, title, kind, questions, answers, results, created_at")
      .in("id", missingIds);
    for (const a of (extra ?? []) as AttemptRow[]) attemptById.set(a.id, a);
  }

  const items: {
    cardId: number;
    attemptId: number;
    attemptTitle: string;
    attemptKind: AttemptRow["kind"];
    daysSinceMistake: number;
    question: Q;
    studentAnswer: string;
    feedback: string;
    ease: number;
    intervalDays: number;
    repetitions: number;
    lapses: number;
    dueAt: string;
    lastReviewedAt: string | null;
  }[] = [];
  for (const c of due) {
    if (items.length >= DUE_LIMIT) break;
    const a = attemptById.get(c.attempt_id);
    const q = a?.questions?.find((x) => x.id === c.question_id);
    if (!a || !q) continue;  // orphan (attempt edited away) — skip silently
    const r = a.results?.find((x) => x.questionId === c.question_id);
    items.push({
      cardId: c.id,
      attemptId: a.id,
      attemptTitle: attemptTitle(a),
      attemptKind: a.kind,
      daysSinceMistake: Math.round((nowMs - new Date(a.created_at).getTime()) / DAY_MS),
      question: q,
      studentAnswer: a.answers?.[String(q.id)] ?? "(未作答)",
      feedback: r?.feedback ?? "",
      ease: c.ease,
      intervalDays: c.interval_days,
      repetitions: c.repetitions,
      lapses: c.lapses,
      dueAt: c.due_at,
      lastReviewedAt: c.last_reviewed_at,
    });
  }

  return NextResponse.json({
    count: items.length,
    items,
    dueCount: due.length,
    nextDueAt,
    forecast: { today, tomorrow, next7Days },
    totalCards: cards.length,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Auth-derived id so a caller can't grade another student's cards by
  // passing their UUID in the body; the card lookup below is also pinned
  // to this studentId.
  const { studentId } = await resolveStudentId(body?.studentId);
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const cardId = Number(body?.cardId);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return NextResponse.json({ error: "cardId required" }, { status: 400 });
  }

  // Either an explicit SM-2 quality (self-rating buttons) or the app's
  // grading signals; the latter is for a future "answer it again and let
  // the grader decide" flow, mapped via qualityFromGrade.
  let quality: Sm2Quality;
  if (typeof body?.quality === "number") {
    quality = clampQuality(body.quality);
  } else if (typeof body?.isCorrect === "boolean") {
    quality = qualityFromGrade({
      isCorrect: body.isCorrect,
      score: typeof body.score === "number" ? body.score : undefined,
      hintUsed: typeof body.hintUsed === "boolean" || typeof body.hintUsed === "number" ? body.hintUsed : undefined,
      confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    });
  } else {
    return NextResponse.json({ error: "quality or isCorrect required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: card, error: cardErr } = await supabase
    .from("review_cards")
    .select("id, concept, ease, interval_days, repetitions, lapses")
    .eq("id", cardId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (cardErr) return NextResponse.json({ error: cardErr.message }, { status: 500 });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const now = new Date();
  const next = sm2Update(
    { ease: card.ease, intervalDays: card.interval_days, repetitions: card.repetitions, lapses: card.lapses },
    quality,
    now,
  );

  const { error: updErr } = await supabase
    .from("review_cards")
    .update({
      ease: next.ease,
      interval_days: next.intervalDays,
      repetitions: next.repetitions,
      lapses: next.lapses,
      due_at: next.dueAt.toISOString(),
      last_reviewed_at: next.lastReviewedAt.toISOString(),
      last_quality: next.lastQuality,
    })
    .eq("id", cardId)
    .eq("student_id", studentId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Mastery nudge — same magnitudes as the old self-rating flow
  // (我會 +0.10 / 有點忘 0 / 完全忘 −0.20), keyed off the SM-2 quality.
  const concept = typeof card.concept === "string" ? card.concept : null;
  if (concept) {
    const delta = quality >= 4 ? 0.10 : quality === 3 ? 0 : -0.20;
    const { data: existing } = await supabase
      .from("student_state")
      .select("mastery_score, attempt_count")
      .eq("student_id", studentId)
      .eq("concept", concept)
      .maybeSingle();
    const cur = existing?.mastery_score ?? 0.3;  // unseen → assume shaky baseline
    await supabase.from("student_state").upsert({
      student_id: studentId,
      concept,
      mastery_score: Math.min(1, Math.max(0, cur + delta)),
      attempt_count: (existing?.attempt_count ?? 0) + 1,
      updated_at: now.toISOString(),
    }, { onConflict: "student_id,concept" });
  }

  return NextResponse.json({
    ok: true,
    cardId,
    quality,
    lapsed: next.lapsed,
    ease: next.ease,
    intervalDays: next.intervalDays,
    repetitions: next.repetitions,
    lapses: next.lapses,
    dueAt: next.dueAt.toISOString(),
  });
}
