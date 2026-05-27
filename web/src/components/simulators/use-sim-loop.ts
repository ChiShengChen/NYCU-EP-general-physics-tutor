"use client";

import { useEffect, useRef } from "react";

/**
 * requestAnimationFrame-driven physics loop.
 *
 * The step callback is given the real wall-clock dt in seconds since the
 * previous frame, clamped to 50ms so that a tab regaining focus after a
 * long pause doesn't fire a single 10-second integration step (which
 * would launch projectiles into the next universe). The latest callback
 * is stashed in a ref via a separate post-commit effect so the RAF loop
 * doesn't have to restart every render just to pick up a new closure
 * (e.g. fresh parameter sliders). That stash lives inside an effect,
 * not the render body, to keep react-hooks/refs happy.
 *
 * Pass `running={false}` to pause cleanly — the loop is torn down and
 * recreated on resume, so re-entering from pause never replays time.
 */
export function useSimLoop(running: boolean, step: (dtSec: number) => void): void {
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastT = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      stepRef.current(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
}
