import { describe, expect, it } from "vitest";
import { restoreLatexEscapes, stripMetaCommentary } from "./restore-latex";

describe("restoreLatexEscapes", () => {
  it("unwraps single-line $$..$$ into inline $..$", () => {
    expect(restoreLatexEscapes("see $$c$$ here")).toBe("see $c$ here");
    expect(restoreLatexEscapes("$$\\gamma$$")).toBe("$\\gamma$");
    expect(restoreLatexEscapes("a $$c+v$$ b")).toBe("a $c+v$ b");
  });

  it("leaves multi-line display math alone", () => {
    const block = "$$\nx = 1\n+ 2\n$$";
    expect(restoreLatexEscapes(`pre\n${block}\npost`)).toBe(`pre\n${block}\npost`);
  });

  it("recovers JSON-escape collisions inside $..$ blocks", () => {
    // \f -> "\f" (form feed, U+000C); should become \\f
    const formfeed = String.fromCharCode(0x0c);
    expect(restoreLatexEscapes(`$${formfeed}rac{1}{2}$`)).toBe("$\\frac{1}{2}$");
  });

  it("is a no-op for plain text", () => {
    expect(restoreLatexEscapes("hello world")).toBe("hello world");
    expect(restoreLatexEscapes("")).toBe("");
  });
});

describe("stripMetaCommentary", () => {
  it("drops a trailing English thought-dump from a mixed Chinese/English answer", () => {
    const text =
      "牛頓第二定律告訴我們 F = ma。\n\n" +
      "The user asked about Newton's second law. " +
      "I have provided an explanation.\n\n" +
      "Now I need to silently update the student model.";
    expect(stripMetaCommentary(text)).toBe("牛頓第二定律告訴我們 F = ma。");
  });

  it("does NOT wipe an answer that's all English (legit translation request)", () => {
    const text =
      "Newton's second law states that F = ma.\n\n" +
      "This is the fundamental relation between force and acceleration.";
    expect(stripMetaCommentary(text)).toBe(text);
  });

  it("preserves a tail paragraph that has Chinese in it", () => {
    const text = "first.\n\n還有第二段。";
    expect(stripMetaCommentary(text)).toBe(text);
  });

  it("preserves short trailing English (e.g. a citation)", () => {
    const text = "牛頓第二定律。\n\n(Newton, 1687)";
    expect(stripMetaCommentary(text)).toBe(text);
  });

  it("handles empty input safely", () => {
    expect(stripMetaCommentary("")).toBe("");
  });
});
