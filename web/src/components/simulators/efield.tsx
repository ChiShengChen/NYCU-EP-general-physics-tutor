"use client";

import { useState } from "react";
import { SimChrome, Slider, Readout } from "./sim-chrome";

/**
 * Two point charges + a vector grid + a test point.
 *
 * We work in arbitrary units (Coulomb's constant absorbed into the
 * charge magnitude) — the focus here is the *shape* of the field, not
 * numerical SI values. At every grid point the contribution from each
 * charge is summed:
 *
 *   E = Σ_i  q_i · (r − r_i) / |r − r_i|³
 *
 * Arrows are normalized to a fixed pixel length (so the shape stays
 * legible near the charges where |E| would otherwise saturate), with a
 * brightness ramp keyed to log(|E|) so the relative strength is still
 * communicated.
 *
 * Drawing real "field lines" (streamlines that trace ∫ dr along E)
 * would be a much bigger lift; the dense direction-arrow grid here
 * conveys the same intuition for the intro-physics audience.
 */

const VIEW_W = 480;
const VIEW_H = 320;
const GRID_NX = 18;
const GRID_NY = 12;
const ARROW_LEN_PX = 14;

interface Charge {
  q: number;     // arbitrary units, [-3, 3]
  x: number;     // grid units
  y: number;
}

function fieldAt(rx: number, ry: number, charges: Charge[]): { ex: number; ey: number; mag: number } {
  let ex = 0;
  let ey = 0;
  for (const c of charges) {
    const dx = rx - c.x;
    const dy = ry - c.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 0.01) continue;  // avoid singularity at the charge itself
    const r3 = Math.pow(r2, 1.5);
    ex += (c.q * dx) / r3;
    ey += (c.q * dy) / r3;
  }
  const mag = Math.hypot(ex, ey);
  return { ex, ey, mag };
}

function toPxX(x: number): number {
  return VIEW_W / 2 + x * 20;
}
function toPxY(y: number): number {
  return VIEW_H / 2 - y * 20;
}

export function EFieldSim({ onBack, inline }: { onBack?: () => void; inline?: boolean }) {
  const [q1, setQ1] = useState(1);
  const [q2, setQ2] = useState(-1);
  const [x1, setX1] = useState(-3);
  const [x2, setX2] = useState(3);
  const [testX, setTestX] = useState(0);
  const [testY, setTestY] = useState(2);

  const charges: Charge[] = [
    { q: q1, x: x1, y: 0 },
    { q: q2, x: x2, y: 0 },
  ];

  // Vector grid arrows
  const arrows: { x: number; y: number; dx: number; dy: number; mag: number }[] = [];
  for (let ix = 0; ix < GRID_NX; ix++) {
    for (let iy = 0; iy < GRID_NY; iy++) {
      const gx = (ix + 0.5) / GRID_NX * (VIEW_W - 40) + 20;
      const gy = (iy + 0.5) / GRID_NY * (VIEW_H - 40) + 20;
      // Convert pixel position back to grid units for field evaluation.
      const rx = (gx - VIEW_W / 2) / 20;
      const ry = (VIEW_H / 2 - gy) / 20;
      const { ex, ey, mag } = fieldAt(rx, ry, charges);
      if (mag === 0) continue;
      // Normalize direction; arrow length is fixed pixel size.
      const dxN = ex / mag;
      const dyN = -ey / mag;  // SVG y grows downward
      arrows.push({ x: gx, y: gy, dx: dxN, dy: dyN, mag });
    }
  }

  // Test-point field
  const testField = fieldAt(testX, testY, charges);
  const testPx = { x: toPxX(testX), y: toPxY(testY) };
  const testArrowScale = Math.min(60, Math.log10(testField.mag + 1) * 30 + 6);
  const testArrowEnd = {
    x: testPx.x + (testField.mag > 0 ? (testField.ex / testField.mag) * testArrowScale : 0),
    y: testPx.y - (testField.mag > 0 ? (testField.ey / testField.mag) * testArrowScale : 0),
  };

  const chargeColor = (q: number) =>
    q > 0 ? "fill-rose-500 stroke-rose-700 dark:stroke-rose-300" :
    q < 0 ? "fill-sky-500 stroke-sky-700 dark:stroke-sky-300" :
    "fill-slate-400 stroke-slate-600";

  // Magnitude-based opacity ramp for grid arrows, capped so the densest
  // arrows aren't fully opaque.
  const arrowOpacity = (mag: number) => Math.min(0.85, 0.15 + Math.log10(mag + 1) * 0.4);

  return (
    <SimChrome
      title="電場線（向量場）模擬"
      subtitle="Electric field · Ch21"
      onBack={onBack}
      inline={inline}
      canvas={
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full max-h-[55vh] max-w-3xl"
          aria-label="Electric field simulation canvas"
        >
          {/* Bounding box for orientation */}
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="none" className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />

          {/* Vector grid */}
          {arrows.map((a, i) => (
            <g key={i} className="stroke-indigo-500 dark:stroke-indigo-300" strokeWidth={1.2} opacity={arrowOpacity(a.mag)}>
              <line x1={a.x} y1={a.y} x2={a.x + a.dx * ARROW_LEN_PX} y2={a.y + a.dy * ARROW_LEN_PX} />
              <polygon
                points={`${a.x + a.dx * ARROW_LEN_PX},${a.y + a.dy * ARROW_LEN_PX} ${a.x + a.dx * (ARROW_LEN_PX - 4) - a.dy * 2.5},${a.y + a.dy * (ARROW_LEN_PX - 4) + a.dx * 2.5} ${a.x + a.dx * (ARROW_LEN_PX - 4) + a.dy * 2.5},${a.y + a.dy * (ARROW_LEN_PX - 4) - a.dx * 2.5}`}
                fill="currentColor"
                stroke="none"
              />
            </g>
          ))}

          {/* Charges */}
          {charges.map((c, i) => {
            const px = { x: toPxX(c.x), y: toPxY(c.y) };
            const radius = 8 + Math.abs(c.q) * 3;
            return (
              <g key={i}>
                <circle cx={px.x} cy={px.y} r={radius} className={chargeColor(c.q)} strokeWidth={2} />
                <text x={px.x} y={px.y + 4} fontSize={11} textAnchor="middle" fill="#fff">
                  {c.q > 0 ? `+${c.q.toFixed(1)}` : c.q.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Test point */}
          <g>
            <circle cx={testPx.x} cy={testPx.y} r={5} className="fill-amber-500 stroke-amber-700 dark:stroke-amber-300" strokeWidth={2} />
            {testField.mag > 1e-4 && (
              <g stroke="#f59e0b" fill="#f59e0b" strokeWidth={2}>
                <line x1={testPx.x} y1={testPx.y} x2={testArrowEnd.x} y2={testArrowEnd.y} />
                <polygon
                  points={`${testArrowEnd.x},${testArrowEnd.y} ${testArrowEnd.x - (testField.ex / testField.mag) * 6 - (-testField.ey / testField.mag) * 3},${testArrowEnd.y + (testField.ey / testField.mag) * 6 - (testField.ex / testField.mag) * 3} ${testArrowEnd.x - (testField.ex / testField.mag) * 6 + (-testField.ey / testField.mag) * 3},${testArrowEnd.y + (testField.ey / testField.mag) * 6 + (testField.ex / testField.mag) * 3}`}
                />
              </g>
            )}
            <text x={testPx.x + 8} y={testPx.y - 8} fontSize={10} className="fill-amber-700 dark:fill-amber-300">P</text>
          </g>
        </svg>
      }
      controls={
        <>
          <Slider label="電荷 q₁" value={q1} min={-3} max={3} step={0.1} onChange={setQ1} />
          <Slider label="q₁ x 位置" value={x1} min={-7} max={7} step={0.1} onChange={setX1} />
          <Slider label="電荷 q₂" value={q2} min={-3} max={3} step={0.1} onChange={setQ2} />
          <Slider label="q₂ x 位置" value={x2} min={-7} max={7} step={0.1} onChange={setX2} />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
          <Slider label="測試點 P x" value={testX} min={-7} max={7} step={0.1} onChange={setTestX} />
          <Slider label="測試點 P y" value={testY} min={-5} max={5} step={0.1} onChange={setTestY} />
        </>
      }
      readouts={
        <>
          <Readout label="E_x 在 P" value={testField.ex.toFixed(3)} />
          <Readout label="E_y 在 P" value={testField.ey.toFixed(3)} />
          <Readout label="|E| 在 P" value={testField.mag.toFixed(3)} emphasis />
          <Readout label="方向" value={`${(Math.atan2(testField.ey, testField.ex) * 180 / Math.PI).toFixed(0)}°`} />
        </>
      }
      notes={
        <>
          <p>
            單位是任意的（k_e 已吸收進電荷）——重點看<strong>方向圖案</strong>。
            電場永遠從 + 電荷出發、指向 − 電荷；力對正測試點 F = qE，方向相同；對負則相反。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>q₁ = q₂ = +1 → 推開彼此的對稱場；q₁ = +1, q₂ = −1 → 偶極場；
            兩同號電荷中點處 E = 0（鞍點）。
          </p>
        </>
      }
    />
  );
}
