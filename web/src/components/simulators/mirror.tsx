"use client";

import { useState } from "react";
import { SimChrome, Slider, Readout } from "./sim-chrome";
import { mirrorImage } from "@/lib/optics";

/**
 * Spherical-mirror imaging — static (no time evolution).
 *
 * Uses the mirror equation
 *
 *   1/f = 1/d_o + 1/d_i,   f = R/2
 *
 * with the usual sign convention: R > 0 / f > 0 for a concave mirror
 * (centre of curvature C in front of the mirror, on the object side),
 * d_i > 0 for a real image in front of the mirror, d_i < 0 for a
 * virtual image behind it. M = −d_i/d_o, negative = inverted.
 *
 * Layout mirrors (pun intended) the lens sim: object on the left, mirror
 * vertex at the canvas centre, reflecting face toward the object. Real
 * images therefore land on the LEFT (x = −d_i), virtual ones behind the
 * mirror on the right.
 *
 * Three principal rays:
 *   1. parallel-to-axis → reflects through F (or appears to come from F)
 *   2. to the vertex    → reflects symmetrically about the axis
 *   3. through F        → reflects parallel to the axis
 * Dashed backward extensions locate a virtual image behind the mirror.
 *
 * `MirrorCanvas` is the controlled SVG (shared with the 光學操作題 quiz
 * component); `MirrorSim` adds sliders + readouts in SimChrome.
 */

const VIEW_W = 520;
const VIEW_H = 280;
const AXIS_Y = VIEW_H / 2;
const MIRROR_X = VIEW_W / 2;
const PIXELS_PER_CM = 8;
const APERTURE_PX = 70;                         // half-height of the drawn mirror
const APERTURE_CM = APERTURE_PX / PIXELS_PER_CM;

function toPx(xCm: number, yCm: number): { x: number; y: number } {
  return { x: MIRROR_X + xCm * PIXELS_PER_CM, y: AXIS_Y - yCm * PIXELS_PER_CM };
}

export interface MirrorCanvasProps {
  /** Radius of curvature (cm, signed: positive = concave). */
  R: number;
  /** Object distance (cm, positive = in front of the mirror). */
  dO: number;
  /** Object height (cm). */
  hO: number;
}

/** Derived quantities the readouts need, shared with the task component. */
export function computeMirror({ R, dO, hO }: MirrorCanvasProps) {
  const f = R / 2;
  const { dI, m } = mirrorImage(f, dO);
  const finiteDI = Number.isFinite(dI);
  const hI = finiteDI ? m * hO : NaN;
  const imageType =
    !finiteDI ? "在無窮遠"
      : dI > 0 ? "實像 · 倒立"
        : "虛像 · 正立";
  return { f, dI, mag: m, hI, finiteDI, imageType, concave: R > 0 };
}

export function MirrorCanvas({ R, dO, hO }: MirrorCanvasProps) {
  const { f, dI, hI, finiteDI, concave } = computeMirror({ R, dO, hO });

  // Leftmost x we draw rays to (cm, negative). Rays are clipped at the
  // viewport edge by stopping them here.
  const xLeftCm = -(MIRROR_X - 10) / PIXELS_PER_CM;
  const xRightCm = (VIEW_W - 10 - MIRROR_X) / PIXELS_PER_CM;

  // Mirror profile: circle of radius |R| centred at (−R, 0) so the vertex
  // sits at the origin and the face bows toward C. A radius smaller than
  // the aperture can't be drawn, so clamp the *drawn* radius only.
  const drawR = Math.max(Math.abs(R), APERTURE_CM + 0.5) * (R < 0 ? -1 : 1);
  const profile: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = -APERTURE_CM + (2 * APERTURE_CM * i) / 24;
    const x = -drawR + Math.sign(drawR) * Math.sqrt(drawR * drawR - y * y);
    const p = toPx(x, y);
    profile.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  // Back-side hatching so the reflecting face is unambiguous.
  const hatch = profile.filter((_, i) => i % 3 === 0).map((pt) => {
    const [x, y] = pt.split(",").map(Number);
    return { x, y };
  });

  const obj = toPx(-dO, hO);
  const objBase = toPx(-dO, 0);
  const focus = toPx(-f, 0);
  const centre = toPx(-R, 0);

  // Ray 1: parallel in, then along the line through (0, h_o) and F:
  //   y(x) = h_o (1 + x/f)  for x ≤ 0.
  const r1Hit = toPx(0, hO);
  const r1End = toPx(xLeftCm, hO * (1 + xLeftCm / f));

  // Ray 2: to the vertex, reflects symmetrically: y(x) = +h_o x/d_o for x ≤ 0.
  const vertex = toPx(0, 0);
  const r2End = toPx(xLeftCm, (hO * xLeftCm) / dO);

  // Ray 3: through F (or aimed at F behind a convex mirror), reflects
  // parallel at the height where it meets the mirror: y_M = h_o f/(f − d_o).
  const r3HitY = (hO * f) / (f - dO);
  const r3Hit = toPx(0, r3HitY);
  const r3End = toPx(xLeftCm, r3HitY);

  const imgPx = finiteDI ? toPx(-dI, hI) : null;
  const virtual = finiteDI && dI < 0;
  // Virtual extensions stop at the image, or at the right edge if the
  // image is off-canvas.
  const extX = imgPx ? Math.min(imgPx.x, toPx(xRightCm, 0).x) : null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full max-h-[55vh] max-w-3xl"
      aria-label="Spherical mirror simulation canvas"
    >
      {/* Optical axis */}
      <line x1={10} y1={AXIS_Y} x2={VIEW_W - 10} y2={AXIS_Y} className="stroke-slate-400 dark:stroke-slate-600" strokeWidth={0.8} strokeDasharray="3 3" />

      {/* Mirror + hatching on the non-reflecting back */}
      <g>
        {hatch.map((p, i) => (
          <line key={i} x1={p.x} y1={p.y} x2={p.x + 7} y2={p.y + 5} className="stroke-slate-400 dark:stroke-slate-500" strokeWidth={1} />
        ))}
        <polyline points={profile.join(" ")} fill="none" className="stroke-sky-600 dark:stroke-sky-400" strokeWidth={2.5} />
        <text x={MIRROR_X} y={AXIS_Y + APERTURE_PX + 16} fontSize={10} textAnchor="middle" className="fill-sky-700 dark:fill-sky-300">{concave ? "concave" : "convex"}</text>
      </g>

      {/* F and C markers */}
      <g className="fill-amber-600 dark:fill-amber-400">
        <circle cx={focus.x} cy={focus.y} r={3} />
        <text x={focus.x} y={focus.y - 6} fontSize={9} textAnchor="middle">F</text>
        <circle cx={centre.x} cy={centre.y} r={3} />
        <text x={centre.x} y={centre.y + 14} fontSize={9} textAnchor="middle">C</text>
      </g>

      {/* Object (upright arrow) */}
      <g stroke="#10b981" fill="#10b981" strokeWidth={2}>
        <line x1={objBase.x} y1={objBase.y} x2={obj.x} y2={obj.y} />
        <polygon points={`${obj.x},${obj.y - 6} ${obj.x - 4},${obj.y} ${obj.x + 4},${obj.y}`} />
        <text x={obj.x} y={obj.y - 10} fontSize={10} className="fill-emerald-700 dark:fill-emerald-300">物</text>
      </g>

      {/* Ray 1: parallel → through F */}
      <line x1={obj.x} y1={obj.y} x2={r1Hit.x} y2={r1Hit.y} className="stroke-indigo-500" strokeWidth={1.5} />
      <line x1={r1Hit.x} y1={r1Hit.y} x2={r1End.x} y2={r1End.y} className="stroke-indigo-500" strokeWidth={1.5} />

      {/* Ray 2: vertex, symmetric reflection */}
      <line x1={obj.x} y1={obj.y} x2={vertex.x} y2={vertex.y} className="stroke-rose-500" strokeWidth={1.5} />
      <line x1={vertex.x} y1={vertex.y} x2={r2End.x} y2={r2End.y} className="stroke-rose-500" strokeWidth={1.5} />

      {/* Ray 3: through F → parallel */}
      <line x1={obj.x} y1={obj.y} x2={r3Hit.x} y2={r3Hit.y} className="stroke-amber-500" strokeWidth={1.5} />
      <line x1={r3Hit.x} y1={r3Hit.y} x2={r3End.x} y2={r3End.y} className="stroke-amber-500" strokeWidth={1.5} />

      {/* Virtual extensions behind the mirror (dashed) */}
      {virtual && imgPx && extX !== null && (
        <>
          <line x1={r1Hit.x} y1={r1Hit.y} x2={extX} y2={r1Hit.y + ((imgPx.y - r1Hit.y) * (extX - r1Hit.x)) / (imgPx.x - r1Hit.x || 1)} className="stroke-indigo-400" strokeWidth={1} strokeDasharray="3 3" />
          <line x1={vertex.x} y1={vertex.y} x2={extX} y2={vertex.y + ((imgPx.y - vertex.y) * (extX - vertex.x)) / (imgPx.x - vertex.x || 1)} className="stroke-rose-400" strokeWidth={1} strokeDasharray="3 3" />
          <line x1={r3Hit.x} y1={r3Hit.y} x2={extX} y2={r3Hit.y} className="stroke-amber-400" strokeWidth={1} strokeDasharray="3 3" />
        </>
      )}

      {/* Image */}
      {finiteDI && imgPx && (
        <g stroke="#0ea5e9" fill="#0ea5e9" strokeWidth={2}>
          <line x1={imgPx.x} y1={AXIS_Y} x2={imgPx.x} y2={imgPx.y} />
          <polygon
            points={
              imgPx.y > AXIS_Y
                ? `${imgPx.x},${imgPx.y + 6} ${imgPx.x - 4},${imgPx.y} ${imgPx.x + 4},${imgPx.y}`
                : `${imgPx.x},${imgPx.y - 6} ${imgPx.x - 4},${imgPx.y} ${imgPx.x + 4},${imgPx.y}`
            }
          />
          <text x={imgPx.x} y={imgPx.y + (imgPx.y > AXIS_Y ? 18 : -10)} fontSize={10} className="fill-sky-700 dark:fill-sky-300">像</text>
        </g>
      )}
    </svg>
  );
}

export function MirrorSim({ onBack, inline }: { onBack?: () => void; inline?: boolean }) {
  // All distances in cm. |R| and the concave/convex toggle are separate
  // controls so the slider never passes through the unphysical R = 0.
  const [rMag, setRMag] = useState(20);
  const [concave, setConcave] = useState(true);
  const [dO, setDO] = useState(25);
  const [hO, setHO] = useState(3);
  const R = concave ? rMag : -rMag;

  const { f, dI, mag, hI, finiteDI, imageType } = computeMirror({ R, dO, hO });

  const toggleCls = (on: boolean) =>
    `flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
      on
        ? "bg-indigo-600 text-white border-indigo-600"
        : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
    }`;

  return (
    <SimChrome
      title="球面鏡成像模擬"
      subtitle="Spherical mirror · Ch34"
      onBack={onBack}
      inline={inline}
      canvas={<MirrorCanvas R={R} dO={dO} hO={hO} />}
      controls={
        <>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConcave(true)} className={toggleCls(concave)}>凹面鏡</button>
            <button type="button" onClick={() => setConcave(false)} className={toggleCls(!concave)}>凸面鏡</button>
          </div>
          <Slider label="曲率半徑 |R|" unit="cm" value={rMag} min={6} max={50} step={1} onChange={setRMag} />
          <Slider label="物距 d_o" unit="cm" value={dO} min={2} max={40} step={0.5} onChange={setDO} />
          <Slider label="物高 h_o" unit="cm" value={hO} min={0.5} max={6} step={0.1} onChange={setHO} />
        </>
      }
      readouts={
        <>
          <Readout label="焦距 f = R/2" value={f.toFixed(1)} unit="cm" />
          <Readout label="像距 d_i" value={finiteDI ? dI.toFixed(2) : "∞"} unit="cm" />
          <Readout label="放大率 M = −d_i/d_o" value={Number.isFinite(mag) ? mag.toFixed(2) : "∞"} />
          <Readout label="像高 h_i" value={Number.isFinite(hI) ? hI.toFixed(2) : "∞"} unit="cm" />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Readout label="像型" value={imageType} emphasis />
        </>
      }
      notes={
        <>
          <p>
            符號慣例：<strong>R &gt; 0</strong> 凹面鏡（C 在鏡前）、<strong>d_i &gt; 0</strong> 實像在鏡前、
            <strong>d_i &lt; 0</strong> 虛像在鏡後。M 為負代表倒立。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>凹面鏡把物放在 C（d_o = R）→ 等大倒立實像；放在 F 內 → 放大正立虛像（化妝鏡）；
            凸面鏡不管怎麼放都是縮小正立虛像（路口廣角鏡）。
          </p>
        </>
      }
    />
  );
}
