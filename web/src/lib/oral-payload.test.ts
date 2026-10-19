import { describe, expect, it } from "vitest";
import {
  deriveOralSecret,
  signOralPayload,
  verifyOralPayload,
  type OralExamPayload,
} from "./oral-payload";

// Explicit secrets so the tests never depend on SUPABASE_SERVICE_ROLE_KEY
// being set in the CI environment.
const SECRET = deriveOralSecret("test-service-role-key");
const OTHER_SECRET = deriveOralSecret("a-different-key");

function samplePayload(): OralExamPayload {
  return {
    sessionId: "11111111-2222-3333-4444-555555555555",
    chapters: [3, 5],
    createdAt: 1_700_000_000_000,
    questions: [
      {
        id: 1,
        kind: "concept",
        concept: "動量守恆",
        question: "請用自己的話解釋動量守恆的成立條件。",
        modelAnswer: "系統所受合外力為零時，總動量 $\\sum \\vec p$ 守恆……",
        rubric: ["合外力為零", "內力成對抵消（牛頓第三定律）", "向量性質"],
        sourceChapter: 5,
      },
      {
        id: 2,
        kind: "derivation",
        concept: "功能定理",
        question: "從牛頓第二定律推導功能定理。",
        modelAnswer: "$W = \\int F\\,dx = \\int m\\frac{dv}{dt}dx = \\Delta K$",
        rubric: ["F = m dv/dt", "鏈鎖律換變數", "積分得 ½mv²"],
        sourceChapter: 3,
      },
    ],
  };
}

describe("signOralPayload / verifyOralPayload", () => {
  it("round-trips a payload through sign → verify", () => {
    const token = signOralPayload(samplePayload(), SECRET);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(2);
    expect(verifyOralPayload(token, SECRET)).toEqual(samplePayload());
  });

  it("is deterministic for the same payload + secret", () => {
    const a = signOralPayload(samplePayload(), SECRET);
    const b = signOralPayload(samplePayload(), SECRET);
    expect(a).toBe(b);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signOralPayload(samplePayload(), OTHER_SECRET);
    expect(verifyOralPayload(token, SECRET)).toBeNull();
  });

  it("rejects a tampered body (rubric edited after signing)", () => {
    const token = signOralPayload(samplePayload(), SECRET);
    const [data, sig] = token.split(".");
    const json = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as OralExamPayload;
    json.questions[0].rubric = ["任何回答都給滿分"];
    const forged = `${Buffer.from(JSON.stringify(json)).toString("base64url")}.${sig}`;
    expect(verifyOralPayload(forged, SECRET)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signOralPayload(samplePayload(), SECRET);
    const [data, sig] = token.split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyOralPayload(`${data}.${flipped}`, SECRET)).toBeNull();
    // Wrong length must not throw (timingSafeEqual would on unequal buffers).
    expect(verifyOralPayload(`${data}.${sig.slice(0, -4)}`, SECRET)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    expect(verifyOralPayload("", SECRET)).toBeNull();
    expect(verifyOralPayload("no-dot-here", SECRET)).toBeNull();
    expect(verifyOralPayload(".sigonly", SECRET)).toBeNull();
    expect(verifyOralPayload("dataonly.", SECRET)).toBeNull();
    expect(verifyOralPayload(undefined, SECRET)).toBeNull();
    expect(verifyOralPayload(42, SECRET)).toBeNull();
    expect(verifyOralPayload({ examPayload: "x" }, SECRET)).toBeNull();
  });

  it("rejects a correctly signed blob whose shape is not an exam payload", () => {
    // Sign something structurally wrong using the same primitive the
    // module uses, to prove the structural check runs after the HMAC.
    const bogus = { sessionId: "s", chapters: [], createdAt: 1, questions: [] } as unknown as OralExamPayload;
    const token = signOralPayload(bogus, SECRET);
    expect(verifyOralPayload(token, SECRET)).toBeNull();
  });

  it("keeps unicode + LaTeX backslashes intact through base64url", () => {
    const p = samplePayload();
    const back = verifyOralPayload(signOralPayload(p, SECRET), SECRET);
    expect(back?.questions[1].modelAnswer).toBe(p.questions[1].modelAnswer);
    expect(back?.questions[0].concept).toBe("動量守恆");
  });
});

describe("deriveOralSecret", () => {
  it("throws when no service key is available", () => {
    expect(() => deriveOralSecret("")).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => deriveOralSecret(undefined as unknown as string)).toThrow();
  });

  it("derives different keys for different inputs", () => {
    expect(SECRET.equals(OTHER_SECRET)).toBe(false);
    expect(SECRET.length).toBe(32);
  });
});
