"use client";

/* 🪞 反思日誌 — metacognition journal. Rotates 1 of 6 reflection prompts so
 * the student isn't staring at a blank textarea, sends their entry +
 * mastery snapshot to /api/reflection, surfaces personalised AI feedback.
 * History list with collapsible past entries. */

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThemeToggle } from "./theme-provider";

interface Reflection {
  id: number;
  content: string;
  ai_feedback: string | null;
  prompt_used: string | null;
  created_at: string;
}

const PROMPTS = [
  "本週你學到最有感的一個物理概念是什麼？為什麼讓你印象深刻？",
  "本週遇到最卡的地方是哪一題 / 哪個觀念？卡在哪裡？你目前怎麼想？",
  "如果你要把這週學的東西用 3 句話跟高中生講清楚，會怎麼講？",
  "比較這週你做對的題目 vs 做錯的題目，差異是「真的懂」還是「剛好猜對 / 算錯」？",
  "你這週有沒有覺得「啊原來如此」的瞬間？什麼觸發的？",
  "如果下週你要更進步，最該改變的 1 個習慣是什麼？",
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface ReflectionJournalProps {
  onBack: () => void;
}

export function ReflectionJournal({ onBack }: ReflectionJournalProps) {
  const studentId = useStudentId() ?? "";
  const { data: listData, mutate: refresh } = useSWR<{ reflections: Reflection[] }>(
    apiKey("/api/reflection", { studentId }),
  );
  const list = listData ? (listData.reflections ?? []) : null;

  // Stable per-mount prompt so it doesn't reshuffle on every keystroke.
  const promptOfTheDay = useMemo(() => {
    const day = new Date().getDate();  // rotate per day in the month
    return PROMPTS[day % PROMPTS.length];
  }, []);

  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [latestFeedback, setLatestFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text || submitting || !studentId) return;
    setSubmitting(true);
    setError(null);
    setLatestFeedback(null);
    try {
      const res = await fetch("/api/reflection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, content: text, promptUsed: promptOfTheDay }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContent("");
      setLatestFeedback(data.reflection?.ai_feedback ?? null);
      await refresh();
    } catch (err) {
      console.error(err);
      setError("送出失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, studentId, promptOfTheDay, refresh]);

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
        <span className="text-xl">🪞</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">反思日誌</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">後設認知訓練</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-3xl mx-auto space-y-5">
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
            <p className="font-medium mb-1">為什麼寫？</p>
            <p className="text-xs">
              研究上叫 <strong>metacognition</strong> — 學生願意寫下自己學什麼、卡哪裡，會比只做題進步更快。
              不用寫長，<strong>3–5 句</strong>就夠。AI 看完會給你個人化回饋（會結合你的弱點資料）。
            </p>
          </div>

          {/* Today's prompt + textarea */}
          <form onSubmit={submit} className="space-y-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1">本日引導題</div>
                <p className="text-sm text-slate-800 dark:text-slate-100">{promptOfTheDay}</p>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="（想到什麼就寫，不必潤稿。3–5 句即可。公式可用 $..$）"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none h-36"
              />
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 dark:text-slate-500">{content.length} 字</span>
                <button
                  type="submit"
                  disabled={!content.trim() || submitting}
                  className="ml-auto px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? "AI 在讀..." : "送出 + 看 AI 回饋"}
                </button>
              </div>
            </div>
          </form>

          {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}

          {latestFeedback && (
            <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 space-y-2">
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">🤖 AI 回饋</div>
              <div className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">
                <MarkdownRenderer content={latestFeedback} />
              </div>
            </div>
          )}

          {/* History */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">過去的反思 {list ? `(${list.length})` : ""}</h2>
            {list === null ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">載入中...</p>
            ) : list.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">還沒有紀錄 — 寫第一則開始吧。</p>
            ) : (
              <ul className="space-y-2">
                {list.map((r) => (
                  <li key={r.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl">
                    <details className="group">
                      <summary className="cursor-pointer px-4 py-3 list-none flex items-center gap-2">
                        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{formatDate(r.created_at)}</span>
                        <span className="text-sm text-slate-800 dark:text-slate-100 line-clamp-1 flex-1">
                          {r.content.slice(0, 100)}{r.content.length > 100 ? "..." : ""}
                        </span>
                        <svg className="w-4 h-4 text-slate-400 dark:text-slate-500 group-open:rotate-180 transition-transform shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </summary>
                      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100 dark:border-slate-700">
                        {r.prompt_used && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 italic">引導題：{r.prompt_used}</div>
                        )}
                        <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{r.content}</div>
                        {r.ai_feedback && (
                          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100">
                            <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 mb-1">🤖 AI 回饋</div>
                            <MarkdownRenderer content={r.ai_feedback} />
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
