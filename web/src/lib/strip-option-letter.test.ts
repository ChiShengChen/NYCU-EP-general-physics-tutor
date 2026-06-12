import { describe, expect, it } from "vitest";
import { stripOptionLetter } from "./strip-option-letter";

describe("stripOptionLetter", () => {
  it("strips a matching letter+dot prefix from the option text", () => {
    expect(stripOptionLetter("A. 兩種情況下高度相同", 0)).toBe("兩種情況下高度相同");
    expect(stripOptionLetter("B. 30° 時飛行時間較長", 1)).toBe("30° 時飛行時間較長");
    expect(stripOptionLetter("(C) 水平射程相同", 2)).toBe("水平射程相同");
    expect(stripOptionLetter("D、無法判斷", 3)).toBe("無法判斷");
  });

  it("ignores a letter that doesn't match the positional index", () => {
    // "A. ..." in slot 1 (which the UI labels B) → keep as-is so we
    // don't accidentally strip content where the letter is meaningful.
    expect(stripOptionLetter("A. 為真", 1)).toBe("A. 為真");
  });

  it("returns the option unchanged when there is no leading-letter prefix", () => {
    expect(stripOptionLetter("純文字選項", 0)).toBe("純文字選項");
    expect(stripOptionLetter("", 2)).toBe("");
  });

  it("handles lowercase letters", () => {
    expect(stripOptionLetter("a. lowercase", 0)).toBe("lowercase");
  });
});
