"use client";

/* 🎯 學習目標 — set a short-term target ("this week I want Ch08") and
 * watch progress fill in automatically from attempts + student_state. */

import { useState } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { ThemeToggle } from "./theme-provider";

interface ChapterInfo { chapter_number: number; page_count: number; sections: string[] }

interface GoalProgress {
  chapterAttempts: number;
  chapterAccuracy: number | null;
  chapterAnswered: number;
  conceptMastery: number | null;
  conceptAttempts: number | null;
  daysRemaining: number | null;
}

interface Goal {
  id: number;
  title: string;
  target_chapter: number | null;
  target_concept: string | null;
  target_date: string | null;
  status: "active" | "done" | "abandoned";
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  progress: GoalProgress;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

interface GoalsViewProps {
  onBack: () => void;
}

export function GoalsView({ onBack }: GoalsViewProps) {
  const studentId = useStudentId() ?? "";
  const { data: goalsData, mutate: refresh } = useSWR<{ goals: Goal[] }>(
    apiKey("/api/goals", { studentId }),
  );
  const { data: lecturesData } = useSWR<{ chapters: ChapterInfo[] }>("/api/lectures");
  const goals = goalsData ? (goalsData.goals ?? []) : null;
  const chapters = lecturesData?.chapters ?? [];

  const [showForm, setShowForm] = useState(false);

  // New-goal form state
  const [title, setTitle] = useState("");
  const [chapter, setChapter] = useState<number | "">("");
  const [concept, setConcept] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          title: title.trim(),
          target_chapter: chapter === "" ? null : Number(chapter),
          target_concept: concept.trim() || null,
          target_date: targetDate || null,
        }),
      });
      setTitle(""); setChapter(""); setConcept(""); setTargetDate("");
      setShowForm(false);
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: number, status: Goal["status"]) => {
    await fetch(`/api/goals?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refresh();
  };

  const remove = async (id: number) => {
    if (!confirm("確定刪除這個目標？")) return;
    await fetch(`/api/goals?id=${id}`, { method: "DELETE" });
    await refresh();
  };

  const active = goals?.filter((g) => g.status === "active") ?? [];
  const closed = goals?.filter((g) => g.status !== "active") ?? [];

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
        <span className="text-xl">🎯</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">學習目標</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="ml-auto px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
        >
          {showForm ? "取消" : "+ 新目標"}
        </button>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-3xl mx-auto space-y-5">
          <p className="text-xs text-slate-500 dark:text-slate-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            研究上叫 <strong>goal-setting theory</strong>：寫下具體、有期限、可驗證的目標，平均完成率比沒寫下來的高 60%+。
            目標可以綁定章節或概念，進度條會根據你的測驗自動填上。
          </p>

          {/* New-goal form */}
          {showForm && (
            <form onSubmit={submit} className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-4 space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="目標標題（例：「本週搞懂 Ch08 動量守恆」）"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                required
              />
              <div className="grid sm:grid-cols-3 gap-2">
                <select
                  value={chapter}
                  onChange={(e) => setChapter(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">— 章節 (選填) —</option>
                  {chapters.map((c) => (
                    <option key={c.chapter_number} value={c.chapter_number}>
                      Ch{String(c.chapter_number).padStart(2, "0")}
                    </option>
                  ))}
                </select>
                <input
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="關聯概念 (選填)"
                  className="rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <button
                type="submit"
                disabled={!title.trim() || submitting}
                className="w-full rounded-xl bg-indigo-600 text-white text-sm font-medium py-2.5 hover:bg-indigo-700 disabled:opacity-40"
              >
                {submitting ? "建立中..." : "建立目標"}
              </button>
            </form>
          )}

          {/* Active goals */}
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">進行中 ({active.length})</h2>
            {goals === null ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">載入中...</p>
            ) : active.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">沒有進行中的目標 — 上方新增一個吧。</p>
            ) : (
              <ul className="space-y-2">
                {active.map((g) => (
                  <GoalCard key={g.id} goal={g} onComplete={() => updateStatus(g.id, "done")} onAbandon={() => updateStatus(g.id, "abandoned")} onDelete={() => remove(g.id)} />
                ))}
              </ul>
            )}
          </div>

          {/* Closed goals */}
          {closed.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200">
                已完成 / 放棄 ({closed.length})
              </summary>
              <ul className="space-y-2 mt-2">
                {closed.map((g) => (
                  <GoalCard key={g.id} goal={g} onDelete={() => remove(g.id)} />
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  onComplete,
  onAbandon,
  onDelete,
}: {
  goal: Goal;
  onComplete?: () => void;
  onAbandon?: () => void;
  onDelete: () => void;
}) {
  const isDone = goal.status === "done";
  const isAbandoned = goal.status === "abandoned";
  return (
    <li className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 space-y-2 ${
      isDone ? "border-emerald-200 dark:border-emerald-800" : isAbandoned ? "border-slate-200 dark:border-slate-700 opacity-70" : "border-indigo-200 dark:border-indigo-800"
    }`}>
      <div className="flex items-start gap-2">
        <span className="text-lg shrink-0">{isDone ? "✅" : isAbandoned ? "🗑️" : "🎯"}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-slate-800 dark:text-slate-100 text-sm">{goal.title}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {goal.target_chapter && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">Ch{String(goal.target_chapter).padStart(2, "0")}</span>
            )}
            {goal.target_concept && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{goal.target_concept}</span>
            )}
            {goal.target_date && (
              <span>{formatDate(goal.target_date)}{goal.progress.daysRemaining !== null && goal.progress.daysRemaining >= 0
                ? `（剩 ${goal.progress.daysRemaining} 天）`
                : goal.progress.daysRemaining !== null && goal.progress.daysRemaining < 0
                  ? `（已過 ${-goal.progress.daysRemaining} 天）`
                  : ""}</span>
            )}
            <span className="ml-auto">建立 {formatDate(goal.created_at)}</span>
          </div>
        </div>
      </div>

      {/* Progress bars */}
      {(goal.target_chapter || goal.target_concept) && goal.status === "active" && (
        <div className="space-y-1.5 pt-1">
          {goal.target_chapter && (
            <ProgressBar
              label={`Ch${String(goal.target_chapter).padStart(2, "0")} 答對率`}
              detail={`${goal.progress.chapterAnswered} 題 / ${goal.progress.chapterAttempts} 次測驗`}
              percent={goal.progress.chapterAccuracy}
            />
          )}
          {goal.target_concept && (
            <ProgressBar
              label={`「${goal.target_concept}」掌握度`}
              detail={goal.progress.conceptAttempts !== null ? `練習 ${goal.progress.conceptAttempts} 次` : "尚未練習"}
              percent={goal.progress.conceptMastery}
            />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {goal.status === "active" && onComplete && (
          <button onClick={onComplete} className="text-xs px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:bg-emerald-900/40">
            ✓ 完成
          </button>
        )}
        {goal.status === "active" && onAbandon && (
          <button onClick={onAbandon} className="text-xs px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
            放棄
          </button>
        )}
        <button onClick={onDelete} className="text-xs px-2 py-1 rounded-lg text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-300 ml-auto">
          刪除
        </button>
      </div>
    </li>
  );
}

function ProgressBar({ label, detail, percent }: { label: string; detail: string; percent: number | null }) {
  const p = percent ?? 0;
  return (
    <div>
      <div className="flex items-center text-[11px] text-slate-600 dark:text-slate-300 mb-0.5">
        <span>{label}</span>
        <span className="ml-auto text-slate-400 dark:text-slate-500">{detail}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full transition-all ${
            percent === null ? "bg-slate-300"
            : p >= 80 ? "bg-emerald-500"
            : p >= 50 ? "bg-amber-500"
            : "bg-rose-400"
          }`}
          style={{ width: `${percent === null ? 0 : p}%` }}
        />
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
        {percent === null ? "尚無資料" : `${p}%`}
      </div>
    </div>
  );
}
