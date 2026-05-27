"use client";

import { useCallback, useState } from "react";
import { SimChrome, Slider, Readout, PlayControls } from "./sim-chrome";
import { useSimLoop } from "./use-sim-loop";

/**
 * RC circuit (battery + switch + resistor + capacitor) simulator.
 *
 * Switch is in series with the battery. Two modes via the toggle:
 *
 *   - charge:    battery in the loop. C charges through R toward V_batt.
 *                  dV_C/dt = (V_batt − V_C) / (RC)
 *                  Solution: V_C(t) = V_batt · (1 − e^(−t/τ))
 *
 *   - discharge: battery removed (switch flipped). C discharges through R.
 *                  dV_C/dt = −V_C / (RC)
 *                  Solution: V_C(t) = V_C(0) · e^(−t/τ)
 *
 * τ = RC is the time constant; after one τ the capacitor reaches ~63% of
 * its final value, after 5τ it's effectively done. We surface τ so the
 * student can predict before pressing play.
 *
 * We do a tiny explicit Euler step (dt is at most 50ms) — it's stable
 * over the slider ranges and the time constant we expose.
 */

const VIEW_W = 420;
const VIEW_H = 320;

type Mode = "charge" | "discharge";

interface State {
  vC: number;   // capacitor voltage (V)
  t: number;    // s elapsed since last reset
}

function makeInitial(): State {
  return { vC: 0, t: 0 };
}

function step(prev: State, dt: number, mode: Mode, vBatt: number, r: number, c: number): State {
  const tau = r * c;
  const dV = mode === "charge"
    ? ((vBatt - prev.vC) / tau) * dt
    : (-prev.vC / tau) * dt;
  return { vC: prev.vC + dV, t: prev.t + dt };
}

export function RCCircuitSim({ onBack }: { onBack?: () => void }) {
  const [vBatt, setVBatt] = useState(9);            // V
  const [r, setR] = useState(1000);                 // Ω
  const [cFarads, setCFarads] = useState(0.001);    // F (= 1 mF default)
  const [mode, setMode] = useState<Mode>("charge");
  const [running, setRunning] = useState(false);
  const [s, setS] = useState<State>(makeInitial);

  const reset = useCallback(() => {
    setS(makeInitial());
    setRunning(false);
  }, []);

  const flipSwitch = useCallback(() => {
    // Flipping the switch doesn't reset the capacitor — that's the whole
    // point. We just reset the elapsed-time counter so the new exponential
    // is easier to predict against τ.
    setMode((m) => (m === "charge" ? "discharge" : "charge"));
    setS((prev) => ({ ...prev, t: 0 }));
  }, []);

  useSimLoop(running, (dt) => {
    setS((prev) => step(prev, dt, mode, vBatt, r, cFarads));
  });

  const tau = r * cFarads;
  const current = mode === "charge"
    ? (vBatt - s.vC) / r
    : -s.vC / r;                                 // negative when discharging — flows opposite
  const energyCap = 0.5 * cFarads * s.vC * s.vC;
  const powerR = current * current * r;
  const fillFrac = Math.max(0, Math.min(1, s.vC / vBatt));

  // Format helpers that pick a sensible unit prefix.
  const fmtR = (ohms: number) => ohms >= 1000 ? `${(ohms / 1000).toFixed(1)} k` : `${ohms.toFixed(0)} `;
  const fmtC = (farads: number) =>
    farads >= 1e-3 ? `${(farads * 1000).toFixed(2)} m` :
    farads >= 1e-6 ? `${(farads * 1e6).toFixed(1)} μ` :
    `${(farads * 1e9).toFixed(0)} n`;
  const fmtI = (amps: number) =>
    Math.abs(amps) < 1e-3 ? `${(amps * 1e6).toFixed(1)} µ` :
    Math.abs(amps) < 1 ? `${(amps * 1000).toFixed(2)} m` :
    amps.toFixed(3);

  return (
    <SimChrome
      title="RC 電路模擬"
      subtitle="Capacitor charge / discharge · Ch24 / Ch26"
      onBack={onBack}
      canvas={
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full max-h-[60vh] max-w-2xl"
          aria-label="RC circuit simulation canvas"
        >
          {/* Wires (a rectangle loop, with breaks for the components) */}
          <g className="stroke-slate-700 dark:stroke-slate-300" strokeWidth={2} fill="none">
            <line x1={80} y1={80} x2={170} y2={80} />
            <line x1={250} y1={80} x2={340} y2={80} />
            <line x1={340} y1={80} x2={340} y2={130} />
            <line x1={340} y1={210} x2={340} y2={240} />
            <line x1={340} y1={240} x2={80} y2={240} />
            <line x1={80} y1={240} x2={80} y2={170} />
            <line x1={80} y1={130} x2={80} y2={80} />
          </g>

          {/* Battery (left side, vertical) */}
          <g>
            <line x1={68} y1={130} x2={92} y2={130} className="stroke-slate-800 dark:stroke-slate-100" strokeWidth={3} />
            <line x1={75} y1={140} x2={85} y2={140} className="stroke-slate-800 dark:stroke-slate-100" strokeWidth={3} />
            <line x1={68} y1={155} x2={92} y2={155} className="stroke-slate-800 dark:stroke-slate-100" strokeWidth={3} />
            <line x1={75} y1={165} x2={85} y2={165} className="stroke-slate-800 dark:stroke-slate-100" strokeWidth={3} />
            <text x={50} y={150} fontSize={11} className="fill-slate-600 dark:fill-slate-300">{vBatt} V</text>
          </g>

          {/* Switch (top, between battery and resistor) */}
          <g>
            <circle cx={170} cy={80} r={3} className="fill-slate-700 dark:fill-slate-300" />
            <circle cx={210} cy={80} r={3} className="fill-slate-700 dark:fill-slate-300" />
            <line
              x1={170}
              y1={80}
              x2={mode === "charge" ? 210 : 200}
              y2={mode === "charge" ? 80 : 60}
              className="stroke-slate-700 dark:stroke-slate-300"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <text x={170} y={45} fontSize={10} className="fill-slate-500 dark:fill-slate-400">
              {mode === "charge" ? "S 閉合（充電）" : "S 開路（放電）"}
            </text>
            <rect
              x={155}
              y={92}
              width={70}
              height={20}
              rx={4}
              onClick={flipSwitch}
              className="fill-indigo-500 hover:fill-indigo-600 cursor-pointer"
            />
            <text
              x={190}
              y={106}
              fontSize={11}
              textAnchor="middle"
              fill="#fff"
              className="cursor-pointer select-none pointer-events-none"
            >
              切換
            </text>
          </g>

          {/* Resistor (zigzag, top right) */}
          <g>
            <polyline
              points="250,80 256,72 262,88 268,72 274,88 280,72 286,88 292,72 298,88 304,72 310,88 316,80"
              fill="none"
              className="stroke-amber-600 dark:stroke-amber-400"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            <text x={272} y={64} fontSize={11} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300">R = {fmtR(r)}Ω</text>
          </g>

          {/* Capacitor (right vertical) */}
          <g>
            <line x1={325} y1={155} x2={355} y2={155} className="stroke-slate-800 dark:stroke-slate-100" strokeWidth={3} />
            <line x1={325} y1={185} x2={355} y2={185} className="stroke-slate-800 dark:stroke-slate-100" strokeWidth={3} />
            <text x={365} y={165} fontSize={11} className="fill-slate-600 dark:fill-slate-300">C = {fmtC(cFarads)}F</text>
            <text x={365} y={180} fontSize={11} className="fill-indigo-600 dark:fill-indigo-300">V_C = {s.vC.toFixed(2)} V</text>

            {/* Charge visualization: blue fill bar inside the cap region */}
            <rect x={330} y={160} width={20} height={20} className="fill-slate-100 dark:fill-slate-800" />
            <rect
              x={330}
              y={180 - 20 * fillFrac}
              width={20}
              height={20 * fillFrac}
              className="fill-indigo-400 dark:fill-indigo-500"
            />
          </g>

          {/* Current arrow on the bottom wire — direction flips on discharge */}
          {Math.abs(current) > 1e-6 && (
            <g className="fill-emerald-600 dark:fill-emerald-400">
              <polygon
                points={
                  current > 0
                    ? "200,234 210,240 200,246"
                    : "220,234 210,240 220,246"
                }
              />
              <text x={235} y={258} fontSize={10} className="fill-emerald-700 dark:fill-emerald-300">
                I = {fmtI(Math.abs(current))}A
              </text>
            </g>
          )}
        </svg>
      }
      controls={
        <>
          <Slider label="電池電壓 V" unit="V" value={vBatt} min={1} max={24} step={0.5} onChange={setVBatt} />
          <Slider label="電阻 R" unit="Ω" value={r} min={100} max={10000} step={50} onChange={setR} format={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)} />
          <Slider
            label="電容 C"
            unit="F"
            value={cFarads}
            min={0.0001}
            max={0.01}
            step={0.0001}
            onChange={setCFarads}
            format={(v) => v >= 1e-3 ? `${(v * 1000).toFixed(2)}m` : `${(v * 1e6).toFixed(0)}μ`}
          />
          <PlayControls running={running} onToggle={() => setRunning((p) => !p)} onReset={reset} />
        </>
      }
      readouts={
        <>
          <Readout label="模式" value={mode === "charge" ? "充電中" : "放電中"} emphasis />
          <Readout label="時間 t" value={s.t.toFixed(2)} unit="s" />
          <Readout label="時間常數 τ = RC" value={tau.toFixed(3)} unit="s" emphasis />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="電容電壓 V_C" value={s.vC.toFixed(3)} unit="V" />
          <Readout label="電流 |I|" value={fmtI(Math.abs(current))} unit="A" />
          <Readout label="電容能量 ½CV²" value={(energyCap * 1000).toFixed(3)} unit="mJ" />
          <Readout label="R 上的功率" value={(powerR * 1000).toFixed(3)} unit="mW" />
        </>
      }
      notes={
        <>
          <p>
            時間常數 <strong>τ = RC</strong>。一個 τ 後 V_C 約達終值 63%，五個 τ 後幾乎滿載。
            點圖中的「切換」鈕可在充電 / 放電間切換，電容的電荷不會被歸零。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>把 R 加倍，τ 也加倍——同樣的目標電壓要等更久；
            充飽後切換到放電，V_C 會以指數形式衰減回 0。
          </p>
        </>
      }
    />
  );
}
