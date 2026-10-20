import { describe, expect, it } from "vitest";
import {
  UNSORTED_SET_TAG,
  blendMastery,
  compareSetTags,
  groupPastExamSets,
  isSetTag,
  normalizeMcAnswer,
  pickSetTag,
  rowInSet,
  snippetOf,
} from "./past-exams";

describe("isSetTag / pickSetTag", () => {
  it("accepts year-term tags and rejects the marker tag", () => {
    expect(isSetTag("2024-期中")).toBe(true);
    expect(isSetTag("2023-期末")).toBe(true);
    expect(isSetTag("2022-第一次期中")).toBe(true);
    expect(isSetTag("考古題")).toBe(false);
    expect(isSetTag("期中")).toBe(false);
    expect(isSetTag("24-期中")).toBe(false);
    expect(isSetTag("2024-")).toBe(false);
  });

  it("picks the first year-term tag regardless of order", () => {
    expect(pickSetTag(["考古題", "2024-期中", "計算"])).toBe("2024-期中");
    expect(pickSetTag([" 2023-期末 ", "考古題"])).toBe("2023-期末");
    expect(pickSetTag(["考古題"])).toBeNull();
    expect(pickSetTag(null)).toBeNull();
  });
});

describe("compareSetTags", () => {
  it("sorts newest year first, 期末 before 期中, unsorted last", () => {
    const tags = [UNSORTED_SET_TAG, "2023-期中", "2024-期中", "2023-期末", "2024-期末", "2024-小考"];
    expect([...tags].sort(compareSetTags)).toEqual([
      "2024-期末", "2024-期中", "2024-小考", "2023-期末", "2023-期中", UNSORTED_SET_TAG,
    ]);
  });
});

describe("groupPastExamSets", () => {
  it("groups by year-term tag with counts and sorted distinct chapters", () => {
    const sets = groupPastExamSets([
      { chapter: 5, tags: ["考古題", "2024-期中"] },
      { chapter: 3, tags: ["2024-期中", "考古題"] },
      { chapter: 5, tags: ["考古題", "2024-期中"] },
      { chapter: 20, tags: ["考古題", "2023-期末"] },
      { chapter: 9, tags: ["考古題"] },
    ]);
    expect(sets).toEqual([
      { tag: "2024-期中", count: 3, chapters: [3, 5] },
      { tag: "2023-期末", count: 1, chapters: [20] },
      { tag: UNSORTED_SET_TAG, count: 1, chapters: [9] },
    ]);
  });

  it("returns [] for no rows", () => {
    expect(groupPastExamSets([])).toEqual([]);
  });
});

describe("rowInSet", () => {
  it("matches the year-term tag or the unsorted bucket", () => {
    expect(rowInSet(["考古題", "2024-期中"], "2024-期中")).toBe(true);
    expect(rowInSet(["考古題", "2024-期中"], "2023-期末")).toBe(false);
    expect(rowInSet(["考古題"], UNSORTED_SET_TAG)).toBe(true);
  });
});

describe("normalizeMcAnswer", () => {
  it("accepts letters in the usual sloppy forms", () => {
    expect(normalizeMcAnswer("B")).toBe("B");
    expect(normalizeMcAnswer(" b ")).toBe("B");
    expect(normalizeMcAnswer("(c)")).toBe("C");
    expect(normalizeMcAnswer("D.")).toBe("D");
    expect(normalizeMcAnswer("A. 5 m/s^2")).toBe("A");
    expect(normalizeMcAnswer("B：答案")).toBe("B");
  });

  it("rejects anything that is not a single option letter", () => {
    expect(normalizeMcAnswer("")).toBeNull();
    expect(normalizeMcAnswer("E")).toBeNull();
    expect(normalizeMcAnswer("AB")).toBeNull();
    expect(normalizeMcAnswer("Ans")).toBeNull();
    expect(normalizeMcAnswer("5 m/s^2")).toBeNull();
  });
});

describe("blendMastery", () => {
  it("uses the 0.6 / 0.4 blend and clamps to [0, 1]", () => {
    expect(blendMastery(0, 1)).toBeCloseTo(0.4);
    expect(blendMastery(0.5, 0.5)).toBeCloseTo(0.5);
    expect(blendMastery(1, 0)).toBeCloseTo(0.6);
    expect(blendMastery(2, 2)).toBe(1);
    expect(blendMastery(-1, -1)).toBe(0);
  });
});

describe("snippetOf", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(snippetOf("  a \n b\t c ")).toBe("a b c");
    expect(snippetOf("x".repeat(200), 10)).toBe(`${"x".repeat(10)}…`);
  });
});
