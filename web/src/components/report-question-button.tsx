"use client";

import { useState } from "react";

/* 🚩 Flag a bad question. Sits in the corner of any question card — quiz,
 * exam, attempts-history detail, wrong-notebook. Sends to /api/question-report
 * and shows a small thank-you. */

interface ReportQuestionButtonProps {
  attemptId?: number;
  questionId?: number;
  question: {
    question?: string;
    correctAnswer?: string;
    sourceChapter?: number;
  };
}

const REASONS: { value: string; label: string }[] = [
  { value: "wrong_answer",    label: "答案有誤" },
  { value: "bad_explanation", label: "解析有問題" },
  { value: "unclear",         label: "題目不清楚" },
  { value: "off_topic",       label: "與課程無關" },
  { value: "too_easy",        label: "太簡單" },
  { value: "too_hard",        label: "太難 / 超綱" },
  { value: "other",           label: "其他" },
];

export function ReportQuestionButton({ attemptId, questionId, question }: ReportQuestionButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const studentId = (typeof window !== "undefined")
    ? (localStorage.getItem("physics_tutor_student_id") ?? null)
    : null;

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/question-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, attemptId, questionId, question, reason, detail }),
      });
      setSubmitted(true);
      setTimeout(() => { setOpen(false); setSubmitted(false); setReason(""); setDetail(""); }, 1500);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="這題有問題？告訴我們"
        className="text-xs text-slate-400 hover:text-rose-600 transition-colors"
      >
        🚩
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-20 w-72 rounded-2xl bg-white border border-slate-200 shadow-lg p-3 space-y-2">
          {submitted ? (
            <p className="text-xs text-emerald-700 py-3 text-center">✓ 已回報，感謝！</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">這題有什麼問題？</span>
                <button onClick={() => setOpen(false)} className="ml-auto text-slate-400 hover:text-slate-600 text-xs">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={`text-[11px] px-2 py-1.5 rounded-lg border text-left transition-colors ${
                      reason === r.value
                        ? "bg-rose-50 border-rose-300 text-rose-700"
                        : "bg-white border-slate-200 text-slate-700 hover:border-rose-300"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="補充說明（選填）"
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs h-16 resize-none focus:outline-none focus:ring-2 focus:ring-rose-300"
              />
              <button
                onClick={submit}
                disabled={!reason || submitting}
                className="w-full px-2 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-40"
              >
                {submitting ? "送出中..." : "送出回報"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
