"use client";

/* Scaffolded hints: a 3-level ladder that helps a stuck student
 * without dropping the answer. Each click escalates the help.
 *   Level 1 (方向)   — which principle / strategy to consider
 *   Level 2 (公式)   — relevant formula / symmetry, no plug-in
 *   Level 3 (下手點) — first concrete step
 * Used hints accumulate so the student can re-read all levels. */

import { useState, useCallback } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

interface HintEntry {
  level: 1 | 2 | 3;
  text: string;
}

interface HintPanelProps {
  question: string;
  correctAnswer: string;
  sourceChapter?: number | null;
  draftAnswer?: string;
  /** Highest level the student has revealed; pass back so persistence works. */
  onLevelChange?: (highestLevel: number) => void;
}

const LABELS: Record<1 | 2 | 3, { title: string; subtitle: string; cta: string }> = {
  1: { title: "💡 Level 1 — 方向",     subtitle: "點我想想該用哪個物理原理", cta: "要第 1 個提示" },
  2: { title: "🧭 Level 2 — 公式",     subtitle: "還是不行？看看相關公式",     cta: "再給一個提示" },
  3: { title: "🔧 Level 3 — 下手點",   subtitle: "卡很久？看第一步怎麼寫",     cta: "再來一個（最後一個）" },
};

export function HintPanel({ question, correctAnswer, sourceChapter, draftAnswer, onLevelChange }: HintPanelProps) {
  const [hints, setHints] = useState<HintEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextLevel = (hints.length + 1) as 1 | 2 | 3;
  const exhausted = hints.length >= 3;

  const requestHint = useCallback(async () => {
    if (exhausted || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          correctAnswer,
          draftAnswer,
          sourceChapter,
          level: nextLevel,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const updated = [...hints, { level: nextLevel, text: String(data.hint ?? "") }];
      setHints(updated);
      onLevelChange?.(updated.length);
    } catch (err) {
      console.error(err);
      setError("提示載入失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, [exhausted, loading, hints, nextLevel, question, correctAnswer, draftAnswer, sourceChapter, onLevelChange]);

  const label = exhausted ? null : LABELS[nextLevel];

  return (
    <div className="space-y-2">
      {/* Rendered hints (most recent at bottom) */}
      {hints.map((h) => (
        <div
          key={h.level}
          className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs space-y-1"
        >
          <div className="font-semibold text-indigo-800">{LABELS[h.level].title}</div>
          <div className="text-slate-800 leading-relaxed">
            <MarkdownRenderer content={h.text} />
          </div>
        </div>
      ))}

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {label && (
        <button
          type="button"
          onClick={requestHint}
          disabled={loading}
          className="w-full text-left px-3 py-2 rounded-xl border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-50 transition-colors text-xs flex items-center gap-2"
        >
          <span className="font-medium">{label.cta}</span>
          <span className="text-indigo-400">{label.subtitle}</span>
          {loading && <span className="ml-auto text-indigo-500">載入中...</span>}
        </button>
      )}

      {exhausted && (
        <p className="text-[11px] text-slate-400 text-center">
          已用滿 3 個提示。剩下交給你了 💪（送出後會看到完整解答 + AI 回饋）
        </p>
      )}
    </div>
  );
}
