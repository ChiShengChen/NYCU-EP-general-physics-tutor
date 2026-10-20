import { z } from "zod";

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
 *
 * Since migration 024 the static arrays are the *default* only: admins can
 * store a `GraphOverride` (node title / group / hidden + added / removed
 * edges) in `concept_graph_overrides`, and `applyGraphOverride()` merges it
 * on top at read time. `/api/concept-graph` serves the merged result;
 * client components start from `STATIC_CHAPTER_GRAPH` and swap in the
 * merged graph when it arrives, so a DB outage never blanks the page.
 * Everything in this module stays pure (no Supabase) so it is unit-testable
 * and safe to import from client bundles.
 */

export const CHAPTER_CATEGORIES = ["mechanics", "waves_fluid", "thermo", "em", "optics", "modern"] as const;
export type ChapterCategory = (typeof CHAPTER_CATEGORIES)[number];

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

/* ─── Merged graph + admin override ─── */

export interface ChapterGraph {
  nodes: ChapterNode[];
  edges: ChapterEdge[];
}

/** The shipped default. Consumers use this as the SWR fallback for `/api/concept-graph`. */
export const STATIC_CHAPTER_GRAPH: ChapterGraph = { nodes: CHAPTER_NODES, edges: CHAPTER_EDGES };

/** Per-node edits. `title` → `label`, `group` → `category`; `hidden` drops the node and its edges. */
export interface GraphNodeOverride {
  title?: string;
  chapter?: number;
  group?: ChapterCategory;
  hidden?: boolean;
}

export interface GraphOverride {
  nodes: Record<string, GraphNodeOverride>;
  edges: { added: ChapterEdge[]; removed: ChapterEdge[] };
}

export const EMPTY_GRAPH_OVERRIDE: GraphOverride = { nodes: {}, edges: { added: [], removed: [] } };

export const GRAPH_TITLE_MAX = 40;

const EdgeSchema = z.object({
  from: z.string().trim().min(1).max(20),
  to: z.string().trim().min(1).max(20),
});

const NodeOverrideSchema = z.object({
  title: z.string().trim().min(1, "標題不可空白").max(GRAPH_TITLE_MAX).optional(),
  chapter: z.number().int().min(1).max(99).optional(),
  group: z.enum(CHAPTER_CATEGORIES).optional(),
  hidden: z.boolean().optional(),
});

const GraphOverrideSchema = z.object({
  nodes: z.record(z.string().max(20), NodeOverrideSchema).default({}),
  edges: z
    .object({
      added: z.array(EdgeSchema).max(500).default([]),
      removed: z.array(EdgeSchema).max(500).default([]),
    })
    .default({ added: [], removed: [] }),
});

export type GraphOverrideParseResult =
  | { ok: true; override: GraphOverride }
  | { ok: false; error: string };

/**
 * Shape-check an untrusted override document (request body / DB row). This
 * only validates types; semantic checks (unknown nodes, cycles, …) live in
 * `applyGraphOverride` so the admin UI gets one consistent error message.
 */
export function parseGraphOverride(raw: unknown): GraphOverrideParseResult {
  const parsed = GraphOverrideSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("；");
    return { ok: false, error: `override 格式錯誤：${msg}` };
  }
  return { ok: true, override: parsed.data };
}

export function edgeKey(e: ChapterEdge): string {
  return `${e.from}->${e.to}`;
}

export function isEmptyGraphOverride(o: GraphOverride): boolean {
  return (
    Object.keys(o.nodes).length === 0 &&
    o.edges.added.length === 0 &&
    o.edges.removed.length === 0
  );
}

/**
 * Canonical form of an override relative to `base`: drops node entries that
 * change nothing, `added` edges the base already has, `removed` edges the
 * base never had, and duplicates; sorts everything so two overrides with
 * the same effect serialize identically (the editor's "dirty" check and the
 * history list both compare JSON).
 */
export function normalizeGraphOverride(override: GraphOverride, base: ChapterGraph = STATIC_CHAPTER_GRAPH): GraphOverride {
  const baseNode = new Map(base.nodes.map((n) => [n.id, n] as const));
  const baseEdges = new Set(base.edges.map(edgeKey));

  const nodes: Record<string, GraphNodeOverride> = {};
  for (const id of Object.keys(override.nodes).sort()) {
    const o = override.nodes[id];
    const b = baseNode.get(id);
    if (!o || !b) continue;
    const out: GraphNodeOverride = {};
    const title = o.title?.trim();
    if (title && title !== b.label) out.title = title;
    if (o.chapter !== undefined && o.chapter !== b.chapter) out.chapter = o.chapter;
    if (o.group !== undefined && o.group !== b.category) out.group = o.group;
    if (o.hidden) out.hidden = true;
    if (Object.keys(out).length > 0) nodes[id] = out;
  }

  const dedupe = (list: ChapterEdge[], keep: (k: string) => boolean): ChapterEdge[] => {
    const seen = new Set<string>();
    const out: ChapterEdge[] = [];
    for (const e of list) {
      const k = edgeKey(e);
      if (seen.has(k) || !keep(k)) continue;
      seen.add(k);
      out.push({ from: e.from, to: e.to });
    }
    return out.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  };
  const removed = dedupe(override.edges.removed, (k) => baseEdges.has(k));
  const removedKeys = new Set(removed.map(edgeKey));
  // An edge that is both "removed" and "added" is just the base edge again.
  const added = dedupe(override.edges.added, (k) => !baseEdges.has(k) && !removedKeys.has(k));

  return { nodes, edges: { added, removed } };
}

export type ApplyGraphResult =
  | { ok: true; graph: ChapterGraph }
  | { ok: false; error: string; cycle?: string[] };

/**
 * Merge `override` onto `base` and return the resulting graph, or a
 * human-readable (zh-TW) error when the override is invalid:
 *   - every node id in `override.nodes` / edges must exist in `base`
 *   - no self edges
 *   - chapter numbers must stay unique
 *   - the merged graph must be a DAG; on a cycle the message lists it
 *     (e.g. 「Ch04 牛頓運動定律 → Ch06 功與動能 → Ch04 牛頓運動定律」)
 * Hidden nodes are dropped together with every edge touching them. Pure:
 * neither input is mutated.
 */
export function applyGraphOverride(base: ChapterGraph, override: GraphOverride): ApplyGraphResult {
  const baseIds = new Set(base.nodes.map((n) => n.id));

  const unknownNodes = Object.keys(override.nodes).filter((id) => !baseIds.has(id));
  if (unknownNodes.length) {
    return { ok: false, error: `未知節點：${unknownNodes.join("、")}` };
  }
  for (const [list, label] of [
    [override.edges.added, "新增"],
    [override.edges.removed, "移除"],
  ] as const) {
    for (const e of list) {
      if (!baseIds.has(e.from) || !baseIds.has(e.to)) {
        return { ok: false, error: `${label}的邊引用未知節點：${e.from} → ${e.to}` };
      }
      if (e.from === e.to) {
        return { ok: false, error: `${label}的邊不可指向自己：${e.from}` };
      }
    }
  }

  // Nodes.
  const nodes: ChapterNode[] = [];
  const hidden = new Set<string>();
  for (const n of base.nodes) {
    const o = override.nodes[n.id];
    if (!o) {
      nodes.push({ ...n });
      continue;
    }
    if (o.hidden) {
      hidden.add(n.id);
      continue;
    }
    const title = o.title?.trim();
    if (o.title !== undefined && !title) {
      return { ok: false, error: `${n.id} 的標題不可空白` };
    }
    if (title && title.length > GRAPH_TITLE_MAX) {
      return { ok: false, error: `${n.id} 的標題超過 ${GRAPH_TITLE_MAX} 字` };
    }
    if (o.chapter !== undefined && (!Number.isInteger(o.chapter) || o.chapter < 1)) {
      return { ok: false, error: `${n.id} 的章節編號無效：${o.chapter}` };
    }
    if (o.group !== undefined && !CHAPTER_CATEGORIES.includes(o.group)) {
      return { ok: false, error: `${n.id} 的分類無效：${o.group}` };
    }
    nodes.push({
      ...n,
      label: title ?? n.label,
      chapter: o.chapter ?? n.chapter,
      category: o.group ?? n.category,
    });
  }
  const seenChapter = new Map<number, string>();
  for (const n of nodes) {
    const dup = seenChapter.get(n.chapter);
    if (dup) {
      return { ok: false, error: `章節編號重複：${dup} 與 ${n.id} 都是 Ch${n.chapter}` };
    }
    seenChapter.set(n.chapter, n.id);
  }

  // Edges.
  const removed = new Set(override.edges.removed.map(edgeKey));
  const edgeMap = new Map<string, ChapterEdge>();
  for (const e of base.edges) {
    if (!removed.has(edgeKey(e))) edgeMap.set(edgeKey(e), { from: e.from, to: e.to });
  }
  for (const e of override.edges.added) {
    if (!removed.has(edgeKey(e))) edgeMap.set(edgeKey(e), { from: e.from, to: e.to });
  }
  const edges = Array.from(edgeMap.values()).filter((e) => !hidden.has(e.from) && !hidden.has(e.to));

  const cycle = findCycle(nodes.map((n) => n.id), edges);
  if (cycle) {
    const label = new Map(nodes.map((n) => [n.id, `Ch${String(n.chapter).padStart(2, "0")} ${n.label}`] as const));
    const pretty = cycle.map((id) => label.get(id) ?? id).join(" → ");
    return { ok: false, error: `先修關係形成循環：${pretty}`, cycle };
  }

  return { ok: true, graph: { nodes, edges } };
}

/**
 * Iterative DFS cycle finder. Returns the cycle as a closed walk
 * (`[a, b, c, a]`) or null when the graph is a DAG. Visits nodes in the
 * order given so the reported cycle is deterministic.
 */
export function findCycle(nodeIds: string[], edges: ChapterEdge[]): string[] | null {
  const out = new Map<string, string[]>();
  for (const id of nodeIds) out.set(id, []);
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e.to);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const start of out.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    color.set(start, GREY);
    parent.set(start, null);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const neighbours = out.get(top.id) ?? [];
      if (top.next < neighbours.length) {
        const nb = neighbours[top.next++];
        const c = color.get(nb) ?? WHITE;
        if (c === WHITE) {
          color.set(nb, GREY);
          parent.set(nb, top.id);
          stack.push({ id: nb, next: 0 });
        } else if (c === GREY) {
          // Back edge: unwind the parent chain from top.id back to nb.
          const path = [nb];
          let cur: string | null = top.id;
          const seg: string[] = [];
          while (cur && cur !== nb) {
            seg.push(cur);
            cur = parent.get(cur) ?? null;
          }
          seg.reverse();
          return [...path, ...seg, nb];
        }
      } else {
        color.set(top.id, BLACK);
        stack.pop();
      }
    }
  }
  return null;
}

/**
 * Walk the chapter dependency graph backwards from `target` and return all
 * transitive prerequisites in topological order (deeper prereqs first,
 * direct prereqs closer to the target last). Cycles are guarded against
 * defensively, though the source data should be a DAG.
 *
 * `graph` defaults to the static data; pass the merged graph (static +
 * admin override) to honour teacher edits.
 *
 * Returned list does NOT include the target chapter itself.
 */
export function findPrereqChapters(target: number, graph: ChapterGraph = STATIC_CHAPTER_GRAPH): number[] {
  const chapterOf = new Map(graph.nodes.map((n) => [n.id, n.chapter] as const));
  const targetId = graph.nodes.find((n) => n.chapter === target)?.id ?? chapterIdOf(target);

  // Reverse adjacency: for each node, the set of chapters that point TO it
  // (i.e. its direct prereqs).
  const incoming = new Map<string, Set<string>>();
  for (const e of graph.edges) {
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
    .map((id) => chapterOf.get(id) ?? chapterNumOf(id))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}
