import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { CHAPTER_NODES } from "@/lib/concept-graph";
import type { AttemptAnalysis } from "@/lib/attempt-analysis";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/* ─── 深入分析 shapes ─── */

/** Newest-N bound on the per-student attempts scan. 300 attempts × ~20
 *  questions is ~6000 question rows to fold in memory — plenty of signal,
 *  and keeps the JSONB payload well under a second even for the keenest
 *  student. */
const ATTEMPTS_LIMIT = 300;
/** Below this many students the percentile would let a reader infer
 *  roughly where each classmate sits, so we withhold it entirely. */
const MIN_CLASS_SIZE = 5;
/** PostgREST caps a single select at 1000 rows; the class-wide
 *  student_state read pages through up to this many pages (~10K rows ≈
 *  300 students × 36 concepts). */
const CLASS_PAGE_SIZE = 1000;
const CLASS_MAX_PAGES = 10;

const QUESTION_TYPES = ["multiple_choice", "short_answer", "oral", "interactive_optics"] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];
/** Only these types ever have hints available, so the hint-dependence
 *  split is computed over them alone — oral and optics questions would
 *  otherwise pad the "no hint" bucket with questions that never offered one. */
const HINTABLE_TYPES = new Set<string>(["multiple_choice", "short_answer"]);

const ERROR_TYPES = ["concept", "calculation", "reading", "incomplete", "unanswered"] as const;
type ErrorType = (typeof ERROR_TYPES)[number];

const HOUR_BUCKETS = [
  { key: "morning", label: "早", range: "06–12", from: 6, to: 12 },
  { key: "afternoon", label: "午", range: "12–18", from: 12, to: 18 },
  { key: "evening", label: "晚", range: "18–24", from: 18, to: 24 },
  { key: "night", label: "夜", range: "00–06", from: 0, to: 6 },
] as const;

interface AttemptQuestion {
  id: number;
  type?: string;
  sourceChapter?: number;
}
interface AttemptResult {
  questionId: number;
  isCorrect: boolean;
}
interface AttemptRow {
  kind: string;
  questions: AttemptQuestion[] | null;
  results: AttemptResult[] | null;
  hint_usage: Record<string, number> | null;
  created_at: string;
}

type Tally = { correct: number; total: number };
const newTally = (): Tally => ({ correct: 0, total: 0 });
const accuracyOf = (t: Tally): number | null =>
  t.total > 0 ? Math.round((t.correct / t.total) * 100) : null;

/** Hour-of-day (0–23) in Asia/Taipei. The DB stores UTC; students study
 *  on Taipei time, so a 23:00 UTC attempt is a 07:00 "morning" one. */
const taipeiHourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  hour: "numeric",
  hourCycle: "h23",
});
function taipeiHour(iso: string): number {
  const h = parseInt(taipeiHourFmt.format(new Date(iso)), 10);
  return Number.isFinite(h) ? h % 24 : 0;
}

/** One-sentence takeaway from the error-type mix. Rule-based on purpose:
 *  it runs on every dashboard load, and an LLM call for a sentence that
 *  only depends on five counts would be wasteful. */
function errorTakeaway(counts: Record<ErrorType, number>): string {
  const total = ERROR_TYPES.reduce((s, t) => s + counts[t], 0);
  if (total === 0) return "還沒有錯題分析資料——測驗結束後按「AI 錯題分析」，這裡就會累積你的錯因。";
  const ranked = [...ERROR_TYPES].sort((a, b) => counts[b] - counts[a]);
  const top = ranked[0];
  const topShare = counts[top] / total;
  const conceptShare = counts.concept / total;
  if (topShare < 0.4) return "錯因很分散，沒有單一弱點，整體再多練幾份測驗就會收斂。";
  switch (top) {
    case "calculation":
      return conceptShare < 0.2
        ? "你最常是計算錯，概念其實懂——多留時間檢查代數、正負號與單位。"
        : "你最常是計算錯，但概念誤解也不少——先把觀念弄清楚，再練計算細節。";
    case "concept":
      return "你最常是概念誤解，建議先回講義把觀念釐清，再回來刷題。";
    case "reading":
      return "你最常是審題錯——題目條件再看一次（已知量、方向、單位）再動筆。";
    case "incomplete":
      return "你的方向多半是對的，但回答不完整——把推導與結論寫到底。";
    case "unanswered":
      return "有不少題沒作答——先練時間分配，或先寫會的部分拿基本分。";
  }
}

/** GET /api/dashboard?studentId=xxx — fetch all dashboard data for a student */
export async function GET(req: NextRequest) {
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Class-wide mastery read (service role, every student). Paged because
  // PostgREST silently truncates at 1000 rows and a 36-concept × N-student
  // table crosses that quickly. Only student_id + score leave the DB and
  // only an aggregate leaves this function.
  const fetchClassMastery = async () => {
    const rows: { student_id: string; mastery_score: number }[] = [];
    for (let page = 0; page < CLASS_MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from("student_state")
        .select("student_id, mastery_score")
        .gte("attempt_count", 1)
        .order("student_id")
        .range(page * CLASS_PAGE_SIZE, (page + 1) * CLASS_PAGE_SIZE - 1);
      if (error || !data) break;
      rows.push(...data);
      if (data.length < CLASS_PAGE_SIZE) break;
    }
    return rows;
  };

  // 1. + 2. (+ 3.–5.) Independent reads from different tables — run them
  //    in parallel. Was sequential before, costing one round-trip of
  //    latency on every dashboard load.
  const [masteryResp, chatResp, attemptsResp, analysesResp, classRows] = await Promise.all([
    supabase
      .from("student_state")
      .select("concept, mastery_score, attempt_count, last_misconception, updated_at")
      .eq("student_id", studentId)
      .order("concept"),
    supabase
      .from("chat_messages")
      .select("role, created_at, content")
      .eq("student_id", studentId)
      .order("created_at", { ascending: true }),
    supabase
      .from("attempts")
      .select("kind, questions, results, hint_usage, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(ATTEMPTS_LIMIT),
    supabase
      .from("attempt_analyses")
      .select("analysis")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(ATTEMPTS_LIMIT),
    fetchClassMastery(),
  ]);
  const masteryData = masteryResp.data;
  const chatData = chatResp.data;
  const attemptRows = (attemptsResp.data ?? []) as AttemptRow[];
  const analysisRows = (analysesResp.data ?? []) as { analysis: AttemptAnalysis | null }[];

  /* ─── 深入分析：題型 / 章節 / 時段 / 提示 ─── */

  const byTypeTally: Record<QuestionType, Tally> = {
    multiple_choice: newTally(),
    short_answer: newTally(),
    oral: newTally(),
    interactive_optics: newTally(),
  };
  const byChapterTally = new Map<number, Tally>();
  // Per hour bucket: how many *attempts* landed there + question tally.
  const byHourTally = HOUR_BUCKETS.map(() => ({ attempts: 0, ...newTally() }));
  const hinted = newTally();
  const noHint = newTally();
  let totalQuestions = 0;

  for (const a of attemptRows) {
    const questions = Array.isArray(a.questions) ? a.questions : [];
    const results = Array.isArray(a.results) ? a.results : [];
    if (results.length === 0) continue;
    const qById = new Map(questions.map((q) => [q.id, q] as const));
    const hour = taipeiHour(a.created_at);
    const bucketIdx = HOUR_BUCKETS.findIndex((b) => hour >= b.from && hour < b.to);
    if (bucketIdx >= 0) byHourTally[bucketIdx].attempts += 1;

    for (const r of results) {
      const q = qById.get(r.questionId);
      const correct = r.isCorrect ? 1 : 0;
      totalQuestions += 1;

      const type = q?.type;
      if (type && (QUESTION_TYPES as readonly string[]).includes(type)) {
        const t = byTypeTally[type as QuestionType];
        t.total += 1;
        t.correct += correct;
      }

      const chapter = q?.sourceChapter;
      if (chapter) {
        const t = byChapterTally.get(chapter) ?? newTally();
        t.total += 1;
        t.correct += correct;
        byChapterTally.set(chapter, t);
      }

      if (bucketIdx >= 0) {
        byHourTally[bucketIdx].total += 1;
        byHourTally[bucketIdx].correct += correct;
      }

      if (type && HINTABLE_TYPES.has(type)) {
        const level = a.hint_usage?.[String(r.questionId)] ?? 0;
        const t = level > 0 ? hinted : noHint;
        t.total += 1;
        t.correct += correct;
      }
    }
  }

  const byType = QUESTION_TYPES
    .filter((t) => byTypeTally[t].total > 0)
    .map((t) => ({ type: t, accuracy: accuracyOf(byTypeTally[t]) ?? 0, count: byTypeTally[t].total }));

  const chapterTitle = new Map(CHAPTER_NODES.map((n) => [n.chapter, n.label] as const));
  const byChapter = [...byChapterTally.entries()]
    .map(([chapter, t]) => ({
      chapter,
      title: chapterTitle.get(chapter) ?? "",
      accuracy: accuracyOf(t) ?? 0,
      count: t.total,
    }))
    // Weakest first; among equals, the one with more evidence first.
    .sort((a, b) => a.accuracy - b.accuracy || b.count - a.count);

  const byHour = HOUR_BUCKETS.map((b, i) => ({
    key: b.key,
    label: b.label,
    range: b.range,
    attempts: byHourTally[i].attempts,
    accuracy: accuracyOf(byHourTally[i]),
  }));

  const hintableTotal = hinted.total + noHint.total;
  const hints = {
    hintedCount: hinted.total,
    noHintCount: noHint.total,
    hintedShare: hintableTotal > 0 ? Math.round((hinted.total / hintableTotal) * 100) : 0,
    hintedAccuracy: accuracyOf(hinted),
    noHintAccuracy: accuracyOf(noHint),
  };

  /* ─── 錯因分布（from this student's cached AI analyses） ─── */

  const errorCounts: Record<ErrorType, number> = {
    concept: 0, calculation: 0, reading: 0, incomplete: 0, unanswered: 0,
  };
  for (const row of analysisRows) {
    for (const q of row.analysis?.questions ?? []) {
      if (q.errorType in errorCounts) errorCounts[q.errorType] += 1;
    }
  }
  const errorTypes = {
    counts: ERROR_TYPES.map((t) => ({ type: t, count: errorCounts[t] })),
    analyzedAttempts: analysisRows.length,
    takeaway: errorTakeaway(errorCounts),
  };

  /* ─── 班級百分位（aggregate only — no ids ever leave this block） ─── */

  const perStudent = new Map<string, Tally>();
  for (const r of classRows) {
    const t = perStudent.get(r.student_id) ?? newTally();
    // Reuse Tally as {sum, n}: correct ← Σscore, total ← count.
    t.correct += r.mastery_score;
    t.total += 1;
    perStudent.set(r.student_id, t);
  }
  const classAverages = [...perStudent.entries()].map(([sid, t]) => ({ sid, avg: t.correct / t.total }));
  const classSize = classAverages.length;
  const mine = classAverages.find((s) => s.sid === studentId)?.avg ?? null;

  let classRank: {
    classSize: number;
    percentile: number | null;
    yourBucket: number | null;
    histogram: number[];
  };
  if (classSize < MIN_CLASS_SIZE || mine === null) {
    classRank = { classSize, percentile: null, yourBucket: null, histogram: [] };
  } else {
    const histogram = new Array<number>(10).fill(0);
    let below = 0;
    let ties = 0;
    for (const s of classAverages) {
      histogram[Math.min(9, Math.floor(s.avg * 10))] += 1;
      if (s.sid === studentId) continue;
      if (s.avg < mine - 1e-9) below += 1;
      else if (Math.abs(s.avg - mine) <= 1e-9) ties += 1;
    }
    // Mid-rank percentile among the *other* students: ties count half,
    // so a student exactly in the middle of a flat class reads as 50.
    const percentile = Math.round(((below + ties / 2) / (classSize - 1)) * 100);
    classRank = {
      classSize,
      percentile: Math.max(0, Math.min(100, percentile)),
      yourBucket: Math.min(9, Math.floor(mine * 10)),
      histogram,
    };
  }

  const analytics = {
    attemptsScanned: attemptRows.length,
    totalQuestions,
    byType,
    byChapter,
    errorTypes,
    byHour,
    hints,
  };

  // 3. Compute activity heatmap (messages per day)
  const activityMap: Record<string, number> = {};
  for (const msg of chatData ?? []) {
    const day = msg.created_at.slice(0, 10); // YYYY-MM-DD
    activityMap[day] = (activityMap[day] ?? 0) + 1;
  }

  const activityHeatmap = Object.entries(activityMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 4. Compute mastery trend over time (from student_state updated_at snapshots)
  // Group mastery by date of last update
  const masteryTrend: Record<string, { total: number; count: number }> = {};
  for (const s of masteryData ?? []) {
    const day = s.updated_at.slice(0, 10);
    if (!masteryTrend[day]) masteryTrend[day] = { total: 0, count: 0 };
    masteryTrend[day].total += s.mastery_score;
    masteryTrend[day].count += 1;
  }

  const trendLine = Object.entries(masteryTrend)
    .map(([date, { total, count }]) => ({
      date,
      avgMastery: Math.round((total / count) * 100),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 5. Summary stats
  const totalMessages = (chatData ?? []).filter((m) => m.role === "user").length;
  const concepts = masteryData ?? [];
  const avgMastery =
    concepts.length > 0
      ? Math.round((concepts.reduce((s, c) => s + c.mastery_score, 0) / concepts.length) * 100)
      : 0;
  const weakConcepts = concepts.filter((c) => c.mastery_score < 0.6);
  const strongConcepts = concepts.filter((c) => c.mastery_score >= 0.8);

  // 6. Study sessions (estimate from chat message timestamps — gaps > 30min = new session)
  let studySessions = 0;
  let totalStudyMinutes = 0;
  let sessionStart: string | null = null;
  let lastTimestamp: string | null = null;

  for (const msg of chatData ?? []) {
    const ts = msg.created_at;
    if (!lastTimestamp) {
      sessionStart = ts;
      studySessions = 1;
    } else {
      const gap = (new Date(ts).getTime() - new Date(lastTimestamp).getTime()) / 60000;
      if (gap > 30) {
        // End previous session
        totalStudyMinutes += (new Date(lastTimestamp).getTime() - new Date(sessionStart!).getTime()) / 60000;
        sessionStart = ts;
        studySessions++;
      }
    }
    lastTimestamp = ts;
  }
  // Close last session
  if (sessionStart && lastTimestamp) {
    totalStudyMinutes += (new Date(lastTimestamp).getTime() - new Date(sessionStart).getTime()) / 60000;
  }
  totalStudyMinutes = Math.max(Math.round(totalStudyMinutes), totalMessages); // at least 1 min per message

  return NextResponse.json({
    mastery: concepts.map((c) => ({
      concept: c.concept,
      score: Math.round(c.mastery_score * 100),
      attempts: c.attempt_count,
      misconception: c.last_misconception,
    })),
    activityHeatmap,
    trendLine,
    stats: {
      totalMessages,
      totalConcepts: concepts.length,
      avgMastery,
      weakCount: weakConcepts.length,
      strongCount: strongConcepts.length,
      studySessions,
      totalStudyMinutes,
    },
    analytics,
    classRank,
  });
}
