"use client";

/* 🔗 概念對比表 — discrimination-learning view. Student picks two
 * physics concepts (graph chips or free text) and the AI generates a
 * side-by-side table covering definition, formula, conserved-when,
 * vector vs scalar, intuition, etc., plus similarities/differences/
 * pitfalls. */

import { useCallback, useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThemeToggle } from "./theme-provider";

interface ComparisonRow {
  dimension: string;
  a: string;
  b: string;
}

interface ComparisonResult {
  rows: ComparisonRow[];
  similarities: string[];
  differences: string[];
  pitfalls: string[];
}

/* Curated suggestion chips — covers the four big areas. Mirrors the
 * knowledge graph node set so chips feel familiar. */
const SUGGESTIONS: { label: string; group: string }[] = [
  { label: "動量", group: "力學" },
  { label: "角動量", group: "力學" },
  { label: "動能", group: "力學" },
  { label: "位能", group: "力學" },
  { label: "力", group: "力學" },
  { label: "力矩", group: "力學" },
  { label: "簡諧運動", group: "振盪/波動" },
  { label: "等速圓周運動", group: "振盪/波動" },
  { label: "橫波", group: "振盪/波動" },
  { label: "縱波", group: "振盪/波動" },
  { label: "熱與溫度", group: "熱學" },
  { label: "功與熱", group: "熱學" },
  { label: "熵", group: "熱學" },
  { label: "電場", group: "電磁" },
  { label: "電位", group: "電磁" },
  { label: "磁場", group: "電磁" },
  { label: "電容", group: "電磁" },
  { label: "電感", group: "電磁" },
  { label: "電流", group: "電磁" },
  { label: "電壓", group: "電磁" },
];

interface ConceptCompareProps {
  onBack: () => void;
}

export function ConceptCompare({ onBack }: ConceptCompareProps) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [resultPair, setResultPair] = useState<{ a: string; b: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const ax = a.trim();
    const bx = b.trim();
    if (!ax || !bx || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/concept-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptA: ax,
          conceptB: bx,
          studentId: typeof window !== "undefined" ? localStorage.getItem("physics_tutor_student_id") : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data.comparison);
      setResultPair({ a: ax, b: bx });
    } catch (err) {
      console.error(err);
      setError("對比表生成失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, [a, b, loading]);

  const pickInto = (target: "a" | "b", value: string) => {
    if (target === "a") setA(value);
    else setB(value);
  };

  const groups = Array.from(new Set(SUGGESTIONS.map((s) => s.group)));

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
        <ThemeToggle />
        <span className="text-xl">🔗</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">概念對比</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">discrimination learning</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-4xl mx-auto space-y-5">
          <p className="text-xs text-slate-600 dark:text-slate-300 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 rounded-lg px-3 py-2 leading-relaxed">
            選兩個你常搞混的概念，AI 會做一份**並列對比表**幫你釐清。研究上叫
            <strong>discrimination learning</strong> — 看兩個概念並列、知道哪裡像哪裡不像，比單看一個記得牢得多。
          </p>

          {/* Inputs */}
          <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">概念 A</label>
              <input
                value={a}
                onChange={(e) => setA(e.target.value)}
                placeholder="例：動量"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">概念 B</label>
              <input
                value={b}
                onChange={(e) => setB(e.target.value)}
                placeholder="例：角動量"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <button
              type="submit"
              disabled={!a.trim() || !b.trim() || loading}
              className="sm:col-span-2 rounded-xl bg-indigo-600 text-white text-sm font-medium py-2.5 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "AI 生成對比表中..." : "生成對比表"}
            </button>
          </form>

          {/* Suggestion chips */}
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">點以下標籤快速填入欄位（先點 A 欄想要的，再點 B 欄想要的）</p>
            {groups.map((g) => (
              <div key={g}>
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{g}</div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.filter((s) => s.group === g).map((s) => (
                    <div key={s.label} className="inline-flex rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                      <button
                        onClick={() => pickInto("a", s.label)}
                        className="px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:bg-indigo-950/30"
                        title={`填入 A 欄：${s.label}`}
                      >
                        A
                      </button>
                      <span className="px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200 border-x border-slate-200 dark:border-slate-700">{s.label}</span>
                      <button
                        onClick={() => pickInto("b", s.label)}
                        className="px-2 py-0.5 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:bg-rose-950/30"
                        title={`填入 B 欄：${s.label}`}
                      >
                        B
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}

          {result && resultPair && (
            <ComparisonView pair={resultPair} result={result} />
          )}
        </div>
      </div>
    </div>
  );
}

function ComparisonView({
  pair,
  result,
}: {
  pair: { a: string; b: string };
  result: ComparisonResult;
}) {
  return (
    <div className="space-y-5 pt-2">
      {/* Headline */}
      <div className="text-center">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          <span className="text-indigo-700 dark:text-indigo-300">{pair.a}</span>
          {" vs "}
          <span className="text-rose-700 dark:text-rose-300">{pair.b}</span>
        </h2>
      </div>

      {/* Side-by-side table (≥sm: ~640px). Fixed 3-column layout assumes
          enough horizontal room for both concepts' MarkdownRenderer output
          plus the dimension label, which falls apart below ~480px. */}
      <div className="hidden sm:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 w-28">維度</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">{pair.a}</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">{pair.b}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/50"}>
                <td className="align-top px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-700">
                  {r.dimension}
                </td>
                <td className="align-top px-3 py-2 text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700">
                  <MarkdownRenderer content={r.a} />
                </td>
                <td className="align-top px-3 py-2 text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700">
                  <MarkdownRenderer content={r.b} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card-stack (mobile, <sm). One card per dimension; A and B stacked
          vertically inside each card so MarkdownRenderer gets full row width. */}
      <div className="sm:hidden space-y-3">
        {result.rows.map((r, idx) => (
          <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 shadow-sm space-y-2.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {r.dimension}
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{pair.a}</div>
              <div className="text-sm text-slate-800 dark:text-slate-100">
                <MarkdownRenderer content={r.a} />
              </div>
            </div>
            <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-700">
              <div className="text-xs font-semibold text-rose-700 dark:text-rose-300">{pair.b}</div>
              <div className="text-sm text-slate-800 dark:text-slate-100">
                <MarkdownRenderer content={r.b} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Similarities / Differences / Pitfalls */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">🟰 相似處</h3>
          <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200 list-disc pl-4">
            {result.similarities.map((s, i) => (
              <li key={i}><MarkdownRenderer content={s} /></li>
            ))}
          </ul>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">↔ 關鍵差異</h3>
          <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200 list-disc pl-4">
            {result.differences.map((s, i) => (
              <li key={i}><MarkdownRenderer content={s} /></li>
            ))}
          </ul>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">⚠️ 常見搞混</h3>
          <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200 list-disc pl-4">
            {result.pitfalls.map((s, i) => (
              <li key={i}><MarkdownRenderer content={s} /></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
