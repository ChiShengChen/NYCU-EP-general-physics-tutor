"use client";

import { useCallback, useState } from "react";
import { SimChrome, Slider, Readout, PlayControls } from "./sim-chrome";
import { useSimLoop } from "./use-sim-loop";

/**
 * Projectile motion with optional linear air drag.
 *
 * EOM (mass = 1 kg, so velocity drag coefficient k is in 1/s):
 *
 *   ẍ = −k · ẋ
 *   ÿ = −g − k · ẏ
 *
 * Without drag (k = 0) you get parabolic motion and optimal angle 45° for
 * range. Crank drag up to a few × 10⁻¹ s⁻¹ and the optimum drops to
 * ~30–40°; that's the headline "why does this matter" finding the sim
 * lets the student discover.
 *
 * Trajectory is sampled every frame and we keep the last N points so a
 * fading trail is drawn behind the projectile. Range / peak height /
 * flight time are latched when the projectile crosses y = 0 going down,
 * so the readouts are useful after the motion completes too.
 */

const VIEW_W = 480;
const VIEW_H = 320;
const GROUND_Y = VIEW_H - 24;
const ORIGIN_X = 40;
const PIXELS_PER_M = 6;
const MAX_TRAIL_POINTS = 240;

interface State {
  x: number;     // m
  y: number;     // m
  vx: number;    // m/s
  vy: number;    // m/s
  t: number;     // s
  trail: { x: number; y: number }[];
  landed: boolean;
  range: number;       // m — finalised on landing
  peakY: number;       // m
  flightTime: number;  // s — finalised on landing
}

function makeInitial(speed: number, angleDeg: number): State {
  const theta = (angleDeg * Math.PI) / 180;
  return {
    x: 0,
    y: 0,
    vx: speed * Math.cos(theta),
    vy: speed * Math.sin(theta),
    t: 0,
    trail: [{ x: 0, y: 0 }],
    landed: false,
    range: 0,
    peakY: 0,
    flightTime: 0,
  };
}

function step(prev: State, dt: number, g: number, k: number): State {
  if (prev.landed) return prev;
  const ax = -k * prev.vx;
  const ay = -g - k * prev.vy;
  const vx = prev.vx + ax * dt;
  const vy = prev.vy + ay * dt;
  let x = prev.x + vx * dt;
  let y = prev.y + vy * dt;
  let landed = false;
  let range = prev.range;
  let flightTime = prev.flightTime;
  if (y < 0 && prev.y >= 0) {
    // Linearly interpolate the landing time within this step so we don't
    // overshoot when dt happens to be coarse.
    const frac = prev.y / (prev.y - y);
    x = prev.x + (x - prev.x) * frac;
    y = 0;
    landed = true;
    range = x;
    flightTime = prev.t + dt * frac;
  }
  const trail = prev.trail.length >= MAX_TRAIL_POINTS
    ? [...prev.trail.slice(1), { x, y }]
    : [...prev.trail, { x, y }];
  return {
    x,
    y,
    vx,
    vy,
    t: prev.t + dt,
    trail,
    landed,
    range,
    peakY: Math.max(prev.peakY, y),
    flightTime,
  };
}

function toPx(xMeters: number, yMeters: number): { x: number; y: number } {
  return {
    x: ORIGIN_X + xMeters * PIXELS_PER_M,
    y: GROUND_Y - yMeters * PIXELS_PER_M,
  };
}

export function ProjectileSim({ onBack, inline }: { onBack?: () => void; inline?: boolean }) {
  const [speed, setSpeed] = useState(25);          // m/s
  const [angleDeg, setAngleDeg] = useState(45);    // degrees
  const [g, setG] = useState(9.8);                 // m/s²
  const [drag, setDrag] = useState(0);             // 1/s (k)
  const [running, setRunning] = useState(false);
  const [s, setS] = useState<State>(() => makeInitial(25, 45));

  const reset = useCallback(() => {
    setS(makeInitial(speed, angleDeg));
    setRunning(false);
  }, [speed, angleDeg]);

  const onSpeedChange = useCallback((v: number) => {
    setSpeed(v);
    if (!running) setS(makeInitial(v, angleDeg));
  }, [running, angleDeg]);

  const onAngleChange = useCallback((v: number) => {
    setAngleDeg(v);
    if (!running) setS(makeInitial(speed, v));
  }, [running, speed]);

  useSimLoop(running && !s.landed, (dt) => {
    setS((prev) => step(prev, dt, g, drag));
  });

  // Initial-velocity vector arrow at the origin, scaled visually so the
  // 25 m/s default fits the viewport.
  const theta = (angleDeg * Math.PI) / 180;
  const arrowDxM = Math.cos(theta) * speed * 0.3;
  const arrowDyM = Math.sin(theta) * speed * 0.3;
  const origin = toPx(0, 0);
  const arrowEnd = toPx(arrowDxM, arrowDyM);

  const projPx = toPx(s.x, s.y);
  const speedNow = Math.hypot(s.vx, s.vy);
  const rangeFinal = s.landed ? s.range : s.x;
  const flightFinal = s.landed ? s.flightTime : s.t;

  return (
    <SimChrome
      title="拋體運動模擬"
      subtitle="Projectile · Ch03"
      onBack={onBack}
      inline={inline}
      canvas={
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full max-h-[60vh] max-w-3xl"
          aria-label="Projectile motion simulation canvas"
        >
          {/* Ground */}
          <rect x={0} y={GROUND_Y} width={VIEW_W} height={VIEW_H - GROUND_Y} className="fill-emerald-200 dark:fill-emerald-900/40" />
          <line x1={0} y1={GROUND_Y} x2={VIEW_W} y2={GROUND_Y} className="stroke-emerald-700 dark:stroke-emerald-500" strokeWidth={1.5} />

          {/* X-axis tick marks every 10 m */}
          {Array.from({ length: Math.floor((VIEW_W - ORIGIN_X) / (10 * PIXELS_PER_M)) + 1 }, (_, i) => {
            const m = i * 10;
            const x = ORIGIN_X + m * PIXELS_PER_M;
            if (x > VIEW_W - 10) return null;
            return (
              <g key={m}>
                <line x1={x} y1={GROUND_Y} x2={x} y2={GROUND_Y + 4} className="stroke-emerald-700 dark:stroke-emerald-500" />
                <text x={x} y={GROUND_Y + 16} fontSize={9} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400">{m}</text>
              </g>
            );
          })}

          {/* Trail */}
          {s.trail.length > 1 && (
            <polyline
              points={s.trail.map((p) => {
                const px = toPx(p.x, p.y);
                return `${px.x.toFixed(1)},${px.y.toFixed(1)}`;
              }).join(" ")}
              fill="none"
              className="stroke-indigo-400 dark:stroke-indigo-500"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          )}

          {/* Initial-velocity arrow (only before launch / during early flight) */}
          {s.t < 0.5 && (
            <g stroke="#6366f1" fill="#6366f1" strokeWidth={2}>
              <line x1={origin.x} y1={origin.y} x2={arrowEnd.x} y2={arrowEnd.y} />
              <polygon
                points={`${arrowEnd.x},${arrowEnd.y} ${arrowEnd.x - 6},${arrowEnd.y + 3} ${arrowEnd.x - 3},${arrowEnd.y + 6}`}
                transform={`rotate(${(angleDeg + 90) * -1}, ${arrowEnd.x}, ${arrowEnd.y})`}
              />
              <text x={arrowEnd.x + 6} y={arrowEnd.y - 6} fontSize={10} fill="#6366f1">{speed} m/s, {angleDeg}°</text>
            </g>
          )}

          {/* Range marker */}
          {s.landed && (
            <g>
              <line x1={origin.x} y1={GROUND_Y - 4} x2={origin.x + s.range * PIXELS_PER_M} y2={GROUND_Y - 4} className="stroke-rose-500" strokeWidth={1} strokeDasharray="4 2" />
              <text x={origin.x + (s.range * PIXELS_PER_M) / 2} y={GROUND_Y - 8} fontSize={10} textAnchor="middle" className="fill-rose-600 dark:fill-rose-300">range {s.range.toFixed(1)} m</text>
            </g>
          )}

          {/* Projectile */}
          <circle cx={projPx.x} cy={projPx.y} r={6} className="fill-indigo-500 stroke-indigo-700 dark:stroke-indigo-300" strokeWidth={2} />
        </svg>
      }
      controls={
        <>
          <Slider label="初速 v₀" unit="m/s" value={speed} min={5} max={60} step={1} onChange={onSpeedChange} />
          <Slider label="發射角 θ" unit="°" value={angleDeg} min={5} max={85} step={1} onChange={onAngleChange} />
          <Slider label="重力加速度 g" unit="m/s²" value={g} min={1.6} max={24.8} step={0.1} onChange={setG} />
          <Slider label="空氣阻力係數 k" unit="1/s" value={drag} min={0} max={0.5} step={0.01} onChange={setDrag} />
          <PlayControls running={running} onToggle={() => setRunning((r) => !r)} onReset={reset} />
        </>
      }
      readouts={
        <>
          <Readout label="時間 t" value={flightFinal.toFixed(2)} unit="s" />
          <Readout label="位置 (x, y)" value={`(${s.x.toFixed(1)}, ${s.y.toFixed(1)})`} unit="m" />
          <Readout label="速度 |v|" value={speedNow.toFixed(2)} unit="m/s" />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="射程 R" value={rangeFinal.toFixed(2)} unit="m" emphasis />
          <Readout label="最高點" value={s.peakY.toFixed(2)} unit="m" />
          <Readout label="飛行時間" value={flightFinal.toFixed(2)} unit="s" />
        </>
      }
      notes={
        <>
          <p>
            無空氣阻力時，<strong>θ = 45°</strong> 給最大射程。把 k 拉到 0.2 看看——最佳角度會偏小（重的球被阻力減速，
            較平的軌跡反而能跑更遠）。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>θ = 30° 跟 θ = 60° 在 k = 0 時射程相同（cos 對稱），但加阻力後不再對稱。
          </p>
        </>
      }
    />
  );
}
