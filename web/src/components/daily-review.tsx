"use client";

/* 📅 每日 5 分鐘小複習 — SM-2 spaced repetition over past wrong answers.
 * Every wrong question is a card with its own due date (see
 * /api/daily-review + lib/sm2.ts). Reveal → think → see answer →
 * self-rate; the rating is posted right away, the server reschedules the
 * card and we show 「下次 N 天後再見」. The rating also nudges the
 * per-concept mastery_score, so this loop feeds the AI study plan &
 * dashboard. */

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThemeToggle } from "./theme-provider";

interface Question {
  id: number;
  /** multiple_choice | short_answer | oral | interactive_optics */
  type: string;
  concept?: string;
  question?: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  sourceChapter?: number;
}

interface ReviewItem {
  cardId: number;
  attemptId: number;
  attemptTitle: string;
  attemptKind: "quiz" | "exam" | "oral";
  daysSinceMistake: number;
  question: Question;
  studentAnswer: string;
  feedback: string;
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: string;
  lastReviewedAt: string | null;
}

interface DailyReviewResponse {
  count: number;
  items: ReviewItem[];
  dueCount: number;
  nextDueAt: string | null;
  forecast: { today: number; tomorrow: number; next7Days: number };
  totalCards: number;
}

/** What POST /api/daily-review returns after one rating. */
interface Outcome {
  quality: number;
  lapsed: boolean;
  intervalDays: number;
  dueAt: string;
}

/* Self-rating buttons → SM-2 quality. 3 is the pass/fail boundary:
 * 完全忘 lapses the card back to tomorrow, the other three stretch it. */
const RATINGS = [
  { q: 1, label: "完全忘", cls: "bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40" },
  { q: 3, label: "有點忘", cls: "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40" },
  { q: 4, label: "我會",   cls: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40" },
  { q: 5, label: "秒答",   cls: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/40" },
] as const;

const TODAY_KEY = (studentId: string) => `physics_tutor_daily_done_${studentId}_${new Date().toISOString().slice(0, 10)}`;
const STREAK_KEY = (studentId: string) => `physics_tutor_daily_streak_${studentId}`;
const STREAK_DATE_KEY = (studentId: string) => `physics_tutor_daily_streak_date_${studentId}`;

function bumpStreak(studentId: string) {
  if (typeof window === "undefined") return 0;
  const lastDate = localStorage.getItem(STREAK_DATE_KEY(studentId));
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  let streak = parseInt(localStorage.getItem(STREAK_KEY(studentId)) ?? "0", 10) || 0;
  if (lastDate === today) {
    // already counted today
  } else if (lastDate === yesterday) {
    streak += 1;
  } else {
    streak = 1;
  }
  localStorage.setItem(STREAK_KEY(studentId), String(streak));
  localStorage.setItem(STREAK_DATE_KEY(studentId), today);
  return streak;
}

/** "10/22" in the viewer's local timezone. */
function fmtMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}

/** 「下次 3 天後再見（10/22）」 / 「明天再見一次」 for the outcome line. */
function outcomeText(o: Outcome): string {
  if (o.lapsed) return `🔁 沒關係，明天再見一次（${fmtMonthDay(o.dueAt)}）`;
  if (o.intervalDays <= 1) return `📆 明天再見（${fmtMonthDay(o.dueAt)}）`;
  return `📆 下次 ${o.intervalDays} 天後再見（${fmtMonthDay(o.dueAt)}）`;
}

interface DailyReviewProps {
  onBack: () => void;
}

export function DailyReview({ onBack }: DailyReviewProps) {
  const studentId = useStudentId() ?? "";
  const { data, isLoading, mutate } = useSWR<DailyReviewResponse>(
    apiKey("/api/daily-review", { studentId }),
    // The batch is the session: don't let a focus/reconnect revalidate
    // swap the cards out from under the student mid-review.
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  // Memoize so the `finish` callback's deps stay stable when SWR returns
  // a structurally-equal payload on revalidation.
  const items = useMemo(() => (data ? (data.items ?? []) : null), [data]);
  const loading = !!studentId && isLoading;

  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [posting, setPosting] = useState<number | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [streak, setStreak] = useState(0);

  const rate = useCallback(async (i: number, cardId: number, quality: number) => {
    if (!studentId || outcomes[i] || posting !== null) return;
    setPosting(i);
    setPostError(null);
    try {
      const res = await fetch("/api/daily-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, cardId, quality }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const o = (await res.json()) as Outcome;
      setOutcomes((prev) => ({ ...prev, [i]: { quality, lapsed: o.lapsed, intervalDays: o.intervalDays, dueAt: o.dueAt } }));
    } catch {
      setPostError("評分沒有送出，請再點一次。");
    } finally {
      setPosting(null);
    }
  }, [studentId, outcomes, posting]);

  const finish = useCallback(() => {
    if (!studentId || !items) return;
    if (typeof window !== "undefined") {
      localStorage.setItem(TODAY_KEY(studentId), "1");
    }
    setStreak(bumpStreak(studentId));
    setDone(true);
  }, [items, studentId]);

  /** Pull the next batch of due cards (when more than 5 were due). */
  const nextBatch = useCallback(async () => {
    setIdx(0);
    setRevealed({});
    setOutcomes({});
    setDone(false);
    await mutate();
  }, [mutate]);

  if (loading) {
    return (
      <Wrapper onBack={onBack} title="今日 5 分鐘">
        <div className="text-center text-slate-400 dark:text-slate-500 py-16">載入中...</div>
      </Wrapper>
    );
  }

  if (!items || items.length === 0) {
    const hasCards = (data?.totalCards ?? 0) > 0;
    return (
      <Wrapper onBack={onBack} title="今日 5 分鐘">
        <div className="max-w-2xl mx-auto space-y-4">
          {data && <ForecastBar data={data} />}
          <div className="text-center text-slate-500 dark:text-slate-400 py-12 max-w-md mx-auto space-y-3">
            {hasCards ? (
              <>
                <p className="text-3xl">🎉</p>
                <p className="font-medium text-slate-700 dark:text-slate-200">今天沒有到期的卡片</p>
                {data?.nextDueAt ? (
                  <p className="text-sm">下一張：<strong>{fmtMonthDay(data.nextDueAt)}</strong></p>
                ) : null}
                <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
                  共有 {data?.totalCards} 張卡片在排程中。答對的卡片會越隔越久才回來，忘記的則隔天就會再出現。
                </p>
              </>
            ) : (
              <>
                <p className="text-3xl">🌱</p>
                <p className="font-medium">還沒有複習卡片</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
                  你在「自動測驗」「考試模擬」「口試模擬」答錯的題目會自動變成複習卡片，依間隔重複（SM-2）排程：
                  記得的越隔越久，忘的隔天再來。先去累積一些資料再回來吧！
                </p>
              </>
            )}
          </div>
        </div>
      </Wrapper>
    );
  }

  if (done) {
    const knownCount = Object.values(outcomes).filter((o) => o.quality >= 4).length;
    const remaining = Math.max(0, (data?.dueCount ?? 0) - items.length);
    // Earliest upcoming card: whichever is sooner, the server's nextDueAt
    // (computed before this batch) or one of the cards we just rescheduled.
    const candidates = [data?.nextDueAt, ...Object.values(outcomes).map((o) => o.dueAt)]
      .filter((x): x is string => typeof x === "string")
      .map((x) => new Date(x).getTime());
    const nextDue = candidates.length > 0 ? new Date(Math.min(...candidates)).toISOString() : null;
    return (
      <Wrapper onBack={onBack} title="今日 5 分鐘 — 完成">
        <div className="text-center py-12 max-w-md mx-auto space-y-3">
          <p className="text-5xl">🎉</p>
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">今天 5 分鐘已完成</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            複習了 <strong>{items.length}</strong> 題，其中 <strong>{knownCount}</strong> 題你現在會了。
          </p>
          {streak > 1 && (
            <div className="inline-block px-4 py-2 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
              🔥 連續複習 <strong>{streak}</strong> 天
            </div>
          )}
          {remaining > 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">還有 {remaining} 張卡片今天到期。</p>
          ) : nextDue ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">下一張：{fmtMonthDay(nextDue)}</p>
          ) : null}
          <div className="flex items-center justify-center gap-2 mt-4">
            {remaining > 0 && (
              <button
                onClick={nextBatch}
                className="px-5 py-2 rounded-xl border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
              >
                再複習 {Math.min(5, remaining)} 題
              </button>
            )}
            <button
              onClick={onBack}
              className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              回首頁
            </button>
          </div>
        </div>
      </Wrapper>
    );
  }

  const it = items[idx];
  const q = it.question;
  const isRevealed = !!revealed[idx];
  const outcome = outcomes[idx];
  const total = items.length;

  const isLast = idx === total - 1;
  const next = () => setIdx(Math.min(total - 1, idx + 1));
  const prev = () => setIdx(Math.max(0, idx - 1));

  return (
    <Wrapper onBack={onBack} title={`今日 5 分鐘 — ${idx + 1} / ${total}`}>
      <div className="max-w-2xl mx-auto space-y-4">
        {data && <ForecastBar data={data} />}

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
              ⏳ {it.daysSinceMistake} 天前答錯
            </span>
            {it.repetitions > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium">
                ✓ 已連續答對 {it.repetitions} 次
              </span>
            )}
            {it.lapses > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-medium">
                🔁 忘過 {it.lapses} 次
              </span>
            )}
            {q.sourceChapter && (
              <span>Ch{String(q.sourceChapter).padStart(2, "0")}</span>
            )}
            {q.concept && <span className="truncate max-w-[200px]">{q.concept}</span>}
            <span className="ml-auto">{q.type === "multiple_choice" ? "選擇" : q.type === "oral" ? "口試" : q.type === "interactive_optics" ? "光路" : "簡答"}</span>
          </div>

          <div className="text-sm text-slate-800 dark:text-slate-100">
            <MarkdownRenderer content={q.question ?? ""} />
          </div>

          {q.options && q.options.length > 0 && !isRevealed && (
            <div className="space-y-1.5">
              {q.options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                return (
                  <div key={i} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm flex items-start gap-2">
                    <span className="font-semibold shrink-0">{letter}.</span>
                    <span className="flex-1"><MarkdownRenderer content={opt} /></span>
                  </div>
                );
              })}
            </div>
          )}

          {!isRevealed ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                💡 先在心裡（或紙上）想一遍答案，覺得 OK 再點下面看正解。
              </p>
              <button
                onClick={() => setRevealed({ ...revealed, [idx]: true })}
                className="w-full px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                我想好了，看正解
              </button>
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700">
              {q.options && q.options.length > 0 && (
                <div className="space-y-1.5">
                  {q.options.map((opt, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const isCorrect = (q.correctAnswer ?? "").startsWith(letter) || q.correctAnswer === letter || q.correctAnswer === opt;
                    return (
                      <div key={i} className={`px-3 py-2 rounded-lg border text-sm flex items-start gap-2 ${isCorrect ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"}`}>
                        <span className="font-semibold shrink-0">{letter}.</span>
                        <span className="flex-1"><MarkdownRenderer content={opt} /></span>
                        {isCorrect && <span className="text-xs shrink-0">正解</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {q.type !== "multiple_choice" && q.correctAnswer && (
                <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-sm">
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mr-2">參考答案</span>
                  <MarkdownRenderer content={q.correctAnswer} />
                </div>
              )}

              {it.studentAnswer && (
                <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-2">你當時答</span>
                  <MarkdownRenderer content={it.studentAnswer} />
                </div>
              )}

              {q.explanation && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300">查看完整解析</summary>
                  <div className="mt-2 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 text-sm text-slate-700 dark:text-slate-200">
                    <MarkdownRenderer content={q.explanation} />
                  </div>
                </details>
              )}

              <div className="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-2">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">這次你會了嗎？</p>
                <div className="grid grid-cols-4 gap-2">
                  {RATINGS.map((opt) => (
                    <button
                      key={opt.q}
                      onClick={() => rate(idx, it.cardId, opt.q)}
                      disabled={!!outcome || posting !== null}
                      className={`px-2 py-1.5 rounded-xl border text-xs font-medium transition-colors ${opt.cls} ${outcome?.quality === opt.q ? "ring-2 ring-offset-1 ring-slate-400" : ""} ${outcome && outcome.quality !== opt.q ? "opacity-40" : ""} disabled:cursor-not-allowed`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {posting === idx && (
                  <p className="text-xs text-slate-400 dark:text-slate-500">排程中...</p>
                )}
                {postError && !outcome && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{postError}</p>
                )}
                {outcome && (
                  <p className={`text-xs font-medium ${outcome.lapsed ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                    {outcomeText(outcome)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={prev}
            disabled={idx === 0}
            className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            ← 上一題
          </button>
          <span className="text-xs text-slate-400 dark:text-slate-500">{idx + 1} / {total}</span>
          {isLast ? (
            <button
              onClick={finish}
              disabled={!outcome}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              完成今日複習 ✓
            </button>
          ) : (
            <button
              onClick={next}
              disabled={!outcome}
              className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一題 →
            </button>
          )}
        </div>
      </div>
    </Wrapper>
  );
}

/** Due count + forecast strip at the top of the review. */
function ForecastBar({ data }: { data: DailyReviewResponse }) {
  const { forecast } = data;
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 dark:text-slate-400 px-1">
      <span className="font-medium text-slate-700 dark:text-slate-200">
        📬 到期 <strong className="text-indigo-600 dark:text-indigo-300">{data.dueCount}</strong> 張
      </span>
      <span className="text-slate-300 dark:text-slate-600">|</span>
      <span>今天 {forecast.today}</span>
      <span>明天 {forecast.tomorrow}</span>
      <span>7 天內 {forecast.next7Days}</span>
      <span className="ml-auto">共 {data.totalCards} 張卡片</span>
    </div>
  );
}

function Wrapper({ onBack, title, children }: { onBack: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📅</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
        <ThemeToggle className="ml-auto" />
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6">{children}</div>
    </div>
  );
}

/** Helper for the mode-selector tile so the home page can show today's status. */
export function useDailyStatus(studentId: string | null) {
  // We read from localStorage on every render (cheap), guarding for SSR.
  // The values change only when `finish()` runs in this same component
  // tree, which already triggers a re-render via setState — so a cached
  // useState mirror would just duplicate the source of truth. Doing the
  // read synchronously dodges the React 19 set-state-in-effect rule and
  // is correct because the component re-renders whenever the parent
  // does (mode-selector reads it once on mount, then re-mounts on
  // navigation back to home).
  if (!studentId || typeof window === "undefined") {
    return { todayDone: false, streak: 0 };
  }
  const todayDone = localStorage.getItem(TODAY_KEY(studentId)) === "1";
  const s = parseInt(localStorage.getItem(STREAK_KEY(studentId)) ?? "0", 10) || 0;
  const lastDate = localStorage.getItem(STREAK_DATE_KEY(studentId));
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  // If they haven't done it today and the last streak day was older than
  // yesterday, the streak is effectively broken — show 0.
  const streak = lastDate !== today && lastDate !== yesterday ? 0 : s;
  return { todayDone, streak };
}
