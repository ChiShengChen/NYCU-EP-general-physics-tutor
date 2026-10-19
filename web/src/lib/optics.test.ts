import { describe, expect, it } from "vitest";
import {
  thinLensImage,
  mirrorImage,
  snell,
  computeOpticsQuantities,
  evaluateOpticsTask,
  formatOpticsAnswer,
  generateOpticsTask,
  seededRng,
  opticsSimForChapter,
  OPTICS_TEMPLATE_COUNT,
  type OpticsTask,
  type OpticsSimKind,
} from "./optics";

/* ─── Physics ─── */

describe("thinLensImage", () => {
  it("converging lens, object beyond 2f → reduced inverted real image", () => {
    const { dI, m } = thinLensImage(10, 30);
    expect(dI).toBeCloseTo(15, 6);
    expect(m).toBeCloseTo(-0.5, 6);
  });

  it("object at 2f → same-size inverted real image", () => {
    const { dI, m } = thinLensImage(10, 20);
    expect(dI).toBeCloseTo(20, 6);
    expect(m).toBeCloseTo(-1, 6);
  });

  it("object inside f → magnified upright virtual image", () => {
    const { dI, m } = thinLensImage(10, 5);
    expect(dI).toBeCloseTo(-10, 6);
    expect(m).toBeCloseTo(2, 6);
  });

  it("diverging lens → reduced upright virtual image", () => {
    const { dI, m } = thinLensImage(-10, 10);
    expect(dI).toBeCloseTo(-5, 6);
    expect(m).toBeCloseTo(0.5, 6);
  });

  it("object on the focal point → image at infinity", () => {
    const { dI, m } = thinLensImage(10, 10);
    expect(Number.isFinite(dI)).toBe(false);
    expect(Number.isNaN(m)).toBe(true);
  });
});

describe("mirrorImage", () => {
  it("concave mirror with object at C (d_o = R = 2f) → same-size inverted real image", () => {
    const { dI, m } = mirrorImage(10, 20);
    expect(dI).toBeCloseTo(20, 6);
    expect(m).toBeCloseTo(-1, 6);
  });

  it("convex mirror always gives a reduced upright virtual image", () => {
    const { dI, m } = mirrorImage(-10, 30);
    expect(dI).toBeCloseTo(-7.5, 6);
    expect(m).toBeCloseTo(0.25, 6);
  });
});

describe("snell", () => {
  it("air → glass bends toward the normal", () => {
    const r = snell(1, 1.5, 30);
    expect(r.tir).toBe(false);
    expect(r.criticalDeg).toBeNull();
    expect(r.thetaRefrDeg).toBeCloseTo(19.47, 2);
  });

  it("glass → air has a critical angle of ~41.8° and TIR beyond it", () => {
    const below = snell(1.5, 1, 40);
    expect(below.criticalDeg).toBeCloseTo(41.81, 2);
    expect(below.tir).toBe(false);
    const above = snell(1.5, 1, 45);
    expect(above.tir).toBe(true);
    expect(above.thetaRefrDeg).toBeNull();
  });

  it("exactly at the critical angle still refracts (grazing, θ_r = 90°)", () => {
    const r = snell(1.5, 1, Math.asin(1 / 1.5) * (180 / Math.PI));
    expect(r.tir).toBe(false);
    expect(r.thetaRefrDeg).toBeCloseTo(90, 3);
  });

  it("normal incidence is undeflected", () => {
    expect(snell(1, 1.5, 0).thetaRefrDeg).toBeCloseTo(0, 9);
  });
});

describe("computeOpticsQuantities", () => {
  it("mirror derives f from R/2", () => {
    const q = computeOpticsQuantities("mirror", { R: 20, dO: 20, hO: 3 });
    expect(q.dI).toBeCloseTo(20, 6);
    expect(q.isReal).toBe(1);
    expect(q.isUpright).toBe(0);
    expect(q.hI).toBeCloseTo(-3, 6);
  });

  it("refraction reports deflection and the reflected/refracted angle", () => {
    const q = computeOpticsQuantities("refraction", { n1: 1, n2: 1.5, thetaInc: 30 });
    expect(q.deflection).toBeCloseTo(30 - 19.47, 2);
    expect(q.reflRefrAngle).toBeCloseTo(180 - 30 - 19.47, 2);
    expect(q.tir).toBe(0);
  });

  it("refraction under TIR yields NaN refraction angle (so eq-checks fail)", () => {
    const q = computeOpticsQuantities("refraction", { n1: 1.5, n2: 1, thetaInc: 60 });
    expect(Number.isNaN(q.thetaRefr)).toBe(true);
    expect(q.tir).toBe(1);
  });
});

/* ─── Evaluation ─── */

const sampleTask: OpticsTask = {
  sim: "lens",
  adjustable: [{ key: "dO", label: "物距 d_o", unit: "cm", min: 2, max: 40, step: 0.5, initial: 20 }],
  fixed: [{ key: "f", label: "焦距 f", unit: "cm", value: 10 }, { key: "hO", label: "物高", unit: "cm", value: 3 }],
  target: [
    { description: "d_i = 30 cm", check: { quantity: "dI", op: "eq", value: 30, tolerance: 0.5 } },
    { description: "實像", check: { quantity: "isReal", op: "eq", value: 1 } },
  ],
};

describe("evaluateOpticsTask", () => {
  it("passes when every target is met", () => {
    const r = evaluateOpticsTask(sampleTask, { dO: 15 });
    expect(r.isCorrect).toBe(true);
    expect(r.perTarget.every((t) => t.ok)).toBe(true);
    expect(r.achieved.dI).toBeCloseTo(30, 6);
  });

  it("fails when any single target misses", () => {
    const r = evaluateOpticsTask(sampleTask, { dO: 20 });   // d_i = 20, still real
    expect(r.isCorrect).toBe(false);
    expect(r.perTarget[0].ok).toBe(false);
    expect(r.perTarget[1].ok).toBe(true);
  });

  it("respects the eq tolerance", () => {
    expect(evaluateOpticsTask(sampleTask, { dO: 15.1 }).isCorrect).toBe(true);   // d_i ≈ 29.6
    expect(evaluateOpticsTask(sampleTask, { dO: 16 }).isCorrect).toBe(false);    // d_i ≈ 26.7
  });

  it("clamps tampered values to the slider range and never throws on garbage", () => {
    const r = evaluateOpticsTask(sampleTask, { dO: 1e9 });
    expect(r.isCorrect).toBe(false);
    expect(r.achieved.dI).toBeCloseTo(thinLensImage(10, 40).dI, 6);
    expect(() => evaluateOpticsTask(sampleTask, { dO: NaN })).not.toThrow();
    expect(() => evaluateOpticsTask(sampleTask, {})).not.toThrow();
  });

  it("supports gte / lte / between ops", () => {
    const mk = (check: OpticsTask["target"][number]["check"]): OpticsTask => ({ ...sampleTask, target: [{ description: "x", check }] });
    expect(evaluateOpticsTask(mk({ quantity: "dI", op: "gte", value: 25 }), { dO: 15 }).isCorrect).toBe(true);
    expect(evaluateOpticsTask(mk({ quantity: "dI", op: "lte", value: 25 }), { dO: 15 }).isCorrect).toBe(false);
    expect(evaluateOpticsTask(mk({ quantity: "dI", op: "between", value: 29, value2: 31 }), { dO: 15 }).isCorrect).toBe(true);
  });

  it("a task with no targets is never correct", () => {
    expect(evaluateOpticsTask({ ...sampleTask, target: [] }, { dO: 15 }).isCorrect).toBe(false);
  });
});

describe("formatOpticsAnswer", () => {
  it("renders adjustable values with labels + units", () => {
    expect(formatOpticsAnswer(sampleTask, { dO: 15 })).toBe("物距 d_o = 15.00 cm");
  });
});

/* ─── Task bank ─── */

/** Brute-force the slider grid for one adjustable parameter. */
function isSolvable(task: OpticsTask): boolean {
  expect(task.adjustable).toHaveLength(1);
  const p = task.adjustable[0];
  const steps = Math.round((p.max - p.min) / p.step);
  for (let i = 0; i <= steps; i++) {
    // Round like the <input type=range> does so the test only counts
    // positions a student can actually reach.
    const v = Number((p.min + i * p.step).toFixed(6));
    if (evaluateOpticsTask(task, { [p.key]: v }).isCorrect) return true;
  }
  return false;
}

describe("generateOpticsTask", () => {
  it("is deterministic for a given seed", () => {
    const a = generateOpticsTask("lens", seededRng(42));
    const b = generateOpticsTask("lens", seededRng(42));
    expect(a).toEqual(b);
    const c = generateOpticsTask("lens", seededRng(43));
    expect(c.question === a.question && c.task.fixed[0].value === a.task.fixed[0].value).toBe(false);
  });

  it("has at least 3 templates per sim", () => {
    for (const sim of ["lens", "mirror", "refraction"] as OpticsSimKind[]) {
      expect(OPTICS_TEMPLATE_COUNT[sim]).toBeGreaterThanOrEqual(3);
    }
  });

  for (const sim of ["lens", "mirror", "refraction"] as OpticsSimKind[]) {
    it(`${sim}: every template is solvable on the slider grid across 50 seeds`, () => {
      for (let t = 0; t < OPTICS_TEMPLATE_COUNT[sim]; t++) {
        for (let seed = 1; seed <= 50; seed++) {
          const g = generateOpticsTask(sim, seededRng(seed * 7919 + t), t);
          expect(g.task.sim).toBe(sim);
          expect(g.question.length).toBeGreaterThan(0);
          expect(g.explanation.length).toBeGreaterThan(0);
          expect(g.correctAnswer.length).toBeGreaterThan(0);
          expect(g.task.target.length).toBeGreaterThan(0);
          // The initial slider position must NOT already satisfy the task.
          const init = Object.fromEntries(g.task.adjustable.map((p) => [p.key, p.initial]));
          expect(evaluateOpticsTask(g.task, init).isCorrect, `${sim} template ${t} seed ${seed} starts solved`).toBe(false);
          expect(isSolvable(g.task), `${sim} template ${t} seed ${seed} unsolvable: ${g.question}`).toBe(true);
        }
      }
    });
  }

  it("round-trips through JSON (task must stay serialisable)", () => {
    const g = generateOpticsTask("refraction", seededRng(7));
    const clone = JSON.parse(JSON.stringify(g.task)) as OpticsTask;
    expect(clone).toEqual(g.task);
  });
});

describe("opticsSimForChapter", () => {
  it("maps Ch33 → refraction, Ch34 → lens + mirror, others → none", () => {
    expect(opticsSimForChapter(33)).toEqual(["refraction"]);
    expect(opticsSimForChapter(34)).toEqual(["lens", "mirror"]);
    expect(opticsSimForChapter(12)).toEqual([]);
  });
});
