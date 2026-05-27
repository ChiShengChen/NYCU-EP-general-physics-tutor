"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { MarkdownRenderer } from "./markdown-renderer";

/* ─── Types ─── */

interface Question {
  id: number;
  type: "multiple_choice" | "short_answer";
  concept?: string;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  sourceChapter?: number;
  points?: number;
}

interface WrongItem {
  attemptId: number;
  attemptTitle: string;
  attemptKind: "quiz" | "exam";
  attemptCreatedAt: string;
  question: Question;
  studentAnswer: string;
  score: number;
  feedback: string;
}

interface WrongResponse {
  total: number;
  items: WrongItem[];
  conceptCounts: Record<string, number>;
  chapterCounts: Record<number, number>;
}

/* ─── Helpers ─── */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function chapterLabel(ch?: number): string {
  return ch ? `Ch${String(ch).padStart(2, "0")}` : "—";
}

/* ─── Component ─── */

interface WrongNotebookProps {
  onBack: () => void;
}

export function WrongNotebook({ onBack }: WrongNotebookProps) {
  const [filterChapter, setFilterChapter] = useState<number | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const studentId = useStudentId() ?? "";
  const { data, isLoading } = useSWR<WrongResponse>(
    apiKey("/api/wrong-questions", { studentId, chapter: filterChapter ?? undefined }),
  );
  const loading = !!studentId && isLoading;

  // For chapter filter chips, we want unique sorted chapters from the *unfiltered*
  // dataset. So fetch one initial unfiltered call too — but to keep it simple we
  // derive from current data's chapterCounts, which only reflects current filter.
  // Workaround: keep an "all" toggle + show counts when filterChapter is null.
  const allChapters = useMemo(() => {
    if (!data || filterChapter !== null) return null;
    return Object.entries(data.chapterCounts)
      .map(([ch, count]) => ({ ch: parseInt(ch), count }))
      .sort((a, b) => a.ch - b.ch);
  }, [data, filterChapter]);

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
        <span className="text-xl">📕</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">錯題本</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
          {data ? `共 ${data.total} 題` : ""}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Chapter filter chips (only meaningful when "all" view) */}
          {allChapters && allChapters.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">依章節篩選</div>
              <div className="flex flex-wrap gap-1.5">
                {allChapters.map(({ ch, count }) => (
                  <button
                    key={ch}
                    onClick={() => setFilterChapter(ch)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-rose-100 dark:bg-rose-900/40 hover:text-rose-700 dark:text-rose-300 transition-colors"
                  >
                    {chapterLabel(ch)}
                    <span className="ml-1 text-rose-600 dark:text-rose-300 font-semibold">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filterChapter !== null && (
            <button
              onClick={() => setFilterChapter(null)}
              className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300"
            >
              ← 顯示全部章節
            </button>
          )}

          {/* Body */}
          {loading ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-12">載入中...</div>
          ) : !data || data.items.length === 0 ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-12">
              <p className="text-3xl mb-2">🎉</p>
              <p>{filterChapter !== null ? `Ch${String(filterChapter).padStart(2, "0")} 沒有錯題紀錄` : "還沒有錯題"}</p>
              <p className="text-xs mt-1">完成幾次測驗或考試後，這裡會自動收集你做錯的題目供你複習。</p>
            </div>
          ) : (
            data.items.map((it, idx) => {
              const isOpen = expandedIdx === idx;
              const q = it.question;
              return (
                <div
                  key={`${it.attemptId}-${q.id}`}
                  className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 rounded-2xl shadow-sm overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedIdx(isOpen ? null : idx)}
                    className="w-full text-left px-4 py-3 hover:bg-rose-50/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-medium">
                        ✗ 答錯
                      </span>
                      <span>{chapterLabel(q.sourceChapter)}</span>
                      <span>·</span>
                      <span>{q.type === "multiple_choice" ? "選擇" : "簡答"}</span>
                      {q.concept && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-[180px]">{q.concept}</span>
                        </>
                      )}
                      <span className="ml-auto shrink-0">{formatDate(it.attemptCreatedAt)} · {it.attemptTitle}</span>
                    </div>
                    <div className="text-sm text-slate-800 dark:text-slate-100 line-clamp-2">
                      {q.question.length > 200 ? `${q.question.slice(0, 200)}...` : q.question}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-rose-100 space-y-3">
                      <div>
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">完整題目</div>
                        <div className="text-sm text-slate-800 dark:text-slate-100"><MarkdownRenderer content={q.question} /></div>
                      </div>

                      {q.options && q.options.length > 0 && (
                        <div className="space-y-1.5">
                          {q.options.map((opt, i) => {
                            const letter = String.fromCharCode(65 + i);
                            const isUser = it.studentAnswer.startsWith(letter) || it.studentAnswer === letter || it.studentAnswer === opt;
                            const isCorrect = q.correctAnswer.startsWith(letter) || q.correctAnswer === letter || q.correctAnswer === opt;
                            let cls = "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200";
                            if (isCorrect) cls = "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200";
                            else if (isUser) cls = "border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200";
                            return (
                              <div key={i} className={`px-3 py-2 rounded-lg border text-sm flex items-start gap-2 ${cls}`}>
                                <span className="font-semibold shrink-0">{letter}.</span>
                                <span className="flex-1"><MarkdownRenderer content={opt} /></span>
                                {isCorrect && <span className="text-xs shrink-0">正解</span>}
                                {!isCorrect && isUser && <span className="text-xs shrink-0">你的答案</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {q.type === "short_answer" && (
                        <div className="space-y-2">
                          <div className="px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-sm">
                            <span className="text-xs font-medium text-rose-700 dark:text-rose-300 mr-2">你的回答</span>
                            <span className="text-rose-900 dark:text-rose-200"><MarkdownRenderer content={it.studentAnswer} /></span>
                          </div>
                          <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-sm">
                            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mr-2">參考答案</span>
                            <span className="text-emerald-900 dark:text-emerald-200"><MarkdownRenderer content={q.correctAnswer} /></span>
                          </div>
                        </div>
                      )}

                      {it.feedback && (
                        <div>
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">AI 回饋</div>
                          <div className="text-sm text-slate-700 dark:text-slate-200"><MarkdownRenderer content={it.feedback} /></div>
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
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
