"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SimChrome, Slider, Readout } from "./simulators/sim-chrome";
import {
  computeOpticsQuantities,
  evaluateOpticsTask,
  formatQuantity,
  QUANTITY_LABELS,
  type OpticsEvaluation,
  type OpticsTask,
} from "@/lib/optics";

/**
 * 操作型互動光路題 — the student doesn't type an answer; they drag the
 * task's adjustable sliders until the simulator meets the stated target,
 * then press 提交. The verdict is computed client-side with the formulas
 * in lib/optics.ts (and re-checked server-side in /api/quiz grade).
 *
 * The canvas is the same controlled `*Canvas` core the standalone sims
 * use, so what the student sees here is pixel-identical to the gallery.
 * Live readouts show the achieved quantities but NOT a pass/fail tick —
 * like every other question type, correctness is revealed at grading.
 */

const LensCanvas = dynamic(() => import("./simulators/lens").then((m) => m.LensCanvas), { ssr: false });
const MirrorCanvas = dynamic(() => import("./simulators/mirror").then((m) => m.MirrorCanvas), { ssr: false });
const RefractionCanvas = dynamic(() => import("./simulators/refraction").then((m) => m.RefractionCanvas), { ssr: false });

const SIM_TITLE: Record<OpticsTask["sim"], { title: string; subtitle: string }> = {
  lens: { title: "透鏡成像 · 操作題", subtitle: "Thin lens · Ch34" },
  mirror: { title: "球面鏡成像 · 操作題", subtitle: "Spherical mirror · Ch34" },
  refraction: { title: "折射與全反射 · 操作題", subtitle: "Snell's law · Ch33" },
};

/** Which derived quantities to list under 目前達成, per sim (targets are
 *  always listed first; these fill in the rest of the picture). */
const EXTRA_READOUTS: Record<OpticsTask["sim"], string[]> = {
  lens: ["dI", "m", "isReal", "isUpright"],
  mirror: ["dI", "m", "isReal", "isUpright"],
  refraction: ["thetaRefr", "thetaCrit", "tir"],
};

export interface OpticsSubmission {
  values: Record<string, number>;
  isCorrect: boolean;
}

interface OpticsTaskViewProps {
  task: OpticsTask;
  /** When set, the sliders are locked at these values (already submitted). */
  submitted?: OpticsSubmission | null;
  onSubmit: (values: Record<string, number>, verdict: OpticsEvaluation) => void;
  /** Unlock the sliders again (clears the parent's stored submission). */
  onReset?: () => void;
}

export function OpticsTaskView({ task, submitted, onSubmit, onReset }: OpticsTaskViewProps) {
  const initial = useMemo(
    () => Object.fromEntries(task.adjustable.map((p) => [p.key, submitted?.values[p.key] ?? p.initial])),
    [task, submitted],
  );
  const [values, setValues] = useState<Record<string, number>>(initial);
  const locked = !!submitted;
  const shown = locked ? { ...initial, ...submitted.values } : values;

  // Fixed params + live adjustable values → the canvas props the sim needs.
  // Cheap enough to rebuild every render (a handful of keys).
  const params: Record<string, number> = {};
  for (const p of task.fixed) params[p.key] = p.value;
  for (const p of task.adjustable) params[p.key] = shown[p.key] ?? p.initial;

  const achieved = computeOpticsQuantities(task.sim, params);
  const targetKeys = task.target.map((t) => t.check.quantity);
  const extraKeys = EXTRA_READOUTS[task.sim].filter((k) => !targetKeys.includes(k));

  const canvas =
    task.sim === "lens" ? <LensCanvas f={params.f} dO={params.dO} hO={params.hO ?? 3} />
      : task.sim === "mirror" ? <MirrorCanvas R={params.R} dO={params.dO} hO={params.hO ?? 3} />
        : <RefractionCanvas n1={params.n1} n2={params.n2} thetaInc={params.thetaInc} />;

  return (
    <div className="space-y-3">
      {/* Target banner */}
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-4 py-3">
        <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 mb-1">🎯 目標（拖動滑桿直到全部達成，再按提交）</p>
        <ul className="text-sm text-emerald-900 dark:text-emerald-100 space-y-0.5 list-disc list-inside">
          {task.target.map((t, i) => <li key={i}>{t.description}</li>)}
        </ul>
      </div>

      <SimChrome
        title={SIM_TITLE[task.sim].title}
        subtitle={SIM_TITLE[task.sim].subtitle}
        inline
        canvas={canvas}
        controls={
          <>
            {task.adjustable.map((p) => (
              <Slider
                key={p.key}
                label={p.label}
                unit={p.unit}
                value={shown[p.key] ?? p.initial}
                min={p.min}
                max={p.max}
                step={p.step}
                disabled={locked}
                onChange={(v) => setValues((prev) => ({ ...prev, [p.key]: v }))}
              />
            ))}
            {task.fixed.length > 0 && (
              <div className="pt-1 border-t border-slate-100 dark:border-slate-800 space-y-1">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">固定（不可調）</p>
                {task.fixed.map((p) => (
                  <Readout key={p.key} label={`🔒 ${p.label}`} value={Number.isInteger(p.value) ? String(p.value) : p.value.toFixed(2)} unit={p.unit} />
                ))}
              </div>
            )}
          </>
        }
        readouts={
          <>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold mb-1">目前達成</p>
            {targetKeys.map((k) => (
              <Readout key={k} label={QUANTITY_LABELS[k]?.label ?? k} value={formatQuantity(k, achieved[k])} emphasis />
            ))}
            {extraKeys.length > 0 && <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />}
            {extraKeys.map((k) => (
              <Readout key={k} label={QUANTITY_LABELS[k]?.label ?? k} value={formatQuantity(k, achieved[k])} />
            ))}
          </>
        }
      />

      {/* Submit / locked state */}
      {locked ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 text-sm">
          <span className="text-slate-600 dark:text-slate-300">
            ✔ 已提交：
            {task.adjustable.map((p) => ` ${p.label} = ${(shown[p.key] ?? p.initial).toFixed(p.step < 1 ? 2 : 1)}${p.unit ? ` ${p.unit}` : ""}`).join("，")}
          </span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="ml-auto text-xs text-indigo-600 dark:text-indigo-300 hover:underline"
            >
              重新調整
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-slate-400 dark:text-slate-500">提交後滑桿會鎖定，批改時以提交當下的數值為準</span>
          <button
            type="button"
            onClick={() => onSubmit({ ...values }, evaluateOpticsTask(task, values))}
            className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            提交這題
          </button>
        </div>
      )}
    </div>
  );
}
