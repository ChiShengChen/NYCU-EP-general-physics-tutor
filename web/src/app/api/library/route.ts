import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * 📝 例題庫 / 公式速查
 *
 * GET /api/library?q=<query>&kind=<formula|example|figure|all>&chapter=<N>
 *
 * Pulls from lecture_chunks. `kind` is best-effort heuristic on content +
 * content_type since the parsing pipeline doesn't explicitly label "this
 * chunk is an example". Search uses Postgres ILIKE; no vector RAG so we
 * avoid Gemini cost & latency — this is a reference lookup view.
 *
 *   formula  → content_type = 'formula' OR content contains $$..$$ block
 *   example  → content contains 例 / Example / 解 / 求 / 計算 keywords
 *   figure   → content_type = 'figure_description'
 *   all      → no kind filter
 */

const EXAMPLE_KEYWORDS = ["例 ", "例題", "例:", "例：", "Example", "EXAMPLE", "解：", "解:", "求：", "求:", "（解）", "(解)"];

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const kind = req.nextUrl.searchParams.get("kind") ?? "all";
  const chapterStr = req.nextUrl.searchParams.get("chapter");
  const chapter = chapterStr ? parseInt(chapterStr) : null;

  const supabase = createServiceClient();
  let query = supabase
    .from("lecture_chunks")
    .select("id, chapter_number, page_number, section_title, content, content_type")
    .order("chapter_number")
    .order("page_number")
    .order("id");

  if (chapter !== null) query = query.eq("chapter_number", chapter);

  if (kind === "formula") {
    query = query.eq("content_type", "formula");
  } else if (kind === "figure") {
    query = query.eq("content_type", "figure_description");
  }
  // For "example" + "all" we keep all rows and post-filter in JS (cheaper
  // than crafting a giant OR ilike with all keywords).

  if (q) {
    // Single substring filter — case-insensitive. Supabase escapes for us.
    query = query.ilike("content", `%${q}%`);
  }

  query = query.limit(300);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data ?? [];

  if (kind === "example") {
    rows = rows.filter((r) => EXAMPLE_KEYWORDS.some((kw) => (r.content ?? "").includes(kw)));
  }

  if (kind === "formula") {
    // Strengthen: must really contain a $$..$$ or significant LaTeX.
    rows = rows.filter((r) => /\$\$[\s\S]+?\$\$|\$[^$\n]{2,}\$/.test(r.content ?? ""));
  }

  // Group by chapter for the UI.
  const groups: Record<number, typeof rows> = {};
  for (const r of rows) {
    (groups[r.chapter_number] ??= []).push(r);
  }
  const byChapter = Object.entries(groups)
    .map(([ch, items]) => ({ chapter: parseInt(ch), items }))
    .sort((a, b) => a.chapter - b.chapter);

  return NextResponse.json({
    total: rows.length,
    byChapter,
  });
}
