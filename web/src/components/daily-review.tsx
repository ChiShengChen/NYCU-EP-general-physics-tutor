"use client";

/* 📅 每日 5 分鐘小複習 — spaced-repetition retrieval practice over past
 * wrong answers. Reveal → think → click to see answer → self-rate. The
 * self-rating nudges the per-concept mastery_score, so this loop feeds
 * the AI study plan & dashboard. */

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThemeToggle } from "./theme-provider";

interface Question {
  id: number;
  type: "multiple_choice" | "short_answer";
  concept?: string;
  question?: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  sourceChapter?: number;
}

interface ReviewItem {
  attemptId: number;
  attemptTitle: string;
  daysSinceMistake: number;
  question: Question;
  feedback: string;
}

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

interface DailyReviewProps {
  onBack: () => void;
}

export function DailyReview({ onBack }: DailyReviewProps) {
  const studentId = useStudentId() ?? "";
  const { data, isLoading } = useSWR<{ items: ReviewItem[] }>(
    apiKey("/api/daily-review", { studentId }),
  );
  // Memoize so the `finish` callback's deps stay stable when SWR returns
  // a structurally-equal payload on revalidation.
  const items = useMemo(() => (data ? (data.items ?? []) : null), [data]);
  const loading = !!studentId && isLoading;

  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [ratings, setRatings] = useState<Record<number, -1 | 0 | 1>>({});
  const [done, setDone] = useState(false);
  const [streak, setStreak] = useState(0);

  const finish = useCallback(async () => {
    if (!studentId || !items) return;
    const body = {
      action: "record",
      studentId,
      items: items.map((it, i) => ({
        concept: it.question.concept,
        knewIt: ratings[i] ?? 0,
      })),
    };
    await fetch("/api/daily-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (typeof window !== "undefined") {
      localStorage.setItem(TODAY_KEY(studentId), "1");
    }
    setStreak(bumpStreak(studentId));
    setDone(true);
  }, [items, ratings, studentId]);

  if (loading) {
    return (
      <Wrapper onBack={onBack} title="今日 5 分鐘">
        <div className="text-center text-slate-400 dark:text-slate-500 py-16">載入中...</div>
      </Wrapper>
    );
  }

  if (!items || items.length === 0) {
    return (
      <Wrapper onBack={onBack} title="今日 5 分鐘">
        <div className="text-center text-slate-500 dark:text-slate-400 py-12 max-w-md mx-auto space-y-3">
          <p className="text-3xl">🌱</p>
          <p className="font-medium">沒有需要複習的題目</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
            這個區塊會自動撈出你過去測驗 / 考試中答錯的題目，依遺忘曲線挑出最該再看的給你。
            目前要不是還沒答錯過題、就是你最近才剛做過 — 先去「自動測驗」或「考試模擬」累積一些資料再回來吧！
          </p>
        </div>
      </Wrapper>
    );
  }

  if (done) {
    const knownCount = Object.values(ratings).filter((v) => v === 1).length;
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
          <button
            onClick={onBack}
            className="block mx-auto mt-4 px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            回首頁
          </button>
        </div>
      </Wrapper>
    );
  }

  const it = items[idx];
  const q = it.question;
  const isRevealed = !!revealed[idx];
  const total = items.length;

  const isLast = idx === total - 1;
  const next = () => setIdx(Math.min(total - 1, idx + 1));
  const prev = () => setIdx(Math.max(0, idx - 1));

  return (
    <Wrapper onBack={onBack} title={`今日 5 分鐘 — ${idx + 1} / ${total}`}>
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
              ⏳ {it.daysSinceMistake} 天前答錯
            </span>
            {q.sourceChapter && (
              <span>Ch{String(q.sourceChapter).padStart(2, "0")}</span>
            )}
            {q.concept && <span className="truncate max-w-[200px]">{q.concept}</span>}
            <span className="ml-auto">{q.type === "multiple_choice" ? "選擇" : "簡答"}</span>
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

              {q.type === "short_answer" && q.correctAnswer && (
                <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-sm">
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mr-2">參考答案</span>
                  <MarkdownRenderer content={q.correctAnswer} />
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
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: -1 as const, label: "完全忘", cls: "bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:bg-rose-900/40" },
                    { v: 0  as const, label: "有點忘", cls: "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:bg-amber-900/40" },
                    { v: 1  as const, label: "我會",   cls: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/40" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => setRatings({ ...ratings, [idx]: opt.v })}
                      className={`px-2 py-1.5 rounded-xl border text-xs font-medium transition-colors ${opt.cls} ${ratings[idx] === opt.v ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
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
              disabled={!isRevealed || ratings[idx] === undefined}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              完成今日複習 ✓
            </button>
          ) : (
            <button
              onClick={next}
              disabled={!isRevealed || ratings[idx] === undefined}
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
        <ThemeToggle />
        <span className="text-xl">📅</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
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
