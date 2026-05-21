"use client";

/* 📝 例題庫 / 公式速查 — searchable index over lecture_chunks.
 * No AI involved; pure Postgres ILIKE + heuristic kind filter. */

import { useCallback, useEffect, useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

interface Chunk {
  id: number;
  chapter_number: number;
  page_number: number;
  section_title: string;
  content: string;
  content_type: string;
}

interface ChapterGroup {
  chapter: number;
  items: Chunk[];
}

interface ChapterInfo {
  chapter_number: number;
  page_count: number;
  sections: string[];
}

type Kind = "all" | "example" | "formula" | "figure";

const KIND_LABELS: Record<Kind, { label: string; emoji: string }> = {
  all:     { label: "全部",       emoji: "📚" },
  example: { label: "例題",       emoji: "📝" },
  formula: { label: "公式",       emoji: "🧮" },
  figure:  { label: "圖表 / 圖示", emoji: "📊" },
};

interface LibraryViewProps {
  onBack: () => void;
}

export function LibraryView({ onBack }: LibraryViewProps) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [chapter, setChapter] = useState<number | null>(null);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [groups, setGroups] = useState<ChapterGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Load chapter list once for the filter.
  useEffect(() => {
    fetch("/api/lectures")
      .then((r) => r.json())
      .then((d) => setChapters(d.chapters ?? []))
      .catch(() => {});
  }, []);

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (kind !== "all") params.set("kind", kind);
      if (chapter !== null) params.set("chapter", String(chapter));
      const res = await fetch(`/api/library?${params.toString()}`);
      const data = await res.json();
      setGroups(data.byChapter ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error(err);
      setGroups([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, kind, chapter]);

  // Auto-search when filters change (no debounce on chapter/kind; debounce q).
  useEffect(() => {
    const t = setTimeout(runSearch, 300);
    return () => clearTimeout(t);
  }, [runSearch]);

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
        <span className="text-xl">📝</span>
        <h1 className="text-lg font-semibold text-slate-800">例題庫 / 公式速查</h1>
        <span className="text-xs text-slate-400 ml-auto">{total} 筆</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋關鍵字 / 公式片段（例：守恆、Faraday、$E = mc^2$）"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex flex-wrap gap-2">
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    kind === k
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-700 border-slate-200 hover:border-indigo-300"
                  }`}
                >
                  {KIND_LABELS[k].emoji} {KIND_LABELS[k].label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500 mr-1">章節：</span>
              <button
                onClick={() => setChapter(null)}
                className={`px-2 py-0.5 rounded-md text-xs font-medium border ${
                  chapter === null
                    ? "bg-slate-700 text-white border-slate-700"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                }`}
              >
                全部
              </button>
              {chapters.map((c) => (
                <button
                  key={c.chapter_number}
                  onClick={() => setChapter(c.chapter_number)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium border ${
                    chapter === c.chapter_number
                      ? "bg-slate-700 text-white border-slate-700"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  }`}
                >
                  Ch{String(c.chapter_number).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          {loading ? (
            <div className="text-center text-slate-400 py-8">搜尋中...</div>
          ) : !groups || groups.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <p className="text-3xl mb-2">🔍</p>
              <p>沒有結果</p>
              <p className="text-xs mt-1">試試別的關鍵字、清掉章節篩選、或換個類型。</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.chapter} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h2 className="text-sm font-semibold text-slate-700">
                      Ch{String(g.chapter).padStart(2, "0")} ({g.items.length})
                    </h2>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {g.items.map((it) => (
                      <li key={it.id} className="px-4 py-3 space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100">P. {it.page_number}</span>
                          {it.section_title && <span className="truncate">{it.section_title}</span>}
                          <span className="ml-auto text-[10px] text-slate-400">{it.content_type}</span>
                        </div>
                        <div className="text-sm text-slate-800">
                          <MarkdownRenderer content={it.content} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
