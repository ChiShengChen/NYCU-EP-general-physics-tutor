"use client";

/* Tiny theme system — 3-state (system / light / dark), persists in
 * localStorage, applies `.dark` to <html> for Tailwind's dark: variant. */

import { useEffect, useState, useCallback } from "react";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "physics_tutor_theme";

function resolveEffective(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyToHtml(effective: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", effective === "dark");
}

export function useTheme(): {
  pref: ThemePref;
  effective: "light" | "dark";
  setPref: (p: ThemePref) => void;
} {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [effective, setEffective] = useState<"light" | "dark">("light");

  // Initial hydration
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemePref | null) ?? "system";
    setPrefState(stored);
    const eff = resolveEffective(stored);
    setEffective(eff);
    applyToHtml(eff);
  }, []);

  // React to system theme changes when on "system" mode
  useEffect(() => {
    if (pref !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const eff = mq.matches ? "dark" : "light";
      setEffective(eff);
      applyToHtml(eff);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, p);
    }
    const eff = resolveEffective(p);
    setEffective(eff);
    applyToHtml(eff);
  }, []);

  return { pref, effective, setPref };
}

/** Compact 3-button toggle for the header (system / light / dark). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { pref, setPref } = useTheme();
  const items: { value: ThemePref; icon: string; label: string }[] = [
    { value: "system", icon: "🖥️", label: "跟隨系統" },
    { value: "light",  icon: "☀️",  label: "亮色" },
    { value: "dark",   icon: "🌙",  label: "暗色" },
  ];
  return (
    <div className={`inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:bg-slate-800 overflow-hidden ${className}`}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => setPref(it.value)}
          title={it.label}
          aria-label={it.label}
          className={`px-2 py-1 text-xs transition-colors ${
            pref === it.value
              ? "bg-slate-100 dark:bg-slate-800 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
              : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:hover:bg-slate-700/60"
          }`}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}

/** Theme-aware colour tokens for places that can't use Tailwind classes
 *  (Recharts grids/ticks, inline SVG fills). */
export function useChartColors() {
  const { effective } = useTheme();
  if (effective === "dark") {
    return {
      grid: "#334155",
      axisTick: "#94a3b8",
      axisLine: "#475569",
      tooltipBg: "#1e293b",
      tooltipBorder: "#334155",
      tooltipText: "#e2e8f0",
    };
  }
  return {
    grid: "#e2e8f0",
    axisTick: "#64748b",
    axisLine: "#94a3b8",
    tooltipBg: "#ffffff",
    tooltipBorder: "#e2e8f0",
    tooltipText: "#1e293b",
  };
}

/** Inline FOUC-prevention script: applies the stored theme class before
 *  React hydrates, so the page doesn't flash light when the user prefers
 *  dark. Drop into <head> via Next.js's <Script>. */
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var p = localStorage.getItem("${STORAGE_KEY}") || "system";
    var d = p === "dark" || (p === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (d) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;
