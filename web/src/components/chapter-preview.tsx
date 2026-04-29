"use client";

import { useEffect, useState, useCallback } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

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

interface ConceptCard {
  title: string;
  summary: string;
  formula: string;
  keyInsight: string;
  referencePage: number;
}

interface PreviewResponse {
  chapter: number;
  content: { concepts: ConceptCard[] };
  generatedAt: string;
  cached: boolean;
}

/* ─── Category palette (mirror knowledge-graph) ─── */

function categoryFor(ch: number): "mechanics" | "waves_fluid" | "thermo" | "em" {
  if (ch <= 12) return "mechanics";
  if (ch <= 16) return "waves_fluid";
  if (ch <= 20) return "thermo";
  return "em";
}

const CATEGORY_STYLE = {
  mechanics:   { card: "bg-blue-50/50 border-blue-200",     pill: "bg-blue-100 text-blue-700",     accent: "text-blue-700",    label: "力學" },
  waves_fluid: { card: "bg-emerald-50/50 border-emerald-200", pill: "bg-emerald-100 text-emerald-700", accent: "text-emerald-700", label: "振盪 / 流體 / 波動" },
  thermo:      { card: "bg-amber-50/50 border-amber-200",   pill: "bg-amber-100 text-amber-700",   accent: "text-amber-700",   label: "熱學" },
  em:          { card: "bg-purple-50/50 border-purple-200", pill: "bg-purple-100 text-purple-700", accent: "text-purple-700",  label: "電磁學" },
};

/* ─── Component ─── */

interface ChapterPreviewProps {
  onBack: () => void;
}

export function ChapterPreview({ onBack }: ChapterPreviewProps) {
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lectures")
      .then((r) => r.json())
      .then((d) => setChapters(d.chapters ?? []))
      .catch(() => {});
  }, []);

  const loadPreview = useCallback(async (ch: number) => {
    setSelectedChapter(ch);
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/preview?chapter=${ch}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as PreviewResponse;
      setPreview(d);
    } catch (err) {
      console.error(err);
      setError("載入失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, []);

  const back = () => {
    setSelectedChapter(null);
    setPreview(null);
    setError(null);
  };

  /* ─── Selector view ─── */

  if (selectedChapter === null) {
    return (
      <div className="flex flex-col h-screen">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
          <button onClick={onBack} className="p-1 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="返回">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-xl">🔭</span>
          <h1 className="text-lg font-semibold text-slate-800">章節預習 — 選擇章節</h1>
          <span className="text-xs text-slate-400 ml-auto">5–7 張概念卡 · 1 分鐘速覽</span>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-4xl mx-auto">
            <p className="text-sm text-slate-500 mb-4">
              選擇任一章節，AI 會幫你抽出本章最重要的 5–7 個核心概念，附公式與重點提醒，讓你在深入讀講義前先有全貌。
            </p>
            {chapters.length === 0 ? (
              <div className="text-center text-slate-400 py-12">載入章節列表中...</div>
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
                      <div className="text-[10px] text-slate-500">{c.page_count} 頁</div>
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

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button onClick={back} className="p-1 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="返回章節列表">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-xl">🔭</span>
        <h1 className="text-lg font-semibold text-slate-800">{chLabel} 預習</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full ${sty.pill}`}>{sty.label}</span>
        <button onClick={onBack} className="ml-auto text-xs text-slate-500 hover:text-indigo-600">返回選擇模式</button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
                <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
              </div>
              <p className="text-sm text-slate-500">AI 正在抽出 {chLabel} 核心概念...（首次約 6–10 秒）</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <p className="text-sm text-rose-600">{error}</p>
              <button
                onClick={() => loadPreview(selectedChapter)}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                重試
              </button>
            </div>
          )}

          {preview && (
            <>
              {preview.cached && (
                <div className="text-xs text-slate-400 mb-3">
                  ⚡ 從快取載入 · 生成時間 {new Date(preview.generatedAt).toLocaleString("zh-TW")}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {preview.content.concepts.map((c, idx) => (
                  <ConceptCardView key={idx} concept={c} idx={idx} chapter={selectedChapter} sty={sty} />
                ))}
              </div>

              {/* Bottom CTAs — bring the student to the next natural action */}
              <div className="mt-6 flex flex-wrap gap-3 justify-center text-sm">
                <button
                  onClick={onBack}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  ← 回首頁
                </button>
                <p className="text-xs text-slate-500 self-center">
                  接下來推薦：<strong>📖 教學模式</strong> 深入讀，或 <strong>📝 自動測驗</strong> 選 {chLabel} 來自我檢測。
                </p>
              </div>
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
  concept: ConceptCard;
  idx: number;
  chapter: number;
  sty: { card: string; pill: string; accent: string; label: string };
}) {
  return (
    <div className={`border rounded-2xl p-5 shadow-sm ${sty.card}`}>
      <div className="flex items-start gap-2 mb-2">
        <span className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-full bg-white border border-slate-200 text-xs font-semibold text-slate-600">
          {idx + 1}
        </span>
        <h3 className={`font-semibold text-slate-800 ${sty.accent}`}>{concept.title}</h3>
      </div>

      <div className="text-sm text-slate-700 mb-3 leading-relaxed">
        <MarkdownRenderer content={concept.summary} />
      </div>

      {concept.formula && concept.formula.trim() && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-white/70 border border-slate-200 text-sm overflow-x-auto">
          <MarkdownRenderer content={ensureMathBlock(concept.formula)} />
        </div>
      )}

      {concept.keyInsight && (
        <div className="mb-2 text-xs text-slate-700 leading-relaxed">
          <span className="font-medium text-amber-700">💡 提醒</span>
          <span className="ml-2">
            <MarkdownRenderer content={concept.keyInsight} />
          </span>
        </div>
      )}

      {concept.referencePage > 0 && (
        <div className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
          深入：教學模式 Ch{String(chapter).padStart(2, "0")} 第 {concept.referencePage} 頁
        </div>
      )}
    </div>
  );
}
