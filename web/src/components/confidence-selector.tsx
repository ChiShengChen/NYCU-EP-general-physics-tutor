"use client";

/* Confidence calibration UI: a 5-point self-assessment scale rendered as a
 * segmented bar. Students pick how sure they are *before* sending the
 * answer. The data feeds the dashboard calibration view and flags
 * dangerous misconceptions when high-confidence answers turn out wrong. */

interface ConfidenceSelectorProps {
  value: number | null;
  onChange: (v: number) => void;
  /** "before" = before grading (in quiz/exam). "after" = read-only review. */
  variant?: "before" | "after";
  /** Optional override label */
  label?: string;
}

const LEVELS = [
  { v: 1, short: "1", long: "完全靠猜" },
  { v: 2, short: "2", long: "不太確定" },
  { v: 3, short: "3", long: "一半一半" },
  { v: 4, short: "4", long: "滿確定" },
  { v: 5, short: "5", long: "非常確定" },
];

const COLORS: Record<number, { active: string; ring: string }> = {
  1: { active: "bg-rose-500 text-white",    ring: "ring-rose-300" },
  2: { active: "bg-orange-500 text-white",  ring: "ring-orange-300" },
  3: { active: "bg-amber-500 text-white",   ring: "ring-amber-300" },
  4: { active: "bg-lime-500 text-white",    ring: "ring-lime-300" },
  5: { active: "bg-emerald-500 text-white", ring: "ring-emerald-300" },
};

export function ConfidenceSelector({ value, onChange, variant = "before", label }: ConfidenceSelectorProps) {
  const readOnly = variant === "after";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500 shrink-0">
        {label ?? (readOnly ? "你的信心" : "答前先想：我有多確定？")}
      </span>
      <div className="flex gap-1">
        {LEVELS.map(({ v, short, long }) => {
          const selected = value === v;
          const palette = COLORS[v];
          return (
            <button
              key={v}
              type="button"
              onClick={() => !readOnly && onChange(v)}
              disabled={readOnly}
              title={`${v} · ${long}`}
              className={
                selected
                  ? `${palette.active} w-7 h-7 rounded-md text-xs font-semibold transition-colors`
                  : `bg-white text-slate-600 w-7 h-7 rounded-md border border-slate-300 text-xs font-medium hover:bg-slate-50 transition-colors ${readOnly ? "opacity-60 cursor-default" : ""}`
              }
            >
              {short}
            </button>
          );
        })}
      </div>
      {value !== null && (
        <span className="text-slate-500 hidden sm:inline">
          {LEVELS.find((l) => l.v === value)?.long}
        </span>
      )}
    </div>
  );
}
