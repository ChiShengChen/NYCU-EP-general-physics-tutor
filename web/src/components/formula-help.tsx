"use client";

import { useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

/* Cheatsheet rows: each row = (LaTeX/Markdown source, label).
 * Source is rendered both as monospaced text and via MarkdownRenderer
 * so students see exactly what to type and what comes out. */

interface Row { src: string; note?: string; }

interface Section { title: string; rows: Row[]; }

const SECTIONS: Section[] = [
  {
    title: "行內 vs 獨立公式",
    rows: [
      { src: "$F = ma$", note: "用 $...$ 包住 → 行內" },
      { src: "$$E = mc^2$$", note: "用 $$...$$ 包住 → 獨立成行、置中" },
    ],
  },
  {
    title: "希臘字母",
    rows: [
      { src: "$\\alpha, \\beta, \\gamma, \\theta, \\phi$" },
      { src: "$\\omega, \\Omega, \\pi, \\Delta, \\nabla$" },
    ],
  },
  {
    title: "上標、下標",
    rows: [
      { src: "$v_0, x_i, T_{1/2}$", note: "下標單一字母直接寫，多個用 {}" },
      { src: "$x^2, e^{i\\pi}, 10^{-3}$", note: "上標同理" },
    ],
  },
  {
    title: "分數、根號、絕對值",
    rows: [
      { src: "$\\frac{1}{2} m v^2$" },
      { src: "$\\sqrt{x^2 + y^2}$" },
      { src: "$\\sqrt[3]{8}, \\, |x|$" },
    ],
  },
  {
    title: "向量、微積分",
    rows: [
      { src: "$\\vec{F} = m \\vec{a}$" },
      { src: "$\\frac{d x}{d t}, \\, \\frac{\\partial f}{\\partial x}$" },
      { src: "$\\int_0^L F\\,dx, \\quad \\sum_{i=1}^N x_i$" },
      { src: "$\\nabla \\cdot \\vec{E} = \\frac{\\rho}{\\varepsilon_0}$" },
    ],
  },
  {
    title: "物理常用",
    rows: [
      { src: "$\\Delta x, \\, \\Delta t \\to 0$" },
      { src: "$\\hat{x}, \\hat{r}$", note: "單位向量" },
      { src: "$\\dot{x} = v, \\, \\ddot{x} = a$", note: "時間導數" },
      { src: "$\\approx, \\propto, \\le, \\ge, \\neq$" },
    ],
  },
];

interface FormulaHelpProps {
  /** Compact: render as a thin "💡 公式輸入語法" link that expands. */
  compact?: boolean;
}

export function FormulaHelp({ compact = true }: FormulaHelpProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 text-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-indigo-700 hover:bg-indigo-100/60 transition-colors"
      >
        <span className="text-base">📐</span>
        <span className="font-medium">如何輸入公式？</span>
        <span className="text-xs text-indigo-500 font-normal">
          {open ? "點此收合" : "用 $..$（行內）或 $$..$$（獨立）+ LaTeX 語法"}
        </span>
        <svg
          className={`ml-auto w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-indigo-100">
          <p className="text-xs text-slate-600">
            這個系統用 <strong>KaTeX</strong> 渲染 LaTeX 公式。下面左邊是你要輸入的文字，右邊是渲染後的樣子：
          </p>
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <div className="text-xs font-semibold text-indigo-700 mb-1.5">{s.title}</div>
              <div className="space-y-1">
                {s.rows.map((row) => (
                  <div
                    key={row.src}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-xs"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <code className="font-mono text-slate-700 break-all whitespace-pre-wrap">{row.src}</code>
                      {row.note && <span className="text-[10px] text-slate-400">{row.note}</span>}
                    </div>
                    <div className="flex items-center min-w-0 overflow-x-auto text-slate-800">
                      <MarkdownRenderer content={row.src} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 leading-relaxed">
            💡 小撇步：簡答題可以混搭一般文字 + 公式，例如：
            <code className="block mt-1 font-mono bg-white px-2 py-1 rounded border border-amber-200">
              {"由能量守恆 $E_k + E_p = \\text{const}$，所以末速為 $v = \\sqrt{2gh}$。"}
            </code>
          </div>
          {!compact && null}
        </div>
      )}
    </div>
  );
}
