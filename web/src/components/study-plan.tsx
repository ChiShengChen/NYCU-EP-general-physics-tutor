"use client";

import { useState, useEffect } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

/* ─── Types ─── */

interface ReviewConcept {
  concept: string;
  reason: string;
  suggestedChapter: number;
  priority: "high" | "medium" | "low";
}

interface StrengthenConcept {
  concept: string;
  reason: string;
  suggestedChapter: number;
  exercise: string;
}

interface StudyPlan {
  summary: string;
  reviewConcepts: ReviewConcept[];
  strengthenConcepts: StrengthenConcept[];
  weeklyPlan: string;
  encouragement: string;
}

interface ReviewDueItem {
  concept: string;
  daysSince: number;
  retention: number;
  mastery: number;
}

/* ─── Component ─── */

interface StudyPlanProps {
  onBack: () => void;
}

export function StudyPlanView({ onBack }: StudyPlanProps) {
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [reviewDue, setReviewDue] = useState<ReviewDueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("physics_tutor_student_id") ?? "";
  });

  useEffect(() => {
    if (!studentId) {
      setEmpty(true);
      setLoading(false);
      return;
    }

    fetch(`/api/study-plan?studentId=${studentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.empty) {
          setEmpty(true);
        } else {
          setPlan(data.plan);
          setReviewDue(data.reviewDue ?? []);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("載入失敗，請稍後再試");
        setLoading(false);
      });
  }, [studentId]);

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
        <span className="text-xl">📅</span>
        <h1 className="text-lg font-semibold text-slate-800">AI 學習計畫</h1>
        <span className="text-xs text-slate-400 ml-auto">NYCU 電物系</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
              <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
            </div>
            <p className="text-slate-600 font-medium">AI 正在分析你的學習狀況...</p>
            <p className="text-sm text-slate-400">根據遺忘曲線計算最佳複習時間</p>
          </div>
        ) : error ? (
          <EmptyState message={error} onBack={onBack} />
        ) : empty ? (
          <EmptyState message="尚無學習紀錄，先去做測驗或使用教學模式吧！" onBack={onBack} />
        ) : plan ? (
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Summary */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800 mb-2">📊 學習總覽</h2>
              <p className="text-slate-600">{plan.summary}</p>
            </div>

            {/* Review Due (Spaced Repetition) */}
            {reviewDue.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-amber-700 mb-3">⏰ 需要複習的概念（記憶衰退中）</h3>
                <div className="space-y-2">
                  {reviewDue.map((item) => (
                    <div
                      key={item.concept}
                      className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-amber-100"
                    >
                      <div className="flex-1">
                        <span className="font-medium text-slate-700">{item.concept}</span>
                        <span className="text-xs text-slate-400 ml-2">{item.daysSince} 天前練習</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs text-slate-400">記憶保持</div>
                          <div className={`text-sm font-semibold ${
                            item.retention < 30 ? "text-red-500" : item.retention < 50 ? "text-amber-500" : "text-yellow-600"
                          }`}>
                            {item.retention}%
                          </div>
                        </div>
                        <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              item.retention < 30 ? "bg-red-400" : item.retention < 50 ? "bg-amber-400" : "bg-yellow-400"
                            }`}
                            style={{ width: `${item.retention}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review Concepts */}
            {plan.reviewConcepts.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">🔄 建議複習</h3>
                <div className="space-y-3">
                  {plan.reviewConcepts.map((c) => (
                    <div key={c.concept} className="flex items-start gap-3 bg-slate-50 rounded-xl px-4 py-3">
                      <PriorityBadge priority={c.priority} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-700">{c.concept}</span>
                          <span className="text-xs text-slate-400">Ch{String(c.suggestedChapter).padStart(2, "0")}</span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">{c.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strengthen Concepts */}
            {plan.strengthenConcepts.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">💪 建議加強</h3>
                <div className="space-y-3">
                  {plan.strengthenConcepts.map((c) => (
                    <div key={c.concept} className="bg-slate-50 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-700">{c.concept}</span>
                        <span className="text-xs text-slate-400">Ch{String(c.suggestedChapter).padStart(2, "0")}</span>
                      </div>
                      <p className="text-sm text-slate-500 mb-2">{c.reason}</p>
                      <div className="bg-indigo-50 rounded-lg px-3 py-2 text-sm">
                        <span className="text-indigo-600 font-medium">練習建議：</span>
                        <span className="text-indigo-700">{c.exercise}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weekly Plan */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">📅 本週學習計畫</h3>
              <div className="prose-sm">
                <MarkdownRenderer content={plan.weeklyPlan} />
              </div>
            </div>

            {/* Encouragement */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-5 text-center">
              <p className="text-2xl mb-2">✨</p>
              <p className="text-slate-700 font-medium">{plan.encouragement}</p>
            </div>

            {/* Back button */}
            <div className="flex justify-center pb-6">
              <button
                onClick={onBack}
                className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                返回首頁
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-red-100 text-red-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-green-100 text-green-700",
  };
  const labels = { high: "高", medium: "中", low: "低" };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 mt-0.5 ${styles[priority]}`}>
      {labels[priority]}
    </span>
  );
}

function EmptyState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <p className="text-4xl">📭</p>
      <p className="text-slate-500">{message}</p>
      <button
        onClick={onBack}
        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
      >
        返回首頁
      </button>
    </div>
  );
}
