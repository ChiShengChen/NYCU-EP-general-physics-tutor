import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  STATIC_CHAPTER_GRAPH,
  applyGraphOverride,
  parseGraphOverride,
  type ChapterGraph,
} from "@/lib/concept-graph";

export const maxDuration = 10;

/**
 * GET /api/concept-graph
 *
 * Public, cacheable. Returns the chapter graph students see: the static
 * `STATIC_CHAPTER_GRAPH` with the admin override from
 * `concept_graph_overrides` (key = 'chapter', migration 024) merged on top.
 *
 *   { nodes: ChapterNode[], edges: ChapterEdge[],
 *     overridden: boolean, updatedAt: string | null }
 *
 * Failure modes degrade to the static graph instead of erroring: a missing
 * table, an unreachable DB or a row that no longer validates (e.g. the
 * static graph changed underneath it) all return `overridden: false` with
 * the shipped data, so the 概念圖譜 page never blanks. Clients use the
 * static graph as their SWR fallback for the same reason.
 */
export async function GET() {
  const { graph, overridden, updatedAt } = await loadMergedGraph();
  return NextResponse.json(
    { nodes: graph.nodes, edges: graph.edges, overridden, updatedAt },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}

async function loadMergedGraph(): Promise<{ graph: ChapterGraph; overridden: boolean; updatedAt: string | null }> {
  const fallback = { graph: STATIC_CHAPTER_GRAPH, overridden: false, updatedAt: null };
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("concept_graph_overrides")
      .select("data, updated_at")
      .eq("key", "chapter")
      .maybeSingle();
    if (error || !data) return fallback;
    const parsed = parseGraphOverride(data.data);
    if (!parsed.ok) return fallback;
    const applied = applyGraphOverride(STATIC_CHAPTER_GRAPH, parsed.override);
    if (!applied.ok) return fallback;
    return { graph: applied.graph, overridden: true, updatedAt: (data.updated_at as string | null) ?? null };
  } catch {
    return fallback;
  }
}
