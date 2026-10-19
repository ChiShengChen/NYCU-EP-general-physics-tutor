"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { apiFetcher, apiKey, ApiError } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { MarkdownRenderer } from "./markdown-renderer";

/**
 * 🔍 AI 錯題分析 panel.
 *
 * Mounted in three places with slightly different needs:
 *   - 測驗紀錄 detail + 錯題本: the attempt id is known → load the cached
 *     analysis on mount (GET, no LLM) and offer a button to generate.
 *   - 結果頁 (quiz / exam / oral right after grading): the attempt row is
 *     inserted in `after()` on the server so the client doesn't have its
 *     id. Pass `locate` instead and the panel resolves the newest attempt
 *     of that kind created after grading started, retrying briefly while
 *     the background insert lands.
 *
 * Lecture-page citations render as buttons when `onNavigateToTeaching`
 * is provided (deep link into 教學模式 at that chapter + page), otherwise
 * as plain chips.
 */

/* ─── Types (mirror of lib/attempt-analysis.ts) ─── */

type ErrorType = "concept" | "calculation" | "reading" | "incomplete" | "unanswered";

interface LecturePage {
  chapter: number;
  page: number;
  sectionTitle: string;
  why: string;
}

interface QuestionAnalysis {
  questionId: number;
  errorType: ErrorType;
  diagnosis: string;
  fix: string;
  lecturePages: LecturePage[];
}

interface Analysis {
  summary: string;
  errorPatterns: { label: string; questionIds: number[] }[];
  questions: QuestionAnalysis[];
  reviewPlan: { chapter: number; pages: number[]; reason: string; priority: number }[];
}

interface AnalysisRecord {
  attemptId: number;
  analysis: Analysis;
  promptVersion: string;
  model: string | null;
  createdAt: string;
  cached: boolean;
}

interface AttemptSummary {
  id: number;
  kind: string;
  created_at: string;
}

/* ─── Helpers ─── */

const ERROR_TYPE_META: Record<ErrorType, { label: string; cls: string }> = {
  concept:     { label: "概念誤解",  cls: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800" },
  calculation: { label: "計算錯誤",  cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  reading:     { label: "審題錯誤",  cls: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800" },
  incomplete:  { label: "回答不完整", cls: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800" },
  unanswered:  { label: "未作答",    cls: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" },
};

function chapterLabel(ch: number): string {
  return `Ch${String(ch).padStart(2, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ─── Component ─── */

export interface AttemptAnalysisPanelProps {
  /** Known attempt id (測驗紀錄 / 錯題本). */
  attemptId?: number | null;
  /** Lazy lookup for the 結果頁 where the attempt row is written after
   *  the response. `since` = ISO timestamp from just before grading. */
  locate?: { kind: "quiz" | "exam" | "oral"; since: string };
  /** Only render this question's entry (錯題本 per-item view). */
  questionId?: number;
  onNavigateToTeaching?: (chapter: number, page: number) => void;
  /** Visual density: "card" (default) wraps in a bordered card; "inline"
   *  is for embedding under a single question in 錯題本. */
  variant?: "card" | "inline";
}

export function AttemptAnalysisPanel({
  attemptId: knownAttemptId,
  locate,
  questionId,
  onNavigateToTeaching,
  variant = "card",
}: AttemptAnalysisPanelProps) {
  const studentId = useStudentId() ?? "";
  const [resolvedId, setResolvedId] = useState<number | null>(knownAttemptId ?? null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attemptId = knownAttemptId ?? resolvedId;

  // Cached analysis (GET never calls the LLM).
  const { data, mutate } = useSWR<{ analysis: AnalysisRecord | null }>(
    attemptId ? apiKey("/api/attempt-analysis", { studentId, attemptId }) : null,
  );
  const record = data?.analysis ?? null;

  /** For the 結果頁: find the attempt row the grader just inserted. */
  const resolveAttemptId = useCallback(async (): Promise<number | null> => {
    if (attemptId) return attemptId;
    if (!locate || !studentId) return null;
    const sinceMs = new Date(locate.since).getTime();
    // The server inserts the attempt in after(); typically <2s but under
    // load it can lag, so poll a few times before giving up.
    for (let i = 0; i < 4; i++) {
      const res = await apiFetcher<{ attempts: AttemptSummary[] }>(
        `/api/attempts?studentId=${encodeURIComponent(studentId)}`,
      );
      const hit = res.attempts.find(
        (a) => a.kind === locate.kind && new Date(a.created_at).getTime() >= sinceMs - 5_000,
      );
      if (hit) {
        setResolvedId(hit.id);
        return hit.id;
      }
      await sleep(1500);
    }
    return null;
  }, [attemptId, locate, studentId]);

  const generate = useCallback(async (force = false) => {
    setError(null);
    setGenerating(true);
    try {
      const id = await resolveAttemptId();
      if (!id) {
        setError("批改紀錄還沒寫入，請稍後到「測驗紀錄」再試一次。");
        return;
      }
      const res = await apiFetcher<{ analysis: AnalysisRecord }>("/api/attempt-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: id, studentId, force }),
      });
      await mutate({ analysis: res.analysis }, { revalidate: false });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError("今天的 AI 額度用完了，明天再來分析吧。");
      } else {
        setError("分析失敗，請稍後再試。");
      }
    } finally {
      setGenerating(false);
    }
  }, [resolveAttemptId, studentId, mutate]);

  if (!studentId) return null;

  const wrapperCls = variant === "card"
    ? "bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5 shadow-sm"
    : "mt-3 pt-3 border-t border-rose-100 dark:border-rose-900/40";

  /* ── Not generated yet ── */
  if (!record) {
    return (
      <div className={wrapperCls}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">🔍 AI 錯題分析</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              分類每題的錯因、給你正確思路，並標出講義該回去看哪一頁。
            </div>
          </div>
          <button
            onClick={() => generate(false)}
            disabled={generating}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? "分析中…" : "產生分析"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
      </div>
    );
  }

  /* ── Generated ── */
  const a = record.analysis;
  const questions = questionId !== undefined
    ? a.questions.filter((q) => q.questionId === questionId)
    : a.questions;

  const PageChip = ({ p }: { p: LecturePage }) => {
    const label = `📖 ${chapterLabel(p.chapter)} p.${p.page}${p.sectionTitle ? ` 〈${p.sectionTitle}〉` : ""}`;
    const cls = "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300";
    return onNavigateToTeaching ? (
      <button
        onClick={() => onNavigateToTeaching(p.chapter, p.page)}
        title="在教學模式開啟這一頁"
        className={`${cls} hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors`}
      >
        {label} →
      </button>
    ) : (
      <span className={cls}>{label}</span>
    );
  };

  return (
    <div className={wrapperCls}>
      {/* Header + summary (hidden in per-question inline view) */}
      {questionId === undefined && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">🔍 AI 錯題分析</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              {record.cached ? "已快取" : "剛產生"} · {new Date(record.createdAt).toLocaleDateString("zh-TW")}
            </span>
            <button
              onClick={() => generate(true)}
              disabled={generating}
              className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 disabled:opacity-50"
            >
              {generating ? "重新分析中…" : "重新分析"}
            </button>
          </div>
          <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            <MarkdownRenderer content={a.summary} />
          </div>
          {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>}

          {a.errorPatterns.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.errorPatterns.map((p, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 rounded-full text-xs bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                  title={`題 ${p.questionIds.join("、")}`}
                >
                  ⚠️ {p.label}
                  <span className="ml-1 opacity-70">×{p.questionIds.length}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* Per-question */}
      {questions.length > 0 && (
        <div className={`space-y-3 ${questionId === undefined ? "mt-4" : ""}`}>
          {questions.map((q) => {
            const meta = ERROR_TYPE_META[q.errorType];
            return (
              <div
                key={q.questionId}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {questionId === undefined && (
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">題 {q.questionId}</span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.cls}`}>{meta.label}</span>
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-xs font-medium text-rose-600 dark:text-rose-300 mr-1">錯在哪</span>
                  <MarkdownRenderer content={q.diagnosis} />
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-200 mt-1.5">
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-300 mr-1">怎麼修</span>
                  <MarkdownRenderer content={q.fix} />
                </div>
                {q.lecturePages.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {q.lecturePages.map((p, i) => (
                      <div key={i} className="flex items-start gap-2 flex-wrap">
                        <PageChip p={p} />
                        <span className="text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-[160px] pt-1">{p.why}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {questionId !== undefined && questions.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">這題沒有分析（可能分析時已被判為正確）。</p>
      )}

      {/* Review plan */}
      {questionId === undefined && a.reviewPlan.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">建議複習順序</div>
          <ol className="space-y-1.5">
            {a.reviewPlan.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] font-semibold">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1.5 mb-0.5">
                    {r.pages.map((pg) => (
                      <PageChip key={pg} p={{ chapter: r.chapter, page: pg, sectionTitle: "", why: r.reason }} />
                    ))}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">{r.reason}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
