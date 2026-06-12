/**
 * Chapter-level dependency graph for the prerequisite path feature.
 *
 * The source of truth for chapter metadata + edges used to live inside
 * `components/knowledge-graph.tsx` (visualization-only). When we added
 * `/api/prereq-path`, the server needed the same edges to walk backwards
 * from a target chapter, so the data moved here and the component now
 * imports from this module. Keep `NODES` and `EDGES` in sync if you add a
 * new chapter — both the visualization and the prereq path traversal
 * read from the same arrays.
 */

export type ChapterCategory = "mechanics" | "waves_fluid" | "thermo" | "em" | "optics" | "modern";

export interface ChapterNode {
  id: string;        // "ch01"
  label: string;     // "向量與單位"
  chapter: number;   // 1..36
  category: ChapterCategory;
  x: number;
  y: number;
}

export interface ChapterEdge {
  from: string;
  to: string;
}

export const CHAPTER_NODES: ChapterNode[] = [
  // Mechanics — row 1 (Ch01–Ch07)
  { id: "ch01", label: "向量與單位", chapter: 1, category: "mechanics", x: 90, y: 60 },
  { id: "ch02", label: "1D 運動學", chapter: 2, category: "mechanics", x: 230, y: 60 },
  { id: "ch03", label: "2D/3D 運動", chapter: 3, category: "mechanics", x: 370, y: 60 },
  { id: "ch04", label: "牛頓運動定律", chapter: 4, category: "mechanics", x: 510, y: 60 },
  { id: "ch05", label: "牛頓定律應用", chapter: 5, category: "mechanics", x: 650, y: 60 },
  { id: "ch06", label: "功與動能", chapter: 6, category: "mechanics", x: 790, y: 60 },
  { id: "ch07", label: "位能與能量守恆", chapter: 7, category: "mechanics", x: 930, y: 60 },
  // Mechanics — row 2 (Ch08–Ch12)
  { id: "ch08", label: "動量與碰撞", chapter: 8, category: "mechanics", x: 90, y: 160 },
  { id: "ch09", label: "剛體轉動", chapter: 9, category: "mechanics", x: 230, y: 160 },
  { id: "ch10", label: "轉動動力學", chapter: 10, category: "mechanics", x: 370, y: 160 },
  { id: "ch11", label: "靜力平衡", chapter: 11, category: "mechanics", x: 510, y: 160 },
  { id: "ch12", label: "重力", chapter: 12, category: "mechanics", x: 650, y: 160 },

  // Waves & Fluid — row 3 (Ch13–Ch16)
  { id: "ch13", label: "簡諧運動", chapter: 13, category: "waves_fluid", x: 90, y: 280 },
  { id: "ch14", label: "流體力學", chapter: 14, category: "waves_fluid", x: 230, y: 280 },
  { id: "ch15", label: "機械波", chapter: 15, category: "waves_fluid", x: 370, y: 280 },
  { id: "ch16", label: "聲學", chapter: 16, category: "waves_fluid", x: 510, y: 280 },

  // Thermo — row 4 (Ch17–Ch20)
  { id: "ch17", label: "溫度與熱", chapter: 17, category: "thermo", x: 90, y: 400 },
  { id: "ch18", label: "理想氣體", chapter: 18, category: "thermo", x: 230, y: 400 },
  { id: "ch19", label: "熱力學第一定律", chapter: 19, category: "thermo", x: 370, y: 400 },
  { id: "ch20", label: "熱力學第二定律", chapter: 20, category: "thermo", x: 510, y: 400 },

  // EM — row 5 (Ch21–Ch26)
  { id: "ch21", label: "電荷與電場", chapter: 21, category: "em", x: 90, y: 520 },
  { id: "ch22", label: "高斯定律", chapter: 22, category: "em", x: 230, y: 520 },
  { id: "ch23", label: "電位", chapter: 23, category: "em", x: 370, y: 520 },
  { id: "ch24", label: "電容與介電質", chapter: 24, category: "em", x: 510, y: 520 },
  { id: "ch25", label: "電流與電阻", chapter: 25, category: "em", x: 650, y: 520 },
  { id: "ch26", label: "直流電路", chapter: 26, category: "em", x: 790, y: 520 },
  // EM — row 6 (Ch27–Ch32)
  { id: "ch27", label: "磁場與磁力", chapter: 27, category: "em", x: 90, y: 640 },
  { id: "ch28", label: "磁場來源", chapter: 28, category: "em", x: 230, y: 640 },
  { id: "ch29", label: "電磁感應", chapter: 29, category: "em", x: 370, y: 640 },
  { id: "ch30", label: "電感", chapter: 30, category: "em", x: 510, y: 640 },
  { id: "ch31", label: "交流電路", chapter: 31, category: "em", x: 650, y: 640 },
  { id: "ch32", label: "電磁波", chapter: 32, category: "em", x: 790, y: 640 },

  // Optics — row 7 (Ch33–Ch36)
  { id: "ch33", label: "光的傳播", chapter: 33, category: "optics", x: 90, y: 760 },
  { id: "ch34", label: "幾何光學", chapter: 34, category: "optics", x: 230, y: 760 },
  { id: "ch35", label: "干涉", chapter: 35, category: "optics", x: 370, y: 760 },
  { id: "ch36", label: "繞射", chapter: 36, category: "optics", x: 510, y: 760 },

  // Modern physics — row 8 (Ch37+)
  { id: "ch37", label: "相對論", chapter: 37, category: "modern", x: 90, y: 880 },
];

export const CHAPTER_EDGES: ChapterEdge[] = [
  // Mechanics chain
  { from: "ch01", to: "ch02" },
  { from: "ch02", to: "ch03" },
  { from: "ch03", to: "ch04" },
  { from: "ch04", to: "ch05" },
  { from: "ch04", to: "ch06" },
  { from: "ch06", to: "ch07" },
  { from: "ch04", to: "ch08" },
  { from: "ch07", to: "ch08" },
  { from: "ch03", to: "ch09" },
  { from: "ch09", to: "ch10" },
  { from: "ch04", to: "ch10" },
  { from: "ch10", to: "ch11" },
  { from: "ch04", to: "ch12" },
  // Waves / fluid
  { from: "ch07", to: "ch13" },
  { from: "ch04", to: "ch14" },
  { from: "ch13", to: "ch15" },
  { from: "ch15", to: "ch16" },
  // Thermo
  { from: "ch17", to: "ch18" },
  { from: "ch17", to: "ch19" },
  { from: "ch18", to: "ch19" },
  { from: "ch19", to: "ch20" },
  // EM
  { from: "ch21", to: "ch22" },
  { from: "ch21", to: "ch23" },
  { from: "ch22", to: "ch23" },
  { from: "ch23", to: "ch24" },
  { from: "ch23", to: "ch25" },
  { from: "ch25", to: "ch26" },
  { from: "ch24", to: "ch26" },
  { from: "ch25", to: "ch27" },
  { from: "ch27", to: "ch28" },
  { from: "ch27", to: "ch29" },
  { from: "ch29", to: "ch30" },
  { from: "ch30", to: "ch31" },
  { from: "ch26", to: "ch31" },
  { from: "ch29", to: "ch32" },
  { from: "ch31", to: "ch32" },
  // Optics
  { from: "ch32", to: "ch33" },
  { from: "ch33", to: "ch34" },
  { from: "ch33", to: "ch35" },
  { from: "ch15", to: "ch35" },
  { from: "ch35", to: "ch36" },
  // Special relativity: builds on EM-wave / light invariance (Ch32) and
  // the relativistic energy story extends mechanical energy (Ch07).
  { from: "ch32", to: "ch37" },
  { from: "ch07", to: "ch37" },
];

/**
 * Category lookup keyed by chapter number. Used by chapter-preview's
 * card colouring so it stays in sync with knowledge-graph and the
 * prereq-path API without needing a parallel hardcoded `if (ch <= 32)`
 * boundary table. Unknown chapters fall back to "modern" so future
 * additions don't crash the UI before this file is updated.
 */
export function categoryForChapter(chapter: number): ChapterCategory {
  const node = CHAPTER_NODES.find((n) => n.chapter === chapter);
  return node?.category ?? "modern";
}

export function chapterIdOf(n: number): string {
  return `ch${String(n).padStart(2, "0")}`;
}

export function chapterNumOf(id: string): number {
  return parseInt(id.slice(2), 10);
}

/**
 * Walk the chapter dependency graph backwards from `target` and return all
 * transitive prerequisites in topological order (deeper prereqs first,
 * direct prereqs closer to the target last). Cycles are guarded against
 * defensively, though the source data should be a DAG.
 *
 * Returned list does NOT include the target chapter itself.
 */
export function findPrereqChapters(target: number): number[] {
  const targetId = chapterIdOf(target);

  // Reverse adjacency: for each node, the set of chapters that point TO it
  // (i.e. its direct prereqs).
  const incoming = new Map<string, Set<string>>();
  for (const e of CHAPTER_EDGES) {
    if (!incoming.has(e.to)) incoming.set(e.to, new Set());
    incoming.get(e.to)!.add(e.from);
  }

  // BFS backwards collecting all ancestors.
  const visited = new Set<string>();
  const queue: string[] = [targetId];
  while (queue.length) {
    const cur = queue.shift()!;
    const parents = incoming.get(cur);
    if (!parents) continue;
    for (const p of parents) {
      if (visited.has(p)) continue;
      visited.add(p);
      queue.push(p);
    }
  }

  // Sort by chapter number for a stable, syllabus-aligned reading order.
  return Array.from(visited)
    .map(chapterNumOf)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}
