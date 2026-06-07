"use client";

import { useEffect, useState, useCallback } from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { MarkdownRenderer } from "./markdown-renderer";
import { PreviewSchema, type PreviewConcept } from "@/lib/preview-schema";
import { restoreLatexEscapes } from "@/lib/restore-latex";
import { useStudentId } from "@/lib/use-student-id";
import { ThemeToggle } from "./theme-provider";

/** Auto-wrap raw LaTeX in $$..$$ when the model forgot the delimiters,
 *  so KaTeX renders instead of showing literal backslashes. */
function ensureMathBlock(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (s.includes("$")) return s; // already has $..$ or $$..$$ — leave it
  return `$$${s}$$`;
}

/* ─── Types ─── */

interface ChapterInfo {
  chapter_number: number;
  page_count: number;
  sections: string[];
}

interface CachedPreview {
  cached: true;
  content: { concepts: PreviewConcept[] };
  generatedAt: string;
}

/* ─── Category palette (mirror knowledge-graph) ─── */

function categoryFor(ch: number): "mechanics" | "waves_fluid" | "thermo" | "em" | "optics" | "modern" {
  if (ch <= 12) return "mechanics";
  if (ch <= 16) return "waves_fluid";
  if (ch <= 20) return "thermo";
  if (ch <= 32) return "em";
  if (ch <= 36) return "optics";
  return "modern";
}

const CATEGORY_STYLE = {
  mechanics:   { card: "bg-blue-50/50 border-blue-200 dark:border-blue-800",     pill: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",     accent: "text-blue-700 dark:text-blue-300",    label: "力學" },
  waves_fluid: { card: "bg-emerald-50/50 border-emerald-200 dark:border-emerald-800", pill: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300", accent: "text-emerald-700 dark:text-emerald-300", label: "振盪 / 流體 / 波動" },
  thermo:      { card: "bg-amber-50/50 border-amber-200 dark:border-amber-800",   pill: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",   accent: "text-amber-700 dark:text-amber-300",   label: "熱學" },
  em:          { card: "bg-purple-50/50 border-purple-200 dark:border-purple-800", pill: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300", accent: "text-purple-700 dark:text-purple-300",  label: "電磁學" },
  optics:      { card: "bg-rose-50/50 border-rose-200 dark:border-rose-800",       pill: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",        accent: "text-rose-700 dark:text-rose-300",     label: "光學" },
  modern:      { card: "bg-slate-50/50 border-slate-300 dark:border-slate-700",    pill: "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200",       accent: "text-slate-700 dark:text-slate-200",   label: "近代物理" },
};

/* ─── Component ─── */

interface ChapterPreviewProps {
  onBack: () => void;
}

export function ChapterPreview({ onBack }: ChapterPreviewProps) {
  const studentId = useStudentId();
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [cached, setCached] = useState<CachedPreview | null>(null);
  const [cacheCheckLoading, setCacheCheckLoading] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  // Streaming generation for cache misses. `object.concepts` fills in
  // card-by-card / field-by-field as JSON arrives; we render whatever's
  // there so the student sees the first concept ~1s after submit instead
  // of staring at a spinner for 15–40s.
  const { object: streamed, submit, isLoading: streaming, error: streamError, clear } = useObject({
    api: "/api/preview",
    schema: PreviewSchema,
  });

  useEffect(() => {
    fetch("/api/lectures")
      .then((r) => r.json())
      .then((d) => setChapters(d.chapters ?? []))
      .catch(() => {});
  }, []);

  const loadPreview = useCallback(
    async (ch: number) => {
      setSelectedChapter(ch);
      setCached(null);
      setCacheError(null);
      clear();
      setCacheCheckLoading(true);
      try {
        const res = await fetch(`/api/preview?chapter=${ch}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (d.cached) {
          setCached({ cached: true, content: d.content, generatedAt: d.generatedAt });
        } else {
          submit({ chapter: ch, studentId });
        }
      } catch (err) {
        console.error(err);
        setCacheError("載入失敗，請稍後再試");
      } finally {
        setCacheCheckLoading(false);
      }
    },
    [submit, clear, studentId],
  );

  const back = () => {
    setSelectedChapter(null);
    setCached(null);
    setCacheError(null);
    clear();
  };

  /* ─── Selector view ─── */

  if (selectedChapter === null) {
    return (
      <div className="flex flex-col h-screen">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
          <button onClick={onBack} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300" aria-label="返回">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-xl">🔭</span>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">章節預習 — 選擇章節</h1>
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">5–7 張概念卡 · 1 分鐘速覽</span>
          <ThemeToggle />
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-4xl mx-auto">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              選擇任一章節，AI 會幫你抽出本章最重要的 5–7 個核心概念，附公式與重點提醒，讓你在深入讀講義前先有全貌。
            </p>
            {chapters.length === 0 ? (
              <div className="text-center text-slate-400 dark:text-slate-500 py-12">載入章節列表中...</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
                {chapters.map((c) => {
                  const sty = CATEGORY_STYLE[categoryFor(c.chapter_number)];
                  return (
                    <button
                      key={c.chapter_number}
                      onClick={() => loadPreview(c.chapter_number)}
                      className={`p-2.5 border rounded-xl text-center hover:shadow-sm hover:-translate-y-0.5 transition-all ${sty.card}`}
                    >
                      <div className={`text-sm font-semibold ${sty.accent}`}>
                        Ch{String(c.chapter_number).padStart(2, "0")}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{c.page_count} 頁</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ─── Preview view ─── */

  const sty = CATEGORY_STYLE[categoryFor(selectedChapter)];
  const chLabel = `Ch${String(selectedChapter).padStart(2, "0")}`;

  // Pick render source: cache wins if present, else use the in-flight stream.
  const concepts: (Partial<PreviewConcept> | undefined)[] =
    cached?.content.concepts ?? (streamed?.concepts ?? []);
  const showInitialSpinner = cacheCheckLoading || (streaming && concepts.length === 0);
  const showError = cacheError ?? (streamError ? "生成失敗，請重試" : null);

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button onClick={back} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300" aria-label="返回章節列表">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-xl">🔭</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{chLabel} 預習</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full ${sty.pill}`}>{sty.label}</span>
        <button onClick={onBack} className="ml-auto text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:text-indigo-300">返回選擇模式</button>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto">
          {showInitialSpinner && (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
                <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {cacheCheckLoading ? `檢查 ${chLabel} 快取...` : `AI 正在抽出 ${chLabel} 核心概念...`}
              </p>
            </div>
          )}

          {showError && !showInitialSpinner && (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <p className="text-sm text-rose-600 dark:text-rose-300">{showError}</p>
              <button
                onClick={() => loadPreview(selectedChapter)}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                重試
              </button>
            </div>
          )}

          {concepts.length > 0 && (
            <>
              {cached ? (
                <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                  ⚡ 從快取載入 · 生成時間 {new Date(cached.generatedAt).toLocaleString("zh-TW")}
                </div>
              ) : streaming ? (
                <div className="text-xs text-indigo-600 dark:text-indigo-300 mb-3 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  AI 邊產生邊顯示中... 已完成 {concepts.length} / 5–7 張
                </div>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {concepts.map((c, idx) => (
                  <ConceptCardView key={idx} concept={c} idx={idx} chapter={selectedChapter} sty={sty} />
                ))}
              </div>

              {!streaming && !cacheCheckLoading && (
                <div className="mt-6 flex flex-wrap gap-3 justify-center text-sm">
                  <button
                    onClick={onBack}
                    className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    ← 回首頁
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400 self-center">
                    接下來推薦：<strong>📖 教學模式</strong> 深入讀，或 <strong>📝 自動測驗</strong> 選 {chLabel} 來自我檢測。
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Card ─── */

function ConceptCardView({
  concept,
  idx,
  chapter,
  sty,
}: {
  concept: Partial<PreviewConcept> | undefined;
  idx: number;
  chapter: number;
  sty: { card: string; pill: string; accent: string; label: string };
}) {
  const title = concept?.title ?? "";
  const summary = concept?.summary ? restoreLatexEscapes(concept.summary) : "";
  const formula = concept?.formula ?? "";
  const keyInsight = concept?.keyInsight ? restoreLatexEscapes(concept.keyInsight) : "";
  const referencePage = concept?.referencePage ?? 0;

  return (
    <div className={`border rounded-2xl p-5 shadow-sm ${sty.card}`}>
      <div className="flex items-start gap-2 mb-2">
        <span className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {idx + 1}
        </span>
        <h3 className={`font-semibold text-slate-800 dark:text-slate-100 ${sty.accent} min-h-[1.5rem]`}>
          {title || <span className="inline-block w-32 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />}
        </h3>
      </div>

      <div className="text-sm text-slate-700 dark:text-slate-200 mb-3 leading-relaxed">
        {summary ? (
          <MarkdownRenderer content={summary} />
        ) : (
          <div className="space-y-1.5">
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-3 w-3/4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          </div>
        )}
      </div>

      {formula.trim() && (
        // Force a white background + dark text even in dark mode so KaTeX
        // formulas stay readable. The surrounding card already gives the
        // dark theme its mood; the formula plate is the one thing that
        // benefits from being a high-contrast island.
        <div className="mb-3 px-3 py-2 rounded-xl bg-white border border-slate-200 dark:border-slate-700 text-sm text-slate-900 overflow-x-auto">
          <MarkdownRenderer content={restoreLatexEscapes(ensureMathBlock(formula))} />
        </div>
      )}

      {keyInsight && (
        <div className="mb-2 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
          <span className="font-medium text-amber-700 dark:text-amber-300">💡 提醒</span>
          <span className="ml-2">
            <MarkdownRenderer content={keyInsight} />
          </span>
        </div>
      )}

      {referencePage > 0 && (
        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
          深入：教學模式 Ch{String(chapter).padStart(2, "0")} 第 {referencePage} 頁
        </div>
      )}
    </div>
  );
}
