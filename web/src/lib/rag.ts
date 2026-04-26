import { createServiceClient } from "./supabase/server";
import { google } from "@ai-sdk/google";
import { embed } from "ai";

const EMBED_MODEL = process.env.EMBEDDING_MODEL ?? "gemini-embedding-001";

export interface RetrievedChunk {
  id: number;
  chapter_number: number;
  page_number: number;
  section_title: string;
  content: string;
  content_type: string;
  is_counterexample: boolean;
  similarity: number;
}

export async function retrieveChunks(
  query: string,
  options: { matchCount?: number; matchThreshold?: number; filterChapter?: number } = {},
): Promise<RetrievedChunk[]> {
  const { matchCount = 6, matchThreshold = 0.65, filterChapter } = options;

  const { embedding } = await embed({
    model: google.embedding(EMBED_MODEL),
    value: query,
    providerOptions: {
      google: { outputDimensionality: 768 },
    },
  });

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    filter_chapter: filterChapter ?? null,
  });

  if (error) {
    console.error("RAG retrieval error:", error);
    return [];
  }

  return data as RetrievedChunk[];
}

export function formatChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "（未找到相關教材內容）";

  return chunks
    .map((c) => {
      const prefix = c.is_counterexample ? "⚠️ [此為反例/錯誤示範]\n" : "";
      const chapterLabel = `Ch${String(c.chapter_number).padStart(2, "0")}`;
      const source = `[${chapterLabel}, Page ${c.page_number}${c.section_title ? ` — ${c.section_title}` : ""}]`;
      return `${source}\n${prefix}${c.content}`;
    })
    .join("\n\n---\n\n");
}
