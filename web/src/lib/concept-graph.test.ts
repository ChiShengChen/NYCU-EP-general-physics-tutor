import { describe, expect, it } from "vitest";
import {
  CHAPTER_NODES,
  CHAPTER_EDGES,
  findPrereqChapters,
  categoryForChapter,
  chapterIdOf,
  chapterNumOf,
} from "./concept-graph";

describe("CHAPTER_NODES / CHAPTER_EDGES integrity", () => {
  it("has unique chapter numbers for every node", () => {
    const seen = new Set<number>();
    for (const n of CHAPTER_NODES) {
      expect(seen.has(n.chapter)).toBe(false);
      seen.add(n.chapter);
    }
  });

  it("references only known chapter IDs from every edge", () => {
    const ids = new Set(CHAPTER_NODES.map((n) => n.id));
    for (const e of CHAPTER_EDGES) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it("contains Ch37 with category modern", () => {
    const ch37 = CHAPTER_NODES.find((n) => n.chapter === 37);
    expect(ch37).toBeDefined();
    expect(ch37?.category).toBe("modern");
  });
});

describe("chapterIdOf / chapterNumOf", () => {
  it("formats single-digit chapters with a leading zero", () => {
    expect(chapterIdOf(1)).toBe("ch01");
    expect(chapterIdOf(12)).toBe("ch12");
    expect(chapterIdOf(37)).toBe("ch37");
  });

  it("round-trips through chapterNumOf", () => {
    for (const n of [1, 5, 16, 24, 37]) {
      expect(chapterNumOf(chapterIdOf(n))).toBe(n);
    }
  });
});

describe("categoryForChapter", () => {
  it("returns the actual node's category, not a hardcoded boundary", () => {
    expect(categoryForChapter(1)).toBe("mechanics");
    expect(categoryForChapter(15)).toBe("waves_fluid");
    expect(categoryForChapter(20)).toBe("thermo");
    expect(categoryForChapter(28)).toBe("em");
    expect(categoryForChapter(34)).toBe("optics");
    expect(categoryForChapter(37)).toBe("modern");
  });

  it("falls back to modern for unknown chapters", () => {
    expect(categoryForChapter(99)).toBe("modern");
  });
});

describe("findPrereqChapters", () => {
  it("returns an empty list for entry chapters with no incoming edges", () => {
    // Ch01 is the very first node in the graph, no edges point to it.
    expect(findPrereqChapters(1)).toEqual([]);
  });

  it("traverses transitive prereqs in syllabus order", () => {
    // Ch04 (Newton's laws) needs Ch03 (2D/3D motion) → Ch02 (1D kinematics)
    // → Ch01 (vectors). Order is sorted ascending.
    const prereqs = findPrereqChapters(4);
    expect(prereqs).toEqual([1, 2, 3]);
  });

  it("includes Ch07 + Ch32 in the Ch37 (relativity) prereq set", () => {
    const prereqs = findPrereqChapters(37);
    expect(prereqs).toContain(7);
    expect(prereqs).toContain(32);
  });

  it("never returns the target chapter itself", () => {
    for (const ch of [5, 10, 26, 37]) {
      expect(findPrereqChapters(ch)).not.toContain(ch);
    }
  });
});
