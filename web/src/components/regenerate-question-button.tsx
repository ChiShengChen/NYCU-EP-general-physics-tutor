"use client";

import { useState } from "react";

interface RegenerateButtonProps<Q> {
  question: Q;
  /** Replace the previous question in parent state with the freshly-generated one. */
  onReplace: (newQuestion: Q) => void;
  /** Resets any per-question answer / confidence / hint state in the parent
   *  because a new question shouldn't inherit the old one's draft. */
  onResetForQuestion?: (questionId: number) => void;
}

/* 🔁 Regenerate the current question in-place. Used in quiz / exam when
 * a student feels the question is broken. Hits /api/regen-question. */

export function RegenerateQuestionButton<Q extends { id: number; type: string; concept?: string; difficulty?: string; question?: string; sourceChapter?: number; points?: number }>({
  question,
  onReplace,
  onResetForQuestion,
}: RegenerateButtonProps<Q>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regen = async () => {
    if (loading) return;
    if (!confirm("AI 將重新生成這題（會清掉你目前的作答）。確定？")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/regen-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previous: question,
          reason: "other",
          studentId: typeof window !== "undefined" ? localStorage.getItem("physics_tutor_student_id") : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const newQ = data.question as Q;
      onResetForQuestion?.(question.id);
      onReplace(newQ);
    } catch (err) {
      console.error(err);
      setError("重生失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={regen}
        disabled={loading}
        title="覺得這題不好？讓 AI 重出一題"
        className="text-xs text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:text-indigo-300 transition-colors disabled:opacity-40"
      >
        {loading ? "重生中..." : "🔁"}
      </button>
      {error && <span className="text-[10px] text-rose-600 dark:text-rose-300">{error}</span>}
    </span>
  );
}
