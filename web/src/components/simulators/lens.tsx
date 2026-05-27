"use client";

import { useState } from "react";
import { SimChrome, Slider, Readout } from "./sim-chrome";

/**
 * Thin-lens imaging — static (no time evolution).
 *
 * Uses the thin-lens equation
 *
 *   1/f = 1/d_o + 1/d_i
 *
 * with the standard sign convention: d_o > 0 for a real object on the
 * incoming side, f > 0 for a converging (convex) lens, d_i > 0 for a
 * real image on the outgoing side. A diverging (concave) lens has f < 0
 * and gives an upright virtual image.
 *
 * Three principal rays are drawn so the student can see *how* the image
 * forms, not just where:
 *   1. parallel-to-axis  → refracted through the focal point on the far side
 *   2. through-center    → continues undeflected
 *   3. through near-focus → emerges parallel to the axis
 *
 * For a virtual image the actual outgoing rays diverge; we extend them
 * backwards as dashed segments so the apparent image location is
 * visible behind the object.
 */

const VIEW_W = 520;
const VIEW_H = 280;
const AXIS_Y = VIEW_H / 2;
const LENS_X = VIEW_W / 2;
const PIXELS_PER_CM = 8;

function toPx(xCm: number, yCm: number): { x: number; y: number } {
  return { x: LENS_X + xCm * PIXELS_PER_CM, y: AXIS_Y - yCm * PIXELS_PER_CM };
}

export function LensSim({ onBack, inline }: { onBack?: () => void; inline?: boolean }) {
  // All distances in cm.
  const [f, setF] = useState(10);                  // focal length (signed)
  const [dO, setDO] = useState(20);                // object distance (positive = left of lens)
  const [hO, setHO] = useState(3);                 // object height

  // Image distance via 1/f = 1/d_o + 1/d_i  →  d_i = 1 / (1/f − 1/d_o).
  // Guard for d_o == f (image at infinity); we clamp to a huge magnitude
  // and let the magnification readout flag "圖像在無窮遠".
  const denom = 1 / f - 1 / dO;
  const dI = Math.abs(denom) < 1e-4 ? Infinity * Math.sign(denom || 1) : 1 / denom;
  const finiteDI = Number.isFinite(dI);
  const mag = finiteDI ? -dI / dO : NaN;
  const hI = finiteDI ? mag * hO : NaN;

  // Lens shape (vertical line + small curves at top/bottom to hint convex/concave).
  const lensConverging = f > 0;
  const lensApex = 70;
  const lensCurveDx = lensConverging ? 6 : -6;

  // Helper for clipped rays — we want all line segments to stay inside the viewport.
  const clampX = (x: number) => Math.max(20, Math.min(VIEW_W - 20, x));

  // Object position
  const obj = toPx(-dO, hO);
  const objBase = toPx(-dO, 0);

  // Three principal-ray endpoints on the far side.
  // 1) Parallel ray: goes horizontally to the lens, then through far focal point at (f, 0).
  const farFocus = toPx(f, 0);
  const nearFocus = toPx(-f, 0);
  const lensTopAtRay1 = toPx(0, hO);
  // For diverging lens, the focal "point" for the refraction is on the
  // *near* side, so we extend backward; we still draw the actual ray
  // departing the lens through the appropriate slope.
  const ray1Slope = (farFocus.y - lensTopAtRay1.y) / (farFocus.x - lensTopAtRay1.x);
  const ray1EndX = clampX(VIEW_W - 10);
  const ray1EndY = lensTopAtRay1.y + ray1Slope * (ray1EndX - lensTopAtRay1.x);

  // 2) Through-center ray: undeflected straight line from object tip
  //    through the lens centre.
  const centerSlope = (AXIS_Y - obj.y) / (LENS_X - obj.x);
  const ray2EndX = clampX(VIEW_W - 10);
  const ray2EndY = obj.y + centerSlope * (ray2EndX - obj.x);

  // 3) Through near-focus ray: from object tip through near focal point on
  //    the same side, then exits the lens parallel to the axis.
  const ray3LensX = LENS_X;
  const ray3SlopeIn = (nearFocus.y - obj.y) / (nearFocus.x - obj.x);
  const ray3LensY = obj.y + ray3SlopeIn * (ray3LensX - obj.x);
  // After the lens, the ray runs parallel to the axis (same height).
  const ray3EndX = clampX(VIEW_W - 10);
  const ray3EndY = ray3LensY;

  // Image location (drawn at the intersection of the rays).
  const imgPx = finiteDI ? toPx(dI, hI) : null;

  const imageType =
    !finiteDI ? "在無窮遠"
      : dI > 0 ? (hI > 0 === hO > 0 ? "實像 · 正立 (罕見)" : "實像 · 倒立")
        : "虛像 · 正立";

  return (
    <SimChrome
      title="透鏡成像模擬"
      subtitle="Thin lens · Ch34"
      onBack={onBack}
      inline={inline}
      canvas={
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full max-h-[55vh] max-w-3xl"
          aria-label="Thin lens simulation canvas"
        >
          {/* Optical axis */}
          <line x1={10} y1={AXIS_Y} x2={VIEW_W - 10} y2={AXIS_Y} className="stroke-slate-400 dark:stroke-slate-600" strokeWidth={0.8} strokeDasharray="3 3" />

          {/* Lens */}
          <g>
            <line x1={LENS_X} y1={AXIS_Y - lensApex} x2={LENS_X} y2={AXIS_Y + lensApex} className="stroke-sky-600 dark:stroke-sky-400" strokeWidth={2} />
            <path
              d={`M ${LENS_X - lensCurveDx} ${AXIS_Y - lensApex} Q ${LENS_X} ${AXIS_Y - lensApex - 6} ${LENS_X + lensCurveDx} ${AXIS_Y - lensApex}`}
              fill="none"
              className="stroke-sky-600 dark:stroke-sky-400"
              strokeWidth={2}
            />
            <path
              d={`M ${LENS_X - lensCurveDx} ${AXIS_Y + lensApex} Q ${LENS_X} ${AXIS_Y + lensApex + 6} ${LENS_X + lensCurveDx} ${AXIS_Y + lensApex}`}
              fill="none"
              className="stroke-sky-600 dark:stroke-sky-400"
              strokeWidth={2}
            />
            <text x={LENS_X} y={AXIS_Y + lensApex + 16} fontSize={10} textAnchor="middle" className="fill-sky-700 dark:fill-sky-300">{lensConverging ? "convex" : "concave"}</text>
          </g>

          {/* Focal points */}
          <g className="fill-amber-600 dark:fill-amber-400">
            <circle cx={farFocus.x} cy={farFocus.y} r={3} />
            <text x={farFocus.x} y={farFocus.y - 6} fontSize={9} textAnchor="middle">F</text>
            <circle cx={nearFocus.x} cy={nearFocus.y} r={3} />
            <text x={nearFocus.x} y={nearFocus.y - 6} fontSize={9} textAnchor="middle">F</text>
          </g>

          {/* Object (upright arrow) */}
          <g stroke="#10b981" fill="#10b981" strokeWidth={2}>
            <line x1={objBase.x} y1={objBase.y} x2={obj.x} y2={obj.y} />
            <polygon points={`${obj.x},${obj.y - 6} ${obj.x - 4},${obj.y} ${obj.x + 4},${obj.y}`} />
            <text x={obj.x} y={obj.y - 10} fontSize={10} className="fill-emerald-700 dark:fill-emerald-300">物</text>
          </g>

          {/* Principal rays — solid on the actual path, dashed on the virtual extension */}
          {/* Ray 1: parallel → through far focus */}
          <line x1={obj.x} y1={obj.y} x2={LENS_X} y2={lensTopAtRay1.y} className="stroke-indigo-500" strokeWidth={1.5} />
          <line x1={LENS_X} y1={lensTopAtRay1.y} x2={ray1EndX} y2={ray1EndY} className="stroke-indigo-500" strokeWidth={1.5} />

          {/* Ray 2: through centre, undeflected */}
          <line x1={obj.x} y1={obj.y} x2={ray2EndX} y2={ray2EndY} className="stroke-rose-500" strokeWidth={1.5} />

          {/* Ray 3: through near focus → parallel after lens */}
          <line x1={obj.x} y1={obj.y} x2={LENS_X} y2={ray3LensY} className="stroke-amber-500" strokeWidth={1.5} />
          <line x1={LENS_X} y1={ray3LensY} x2={ray3EndX} y2={ray3EndY} className="stroke-amber-500" strokeWidth={1.5} />

          {/* Virtual extensions (dashed) when image is virtual */}
          {finiteDI && dI < 0 && imgPx && (
            <>
              <line x1={LENS_X} y1={lensTopAtRay1.y} x2={imgPx.x} y2={imgPx.y} className="stroke-indigo-400" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={LENS_X} y1={ray3LensY} x2={imgPx.x} y2={imgPx.y} className="stroke-amber-400" strokeWidth={1} strokeDasharray="3 3" />
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
      }
      controls={
        <>
          <Slider label="焦距 f" unit="cm" value={f} min={-25} max={25} step={0.5} onChange={setF} />
          <Slider label="物距 d_o" unit="cm" value={dO} min={2} max={40} step={0.5} onChange={setDO} />
          <Slider label="物高 h_o" unit="cm" value={hO} min={0.5} max={6} step={0.1} onChange={setHO} />
        </>
      }
      readouts={
        <>
          <Readout label="透鏡類型" value={lensConverging ? "凸透鏡 (converging)" : "凹透鏡 (diverging)"} />
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
            符號慣例：<strong>d_o &gt; 0</strong> 物在透鏡左側、<strong>f &gt; 0</strong> 凸透鏡、
            <strong>d_i &gt; 0</strong> 實像在右側。M 為負代表倒立。
          </p>
          <p className="mt-2">
            <strong>試試：</strong>凸透鏡時把 d_o 設在 f 跟 2f 之間 → 放大實像；超過 2f → 縮小實像；
            小於 f → 像跑到物的同側變成放大虛像（放大鏡的原理）。
          </p>
        </>
      }
    />
  );
}
