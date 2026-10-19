/**
 * Shared geometric-optics math + the "操作型互動光路題" task bank.
 *
 * Pure TypeScript — no React, no DOM — so it is imported both by the
 * simulator canvases (client) and by /api/quiz (server) which re-grades
 * every interactive task with the same formulas the student saw.
 *
 * Sign conventions (identical to the simulators):
 *   thin lens   1/f = 1/d_o + 1/d_i   f > 0 converging, d_o > 0 real object,
 *               d_i > 0 real image on the far side, M = −d_i/d_o
 *   mirror      1/f = 1/d_o + 1/d_i   f = R/2, R > 0 concave, d_i > 0 real
 *               image in front of the mirror, M = −d_i/d_o
 *   refraction  n1 sin θ_i = n2 sin θ_r, angles measured from the normal,
 *               θ_c = asin(n2/n1) only when n1 > n2
 */

/* ─── Physics ─── */

export interface ImageResult {
  /** Image distance (cm). ±Infinity when the object sits on the focal point. */
  dI: number;
  /** Lateral magnification −d_i/d_o. NaN when d_i is infinite. */
  m: number;
}

/** Thin-lens equation. `f` signed (negative = diverging). */
export function thinLensImage(f: number, dO: number): ImageResult {
  // Guard for d_o == f (image at infinity): clamp to a huge magnitude so
  // callers can flag "在無窮遠" instead of dividing by zero.
  const denom = 1 / f - 1 / dO;
  const dI = Math.abs(denom) < 1e-4 ? Infinity * Math.sign(denom || 1) : 1 / denom;
  const m = Number.isFinite(dI) ? -dI / dO : NaN;
  return { dI, m };
}

/** Spherical-mirror equation. `f` signed (negative = convex). Same algebra
 *  as the thin lens, exported separately so call sites read as physics. */
export function mirrorImage(f: number, dO: number): ImageResult {
  return thinLensImage(f, dO);
}

export interface SnellResult {
  /** Refraction angle in degrees, or null under total internal reflection. */
  thetaRefrDeg: number | null;
  /** Critical angle in degrees, or null when n1 <= n2 (no TIR possible). */
  criticalDeg: number | null;
  tir: boolean;
}

const DEG = Math.PI / 180;

/** Snell's law at a flat interface. `thetaIncDeg` measured from the normal. */
export function snell(n1: number, n2: number, thetaIncDeg: number): SnellResult {
  const criticalDeg = n1 > n2 ? Math.asin(n2 / n1) / DEG : null;
  const s = (n1 / n2) * Math.sin(thetaIncDeg * DEG);
  // Floating-point: sin θ_c computed back through asin can land a hair
  // above 1, so compare with a tiny epsilon rather than `> 1`.
  if (s > 1 + 1e-12) return { thetaRefrDeg: null, criticalDeg, tir: true };
  return { thetaRefrDeg: Math.asin(Math.min(1, s)) / DEG, criticalDeg, tir: false };
}

/* ─── Task shape ─── */

export type OpticsSimKind = "lens" | "mirror" | "refraction";

export type OpticsCheckOp = "eq" | "gte" | "lte" | "between";

export interface OpticsCheck {
  /** Key into the quantities produced by `computeOpticsQuantities`. */
  quantity: string;
  op: OpticsCheckOp;
  value: number;
  /** Upper bound for `between`. */
  value2?: number;
  /** Absolute tolerance for `eq` (default 0 → exact). */
  tolerance?: number;
}

export interface OpticsTarget {
  description: string;
  check: OpticsCheck;
}

export interface OpticsParam {
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  initial: number;
}

export interface OpticsFixedParam {
  key: string;
  label: string;
  unit?: string;
  value: number;
}

/** Serialisable task description — it rides inside the question JSON
 *  stored in `attempts.questions`, so keep it plain data. */
export interface OpticsTask {
  sim: OpticsSimKind;
  /** Parameters the student can move, with their ranges and initial values. */
  adjustable: OpticsParam[];
  /** Parameters shown but locked. */
  fixed: OpticsFixedParam[];
  /** What the student must achieve. Checked client-side AND server-side. */
  target: OpticsTarget[];
}

/* ─── Derived quantities ─── */

/** Human labels for every quantity a target can reference (student-facing). */
export const QUANTITY_LABELS: Record<string, { label: string; unit?: string; boolean?: boolean }> = {
  dI: { label: "像距 d_i", unit: "cm" },
  m: { label: "放大率 M" },
  absM: { label: "放大率 |M|" },
  hI: { label: "像高 h_i", unit: "cm" },
  isReal: { label: "實像", boolean: true },
  isUpright: { label: "正立", boolean: true },
  thetaInc: { label: "入射角 θ_i", unit: "°" },
  thetaRefr: { label: "折射角 θ_r", unit: "°" },
  thetaCrit: { label: "臨界角 θ_c", unit: "°" },
  deflection: { label: "偏折角 θ_i − θ_r", unit: "°" },
  reflRefrAngle: { label: "反射光與折射光夾角", unit: "°" },
  tir: { label: "全反射", boolean: true },
};

/** Format a quantity for readouts / feedback: booleans as 是/否, NaN as "—". */
export function formatQuantity(key: string, v: number | undefined): string {
  const meta = QUANTITY_LABELS[key];
  if (v === undefined || Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  if (meta?.boolean) return v >= 0.5 ? "是" : "否";
  const text = Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
  return meta?.unit ? `${text} ${meta.unit}` : text;
}

/**
 * All derived quantities for a sim given its parameter values. Missing
 * parameters fall back to 0 so a malformed payload yields NaN/failing
 * checks instead of throwing. Booleans are encoded 1 / 0.
 */
export function computeOpticsQuantities(sim: OpticsSimKind, values: Record<string, number>): Record<string, number> {
  const v = (k: string) => (Number.isFinite(values[k]) ? values[k] : 0);

  if (sim === "lens" || sim === "mirror") {
    const f = sim === "lens" ? v("f") : v("R") / 2;
    const dO = v("dO");
    const hO = Number.isFinite(values.hO) ? values.hO : 1;
    const { dI, m } = thinLensImage(f, dO);
    return {
      dI,
      m,
      absM: Math.abs(m),
      hI: m * hO,
      isReal: Number.isFinite(dI) && dI > 0 ? 1 : 0,
      isUpright: Number.isFinite(m) && m > 0 ? 1 : 0,
    };
  }

  const n1 = v("n1");
  const n2 = v("n2");
  const thetaInc = v("thetaInc");
  const r = snell(n1, n2, thetaInc);
  const thetaRefr = r.thetaRefrDeg ?? NaN;
  return {
    thetaInc,
    thetaRefr,
    thetaCrit: r.criticalDeg ?? NaN,
    deflection: thetaInc - thetaRefr,
    reflRefrAngle: 180 - thetaInc - thetaRefr,
    tir: r.tir ? 1 : 0,
  };
}

/* ─── Evaluation ─── */

export interface OpticsEvaluation {
  isCorrect: boolean;
  achieved: Record<string, number>;
  perTarget: { description: string; ok: boolean; actual: number }[];
}

function checkOne(check: OpticsCheck, actual: number): boolean {
  if (!Number.isFinite(actual)) return false;
  switch (check.op) {
    case "eq":
      return Math.abs(actual - check.value) <= (check.tolerance ?? 0) + 1e-9;
    case "gte":
      return actual >= check.value - 1e-9;
    case "lte":
      return actual <= check.value + 1e-9;
    case "between":
      return actual >= check.value - 1e-9 && actual <= (check.value2 ?? check.value) + 1e-9;
    default:
      return false;
  }
}

/** Every target must pass. Values outside the adjustable ranges are
 *  clamped first so a tampered payload can't reach configurations the
 *  slider never offered. */
export function evaluateOpticsTask(task: OpticsTask, values: Record<string, number>): OpticsEvaluation {
  const merged: Record<string, number> = {};
  for (const p of task.fixed) merged[p.key] = p.value;
  for (const p of task.adjustable) {
    const raw = values[p.key];
    const x = Number.isFinite(raw) ? raw : p.initial;
    merged[p.key] = Math.min(p.max, Math.max(p.min, x));
  }
  const achieved = computeOpticsQuantities(task.sim, merged);
  const perTarget = task.target.map((t) => {
    const actual = achieved[t.check.quantity];
    return { description: t.description, ok: checkOne(t.check, actual ?? NaN), actual: actual ?? NaN };
  });
  return { isCorrect: perTarget.length > 0 && perTarget.every((t) => t.ok), achieved, perTarget };
}

/** Readable summary of the submitted configuration, e.g. "d_o = 15.0 cm, f = 10.0 cm".
 *  Stored in `answers[qid]` so 錯題本 / 測驗紀錄 (which render answers as text) stay sensible. */
export function formatOpticsAnswer(task: OpticsTask, values: Record<string, number>): string {
  return task.adjustable
    .map((p) => {
      const v = values[p.key];
      const text = Number.isFinite(v) ? v.toFixed(p.step < 1 ? 2 : 1) : "?";
      return `${p.label} = ${text}${p.unit ? ` ${p.unit}` : ""}`;
    })
    .join(", ");
}

/* ─── Seeded RNG ─── */

/** mulberry32 — tiny deterministic PRNG so the same seed reproduces a task. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
}

/* ─── Task bank ─── */

export interface GeneratedOpticsTask {
  task: OpticsTask;
  /** Question stem, Traditional Chinese, LaTeX allowed. */
  question: string;
  concept: string;
  /** Short worked solution. */
  explanation: string;
  /** Textual description of one valid configuration (shown as 正確答案). */
  correctAnswer: string;
  difficulty: "easy" | "medium" | "hard";
}

const fmt = (x: number, digits = 1) => Number(x.toFixed(digits)).toString();

/* Parameter presets shared by templates. */
const LENS_DO: OpticsParam = { key: "dO", label: "物距 d_o", unit: "cm", min: 2, max: 40, step: 0.5, initial: 20 };
const LENS_F: OpticsParam = { key: "f", label: "焦距 f", unit: "cm", min: 2, max: 25, step: 0.5, initial: 10 };
const MIRROR_DO: OpticsParam = { key: "dO", label: "物距 d_o", unit: "cm", min: 2, max: 40, step: 0.5, initial: 20 };
const MIRROR_R: OpticsParam = { key: "R", label: "曲率半徑 R", unit: "cm", min: 4, max: 50, step: 1, initial: 20 };
const HO_FIXED: OpticsFixedParam = { key: "hO", label: "物高 h_o", unit: "cm", value: 3 };
const THETA_INC: OpticsParam = { key: "thetaInc", label: "入射角 θ_i", unit: "°", min: 0, max: 89.5, step: 0.5, initial: 20 };
const N2_ADJ: OpticsParam = { key: "n2", label: "下方介質 n_2", min: 1, max: 2.5, step: 0.01, initial: 1.2 };

const MEDIA = [
  { n: 1.0, name: "空氣" },
  { n: 1.33, name: "水" },
  { n: 1.5, name: "玻璃" },
  { n: 2.42, name: "鑽石" },
] as const;

/* Each template returns a complete GeneratedOpticsTask; the bank below
 * indexes them by sim. Parameters are chosen so the exact solution lies
 * on the slider grid (see optics.test.ts, which sweeps ~50 seeds). */

function lensVirtualMagnified(rng: Rng): GeneratedOpticsTask {
  const k = pick(rng, [2, 3, 4]);
  const j = pick(rng, [3, 4, 5]);
  const f = k * j;                 // f = k·j → d_o = f(1 − 1/k) = j(k − 1), on grid
  const dO = j * (k - 1);
  return {
    task: {
      sim: "lens",
      adjustable: [{ ...LENS_DO, initial: Math.min(LENS_DO.max, 2 * f) }],
      fixed: [{ key: "f", label: "焦距 f", unit: "cm", value: f }, HO_FIXED],
      target: [
        { description: `放大率 M = +${k}（正立虛像，誤差 ±0.1）`, check: { quantity: "m", op: "eq", value: k, tolerance: 0.1 } },
      ],
    },
    question: `一片凸透鏡焦距 $f = ${f}\\ \\text{cm}$。請拖動物距 $d_o$，讓透鏡像放大鏡一樣產生 **放大 ${k} 倍的正立虛像**（$M = +${k}$）。`,
    concept: "薄透鏡成像：虛像與放大率",
    explanation: `虛像放大率 $M = -\\dfrac{d_i}{d_o} = \\dfrac{f}{f - d_o}$。令 $M = ${k}$ 得 $d_o = f\\left(1 - \\dfrac{1}{${k}}\\right) = ${fmt(dO)}\\ \\text{cm}$，此時 $d_o < f$，像為正立虛像。`,
    correctAnswer: `d_o = ${fmt(dO)} cm（f = ${f} cm）`,
    difficulty: "medium",
  };
}

function lensRealImageAt(rng: Rng): GeneratedOpticsTask {
  const [f, dI] = pick(rng, [[6, 18], [6, 24], [9, 18], [9, 27], [12, 24], [15, 30], [10, 30], [10, 20], [8, 24]] as const);
  const dO = (f * dI) / (dI - f);
  return {
    task: {
      sim: "lens",
      adjustable: [{ ...LENS_DO, initial: Math.min(LENS_DO.max, 3 * f) }],
      fixed: [{ key: "f", label: "焦距 f", unit: "cm", value: f }, HO_FIXED],
      target: [
        { description: `像距 d_i = ${dI} cm（誤差 ±0.5 cm）`, check: { quantity: "dI", op: "eq", value: dI, tolerance: 0.5 } },
        { description: "成實像", check: { quantity: "isReal", op: "eq", value: 1 } },
      ],
    },
    question: `凸透鏡焦距 $f = ${f}\\ \\text{cm}$。請調整物距，使 **實像** 恰好成在透鏡另一側 $d_i = ${dI}\\ \\text{cm}$ 處。`,
    concept: "薄透鏡公式：物距與像距",
    explanation: `由 $\\dfrac{1}{f} = \\dfrac{1}{d_o} + \\dfrac{1}{d_i}$ 得 $d_o = \\dfrac{f\\,d_i}{d_i - f} = \\dfrac{${f}\\times${dI}}{${dI}-${f}} = ${fmt(dO)}\\ \\text{cm}$。$d_i > 0$ 為實像。`,
    correctAnswer: `d_o = ${fmt(dO)} cm（f = ${f} cm）`,
    difficulty: "easy",
  };
}

function lensSameSize(rng: Rng): GeneratedOpticsTask {
  const adjustF = rng() < 0.5;
  const f = pick(rng, [5, 6, 8, 10, 12]);
  const dO = 2 * f;
  const target: OpticsTarget[] = [
    { description: "像與物等大 |M| = 1（誤差 ±0.05）", check: { quantity: "absM", op: "eq", value: 1, tolerance: 0.05 } },
    { description: "成實像", check: { quantity: "isReal", op: "eq", value: 1 } },
  ];
  if (adjustF) {
    return {
      task: {
        sim: "lens",
        adjustable: [{ ...LENS_F, initial: 2 }],
        fixed: [{ key: "dO", label: "物距 d_o", unit: "cm", value: dO }, HO_FIXED],
        target,
      },
      question: `物體固定放在凸透鏡前 $d_o = ${dO}\\ \\text{cm}$。請調整焦距 $f$，讓實像與物體 **等大**。`,
      concept: "薄透鏡：2f 位置成等大實像",
      explanation: `$|M| = 1$ 且為實像 ⇒ $d_i = d_o$，代入 $\\dfrac{1}{f} = \\dfrac{2}{d_o}$ 得 $f = \\dfrac{d_o}{2} = ${f}\\ \\text{cm}$，即物在 $2f$ 處。`,
      correctAnswer: `f = ${f} cm（d_o = ${dO} cm）`,
      difficulty: "easy",
    };
  }
  return {
    task: {
      sim: "lens",
      adjustable: [{ ...LENS_DO, initial: Math.min(LENS_DO.max, 3 * f + 2) }],
      fixed: [{ key: "f", label: "焦距 f", unit: "cm", value: f }, HO_FIXED],
      target,
    },
    question: `凸透鏡焦距 $f = ${f}\\ \\text{cm}$。請調整物距，讓實像與物體 **等大**（$|M| = 1$）。`,
    concept: "薄透鏡：2f 位置成等大實像",
    explanation: `等大實像須 $d_i = d_o$，由 $\\dfrac{1}{f} = \\dfrac{2}{d_o}$ 得 $d_o = 2f = ${dO}\\ \\text{cm}$。`,
    correctAnswer: `d_o = ${dO} cm（f = ${f} cm）`,
    difficulty: "easy",
  };
}

function lensDivergingReduced(rng: Rng): GeneratedOpticsTask {
  const k = pick(rng, [2, 3, 4]);                 // |M| = 1/k
  const fAbs = pick(rng, [5, 6, 8, 10]);
  const dO = fAbs * (k - 1);                      // M = |f|/(|f|+d_o) = 1/k
  return {
    task: {
      sim: "lens",
      adjustable: [{ ...LENS_DO, initial: 4 }],
      fixed: [{ key: "f", label: "焦距 f", unit: "cm", value: -fAbs }, HO_FIXED],
      target: [
        { description: `放大率 M = +1/${k} = ${fmt(1 / k, 3)}（誤差 ±0.02）`, check: { quantity: "m", op: "eq", value: 1 / k, tolerance: 0.02 } },
      ],
    },
    question: `凹透鏡焦距 $f = -${fAbs}\\ \\text{cm}$。請調整物距，使虛像縮小為物體的 $\\dfrac{1}{${k}}$（$M = +\\dfrac{1}{${k}}$）。`,
    concept: "凹透鏡：縮小正立虛像",
    explanation: `凹透鏡 $M = \\dfrac{f}{f - d_o} = \\dfrac{|f|}{|f| + d_o}$。令其等於 $\\dfrac{1}{${k}}$ 得 $d_o = (${k} - 1)|f| = ${dO}\\ \\text{cm}$。`,
    correctAnswer: `d_o = ${dO} cm（f = −${fAbs} cm）`,
    difficulty: "medium",
  };
}

function mirrorVirtualMagnified(rng: Rng): GeneratedOpticsTask {
  const k = pick(rng, [2, 3, 4]);
  const j = pick(rng, [2, 3, 4]);
  const f = k * j;
  const R = 2 * f;
  const dO = j * (k - 1);
  return {
    task: {
      sim: "mirror",
      adjustable: [{ ...MIRROR_DO, initial: Math.min(MIRROR_DO.max, 2 * f) }],
      fixed: [{ key: "R", label: "曲率半徑 R", unit: "cm", value: R }, HO_FIXED],
      target: [
        { description: `放大率 M = +${k}（正立虛像，誤差 ±0.1）`, check: { quantity: "m", op: "eq", value: k, tolerance: 0.1 } },
      ],
    },
    question: `凹面鏡曲率半徑 $R = ${R}\\ \\text{cm}$（化妝鏡原理）。請調整物距，產生 **放大 ${k} 倍的正立虛像**。`,
    concept: "球面鏡成像：凹面鏡虛像",
    explanation: `$f = R/2 = ${f}\\ \\text{cm}$。虛像放大率 $M = \\dfrac{f}{f - d_o}$，令 $M = ${k}$ 得 $d_o = f\\left(1 - \\dfrac{1}{${k}}\\right) = ${fmt(dO)}\\ \\text{cm}$（物在焦點內）。`,
    correctAnswer: `d_o = ${fmt(dO)} cm（R = ${R} cm）`,
    difficulty: "medium",
  };
}

function mirrorRealImageAt(rng: Rng): GeneratedOpticsTask {
  const [f, dI] = pick(rng, [[6, 18], [6, 24], [9, 18], [9, 27], [12, 24], [15, 30], [10, 30], [10, 20], [8, 24]] as const);
  const R = 2 * f;
  const dO = (f * dI) / (dI - f);
  return {
    task: {
      sim: "mirror",
      adjustable: [{ ...MIRROR_DO, initial: Math.min(MIRROR_DO.max, 3 * f) }],
      fixed: [{ key: "R", label: "曲率半徑 R", unit: "cm", value: R }, HO_FIXED],
      target: [
        { description: `像距 d_i = ${dI} cm（誤差 ±0.5 cm）`, check: { quantity: "dI", op: "eq", value: dI, tolerance: 0.5 } },
        { description: "成實像", check: { quantity: "isReal", op: "eq", value: 1 } },
      ],
    },
    question: `凹面鏡曲率半徑 $R = ${R}\\ \\text{cm}$。請調整物距，使 **實像** 成在鏡前 $d_i = ${dI}\\ \\text{cm}$ 處。`,
    concept: "球面鏡公式：物距與像距",
    explanation: `$f = R/2 = ${f}\\ \\text{cm}$，由 $\\dfrac{1}{f} = \\dfrac{1}{d_o} + \\dfrac{1}{d_i}$ 得 $d_o = \\dfrac{f\\,d_i}{d_i - f} = ${fmt(dO)}\\ \\text{cm}$。`,
    correctAnswer: `d_o = ${fmt(dO)} cm（R = ${R} cm）`,
    difficulty: "easy",
  };
}

function mirrorSameSize(rng: Rng): GeneratedOpticsTask {
  const adjustR = rng() < 0.5;
  const R = pick(rng, [10, 12, 16, 20, 24]);
  const target: OpticsTarget[] = [
    { description: "像與物等大 |M| = 1（誤差 ±0.05）", check: { quantity: "absM", op: "eq", value: 1, tolerance: 0.05 } },
    { description: "成實像", check: { quantity: "isReal", op: "eq", value: 1 } },
  ];
  if (adjustR) {
    return {
      task: {
        sim: "mirror",
        adjustable: [{ ...MIRROR_R, initial: 6 }],
        fixed: [{ key: "dO", label: "物距 d_o", unit: "cm", value: R }, HO_FIXED],
        target,
      },
      question: `物體固定在凹面鏡前 $d_o = ${R}\\ \\text{cm}$。請調整曲率半徑 $R$，讓實像與物體 **等大**。`,
      concept: "球面鏡：曲率中心成等大實像",
      explanation: `等大實像 ⇒ $d_i = d_o$，$\\dfrac{2}{R} = \\dfrac{2}{d_o}$，故 $R = d_o = ${R}\\ \\text{cm}$：物放在曲率中心 $C$ 時像也在 $C$。`,
      correctAnswer: `R = ${R} cm（d_o = ${R} cm）`,
      difficulty: "easy",
    };
  }
  return {
    task: {
      sim: "mirror",
      adjustable: [{ ...MIRROR_DO, initial: Math.min(MIRROR_DO.max, R + 10) }],
      fixed: [{ key: "R", label: "曲率半徑 R", unit: "cm", value: R }, HO_FIXED],
      target,
    },
    question: `凹面鏡曲率半徑 $R = ${R}\\ \\text{cm}$。請調整物距，讓實像與物體 **等大**。`,
    concept: "球面鏡：曲率中心成等大實像",
    explanation: `等大實像 ⇒ $d_i = d_o = 2f = R = ${R}\\ \\text{cm}$，即物體放在曲率中心。`,
    correctAnswer: `d_o = ${R} cm（R = ${R} cm）`,
    difficulty: "easy",
  };
}

function mirrorConvexReduced(rng: Rng): GeneratedOpticsTask {
  const k = pick(rng, [2, 3, 4]);
  const fAbs = pick(rng, [5, 6, 8, 10]);
  const R = -2 * fAbs;
  const dO = fAbs * (k - 1);
  return {
    task: {
      sim: "mirror",
      adjustable: [{ ...MIRROR_DO, initial: 4 }],
      fixed: [{ key: "R", label: "曲率半徑 R", unit: "cm", value: R }, HO_FIXED],
      target: [
        { description: `放大率 M = +1/${k} = ${fmt(1 / k, 3)}（誤差 ±0.02）`, check: { quantity: "m", op: "eq", value: 1 / k, tolerance: 0.02 } },
      ],
    },
    question: `凸面鏡曲率半徑 $R = ${R}\\ \\text{cm}$（$f = -${fAbs}\\ \\text{cm}$，如路口廣角鏡）。請調整物距，使虛像縮小為物體的 $\\dfrac{1}{${k}}$。`,
    concept: "凸面鏡：縮小正立虛像",
    explanation: `凸面鏡 $M = \\dfrac{|f|}{|f| + d_o}$，令其為 $\\dfrac{1}{${k}}$ 得 $d_o = (${k}-1)|f| = ${dO}\\ \\text{cm}$。`,
    correctAnswer: `d_o = ${dO} cm（R = ${R} cm）`,
    difficulty: "medium",
  };
}

function refractionCritical(rng: Rng): GeneratedOpticsTask {
  const dense = pick(rng, MEDIA.slice(1));                    // n1 > n2 required
  const rare = pick(rng, MEDIA.filter((m) => m.n < dense.n));
  const thetaC = Math.asin(rare.n / dense.n) / DEG;
  const lo = Number(thetaC.toFixed(2));
  return {
    task: {
      sim: "refraction",
      adjustable: [{ ...THETA_INC, initial: 10 }],
      fixed: [
        { key: "n1", label: `上方介質 n_1（${dense.name}）`, value: dense.n },
        { key: "n2", label: `下方介質 n_2（${rare.name}）`, value: rare.n },
      ],
      target: [
        { description: `入射角剛好達到臨界角：θ_c ≤ θ_i ≤ θ_c + 1°（θ_c ≈ ${fmt(thetaC)}°）`, check: { quantity: "thetaInc", op: "between", value: lo, value2: lo + 1 } },
        { description: "發生全反射", check: { quantity: "tir", op: "eq", value: 1 } },
      ],
    },
    question: `光從${dense.name}（$n_1 = ${dense.n}$）射向${rare.name}（$n_2 = ${rare.n}$）。請調整入射角，讓光線 **剛好開始全反射**（入射角落在臨界角到臨界角 +1° 之間）。`,
    concept: "全反射與臨界角",
    explanation: `臨界角由 $n_1 \\sin\\theta_c = n_2 \\sin 90^\\circ$ 得 $\\theta_c = \\sin^{-1}\\dfrac{${rare.n}}{${dense.n}} \\approx ${fmt(thetaC)}^\\circ$。$\\theta_i$ 略大於 $\\theta_c$ 時折射光消失，全部反射。`,
    correctAnswer: `θ_i ≈ ${fmt(Math.ceil(thetaC * 2) / 2)}°（θ_c ≈ ${fmt(thetaC)}°）`,
    difficulty: "medium",
  };
}

function refractionAngleTarget(rng: Rng): GeneratedOpticsTask {
  const thetaR = pick(rng, [20, 25, 30, 35]);
  const adjustN2 = rng() < 0.5;
  if (adjustN2) {
    // Only keep (n1, θ_i) combos whose solution n_2 sits inside the slider
    // range [1, 2.5] with some margin — θ_r = 20° from 50° in water needs
    // n_2 ≈ 2.98, which the student could never reach.
    const combos = [1.0, 1.33].flatMap((n1) =>
      [30, 40, 45, 50, 60].map((thetaI) => ({ n1, thetaI, n2: (n1 * Math.sin(thetaI * DEG)) / Math.sin(thetaR * DEG) })),
    ).filter((c) => c.n2 >= 1.05 && c.n2 <= 2.4);
    const { n1, thetaI, n2 } = pick(rng, combos);
    return {
      task: {
        sim: "refraction",
        adjustable: [{ ...N2_ADJ, initial: 1 }],
        fixed: [
          { key: "n1", label: "上方介質 n_1", value: n1 },
          { key: "thetaInc", label: "入射角 θ_i", unit: "°", value: thetaI },
        ],
        target: [
          { description: `折射角 θ_r = ${thetaR}°（誤差 ±0.5°）`, check: { quantity: "thetaRefr", op: "eq", value: thetaR, tolerance: 0.5 } },
        ],
      },
      question: `入射角固定 $\\theta_i = ${thetaI}^\\circ$，上方介質 $n_1 = ${n1}$。請調整下方介質的折射率 $n_2$，使折射角恰為 $${thetaR}^\\circ$。`,
      concept: "司乃耳定律（Snell's law）",
      explanation: `$n_1 \\sin\\theta_i = n_2 \\sin\\theta_r \\Rightarrow n_2 = \\dfrac{${n1}\\sin ${thetaI}^\\circ}{\\sin ${thetaR}^\\circ} \\approx ${fmt(n2, 2)}$。`,
      correctAnswer: `n_2 ≈ ${fmt(n2, 2)}（n_1 = ${n1}, θ_i = ${thetaI}°）`,
      difficulty: "medium",
    };
  }
  // n1 <= n2 so dθ_r/dθ_i < 1 and the 0.5° slider grid can always land
  // inside the ±0.5° tolerance.
  // Drop combos where sin θ_i = (n2/n1) sin θ_r would exceed 1 (e.g. air →
  // diamond can never refract as far as 35°) or would need a near-grazing θ_i.
  const pairs = [1.0, 1.33].flatMap((a) => MEDIA.filter((m) => m.n > a).map((m) => ({ n1: a, n2: m.n })))
    .filter(({ n1, n2 }) => (n2 * Math.sin(thetaR * DEG)) / n1 <= 0.95);
  const { n1, n2 } = pick(rng, pairs);
  const thetaI = Math.asin((n2 * Math.sin(thetaR * DEG)) / n1) / DEG;
  return {
    task: {
      sim: "refraction",
      adjustable: [{ ...THETA_INC, initial: 5 }],
      fixed: [
        { key: "n1", label: "上方介質 n_1", value: n1 },
        { key: "n2", label: "下方介質 n_2", value: n2 },
      ],
      target: [
        { description: `折射角 θ_r = ${thetaR}°（誤差 ±0.5°）`, check: { quantity: "thetaRefr", op: "eq", value: thetaR, tolerance: 0.5 } },
      ],
    },
    question: `光從 $n_1 = ${n1}$ 射入 $n_2 = ${n2}$。請調整入射角，使折射角恰為 $${thetaR}^\\circ$。`,
    concept: "司乃耳定律（Snell's law）",
    explanation: `$\\sin\\theta_i = \\dfrac{n_2}{n_1}\\sin\\theta_r = \\dfrac{${n2}}{${n1}}\\sin ${thetaR}^\\circ \\Rightarrow \\theta_i \\approx ${fmt(thetaI)}^\\circ$。`,
    correctAnswer: `θ_i ≈ ${fmt(thetaI)}°（n_1 = ${n1}, n_2 = ${n2}）`,
    difficulty: "easy",
  };
}

function refractionNoDeflection(rng: Rng): GeneratedOpticsTask {
  const medium = pick(rng, MEDIA.slice(1, 3));
  const thetaI = pick(rng, [30, 40, 50, 60]);
  return {
    task: {
      sim: "refraction",
      adjustable: [{ ...N2_ADJ, initial: 1 }],
      fixed: [
        { key: "n1", label: `上方介質 n_1（${medium.name}）`, value: medium.n },
        { key: "thetaInc", label: "入射角 θ_i", unit: "°", value: thetaI },
      ],
      target: [
        { description: "光線不偏折：θ_i − θ_r = 0（誤差 ±0.5°）", check: { quantity: "deflection", op: "eq", value: 0, tolerance: 0.5 } },
      ],
    },
    question: `光以 $\\theta_i = ${thetaI}^\\circ$ 從${medium.name}（$n_1 = ${medium.n}$）射向下方介質。請調整 $n_2$，讓光線 **穿過界面完全不偏折**。`,
    concept: "折射率匹配（index matching）",
    explanation: `不偏折代表 $\\theta_r = \\theta_i$，由 $n_1\\sin\\theta_i = n_2\\sin\\theta_r$ 得 $n_2 = n_1 = ${medium.n}$——兩介質光學性質相同時界面「消失」，這也是為什麼玻璃棒浸在折射率相近的油裡會看不見。`,
    correctAnswer: `n_2 = ${medium.n}（與 n_1 相同）`,
    difficulty: "easy",
  };
}

function refractionBrewster(rng: Rng): GeneratedOpticsTask {
  const n1 = pick(rng, [1.0, 1.33]);
  const n2 = pick(rng, MEDIA.filter((m) => m.n > n1)).n;
  const thetaB = Math.atan(n2 / n1) / DEG;
  return {
    task: {
      sim: "refraction",
      adjustable: [{ ...THETA_INC, initial: 10 }],
      fixed: [
        { key: "n1", label: "上方介質 n_1", value: n1 },
        { key: "n2", label: "下方介質 n_2", value: n2 },
      ],
      target: [
        { description: "反射光與折射光互相垂直（夾角 90°，誤差 ±0.5°）", check: { quantity: "reflRefrAngle", op: "eq", value: 90, tolerance: 0.5 } },
      ],
    },
    question: `光從 $n_1 = ${n1}$ 射向 $n_2 = ${n2}$。請調整入射角，使 **反射光與折射光互相垂直**（此時反射光為完全線偏振，即布魯斯特角）。`,
    concept: "布魯斯特角（反射偏振）",
    explanation: `反射光與折射光垂直 ⇒ $\\theta_i + \\theta_r = 90^\\circ$，$\\sin\\theta_r = \\cos\\theta_i$，代入司乃耳定律得 $\\tan\\theta_B = \\dfrac{n_2}{n_1} \\Rightarrow \\theta_B \\approx ${fmt(thetaB)}^\\circ$。`,
    correctAnswer: `θ_i ≈ ${fmt(thetaB)}°（tan θ_B = n_2/n_1）`,
    difficulty: "hard",
  };
}

const TEMPLATES: Record<OpticsSimKind, ((rng: Rng) => GeneratedOpticsTask)[]> = {
  lens: [lensVirtualMagnified, lensRealImageAt, lensSameSize, lensDivergingReduced],
  mirror: [mirrorVirtualMagnified, mirrorRealImageAt, mirrorSameSize, mirrorConvexReduced],
  refraction: [refractionCritical, refractionAngleTarget, refractionNoDeflection, refractionBrewster],
};

/** Number of templates per sim (exported for tests / UI copy). */
export const OPTICS_TEMPLATE_COUNT: Record<OpticsSimKind, number> = {
  lens: TEMPLATES.lens.length,
  mirror: TEMPLATES.mirror.length,
  refraction: TEMPLATES.refraction.length,
};

/**
 * Draw one task from the bank. `rng` is any `() => number` in [0, 1);
 * pass `seededRng(seed)` for reproducibility. `templateIndex` forces a
 * specific template (used by tests to sweep every one).
 */
export function generateOpticsTask(sim: OpticsSimKind, rng: Rng = Math.random, templateIndex?: number): GeneratedOpticsTask {
  const bank = TEMPLATES[sim];
  const idx = templateIndex ?? Math.floor(rng() * bank.length);
  return bank[Math.min(bank.length - 1, Math.max(0, idx))](rng);
}

/** Which sim a chapter maps to for interactive tasks (Ch33 refraction, Ch34 lens/mirror). */
export function opticsSimForChapter(chapter: number): OpticsSimKind[] {
  if (chapter === 33) return ["refraction"];
  if (chapter === 34) return ["lens", "mirror"];
  return [];
}
