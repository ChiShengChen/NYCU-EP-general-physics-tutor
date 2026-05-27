"use client";

import { useState } from "react";
import { FreeFallSim } from "./free-fall";
import { SpringSim } from "./spring";
import { RCCircuitSim } from "./rc-circuit";

type SimKey = "free-fall" | "spring" | "rc";

interface SimulatorsModeProps {
  onBack: () => void;
  initialSim?: SimKey;
}

/**
 * Entry point for Batch 3 simulators. Shows a picker by default so the
 * three sims (free fall / SHM spring / RC circuit) sit behind one mode
 * key in app/page.tsx, instead of polluting the mode union with three
 * variants. Once inside a specific sim the back arrow returns here,
 * which keeps the navigation predictable: home → sims gallery → sim →
 * back to gallery → back to home.
 *
 * `initialSim` lets future callers (e.g. a "from the lecture" deep link
 * baked into teaching-mode) open straight into a specific simulator and
 * still get the gallery back arrow.
 */
export function SimulatorsMode({ onBack, initialSim }: SimulatorsModeProps) {
  const [active, setActive] = useState<SimKey | null>(initialSim ?? null);

  if (active === "free-fall") return <FreeFallSim onBack={() => setActive(null)} />;
  if (active === "spring") return <SpringSim onBack={() => setActive(null)} />;
  if (active === "rc") return <RCCircuitSim onBack={() => setActive(null)} />;

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
        <span className="text-xl">🔬</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">互動模擬器</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">PhET 風格 · 即時調參</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 text-center">
            選一個現象來玩。每個模擬都是純 SVG，手機上也跑得動，旁邊滑桿改參數立刻看到結果。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <PickerCard
              emoji="🍎"
              title="自由落體"
              subtitle="Free Fall"
              blurb="拉 g、初始高度、反彈係數，看落地速度與彈跳能量損失。同題型可比較月球 / 地球 / 木星。"
              chapter="Ch02 · Ch04"
              accent="text-indigo-700 dark:text-indigo-300"
              onClick={() => onPick("free-fall")}
            />
            <PickerCard
              emoji="🪀"
              title="彈簧與簡諧運動"
              subtitle="Spring · SHM"
              blurb="質量、彈簧常數、阻尼三條滑桿。連續看到欠阻尼 → 臨界阻尼 → 過阻尼三種行為。"
              chapter="Ch13"
              accent="text-amber-700 dark:text-amber-300"
              onClick={() => onPick("spring")}
            />
            <PickerCard
              emoji="🔋"
              title="RC 電路"
              subtitle="Capacitor charge / discharge"
              blurb="充電曲線 V_C = V(1 − e^(−t/RC))。切換開關看電容如何放電。理解時間常數 τ = RC。"
              chapter="Ch24 · Ch26"
              accent="text-rose-700 dark:text-rose-300"
              onClick={() => onPick("rc")}
            />
          </div>

          <p className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
            這是 Batch 3 的起點，之後會加更多（拋體運動、二體碰撞、電場線等）。歡迎在反思日誌或自由問答提需求。
          </p>
        </div>
      </div>
    </div>
  );
}

function PickerCard({
  emoji,
  title,
  subtitle,
  blurb,
  chapter,
  accent,
  onClick,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  blurb: string;
  chapter: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col text-left p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-4xl group-hover:scale-110 transition-transform">{emoji}</span>
        <div>
          <h3 className={`text-base font-semibold ${accent}`}>{title}</h3>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">{subtitle}</p>
        </div>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed flex-1">{blurb}</p>
      <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">{chapter}</p>
    </button>
  );
}
