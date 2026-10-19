"use client";

import { useState } from "react";
import { SimChrome, Slider, Readout } from "./sim-chrome";
import { snell } from "@/lib/optics";

/**
 * Refraction + total internal reflection at a flat interface — static.
 *
 * Medium 1 (index n₁) fills the top half, medium 2 (n₂) the bottom. A
 * ray comes in from the upper-left at angle θ_i to the normal, and we
 * draw
 *   - the reflected ray (always, at θ_i on the upper-right),
 *   - the refracted ray from Snell's law  n₁ sin θ_i = n₂ sin θ_r,
 *   - when n₁ > n₂, a faint marker at the critical angle
 *       θ_c = asin(n₂ / n₁)
 *     and, once θ_i > θ_c, no refracted ray at all (total internal
 *     reflection).
 *
 * `RefractionCanvas` is the controlled SVG (shared with the 光學操作題
 * quiz component); `RefractionSim` adds sliders + readouts in SimChrome.
 */

const VIEW_W = 520;
const VIEW_H = 280;
const OX = VIEW_W / 2;                 // point of incidence
const OY = VIEW_H / 2;                 // interface height
const RAY_LEN = 118;
const ARC_R = 30;
const DEG = Math.PI / 180;

/** Point on a circle around the incidence point; φ measured CCW from +x
 *  the way a maths diagram would (we flip y for screen space). */
function polar(r: number, phiDeg: number): { x: number; y: number } {
  return { x: OX + r * Math.cos(phiDeg * DEG), y: OY - r * Math.sin(phiDeg * DEG) };
}

/** SVG arc path between two angles (both < 180° apart). */
function arcPath(r: number, fromDeg: number, toDeg: number): string {
  const a = polar(r, fromDeg);
  const b = polar(r, toDeg);
  const sweep = toDeg > fromDeg ? 0 : 1;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 0 ${sweep} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** Small triangular arrow head at the END of the segment (x1,y1)→(x2,y2). */
function arrowHead(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * 9;
  const by = y2 - uy * 9;
  return `${x2},${y2} ${bx - uy * 4},${by + ux * 4} ${bx + uy * 4},${by - ux * 4}`;
}

export interface RefractionCanvasProps {
  /** Refractive index of the top medium (where the ray comes from). */
  n1: number;
  /** Refractive index of the bottom medium. */
  n2: number;
  /** Incidence angle from the normal, degrees. */
  thetaInc: number;
}

/** Derived quantities the readouts need, shared with the task component. */
export function computeRefraction({ n1, n2, thetaInc }: RefractionCanvasProps) {
  const r = snell(n1, n2, thetaInc);
  return {
    thetaRefr: r.thetaRefrDeg,
    thetaCrit: r.criticalDeg,
    tir: r.tir,
    /** Angle between the reflected and refracted rays (null under TIR). */
    reflRefrAngle: r.thetaRefrDeg === null ? null : 180 - thetaInc - r.thetaRefrDeg,
  };
}

export function RefractionCanvas({ n1, n2, thetaInc }: RefractionCanvasProps) {
  const { thetaRefr, thetaCrit, tir } = computeRefraction({ n1, n2, thetaInc });

  // Direction angles (maths convention, CCW from +x): incident ray arrives
  // from φ = 90 + θ_i, reflected leaves toward 90 − θ_i, refracted toward
  // θ_r − 90 (below the interface, bending right).
  const incFrom = polar(RAY_LEN, 90 + thetaInc);
  const refl = polar(RAY_LEN, 90 - thetaInc);
  const refr = thetaRefr === null ? null : polar(RAY_LEN, thetaRefr - 90);
  const crit = thetaCrit === null ? null : polar(RAY_LEN * 0.8, 90 + thetaCrit);

  // Denser medium → deeper tint so the student *sees* n.
  const tint = (n: number) => Math.min(0.55, 0.08 + (n - 1) * 0.3);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full max-h-[55vh] max-w-3xl"
      aria-label="Refraction simulation canvas"
    >
      {/* Media */}
      <rect x={0} y={0} width={VIEW_W} height={OY} className="fill-sky-400 dark:fill-sky-500" fillOpacity={tint(n1)} />
      <rect x={0} y={OY} width={VIEW_W} height={VIEW_H - OY} className="fill-sky-400 dark:fill-sky-500" fillOpacity={tint(n2)} />
      <line x1={0} y1={OY} x2={VIEW_W} y2={OY} className="stroke-slate-500 dark:stroke-slate-400" strokeWidth={1.5} />
      <text x={12} y={18} fontSize={11} className="fill-slate-700 dark:fill-slate-200">n₁ = {n1.toFixed(2)}</text>
      <text x={12} y={VIEW_H - 10} fontSize={11} className="fill-slate-700 dark:fill-slate-200">n₂ = {n2.toFixed(2)}</text>

      {/* Normal */}
      <line x1={OX} y1={12} x2={OX} y2={VIEW_H - 12} className="stroke-slate-400 dark:stroke-slate-500" strokeWidth={0.8} strokeDasharray="4 3" />
      <text x={OX + 4} y={22} fontSize={9} className="fill-slate-500 dark:fill-slate-400">法線</text>

      {/* Critical-angle guide (only when TIR is possible) */}
      {crit && (
        <g>
          <line x1={OX} y1={OY} x2={crit.x} y2={crit.y} className="stroke-rose-400 dark:stroke-rose-500" strokeWidth={1} strokeDasharray="2 3" />
          <text x={crit.x - 4} y={crit.y - 4} fontSize={9} textAnchor="end" className="fill-rose-600 dark:fill-rose-300">θ_c = {thetaCrit!.toFixed(1)}°</text>
        </g>
      )}

      {/* Incident ray (arrow points INTO the interface) */}
      <line x1={incFrom.x} y1={incFrom.y} x2={OX} y2={OY} className="stroke-amber-500" strokeWidth={2} />
      <polygon points={arrowHead(incFrom.x, incFrom.y, OX, OY)} className="fill-amber-500" />
      <path d={arcPath(ARC_R, 90, 90 + thetaInc)} fill="none" className="stroke-amber-600 dark:stroke-amber-400" strokeWidth={1} />
      <text x={polar(ARC_R + 12, 90 + thetaInc / 2).x} y={polar(ARC_R + 12, 90 + thetaInc / 2).y} fontSize={9} textAnchor="middle" className="fill-amber-700 dark:fill-amber-300">θ_i</text>

      {/* Reflected ray */}
      <line x1={OX} y1={OY} x2={refl.x} y2={refl.y} className="stroke-rose-500" strokeWidth={tir ? 2.5 : 1.5} strokeOpacity={tir ? 1 : 0.7} />
      <polygon points={arrowHead(OX, OY, refl.x, refl.y)} className="fill-rose-500" fillOpacity={tir ? 1 : 0.7} />
      <path d={arcPath(ARC_R, 90 - thetaInc, 90)} fill="none" className="stroke-rose-600 dark:stroke-rose-400" strokeWidth={1} />

      {/* Refracted ray, or the TIR callout */}
      {refr ? (
        <>
          <line x1={OX} y1={OY} x2={refr.x} y2={refr.y} className="stroke-indigo-500" strokeWidth={2} />
          <polygon points={arrowHead(OX, OY, refr.x, refr.y)} className="fill-indigo-500" />
          <path d={arcPath(ARC_R, -90, thetaRefr! - 90)} fill="none" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth={1} />
          <text x={polar(ARC_R + 12, thetaRefr! / 2 - 90).x} y={polar(ARC_R + 12, thetaRefr! / 2 - 90).y + 3} fontSize={9} textAnchor="middle" className="fill-indigo-700 dark:fill-indigo-300">θ_r</text>
        </>
      ) : (
        <text x={OX + 60} y={OY + 40} fontSize={12} fontWeight={600} className="fill-rose-600 dark:fill-rose-300">全反射：無折射光</text>
      )}
    </svg>
  );
}

export function RefractionSim({ onBack, inline }: { onBack?: () => void; inline?: boolean }) {
  const [n1, setN1] = useState(1.5);           // glass on top by default so TIR is one drag away
  const [n2, setN2] = useState(1.0);
  const [thetaInc, setThetaInc] = useState(30);

  const { thetaRefr, thetaCrit, tir, reflRefrAngle } = computeRefraction({ n1, n2, thetaInc });

  return (
    <SimChrome
      title="折射與全反射模擬"
      subtitle="Snell's law · Ch33"
      onBack={onBack}
      inline={inline}
      canvas={<RefractionCanvas n1={n1} n2={n2} thetaInc={thetaInc} />}
      controls={
        <>
          <Slider label="上方介質 n₁" value={n1} min={1} max={2.5} step={0.01} onChange={setN1} />
          <Slider label="下方介質 n₂" value={n2} min={1} max={2.5} step={0.01} onChange={setN2} />
          <Slider label="入射角 θ_i" unit="°" value={thetaInc} min={0} max={89.5} step={0.5} onChange={setThetaInc} format={(v) => v.toFixed(1)} />
        </>
      }
      readouts={
        <>
          <Readout label="n₁ sin θ_i" value={(n1 * Math.sin(thetaInc * DEG)).toFixed(3)} />
          <Readout label="折射角 θ_r" value={thetaRefr === null ? "—" : thetaRefr.toFixed(2)} unit="°" />
          <Readout label="反射角" value={thetaInc.toFixed(2)} unit="°" />
          <Readout label="臨界角 θ_c" value={thetaCrit === null ? "無（n₁ ≤ n₂）" : thetaCrit.toFixed(2)} unit={thetaCrit === null ? undefined : "°"} />
          <Readout label="反射光與折射光夾角" value={reflRefrAngle === null ? "—" : reflRefrAngle.toFixed(1)} unit={reflRefrAngle === null ? undefined : "°"} />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="狀態" value={tir ? "全反射 (TIR)" : n1 < n2 ? "折射 · 偏向法線" : n1 > n2 ? "折射 · 偏離法線" : "不偏折"} emphasis />
        </>
      }
      notes={
        <>
          <p>
            司乃耳定律 <strong>n₁ sin θ_i = n₂ sin θ_r</strong>。從光密到光疏（n₁ &gt; n₂）時折射光偏離法線，
            θ_i 超過臨界角 θ_c = sin⁻¹(n₂/n₁) 就沒有折射光——這就是光纖與鑽石閃亮的原理。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>把 n₁ 調到 2.42（鑽石）看 θ_c 掉到 24°；或把 n₁ = n₂ 看光線直接穿過不偏折。
          </p>
        </>
      }
    />
  );
}
