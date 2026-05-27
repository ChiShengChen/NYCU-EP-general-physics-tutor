"use client";

import { useCallback, useState } from "react";
import { SimChrome, Slider, Readout, PlayControls } from "./sim-chrome";
import { useSimLoop } from "./use-sim-loop";

/**
 * Free-fall simulator with optional bounce.
 *
 * Physics — Euler-Cromer integration (symplectic, energy stable for the
 * 30–60s sessions a student plays with):
 *
 *   v ← v + a · dt          (a = -g for free fall, +mg/restitution at bounce)
 *   y ← y + v · dt
 *
 * Mass is fixed at 1 kg so KE / PE / total-E read directly as joules per
 * kilogram (numerically same), which keeps the slider count down without
 * hiding the formulas — m doesn't change the motion under gravity anyway.
 *
 * State lives in useState (not a ref) so the React-19 react-hooks/refs
 * rule doesn't fire on every read during render. The RAF loop calls
 * setState once per frame via an updater function, which React batches
 * into a single re-render per frame at 60 fps.
 */

const MAX_HEIGHT_M = 25;       // sim viewport tall enough to hold the slider range comfortably
const PIXELS_PER_M = 18;       // 25 m × 18 px ≈ 450 px of usable canvas
const VIEW_W = 380;
const VIEW_H = 480;
const GROUND_Y = VIEW_H - 20;  // 20 px ground strip
const BALL_RADIUS = 12;

interface State {
  y: number;     // m, above ground
  v: number;     // m/s, positive = up
  t: number;     // s elapsed
  maxY: number;  // bookkeeping for "peak this run"
  stopped: boolean;
}

function makeInitial(h0: number): State {
  return { y: h0, v: 0, t: 0, maxY: h0, stopped: false };
}

function step(prev: State, dt: number, g: number, e: number): State {
  if (prev.stopped) return prev;
  let v = prev.v - g * dt;
  let y = prev.y + v * dt;
  let stopped = false;
  if (y < 0) {
    // The ball crossed the ground this frame — reflect and reposition.
    y = 0;
    v = -v * e;
    // Below this energy the bounce is visually indistinguishable from
    // a rest — clamp so it settles in finite time.
    if (Math.abs(v) < 0.5) {
      v = 0;
      stopped = true;
    }
  }
  const maxY = y > prev.maxY ? y : prev.maxY;
  return { y, v, t: prev.t + dt, maxY, stopped };
}

function yToPx(yMeters: number): number {
  return GROUND_Y - yMeters * PIXELS_PER_M;
}

export function FreeFallSim({ onBack, inline }: { onBack?: () => void; inline?: boolean }) {
  const [h0, setH0] = useState(10);                              // initial height (m)
  const [g, setG] = useState(9.8);                               // gravity (m/s²)
  const [e, setE] = useState(0.7);                               // restitution (0–1)
  const [running, setRunning] = useState(false);
  const [s, setS] = useState<State>(() => makeInitial(10));

  const reset = useCallback(() => {
    setS(makeInitial(h0));
    setRunning(false);
  }, [h0]);

  // Slider changes for h0 reset the ball position when paused, so the
  // student sees the consequence of the new value immediately. Mid-flight
  // changes only affect the live simulation, not the resting position.
  const onH0Change = useCallback((v: number) => {
    setH0(v);
    if (!running) setS(makeInitial(v));
  }, [running]);

  useSimLoop(running && !s.stopped, (dt) => {
    setS((prev) => step(prev, dt, g, e));
  });

  const ke = 0.5 * s.v * s.v;
  const pe = g * s.y;
  const total = ke + pe;
  const speed = Math.abs(s.v);

  // Velocity-vector arrow: scale velocity to a max ~60px so it never
  // dwarfs the ball at high speeds. The +/- sign maps to up/down on screen.
  const arrowLen = Math.min(60, speed * 4);
  const arrowDir = s.v >= 0 ? -1 : 1; // SVG y grows downward
  const bx = VIEW_W / 2;
  const by = yToPx(s.y);

  return (
    <SimChrome
      title="自由落體模擬"
      subtitle="Free Fall · Ch02 / Ch04"
      onBack={onBack}
      inline={inline}
      canvas={
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full max-h-[70vh] max-w-md"
          aria-label="Free fall simulation canvas"
        >
          {/* Height gridlines every 5 m */}
          {Array.from({ length: Math.floor(MAX_HEIGHT_M / 5) + 1 }, (_, i) => {
            const ym = i * 5;
            const yp = yToPx(ym);
            return (
              <g key={ym} className="text-slate-300 dark:text-slate-700">
                <line x1={30} y1={yp} x2={VIEW_W - 10} y2={yp} stroke="currentColor" strokeDasharray="2 4" strokeWidth={0.8} />
                <text x={10} y={yp + 3} fontSize={9} fill="currentColor">{ym} m</text>
              </g>
            );
          })}

          {/* Ground */}
          <rect x={0} y={GROUND_Y} width={VIEW_W} height={VIEW_H - GROUND_Y} className="fill-emerald-200 dark:fill-emerald-900/40" />
          <line x1={0} y1={GROUND_Y} x2={VIEW_W} y2={GROUND_Y} className="stroke-emerald-700 dark:stroke-emerald-500" strokeWidth={1.5} />

          {/* Peak marker */}
          {s.maxY > 0.1 && (
            <g>
              <line x1={VIEW_W - 60} y1={yToPx(s.maxY)} x2={VIEW_W - 10} y2={yToPx(s.maxY)} className="stroke-rose-500" strokeWidth={1} strokeDasharray="4 2" />
              <text x={VIEW_W - 56} y={yToPx(s.maxY) - 4} fontSize={9} className="fill-rose-600 dark:fill-rose-300">peak {s.maxY.toFixed(1)} m</text>
            </g>
          )}

          {/* Velocity arrow */}
          {speed > 0.1 && (
            <g stroke="#6366f1" fill="#6366f1" strokeWidth={2}>
              <line x1={bx} y1={by} x2={bx} y2={by + arrowDir * arrowLen} />
              <polygon points={`${bx},${by + arrowDir * (arrowLen + 6)} ${bx - 4},${by + arrowDir * arrowLen} ${bx + 4},${by + arrowDir * arrowLen}`} />
              <text x={bx + 8} y={by + arrowDir * arrowLen / 2} fontSize={11} fill="#6366f1">v = {s.v.toFixed(1)} m/s</text>
            </g>
          )}

          {/* Ball */}
          <circle cx={bx} cy={by} r={BALL_RADIUS} className="fill-indigo-500 stroke-indigo-700 dark:stroke-indigo-300" strokeWidth={2} />
        </svg>
      }
      controls={
        <>
          <Slider label="初始高度 h₀" unit="m" value={h0} min={1} max={MAX_HEIGHT_M} step={0.5} onChange={onH0Change} />
          <Slider label="重力加速度 g" unit="m/s²" value={g} min={1.6} max={24.8} step={0.1} onChange={setG} />
          <Slider label="反彈係數 e" value={e} min={0} max={1} step={0.05} onChange={setE} />
          <PlayControls running={running} onToggle={() => setRunning((r) => !r)} onReset={reset} />
        </>
      }
      readouts={
        <>
          <Readout label="時間 t" value={s.t.toFixed(2)} unit="s" />
          <Readout label="高度 y" value={s.y.toFixed(2)} unit="m" />
          <Readout label="速度 v" value={s.v.toFixed(2)} unit="m/s" />
          <Readout label="速率 |v|" value={speed.toFixed(2)} unit="m/s" />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="動能 KE = ½mv²" value={ke.toFixed(2)} unit="J/kg" />
          <Readout label="位能 PE = mgy" value={pe.toFixed(2)} unit="J/kg" />
          <Readout label="總能 E" value={total.toFixed(2)} unit="J/kg" emphasis />
        </>
      }
      notes={
        <>
          <p>
            假設 m = 1 kg，所以能量單位以 J/kg 顯示（數值不變）。空氣阻力略過——
            如果你看到反彈漸漸變矮，那是反彈係數 e &lt; 1 在吸能；e = 1 時能量守恆。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>把 g 調成 1.6（月球）跟 24.8（木星）對比，相同 h₀ 落地速度差很大；
            或設 e = 0 看完全非彈性碰撞，能量瞬間消失。
          </p>
        </>
      }
    />
  );
}
