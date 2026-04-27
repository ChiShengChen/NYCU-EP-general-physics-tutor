import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** GET /api/lectures — list chapters with page counts and sections */
/** GET /api/lectures?chapter=3 — get all chunks for a specific chapter, ordered by page */
/** GET /api/lectures?chapter=3&page=2 — get chunks for a specific page */
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const chapter = req.nextUrl.searchParams.get("chapter");
  const page = req.nextUrl.searchParams.get("page");

  if (chapter && page) {
    const { data, error } = await supabase
      .from("lecture_chunks")
      .select("id, chapter_number, page_number, section_title, content, content_type, is_counterexample")
      .eq("chapter_number", parseInt(chapter))
      .eq("page_number", parseInt(page))
      .order("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ chunks: data });
  }

  if (chapter) {
    const { data, error } = await supabase
      .from("lecture_chunks")
      .select("id, chapter_number, page_number, section_title, content, content_type, is_counterexample")
      .eq("chapter_number", parseInt(chapter))
      .order("page_number")
      .order("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const pages: Record<number, { page_number: number; section_title: string; chunks: typeof data }> = {};
    for (const chunk of data ?? []) {
      if (!pages[chunk.page_number]) {
        pages[chunk.page_number] = {
          page_number: chunk.page_number,
          section_title: chunk.section_title || "",
          chunks: [],
        };
      }
      pages[chunk.page_number].chunks.push(chunk);
      if (chunk.section_title && !pages[chunk.page_number].section_title) {
        pages[chunk.page_number].section_title = chunk.section_title;
      }
    }

    return NextResponse.json({
      chapter: parseInt(chapter),
      pages: Object.values(pages).sort((a, b) => a.page_number - b.page_number),
    });
  }

  // No params: return overview of all chapters.
  // Page through Supabase's 1000-row default cap so all chapters are included.
  const data: { chapter_number: number; page_number: number; section_title: string }[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: rows, error } = await supabase
      .from("lecture_chunks")
      .select("chapter_number, page_number, section_title")
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) break;
    data.push(...rows);
    if (rows.length < pageSize) break;
  }

  const chapters: Record<number, { chapter_number: number; page_count: number; sections: string[] }> = {};
  for (const row of data ?? []) {
    if (!chapters[row.chapter_number]) {
      chapters[row.chapter_number] = { chapter_number: row.chapter_number, page_count: 0, sections: [] };
    }
    chapters[row.chapter_number].page_count = Math.max(chapters[row.chapter_number].page_count, row.page_number);
    if (row.section_title && !chapters[row.chapter_number].sections.includes(row.section_title)) {
      chapters[row.chapter_number].sections.push(row.section_title);
    }
  }

  return NextResponse.json({
    chapters: Object.values(chapters).sort((a, b) => a.chapter_number - b.chapter_number),
  });
}
