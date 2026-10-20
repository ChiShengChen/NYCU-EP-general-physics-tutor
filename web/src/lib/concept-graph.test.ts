import { describe, expect, it } from "vitest";
import {
  CHAPTER_NODES,
  CHAPTER_EDGES,
  STATIC_CHAPTER_GRAPH,
  EMPTY_GRAPH_OVERRIDE,
  findPrereqChapters,
  categoryForChapter,
  chapterIdOf,
  chapterNumOf,
  applyGraphOverride,
  parseGraphOverride,
  normalizeGraphOverride,
  isEmptyGraphOverride,
  findCycle,
  type ChapterGraph,
  type GraphOverride,
} from "./concept-graph";

const override = (partial: Partial<GraphOverride>): GraphOverride => ({
  nodes: partial.nodes ?? {},
  edges: { added: partial.edges?.added ?? [], removed: partial.edges?.removed ?? [] },
});

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

describe("STATIC_CHAPTER_GRAPH", () => {
  it("is a DAG (no cycles in the shipped data)", () => {
    expect(findCycle(CHAPTER_NODES.map((n) => n.id), CHAPTER_EDGES)).toBeNull();
  });

  it("round-trips through applyGraphOverride with an empty override", () => {
    const res = applyGraphOverride(STATIC_CHAPTER_GRAPH, EMPTY_GRAPH_OVERRIDE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.graph.nodes).toEqual(CHAPTER_NODES);
    expect(res.graph.edges).toEqual(CHAPTER_EDGES);
    // Pure: the static arrays are untouched and not aliased.
    expect(res.graph.nodes).not.toBe(CHAPTER_NODES);
  });
});

describe("parseGraphOverride", () => {
  it("fills in defaults for a missing / partial document", () => {
    expect(parseGraphOverride(undefined)).toEqual({ ok: true, override: EMPTY_GRAPH_OVERRIDE });
    expect(parseGraphOverride({ nodes: { ch01: { hidden: true } } })).toEqual({
      ok: true,
      override: { nodes: { ch01: { hidden: true } }, edges: { added: [], removed: [] } },
    });
  });

  it("rejects wrong types with a path in the message", () => {
    const res = parseGraphOverride({ nodes: { ch01: { group: "chemistry" } } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("nodes.ch01.group");
  });

  it("rejects an edge without a target", () => {
    const res = parseGraphOverride({ edges: { added: [{ from: "ch01" }] } });
    expect(res.ok).toBe(false);
  });
});

describe("applyGraphOverride", () => {
  it("applies title / group / chapter edits to a node", () => {
    const res = applyGraphOverride(
      STATIC_CHAPTER_GRAPH,
      override({ nodes: { ch12: { title: "萬有引力", group: "modern", chapter: 50 } } }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const n = res.graph.nodes.find((x) => x.id === "ch12")!;
    expect(n.label).toBe("萬有引力");
    expect(n.category).toBe("modern");
    expect(n.chapter).toBe(50);
    // Untouched nodes are preserved verbatim.
    expect(res.graph.nodes.find((x) => x.id === "ch11")).toEqual(CHAPTER_NODES.find((x) => x.id === "ch11"));
  });

  it("drops hidden nodes together with their edges", () => {
    const res = applyGraphOverride(STATIC_CHAPTER_GRAPH, override({ nodes: { ch13: { hidden: true } } }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.graph.nodes.some((n) => n.id === "ch13")).toBe(false);
    expect(res.graph.edges.some((e) => e.from === "ch13" || e.to === "ch13")).toBe(false);
    // ch07→ch13 and ch13→ch15 gone, everything else intact.
    expect(res.graph.edges.length).toBe(CHAPTER_EDGES.length - 2);
  });

  it("adds and removes edges", () => {
    const res = applyGraphOverride(
      STATIC_CHAPTER_GRAPH,
      override({ edges: { added: [{ from: "ch04", to: "ch13" }], removed: [{ from: "ch07", to: "ch13" }] } }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.graph.edges).toContainEqual({ from: "ch04", to: "ch13" });
    expect(res.graph.edges).not.toContainEqual({ from: "ch07", to: "ch13" });
    expect(findPrereqChapters(13, res.graph)).toEqual([1, 2, 3, 4]);
  });

  it("treats 'added' duplicates of base edges and 'removed' unknown edges as no-ops", () => {
    const res = applyGraphOverride(
      STATIC_CHAPTER_GRAPH,
      override({ edges: { added: [{ from: "ch01", to: "ch02" }], removed: [{ from: "ch01", to: "ch37" }] } }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.graph.edges).toEqual(CHAPTER_EDGES);
  });

  it("rejects self edges", () => {
    const res = applyGraphOverride(STATIC_CHAPTER_GRAPH, override({ edges: { added: [{ from: "ch05", to: "ch05" }], removed: [] } }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("ch05");
  });

  it("rejects unknown node ids in nodes and edges", () => {
    expect(applyGraphOverride(STATIC_CHAPTER_GRAPH, override({ nodes: { ch99: { hidden: true } } })).ok).toBe(false);
    const res = applyGraphOverride(STATIC_CHAPTER_GRAPH, override({ edges: { added: [{ from: "ch01", to: "ch99" }], removed: [] } }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("ch99");
  });

  it("rejects duplicate chapter numbers after an edit", () => {
    const res = applyGraphOverride(STATIC_CHAPTER_GRAPH, override({ nodes: { ch02: { chapter: 1 } } }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Ch1");
  });

  it("rejects a cycle and names every chapter on it", () => {
    // ch02→ch03→ch04 exist; closing ch04→ch02 makes a 3-cycle.
    const res = applyGraphOverride(STATIC_CHAPTER_GRAPH, override({ edges: { added: [{ from: "ch04", to: "ch02" }], removed: [] } }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.cycle).toBeDefined();
    expect(res.cycle![0]).toBe(res.cycle![res.cycle!.length - 1]);
    expect(new Set(res.cycle)).toEqual(new Set(["ch02", "ch03", "ch04"]));
    expect(res.error).toContain("1D 運動學");
    expect(res.error).toContain("牛頓運動定律");
    expect(res.error).toContain("→");
  });

  it("lets a removed edge break the cycle an added edge would otherwise create", () => {
    const res = applyGraphOverride(
      STATIC_CHAPTER_GRAPH,
      override({ edges: { added: [{ from: "ch02", to: "ch01" }], removed: [{ from: "ch01", to: "ch02" }] } }),
    );
    expect(res.ok).toBe(true);
  });

  it("ignores edges to a hidden node when checking for cycles", () => {
    const res = applyGraphOverride(
      STATIC_CHAPTER_GRAPH,
      override({ nodes: { ch03: { hidden: true } }, edges: { added: [{ from: "ch04", to: "ch02" }], removed: [] } }),
    );
    // ch02→ch03→ch04→ch02 would be a cycle, but ch03 is hidden so ch02→ch03 is gone.
    expect(res.ok).toBe(true);
  });
});

describe("normalizeGraphOverride / isEmptyGraphOverride", () => {
  it("drops no-op node entries and base-duplicate edges", () => {
    const n = normalizeGraphOverride(
      override({
        nodes: {
          ch01: { title: "向量與單位", group: "mechanics", hidden: false },
          ch02: { title: "  運動學 " },
        },
        edges: {
          added: [{ from: "ch01", to: "ch02" }, { from: "ch04", to: "ch13" }, { from: "ch04", to: "ch13" }],
          removed: [{ from: "ch01", to: "ch37" }, { from: "ch07", to: "ch13" }],
        },
      }),
    );
    expect(n).toEqual({
      nodes: { ch02: { title: "運動學" } },
      edges: { added: [{ from: "ch04", to: "ch13" }], removed: [{ from: "ch07", to: "ch13" }] },
    });
  });

  it("cancels an edge that is both removed and re-added", () => {
    const n = normalizeGraphOverride(
      override({ edges: { added: [{ from: "ch01", to: "ch02" }], removed: [{ from: "ch01", to: "ch02" }] } }),
    );
    expect(n.edges.added).toEqual([]);
    expect(n.edges.removed).toEqual([{ from: "ch01", to: "ch02" }]);
  });

  it("reports emptiness", () => {
    expect(isEmptyGraphOverride(EMPTY_GRAPH_OVERRIDE)).toBe(true);
    expect(isEmptyGraphOverride(override({ nodes: { ch01: { hidden: true } } }))).toBe(false);
  });
});

describe("findCycle", () => {
  it("returns null for a DAG and a closed walk for a cycle", () => {
    expect(findCycle(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }])).toBeNull();
    const cyc = findCycle(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }]);
    expect(cyc).toEqual(["a", "b", "c", "a"]);
  });

  it("finds a cycle that is not reachable from the first node", () => {
    const cyc = findCycle(["x", "a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }]);
    expect(cyc).toEqual(["a", "b", "a"]);
  });
});

describe("findPrereqChapters with a merged graph", () => {
  it("uses overridden chapter numbers", () => {
    const merged: ChapterGraph = {
      nodes: [
        { id: "ch01", label: "A", chapter: 10, category: "mechanics", x: 0, y: 0 },
        { id: "ch02", label: "B", chapter: 20, category: "mechanics", x: 0, y: 0 },
      ],
      edges: [{ from: "ch01", to: "ch02" }],
    };
    expect(findPrereqChapters(20, merged)).toEqual([10]);
    expect(findPrereqChapters(10, merged)).toEqual([]);
  });
});
