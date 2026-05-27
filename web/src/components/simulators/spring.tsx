"use client";

import { useCallback, useState } from "react";
import { SimChrome, Slider, Readout, PlayControls } from "./sim-chrome";
import { useSimLoop } from "./use-sim-loop";

/**
 * Damped spring / SHM simulator.
 *
 * Equation of motion (vertical spring, ignoring gravity — we work in
 * displacement from equilibrium so the static-stretch term cancels out):
 *
 *   m · ẍ = −k · x − c · ẋ
 *
 * Numerically integrated with Euler-Cromer, like the free-fall sim.
 * For the (k, m, c) ranges exposed below the system is over-resolved at
 * 60 fps so we don't need RK4.
 *
 * Three regimes the student should see by playing with damping `c`:
 *   - underdamped  (ζ < 1):  oscillates with shrinking amplitude
 *   - critically   (ζ = 1):  returns to equilibrium fastest, no overshoot
 *   - overdamped   (ζ > 1):  returns slowly without overshoot
 *
 * ζ = c / (2 · √(mk)) is shown live in the readouts so the regime swap is
 * legible without having to compute it mentally.
 */

const VIEW_W = 320;
const VIEW_H = 480;
const ANCHOR_Y = 40;
const EQUILIBRIUM_Y = VIEW_H / 2;
const PIXELS_PER_M = 100;       // displacement is small (max ~1.5 m) so we scale up

interface State {
  x: number;     // m, displacement from equilibrium, positive = below equilibrium
  v: number;     // m/s, positive = moving down
  t: number;
}

function makeInitial(x0: number): State {
  return { x: x0, v: 0, t: 0 };
}

function step(prev: State, dt: number, m: number, k: number, c: number): State {
  const a = (-k * prev.x - c * prev.v) / m;
  const v = prev.v + a * dt;
  const x = prev.x + v * dt;
  return { x, v, t: prev.t + dt };
}

/** Render a hand-drawn spring as a zigzag polyline from (x1, y1) to (x2, y2). */
function springPath(y1: number, y2: number, x: number, coils = 14, width = 18): string {
  const dy = (y2 - y1) / coils;
  const pts: string[] = [`${x},${y1}`];
  for (let i = 0; i < coils; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    pts.push(`${x + side * width},${y1 + dy * (i + 0.5)}`);
  }
  pts.push(`${x},${y2}`);
  return pts.join(" ");
}

export function SpringSim({ onBack }: { onBack?: () => void }) {
  const [m, setM] = useState(1);              // mass (kg)
  const [k, setK] = useState(20);             // spring constant (N/m)
  const [c, setC] = useState(0.5);            // damping (kg/s)
  const [x0, setX0] = useState(0.6);          // initial displacement (m)
  const [running, setRunning] = useState(false);
  const [s, setS] = useState<State>(() => makeInitial(0.6));

  const reset = useCallback(() => {
    setS(makeInitial(x0));
    setRunning(false);
  }, [x0]);

  const onX0Change = useCallback((v: number) => {
    setX0(v);
    if (!running) setS(makeInitial(v));
  }, [running]);

  useSimLoop(running, (dt) => {
    setS((prev) => step(prev, dt, m, k, c));
  });

  const omega0 = Math.sqrt(k / m);
  const period = (2 * Math.PI) / omega0;
  const zeta = c / (2 * Math.sqrt(m * k));
  const ke = 0.5 * m * s.v * s.v;
  const pe = 0.5 * k * s.x * s.x;
  const total = ke + pe;

  const regime =
    zeta < 0.98 ? "underdamped 欠阻尼" :
    zeta > 1.02 ? "overdamped 過阻尼" :
    "critical 臨界阻尼";

  const massY = EQUILIBRIUM_Y + s.x * PIXELS_PER_M;
  const massCenterX = VIEW_W / 2;
  const massSize = 36;
  const arrowLen = Math.min(60, Math.abs(s.v) * 12);
  const arrowDir = s.v >= 0 ? 1 : -1;

  return (
    <SimChrome
      title="彈簧 / 簡諧運動模擬"
      subtitle="SHM · Ch13"
      onBack={onBack}
      canvas={
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full max-h-[70vh] max-w-md"
          aria-label="Spring SHM simulation canvas"
        >
          {/* Wall / anchor */}
          <line x1={20} y1={ANCHOR_Y} x2={VIEW_W - 20} y2={ANCHOR_Y} className="stroke-slate-500 dark:stroke-slate-400" strokeWidth={2} />
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={i}
              x1={20 + i * ((VIEW_W - 40) / 12)}
              y1={ANCHOR_Y}
              x2={20 + i * ((VIEW_W - 40) / 12) + 10}
              y2={ANCHOR_Y - 10}
              className="stroke-slate-500 dark:stroke-slate-400"
              strokeWidth={1}
            />
          ))}

          {/* Equilibrium line */}
          <line x1={40} y1={EQUILIBRIUM_Y} x2={VIEW_W - 40} y2={EQUILIBRIUM_Y} className="stroke-slate-400 dark:stroke-slate-600" strokeWidth={0.8} strokeDasharray="4 4" />
          <text x={VIEW_W - 38} y={EQUILIBRIUM_Y + 3} fontSize={9} className="fill-slate-500 dark:fill-slate-400">x = 0</text>

          {/* Spring */}
          <polyline
            points={springPath(ANCHOR_Y, massY - massSize / 2, massCenterX)}
            fill="none"
            className="stroke-amber-600 dark:stroke-amber-400"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Velocity arrow */}
          {Math.abs(s.v) > 0.05 && (
            <g stroke="#6366f1" fill="#6366f1" strokeWidth={2}>
              <line x1={massCenterX + 40} y1={massY} x2={massCenterX + 40} y2={massY + arrowDir * arrowLen} />
              <polygon points={`${massCenterX + 40},${massY + arrowDir * (arrowLen + 6)} ${massCenterX + 36},${massY + arrowDir * arrowLen} ${massCenterX + 44},${massY + arrowDir * arrowLen}`} />
            </g>
          )}

          {/* Mass */}
          <rect
            x={massCenterX - massSize / 2}
            y={massY - massSize / 2}
            width={massSize}
            height={massSize}
            rx={4}
            className="fill-indigo-500 stroke-indigo-700 dark:stroke-indigo-300"
            strokeWidth={2}
          />
          <text x={massCenterX} y={massY + 4} fontSize={11} textAnchor="middle" fill="#fff">m</text>
        </svg>
      }
      controls={
        <>
          <Slider label="質量 m" unit="kg" value={m} min={0.2} max={5} step={0.1} onChange={setM} />
          <Slider label="彈簧常數 k" unit="N/m" value={k} min={2} max={80} step={1} onChange={setK} />
          <Slider label="阻尼 c" unit="kg/s" value={c} min={0} max={10} step={0.1} onChange={setC} />
          <Slider label="初始位移 x₀" unit="m" value={x0} min={-1.5} max={1.5} step={0.05} onChange={onX0Change} />
          <PlayControls running={running} onToggle={() => setRunning((r) => !r)} onReset={reset} />
        </>
      }
      readouts={
        <>
          <Readout label="時間 t" value={s.t.toFixed(2)} unit="s" />
          <Readout label="位移 x" value={s.x.toFixed(3)} unit="m" />
          <Readout label="速度 v" value={s.v.toFixed(3)} unit="m/s" />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="角頻率 ω₀ = √(k/m)" value={omega0.toFixed(2)} unit="rad/s" />
          <Readout label="週期 T = 2π/ω₀" value={period.toFixed(2)} unit="s" />
          <Readout label="阻尼比 ζ" value={zeta.toFixed(3)} emphasis />
          <Readout label="" value={regime} />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="動能 KE" value={ke.toFixed(3)} unit="J" />
          <Readout label="彈性位能 ½kx²" value={pe.toFixed(3)} unit="J" />
          <Readout label="總能 E" value={total.toFixed(3)} unit="J" emphasis />
        </>
      }
      notes={
        <>
          <p>
            垂直擺一個方便視覺化，但式子裡看不見重力——因為 x 是「相對於力平衡位置」的位移，
            mg 跟靜止時的拉伸 k·x_eq 抵消掉。
          </p>
          <p className="mt-2">
            <strong>三個阻尼區域：</strong>把 c 從 0 拉到 10，會經過欠阻尼（震盪衰減）→
            臨界阻尼（最快歸位、無 overshoot）→ 過阻尼（緩慢歸位）。
          </p>
        </>
      }
    />
  );
}
