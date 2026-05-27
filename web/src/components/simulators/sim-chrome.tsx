"use client";

import type { ReactNode } from "react";

/**
 * Shared chrome for every simulator: a 2-pane layout with the SVG canvas
 * on the left (or top, on mobile) and the parameter / read-out panel
 * on the right (or bottom). All three sims (free fall, spring, circuit)
 * use this so the visual rhythm stays consistent across the gallery and
 * the page is iframe-embed friendly for later "embed in lecture" usage.
 */

interface SimChromeProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  canvas: ReactNode;        // <svg> + transient overlays
  controls: ReactNode;      // parameter sliders + reset/play
  readouts: ReactNode;      // derived quantities + formulas
  notes?: ReactNode;        // optional pedagogy blurb under the readouts
}

export function SimChrome({ title, subtitle, onBack, canvas, controls, readouts, notes }: SimChromeProps) {
  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
            aria-label="返回"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <span className="text-xl">⚙️</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
        {subtitle && <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{subtitle}</span>}
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 min-h-0 bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 overflow-hidden">
          {canvas}
        </div>

        <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-y-auto">
          <section className="p-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              參數
            </h2>
            <div className="space-y-3">{controls}</div>
          </section>

          <section className="p-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              即時讀數
            </h2>
            <div className="space-y-1.5 text-sm">{readouts}</div>
          </section>

          {notes && (
            <section className="p-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {notes}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ─── Reusable slider primitive ─── */

interface SliderProps {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}

export function Slider({ label, unit, value, min, max, step, onChange, format, disabled }: SliderProps) {
  const display = format ? format(value) : value.toFixed(step < 1 ? 2 : 0);
  return (
    <label className={`block ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-slate-700 dark:text-slate-200">{label}</span>
        <span className="tabular-nums text-slate-600 dark:text-slate-300">
          {display}
          {unit && <span className="text-slate-400 dark:text-slate-500 ml-0.5">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full accent-indigo-600"
      />
    </label>
  );
}

/* ─── Reusable readout row ─── */

interface ReadoutProps {
  label: ReactNode;
  value: string;
  unit?: string;
  emphasis?: boolean;
}

export function Readout({ label, value, unit, emphasis }: ReadoutProps) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`text-xs ${emphasis ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-slate-600 dark:text-slate-300"}`}>
        {label}
      </span>
      <span className={`tabular-nums ${emphasis ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-200"}`}>
        {value}
        {unit && <span className="text-slate-400 dark:text-slate-500 ml-0.5 text-xs">{unit}</span>}
      </span>
    </div>
  );
}

/* ─── Play / pause / reset toolbar ─── */

interface PlayControlsProps {
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
  extra?: ReactNode;
}

export function PlayControls({ running, onToggle, onReset, extra }: PlayControlsProps) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <button
        onClick={onToggle}
        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
      >
        {running ? (
          <>
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
            暫停
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20" /></svg>
            開始
          </>
        )}
      </button>
      <button
        onClick={onReset}
        className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        重置
      </button>
      {extra}
    </div>
  );
}
