"use client";

import { useState, useEffect } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

/* ─── Types ─── */

interface AttemptSummary {
  id: number;
  kind: "quiz" | "exam";
  exam_type: "midterm" | "final" | null;
  title: string;
  total_score: number;
  max_score: number;
  grade: string | null;
  percentage: number;
  created_at: string;
}

interface Question {
  id: number;
  type: "multiple_choice" | "short_answer";
  concept: string;
  difficulty?: string;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  sourceChapter?: number;
  points?: number;
}

interface ResultEntry {
  questionId: number;
  isCorrect: boolean;
  score: number;
  earnedPoints?: number;
  feedback: string;
}

interface AttemptDetail extends AttemptSummary {
  questions: Question[];
  answers: Record<string, string>;
  results: ResultEntry[];
  overall_feedback: string | null;
}

/* ─── Helpers ─── */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function kindLabel(a: AttemptSummary): string {
  if (a.kind === "exam") return a.exam_type === "midterm" ? "期中考模擬" : "期末考模擬";
  return "自動測驗";
}

function kindEmoji(a: AttemptSummary): string {
  return a.kind === "exam" ? "🎓" : "📝";
}

function scoreBadgeColor(pct: number): string {
  if (pct >= 85) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (pct >= 70) return "bg-blue-50 text-blue-700 border-blue-200";
  if (pct >= 60) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

/* ─── Component ─── */

interface AttemptsHistoryProps {
  onBack: () => void;
}

export function AttemptsHistory({ onBack }: AttemptsHistoryProps) {
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("physics_tutor_student_id") ?? "";
  });

  useEffect(() => {
    if (!studentId) { setLoading(false); return; }
    fetch(`/api/attempts?studentId=${studentId}`)
      .then((r) => r.json())
      .then((d) => { setAttempts(d.attempts ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [studentId]);

  if (selectedId !== null) {
    return (
      <AttemptDetailView
        attemptId={selectedId}
        studentId={studentId}
        onBack={() => setSelectedId(null)}
        onBackToModes={onBack}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📚</span>
        <h1 className="text-lg font-semibold text-slate-800">測驗紀錄</h1>
        <span className="text-xs text-slate-400 ml-auto">共 {attempts.length} 次</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-3">
          {loading ? (
            <div className="text-center text-slate-400 py-12">載入中...</div>
          ) : attempts.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <p className="mb-2 text-3xl">📭</p>
              <p>還沒有任何測驗紀錄</p>
              <p className="text-xs text-slate-400 mt-1">完成一次「自動測驗」或「考試模擬」後，這裡會顯示批改結果與每題詳情。</p>
            </div>
          ) : (
            attempts.map((a) => {
              const correctCount = 0; // calculated server-side later if needed
              void correctCount;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className="w-full text-left flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 transition-all"
                >
                  <span className="text-2xl shrink-0">{kindEmoji(a)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800 truncate">{a.title || kindLabel(a)}</span>
                      <span className="text-xs text-slate-400 shrink-0">{formatDate(a.created_at)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{kindLabel(a)}</div>
                  </div>
                  <div className={`shrink-0 px-3 py-1.5 rounded-xl text-sm font-semibold border ${scoreBadgeColor(a.percentage)}`}>
                    {a.grade ?? `${a.percentage}%`}
                    <div className="text-xs font-normal opacity-75">
                      {a.total_score.toFixed(a.kind === "exam" ? 0 : 1)}/{a.max_score.toFixed(0)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Detail view ─── */

function AttemptDetailView({
  attemptId,
  studentId,
  onBack,
  onBackToModes,
}: {
  attemptId: number;
  studentId: string;
  onBack: () => void;
  onBackToModes: () => void;
}) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/attempts?studentId=${studentId}&id=${attemptId}`)
      .then((r) => r.json())
      .then((d) => { setAttempt(d.attempt ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [studentId, attemptId]);

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
          <button onClick={onBack} className="p-1 rounded-lg hover:bg-slate-100 text-slate-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-semibold text-slate-800">載入中...</h1>
        </header>
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="flex flex-col h-screen items-center justify-center text-slate-400">
        找不到此測驗紀錄
        <button onClick={onBack} className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm">返回</button>
      </div>
    );
  }

  const resultMap = new Map<number, ResultEntry>(attempt.results.map((r) => [r.questionId, r]));
  const correctCount = attempt.results.filter((r) => r.isCorrect).length;

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="返回列表">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-xl">{kindEmoji(attempt)}</span>
        <h1 className="text-lg font-semibold text-slate-800 truncate">{attempt.title || kindLabel(attempt)}</h1>
        <button onClick={onBackToModes} className="ml-auto text-xs text-slate-500 hover:text-indigo-600">返回選擇模式</button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Score summary */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className={`px-4 py-2 rounded-xl text-2xl font-bold border ${scoreBadgeColor(attempt.percentage)}`}>
                {attempt.grade ?? `${attempt.percentage}%`}
              </div>
              <div>
                <div className="text-sm text-slate-600">
                  總分 <span className="font-semibold">{attempt.total_score.toFixed(attempt.kind === "exam" ? 0 : 1)}</span> / {attempt.max_score.toFixed(0)}
                </div>
                <div className="text-xs text-slate-400">{kindLabel(attempt)} · {formatDate(attempt.created_at)}</div>
                <div className="text-xs text-slate-400">答對 {correctCount} / {attempt.questions.length} 題</div>
              </div>
            </div>
            {attempt.overall_feedback && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="text-xs font-medium text-slate-500 mb-1">整體回饋</div>
                <div className="text-sm text-slate-700 leading-relaxed">
                  <MarkdownRenderer content={attempt.overall_feedback} />
                </div>
              </div>
            )}
          </div>

          {/* Questions */}
          {attempt.questions.map((q, idx) => {
            const r = resultMap.get(q.id);
            const userAnswer = attempt.answers[String(q.id)] ?? "(未作答)";
            const correct = r?.isCorrect ?? false;
            return (
              <div key={q.id} className={`bg-white border rounded-2xl p-5 shadow-sm ${correct ? "border-emerald-200" : "border-rose-200"}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-full text-xs font-semibold ${correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                    {correct ? "✓" : "✗"}
                  </span>
                  <span className="text-sm font-medium text-slate-700">第 {idx + 1} 題</span>
                  <span className="text-xs text-slate-400">
                    {q.type === "multiple_choice" ? "選擇題" : "簡答題"}
                    {q.sourceChapter ? ` · Ch${String(q.sourceChapter).padStart(2, "0")}` : ""}
                    {q.points ? ` · ${q.points} 分` : ""}
                  </span>
                  {r && (
                    <span className="ml-auto text-xs text-slate-500">
                      {r.earnedPoints !== undefined ? `${r.earnedPoints.toFixed(0)} 分` : `score ${r.score.toFixed(2)}`}
                    </span>
                  )}
                </div>

                <div className="text-sm text-slate-800 mb-3">
                  <MarkdownRenderer content={q.question} />
                </div>

                {q.options && q.options.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {q.options.map((opt, i) => {
                      const letter = String.fromCharCode(65 + i);
                      const isUser = userAnswer.startsWith(letter) || userAnswer === letter || userAnswer === opt;
                      const isCorrect = q.correctAnswer.startsWith(letter) || q.correctAnswer === letter || q.correctAnswer === opt;
                      let cls = "border-slate-200 bg-white text-slate-700";
                      if (isCorrect) cls = "border-emerald-300 bg-emerald-50 text-emerald-800";
                      else if (isUser) cls = "border-rose-300 bg-rose-50 text-rose-800";
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
                  <div className="space-y-2 mb-3">
                    <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm">
                      <span className="text-xs font-medium text-slate-500 mr-2">你的回答</span>
                      <span className="text-slate-700"><MarkdownRenderer content={userAnswer} /></span>
                    </div>
                    <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm">
                      <span className="text-xs font-medium text-emerald-700 mr-2">參考答案</span>
                      <span className="text-emerald-900"><MarkdownRenderer content={q.correctAnswer} /></span>
                    </div>
                  </div>
                )}

                {r?.feedback && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="text-xs font-medium text-slate-500 mb-1">AI 回饋</div>
                    <div className="text-sm text-slate-700"><MarkdownRenderer content={r.feedback} /></div>
                  </div>
                )}

                {q.explanation && (
                  <div className="mt-2">
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700">查看完整解析</summary>
                      <div className="mt-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-slate-700">
                        <MarkdownRenderer content={q.explanation} />
                      </div>
                    </details>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
