"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { CHAPTER_NODES } from "@/lib/concept-graph";

/**
 * Prereq-gap analyzer.
 *
 * Lets the student pick a chapter they want to dive into and immediately
 * see, based on their past attempts, which earlier chapters they're shaky
 * on. The point is to convert the chapter dependency graph from a static
 * visualization (which knowledge-graph.tsx already does) into an
 * actionable "fix these first" checklist.
 *
 * Data comes from /api/prereq-path which walks the dependency graph
 * backwards from the chosen chapter. Status colors mirror the API's
 * thresholds: green = ≥75% correct, amber = 50–75%, red = <50%, grey =
 * no attempts in that chapter yet.
 */

type PrereqStatus = "strong" | "ok" | "weak" | "unseen";

interface PrereqEntry {
  chapter: number;
  title: string;
  status: PrereqStatus;
  attemptsTotal: number;
  attemptsCorrect: number;
  accuracy: number | null;
  weakConcepts: string[];
}

interface PrereqPathResponse {
  target: { chapter: number; title: string };
  prereqs: PrereqEntry[];
}

const STATUS_STYLE: Record<PrereqStatus, { label: string; chip: string; bar: string }> = {
  strong: {
    label: "已掌握",
    chip: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700",
    bar: "bg-emerald-500",
  },
  ok: {
    label: "尚可，可複習",
    chip: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700",
    bar: "bg-amber-500",
  },
  weak: {
    label: "需先補強",
    chip: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700",
    bar: "bg-rose-500",
  },
  unseen: {
    label: "尚未練習",
    chip: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600",
    bar: "bg-slate-400",
  },
};

interface PrereqPathPanelProps {
  studentId: string | null;
  onNavigateToChapter?: (chapter: number) => void;
}

export function PrereqPathPanel({ studentId, onNavigateToChapter }: PrereqPathPanelProps) {
  const [chapter, setChapter] = useState<number | null>(null);

  const { data, isLoading, error } = useSWR<PrereqPathResponse>(
    apiKey("/api/prereq-path", { studentId, chapter }),
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl shrink-0">🎯</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">前置概念缺口分析</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            選一個你想攻克的章節，AI 根據你的測驗紀錄回推：要先補哪些章節，才不會學到一半卡住。
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <label className="text-sm text-slate-700 dark:text-slate-200 sm:self-center sm:shrink-0">想學：</label>
        <select
          value={chapter ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setChapter(v ? parseInt(v) : null);
          }}
          className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
        >
          <option value="">— 選擇章節 —</option>
          {CHAPTER_NODES.map((c) => (
            <option key={c.chapter} value={c.chapter}>
              Ch{String(c.chapter).padStart(2, "0")} · {c.label}
            </option>
          ))}
        </select>
      </div>

      {!chapter && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          範例：選 Ch26（直流電路）會回推 Ch21 → Ch23 → Ch25 等等，標出你目前對答率最低的那幾章。
        </p>
      )}

      {chapter && isLoading && (
        <div className="flex items-center justify-center py-8 text-sm text-slate-500 dark:text-slate-400">
          分析你的測驗紀錄中…
        </div>
      )}

      {chapter && error && (
        <p className="text-sm text-rose-600 dark:text-rose-300">載入失敗，請稍後再試。</p>
      )}

      {chapter && data && data.prereqs.length === 0 && (
        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 p-3 text-sm text-indigo-800 dark:text-indigo-200">
          🎉 <strong>{data.target.title}</strong> 在概念圖譜上沒有前置章節，可以直接開始學習。
        </div>
      )}

      {chapter && data && data.prereqs.length > 0 && (
        <PrereqList
          response={data}
          onNavigateToChapter={onNavigateToChapter}
        />
      )}
    </div>
  );
}

function PrereqList({
  response,
  onNavigateToChapter,
}: {
  response: PrereqPathResponse;
  onNavigateToChapter?: (chapter: number) => void;
}) {
  const weakCount = response.prereqs.filter((p) => p.status === "weak").length;
  const unseenCount = response.prereqs.filter((p) => p.status === "unseen").length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        要學 <strong>{response.target.title}</strong>，建議先檢查這 {response.prereqs.length} 個前置章節
        {weakCount > 0 && <>，其中 <strong className="text-rose-600 dark:text-rose-300">{weakCount}</strong> 個需要補強</>}
        {unseenCount > 0 && <>，{unseenCount} 個還沒練習過</>}
        。
      </p>

      <ol className="space-y-2">
        {response.prereqs.map((p) => {
          const sty = STATUS_STYLE[p.status];
          const pct = p.accuracy !== null ? Math.round(p.accuracy * 100) : null;
          return (
            <li key={p.chapter} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  Ch{String(p.chapter).padStart(2, "0")}
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-100">{p.title}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${sty.chip}`}>
                  {sty.label}
                </span>
                <span className="ml-auto text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {pct === null
                    ? "—"
                    : `${pct}% (${p.attemptsCorrect}/${p.attemptsTotal})`}
                </span>
              </div>

              {pct !== null && (
                <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div className={`h-full ${sty.bar}`} style={{ width: `${pct}%` }} />
                </div>
              )}

              {p.weakConcepts.length > 0 && (
                <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="text-slate-500 dark:text-slate-400">最近答錯的概念：</span>
                  {p.weakConcepts.join("、")}
                </p>
              )}

              {(p.status === "weak" || p.status === "unseen") && onNavigateToChapter && (
                <button
                  onClick={() => onNavigateToChapter(p.chapter)}
                  className="mt-2 text-xs text-indigo-600 dark:text-indigo-300 hover:underline"
                >
                  → 進入教學模式複習這章
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        準確度依過去 120 天內的測驗 / 考試題目計算；未做過題目的章節無法評估。
      </p>
    </div>
  );
}
