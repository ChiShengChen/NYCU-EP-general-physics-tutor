"use client";

import { useState } from "react";
import { SIMS, type SimKey } from "@/lib/sim-mappings";
import { ThemeToggle } from "../theme-provider";

interface SimulatorsModeProps {
  onBack: () => void;
  initialSim?: SimKey;
}

/**
 * Entry point for the simulator gallery. Reads the central SIMS registry
 * in src/lib/sim-mappings.ts so new sims show up here automatically once
 * registered there. Once inside a sim, the back arrow returns to the
 * gallery picker — home → gallery → sim → gallery → home.
 *
 * `initialSim` lets future callers (e.g. a "from the lecture" deep link
 * baked into teaching-mode) open straight into a specific simulator and
 * still get the gallery back arrow.
 */
export function SimulatorsMode({ onBack, initialSim }: SimulatorsModeProps) {
  const [active, setActive] = useState<SimKey | null>(initialSim ?? null);

  if (active !== null) {
    const meta = SIMS.find((s) => s.key === active);
    if (meta) {
      const { Component } = meta;
      return <Component onBack={() => setActive(null)} />;
    }
  }

  return <Picker onBack={onBack} onPick={setActive} />;
}

function Picker({ onBack, onPick }: { onBack: () => void; onPick: (k: SimKey) => void }) {
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
        <span className="text-xl">🔬</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">互動模擬器</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">PhET 風格 · 即時調參</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 text-center">
            選一個現象來玩。每個模擬都是純 SVG，手機上也跑得動，旁邊滑桿改參數立刻看到結果。
            進教學模式時，對應章節的頁面下方也會有同款 sim 可以展開。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SIMS.map((meta) => (
              <button
                key={meta.key}
                onClick={() => onPick(meta.key)}
                className="group relative flex flex-col text-left p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-4xl group-hover:scale-110 transition-transform">{meta.emoji}</span>
                  <div>
                    <h3 className={`text-base font-semibold ${meta.accent}`}>{meta.title}</h3>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">{meta.subtitle}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed flex-1">{meta.blurb}</p>
                <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">{meta.chapters}</p>
              </button>
            ))}
          </div>

          <p className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
            這個沙盒會持續長新功能。歡迎在反思日誌或自由問答提需求。
          </p>
        </div>
      </div>
    </div>
  );
}
