/**
 * Per-mode model picker.
 *
 * Up to Wave 4 every AI route read `process.env.CHAT_MODEL ?? "gemini-2.5-flash"`
 * — one model for all eleven endpoints. That meant the cheap modes
 * (章節預習, hint) and the expensive ones (考試評分, export report)
 * paid the same per-call rate. Now we route by mode so:
 *
 *   - preview / hint / notes-quiz / chapter-preview → MODEL_LIGHT
 *       (Gemini Flash-Lite: ~half the cost of Flash, fine for short
 *        deterministic outputs)
 *   - chat / quiz / reflection / regen / compare / study-plan / class
 *       → MODEL_STANDARD (Gemini Flash, the default)
 *   - exam grading / export-report → MODEL_PREMIUM
 *       (Gemini Pro for higher-stakes outputs)
 *
 * Every env var is optional. Resolution order:
 *   MODEL_<MODE>  →  per-tier (MODEL_LIGHT / STANDARD / PREMIUM)
 *      →  legacy CHAT_MODEL  →  "gemini-2.5-flash" hardcoded fallback
 *
 * That means adopting the per-tier vars is a no-op for existing
 * deployments (CHAT_MODEL still wins if you keep using it) and the
 * full-grained MODEL_<MODE> override always takes precedence so an
 * admin can force one specific endpoint to a different model.
 */

export type AiMode =
  | "chat"
  | "quiz"
  | "exam"
  | "preview"
  | "chapter-preview"
  | "hint"
  | "reflection"
  | "regen"
  | "compare"
  | "notes-quiz"
  | "study-plan"
  | "export";

const MODE_TIER: Record<AiMode, "light" | "standard" | "premium"> = {
  preview: "light",
  "chapter-preview": "light",
  hint: "light",
  "notes-quiz": "light",
  chat: "standard",
  quiz: "standard",
  reflection: "standard",
  regen: "standard",
  compare: "standard",
  "study-plan": "standard",
  exam: "premium",
  export: "premium",
};

const TIER_DEFAULT: Record<"light" | "standard" | "premium", string> = {
  light: "gemini-2.5-flash-lite",
  standard: "gemini-2.5-flash",
  premium: "gemini-2.5-pro",
};

const ENV_VAR_BY_MODE: Record<AiMode, string> = {
  chat: "MODEL_CHAT",
  quiz: "MODEL_QUIZ",
  exam: "MODEL_EXAM",
  preview: "MODEL_PREVIEW",
  "chapter-preview": "MODEL_CHAPTER_PREVIEW",
  hint: "MODEL_HINT",
  reflection: "MODEL_REFLECTION",
  regen: "MODEL_REGEN",
  compare: "MODEL_COMPARE",
  "notes-quiz": "MODEL_NOTES_QUIZ",
  "study-plan": "MODEL_STUDY_PLAN",
  export: "MODEL_EXPORT",
};

export function pickModel(mode: AiMode): string {
  // 1. Mode-specific override.
  const specific = process.env[ENV_VAR_BY_MODE[mode]];
  if (specific && specific.trim()) return specific.trim();

  // 2. Tier override (LIGHT / STANDARD / PREMIUM).
  const tier = MODE_TIER[mode];
  const tierEnv = process.env[`MODEL_${tier.toUpperCase()}`];
  if (tierEnv && tierEnv.trim()) return tierEnv.trim();

  // 3. Legacy global. Honoured for backwards compatibility — without
  //    it a fresh deployment with no MODEL_* vars set still gets sane
  //    defaults per tier.
  const legacy = process.env.CHAT_MODEL;
  if (legacy && legacy.trim()) return legacy.trim();

  // 4. Hardcoded fallback per tier.
  return TIER_DEFAULT[tier];
}
