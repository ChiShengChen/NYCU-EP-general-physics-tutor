import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, opaque carrier for an oral-exam question set.
 *
 * Why this exists: the 口試 route has to keep each question's model
 * answer + rubric hidden from the student for the whole session (the
 * examiner must never leak them), yet Vercel functions are stateless
 * and we have no server-side session store. Round-tripping the full
 * question set through the client is the simplest option — as long
 * as the client can't read or alter it. So `start` hands back the set
 * serialised + HMAC-signed, and every later `turn` / `finish` call
 * verifies the signature before trusting a single field. Tampering
 * (editing the rubric to make grading lenient, swapping questions)
 * fails verification and the route rejects with 400.
 *
 * Confidentiality note: base64 is encoding, not encryption — a curious
 * student *could* decode the payload in DevTools and read the model
 * answers. That's the same threat level as the quiz / exam modes,
 * which already ship `correctAnswer` to the client in plain JSON; the
 * signature is what matters, because it guarantees the grade we
 * persist was computed against the questions we actually generated.
 *
 * Secret: derived from SUPABASE_SERVICE_ROLE_KEY via SHA-256 with a
 * domain-separating label, so the raw service key is never used as an
 * HMAC key directly and a leaked payload signature can't be turned
 * back into the key. Tests pass an explicit secret instead of relying
 * on env.
 */

export type OralQuestionKind = "concept" | "derivation" | "application";

export interface OralQuestion {
  id: number;
  kind: OralQuestionKind;
  concept: string;
  question: string;
  /** Hidden from the client during the exam; revealed on the results screen. */
  modelAnswer: string;
  /** 3–5 key points the examiner probes for and the grader scores against. */
  rubric: string[];
  sourceChapter: number;
}

export interface OralExamPayload {
  sessionId: string;
  /** Chapters the student picked; empty when 依弱點 mode was used. */
  chapters: number[];
  questions: OralQuestion[];
  /** Epoch ms when `start` ran. Informational (shown nowhere yet). */
  createdAt: number;
}

const SECRET_LABEL = "nycu-physics-tutor/oral-exam-payload/v1";

/** Derive the HMAC key from the service role key. Throws when the env
 *  var is missing so a misconfigured deploy fails loudly at `start`
 *  rather than silently signing with an empty key. */
export function deriveOralSecret(serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY): Buffer {
  if (!serviceKey || !serviceKey.trim()) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to sign oral-exam payloads");
  }
  return createHash("sha256").update(`${SECRET_LABEL}:${serviceKey}`).digest();
}

function sign(data: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Serialise + sign. Output is `<base64url(json)>.<base64url(hmac)>`. */
export function signOralPayload(payload: OralExamPayload, secret: Buffer = deriveOralSecret()): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

/**
 * Verify + parse. Returns `null` for anything that isn't a well-formed,
 * correctly signed payload — callers map that to a 400. Never throws on
 * bad input; the only throw path is a missing secret (config error).
 */
export function verifyOralPayload(token: unknown, secret: Buffer = deriveOralSecret()): OralExamPayload | null {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Constant-time compare so a signature can't be guessed byte-by-byte
  // from timing differences. Length mismatch is an automatic reject
  // (timingSafeEqual throws on unequal lengths).
  const expected = Buffer.from(sign(data, secret), "utf8");
  const given = Buffer.from(sig, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isOralExamPayload(parsed)) return null;
  return parsed;
}

/** Structural check so a signed-but-malformed blob (shouldn't happen —
 *  only this module signs — but defence in depth) can't crash the route. */
function isOralExamPayload(v: unknown): v is OralExamPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  if (typeof p.sessionId !== "string" || typeof p.createdAt !== "number") return false;
  if (!Array.isArray(p.chapters) || !p.chapters.every((c) => typeof c === "number")) return false;
  if (!Array.isArray(p.questions) || p.questions.length === 0) return false;
  return p.questions.every((q) => {
    if (!q || typeof q !== "object") return false;
    const x = q as Record<string, unknown>;
    return typeof x.id === "number"
      && (x.kind === "concept" || x.kind === "derivation" || x.kind === "application")
      && typeof x.concept === "string"
      && typeof x.question === "string"
      && typeof x.modelAnswer === "string"
      && Array.isArray(x.rubric) && x.rubric.every((r) => typeof r === "string")
      && typeof x.sourceChapter === "number";
  });
}
