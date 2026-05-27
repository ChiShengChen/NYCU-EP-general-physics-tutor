"use client";

import { useCallback, useState } from "react";
import { SimChrome, Slider, Readout, PlayControls } from "./sim-chrome";
import { useSimLoop } from "./use-sim-loop";

/**
 * 1D collision between two carts on a frictionless track.
 *
 * Each cart slides at constant velocity until they touch (|x1 − x2| ≤
 * cart half-widths). At collision we apply the standard 1D impact law
 * for coefficient of restitution e ∈ [0, 1]:
 *
 *   v1' = (m1·v1 + m2·v2 + e·m2·(v2 − v1)) / (m1 + m2)
 *   v2' = (m1·v1 + m2·v2 + e·m1·(v1 − v2)) / (m1 + m2)
 *
 * e = 1 gives perfectly elastic (kinetic energy conserved), e = 0 gives
 * perfectly inelastic (carts stick together at the common centre-of-mass
 * velocity). Momentum is conserved at every e.
 *
 * After the impact we keep integrating so the student sees the two
 * outgoing velocities for a beat before the track edges absorb them.
 */

const VIEW_W = 480;
const VIEW_H = 220;
const TRACK_Y = 130;
const TRACK_LEFT = 20;
const TRACK_RIGHT = VIEW_W - 20;
const PIXELS_PER_M = 22;            // 1 m ≈ 22 px → fits ±10 m comfortably
const CART_HALF_M = 0.4;            // carts are 0.8 m wide

interface State {
  x1: number;     // m
  x2: number;
  v1: number;     // m/s
  v2: number;
  t: number;
  collided: boolean;
  preKE: number;
  postKE: number;
  preP: number;
  postP: number;
}

function makeInitial(x1: number, x2: number, v1: number, v2: number, m1: number, m2: number): State {
  const preKE = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
  const preP = m1 * v1 + m2 * v2;
  return {
    x1,
    x2,
    v1,
    v2,
    t: 0,
    collided: false,
    preKE,
    postKE: preKE,
    preP,
    postP: preP,
  };
}

function step(prev: State, dt: number, m1: number, m2: number, e: number): State {
  let x1 = prev.x1 + prev.v1 * dt;
  let x2 = prev.x2 + prev.v2 * dt;
  let v1 = prev.v1;
  let v2 = prev.v2;
  let collided = prev.collided;
  let postKE = prev.postKE;
  let postP = prev.postP;

  // Collision check: carts touching and approaching each other.
  const touching = Math.abs(x2 - x1) <= 2 * CART_HALF_M;
  const approaching = (x1 < x2 && v1 > v2) || (x1 > x2 && v1 < v2);
  if (!collided && touching && approaching) {
    // Resolve via the e-COR formulas.
    const totalM = m1 + m2;
    const pTotal = m1 * v1 + m2 * v2;
    const v1New = (pTotal + e * m2 * (v2 - v1)) / totalM;
    const v2New = (pTotal + e * m1 * (v1 - v2)) / totalM;
    v1 = v1New;
    v2 = v2New;
    collided = true;
    postKE = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
    postP = m1 * v1 + m2 * v2;
    // Nudge carts apart by an epsilon so the touching condition doesn't
    // immediately re-trigger from the same frame.
    const sep = 2 * CART_HALF_M + 0.001;
    const mid = (x1 + x2) / 2;
    if (x1 < x2) {
      x1 = mid - sep / 2;
      x2 = mid + sep / 2;
    } else {
      x1 = mid + sep / 2;
      x2 = mid - sep / 2;
    }
  }

  return { ...prev, x1, x2, v1, v2, t: prev.t + dt, collided, postKE, postP };
}

function toPxX(xMeters: number): number {
  return VIEW_W / 2 + xMeters * PIXELS_PER_M;
}

export function CollisionSim({ onBack, inline }: { onBack?: () => void; inline?: boolean }) {
  const [m1, setM1] = useState(1);              // kg
  const [m2, setM2] = useState(2);              // kg
  const [v1Init, setV1Init] = useState(4);      // m/s
  const [v2Init, setV2Init] = useState(-2);     // m/s
  const [e, setE] = useState(1);                // coefficient of restitution
  const [running, setRunning] = useState(false);
  const [s, setS] = useState<State>(() => makeInitial(-4, 4, 4, -2, 1, 2));

  const reset = useCallback(() => {
    setS(makeInitial(-4, 4, v1Init, v2Init, m1, m2));
    setRunning(false);
  }, [v1Init, v2Init, m1, m2]);

  // Mass and initial-velocity sliders reset positions when paused so the
  // change is immediately legible.
  const onMassChange = useCallback((which: 1 | 2, v: number) => {
    if (which === 1) setM1(v); else setM2(v);
    if (!running) setS(makeInitial(-4, 4, v1Init, v2Init, which === 1 ? v : m1, which === 2 ? v : m2));
  }, [running, v1Init, v2Init, m1, m2]);

  const onV1Change = useCallback((v: number) => {
    setV1Init(v);
    if (!running) setS(makeInitial(-4, 4, v, v2Init, m1, m2));
  }, [running, v2Init, m1, m2]);

  const onV2Change = useCallback((v: number) => {
    setV2Init(v);
    if (!running) setS(makeInitial(-4, 4, v1Init, v, m1, m2));
  }, [running, v1Init, m1, m2]);

  // Auto-pause integration once carts leave the visible track. We stop
  // by gating the RAF loop on a derived bounds check rather than calling
  // setRunning during render — that keeps the play/reset buttons
  // responsive and avoids a setState-in-render lint hit.
  const inBounds = Math.abs(s.x1) <= 10 && Math.abs(s.x2) <= 10;
  useSimLoop(running && inBounds, (dt) => {
    setS((prev) => step(prev, dt, m1, m2, e));
  });

  const energyLost = s.preKE - s.postKE;
  const energyLostPct = s.preKE > 0 ? (energyLost / s.preKE) * 100 : 0;
  const momentumConserved = Math.abs(s.postP - s.preP) < 1e-6;

  // Cart-width in px (independent of which cart, since we let m scale the
  // visual cart height only).
  const cartWPx = 2 * CART_HALF_M * PIXELS_PER_M;
  const cart1HPx = 28 + m1 * 4;
  const cart2HPx = 28 + m2 * 4;

  return (
    <SimChrome
      title="1D 碰撞模擬"
      subtitle="1D Collision · Ch08"
      onBack={onBack}
      inline={inline}
      canvas={
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full max-h-[55vh] max-w-3xl"
          aria-label="1D collision simulation canvas"
        >
          {/* Track */}
          <line x1={TRACK_LEFT} y1={TRACK_Y} x2={TRACK_RIGHT} y2={TRACK_Y} className="stroke-slate-500 dark:stroke-slate-400" strokeWidth={2} />
          {Array.from({ length: 21 }, (_, i) => {
            const m = i - 10;
            const x = toPxX(m);
            if (x < TRACK_LEFT || x > TRACK_RIGHT) return null;
            return (
              <g key={m}>
                <line x1={x} y1={TRACK_Y} x2={x} y2={TRACK_Y + 4} className="stroke-slate-400 dark:stroke-slate-500" />
                {m % 2 === 0 && <text x={x} y={TRACK_Y + 16} fontSize={9} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400">{m}</text>}
              </g>
            );
          })}

          {/* Cart 1 (left, indigo) */}
          <g>
            <rect
              x={toPxX(s.x1) - cartWPx / 2}
              y={TRACK_Y - cart1HPx}
              width={cartWPx}
              height={cart1HPx}
              rx={3}
              className="fill-indigo-500 stroke-indigo-700 dark:stroke-indigo-300"
              strokeWidth={2}
            />
            <text x={toPxX(s.x1)} y={TRACK_Y - cart1HPx / 2 + 4} fontSize={11} textAnchor="middle" fill="#fff">m₁ = {m1}</text>
            <text x={toPxX(s.x1)} y={TRACK_Y - cart1HPx - 6} fontSize={10} textAnchor="middle" className="fill-indigo-700 dark:fill-indigo-300">v₁ = {s.v1.toFixed(2)}</text>
            {/* Velocity arrow */}
            {Math.abs(s.v1) > 0.1 && (
              <g stroke="#6366f1" fill="#6366f1" strokeWidth={2}>
                <line x1={toPxX(s.x1)} y1={TRACK_Y - cart1HPx / 2} x2={toPxX(s.x1) + Math.sign(s.v1) * 20} y2={TRACK_Y - cart1HPx / 2} />
                <polygon points={`${toPxX(s.x1) + Math.sign(s.v1) * 26},${TRACK_Y - cart1HPx / 2} ${toPxX(s.x1) + Math.sign(s.v1) * 20},${TRACK_Y - cart1HPx / 2 - 3} ${toPxX(s.x1) + Math.sign(s.v1) * 20},${TRACK_Y - cart1HPx / 2 + 3}`} />
              </g>
            )}
          </g>

          {/* Cart 2 (right, rose) */}
          <g>
            <rect
              x={toPxX(s.x2) - cartWPx / 2}
              y={TRACK_Y - cart2HPx}
              width={cartWPx}
              height={cart2HPx}
              rx={3}
              className="fill-rose-500 stroke-rose-700 dark:stroke-rose-300"
              strokeWidth={2}
            />
            <text x={toPxX(s.x2)} y={TRACK_Y - cart2HPx / 2 + 4} fontSize={11} textAnchor="middle" fill="#fff">m₂ = {m2}</text>
            <text x={toPxX(s.x2)} y={TRACK_Y - cart2HPx - 6} fontSize={10} textAnchor="middle" className="fill-rose-700 dark:fill-rose-300">v₂ = {s.v2.toFixed(2)}</text>
            {Math.abs(s.v2) > 0.1 && (
              <g stroke="#f43f5e" fill="#f43f5e" strokeWidth={2}>
                <line x1={toPxX(s.x2)} y1={TRACK_Y - cart2HPx / 2} x2={toPxX(s.x2) + Math.sign(s.v2) * 20} y2={TRACK_Y - cart2HPx / 2} />
                <polygon points={`${toPxX(s.x2) + Math.sign(s.v2) * 26},${TRACK_Y - cart2HPx / 2} ${toPxX(s.x2) + Math.sign(s.v2) * 20},${TRACK_Y - cart2HPx / 2 - 3} ${toPxX(s.x2) + Math.sign(s.v2) * 20},${TRACK_Y - cart2HPx / 2 + 3}`} />
              </g>
            )}
          </g>

          {s.collided && (
            <text x={VIEW_W / 2} y={30} fontSize={11} textAnchor="middle" className="fill-amber-700 dark:fill-amber-300">已發生碰撞 · e = {e.toFixed(2)}</text>
          )}
        </svg>
      }
      controls={
        <>
          <Slider label="質量 m₁" unit="kg" value={m1} min={0.5} max={5} step={0.1} onChange={(v) => onMassChange(1, v)} />
          <Slider label="質量 m₂" unit="kg" value={m2} min={0.5} max={5} step={0.1} onChange={(v) => onMassChange(2, v)} />
          <Slider label="初速 v₁" unit="m/s" value={v1Init} min={-5} max={5} step={0.1} onChange={onV1Change} />
          <Slider label="初速 v₂" unit="m/s" value={v2Init} min={-5} max={5} step={0.1} onChange={onV2Change} />
          <Slider label="恢復係數 e" value={e} min={0} max={1} step={0.05} onChange={setE} />
          <PlayControls running={running} onToggle={() => setRunning((r) => !r)} onReset={reset} />
        </>
      }
      readouts={
        <>
          <Readout label="時間 t" value={s.t.toFixed(2)} unit="s" />
          <Readout label="狀態" value={s.collided ? "碰撞後" : "碰撞前"} emphasis />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="動量 p (碰前)" value={s.preP.toFixed(2)} unit="kg·m/s" />
          <Readout label="動量 p (碰後)" value={s.postP.toFixed(2)} unit="kg·m/s" />
          <Readout label={momentumConserved ? "✓ 動量守恆" : "⚠ 動量未守恆"} value={(s.postP - s.preP).toFixed(3)} />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="動能 (碰前)" value={s.preKE.toFixed(2)} unit="J" />
          <Readout label="動能 (碰後)" value={s.postKE.toFixed(2)} unit="J" />
          <Readout label="動能損失" value={`${energyLost.toFixed(2)} (${energyLostPct.toFixed(0)}%)`} unit="J" emphasis />
        </>
      }
      notes={
        <>
          <p>
            動量在任何 e 下都守恆——這是因為碰撞時間極短、外力不可能在此尺度上改變總動量。
            動能只在 <strong>e = 1</strong>（完全彈性）時守恆；<strong>e = 0</strong> 時最多，兩車黏在一起。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>m₁ = m₂、v₂ = 0、e = 1：你會看到「動量完全傳遞」——撞擊球同款。
          </p>
        </>
      }
    />
  );
}
