import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const PreviewSchema = z.object({
  concepts: z.array(
    z.object({
      title: z.string().describe("概念名稱（繁體中文，可帶英文，例如：動量守恆 Conservation of Momentum）"),
      summary: z.string().describe("1–2 句說明這個概念是什麼，繁體中文"),
      formula: z.string().describe("核心公式 LaTeX，**必須用 $$...$$ 包起來**（例如 $$\\\\vec{F} = m\\\\vec{a}$$）。若該概念本身沒有公式（如「自由體圖」），回傳空字串"),
      keyInsight: z.string().describe("一句重點提醒、常見迷思或物理直覺，繁體中文"),
      referencePage: z.number().describe("這個概念在該章講義第幾頁出現（從 1 開始的整數；若無法判定請填 1）"),
    }),
  ).min(5).max(7),
});

/** GET /api/preview?chapter=N — return preview for chapter N (cached). */
export async function GET(req: NextRequest) {
  const chapterParam = req.nextUrl.searchParams.get("chapter");
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!chapterParam) {
    return NextResponse.json({ error: "chapter required" }, { status: 400 });
  }
  const chapter = parseInt(chapterParam);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 31) {
    return NextResponse.json({ error: "invalid chapter" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 1) Try cache first
  if (!force) {
    const { data } = await supabase
      .from("chapter_previews")
      .select("content, generated_at")
      .eq("chapter_number", chapter)
      .single();
    if (data) {
      return NextResponse.json({
        chapter,
        content: data.content,
        generatedAt: data.generated_at,
        cached: true,
      });
    }
  }

  // 2) Cache miss — generate fresh
  const chunks = await retrieveChunks(
    "key concepts, central formulas, derivations, definitions, worked examples",
    { matchCount: 14, matchThreshold: 0.3, filterChapter: chapter },
  );
  const context = formatChunksForPrompt(chunks);
  const chLabel = `Ch${String(chapter).padStart(2, "0")}`;

  const { object } = await generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: PreviewSchema,
    prompt: `你正在為「普通物理」課程（楊本立老師）的學生準備 ${chLabel} 的「章節預習卡」。
目的：讓學生在深入讀講義之前，先快速 overview 這一章最重要的 5–7 個核心概念。

以下是 ${chLabel} 的教材內容：
${context}

請選出 5–7 個最重要、學生「必須掌握」的核心概念，每個輸出：
- title：概念名稱（繁體中文，可附英文）
- summary：1–2 句說明這個概念是什麼，避免抽象、用具體物理情境描述
- formula：**核心公式 LaTeX，必須用獨立公式分隔符 $$...$$ 包起來**（例如 $$\\vec{F} = m\\vec{a}$$、$$E = \\frac{1}{2}mv^2$$）。若該概念本身沒有公式（例如「自由體圖」），這個 field 留空字串
- keyInsight：一句最有用的重點提醒或常見迷思（例：「只在外力合 = 0 時動量才守恆」）
- referencePage：在講義中第幾頁出現（盡量根據教材內容判斷）

要求：
- 嚴選最關鍵的概念，不要列瑣碎細節
- 概念之間互不重複，盡量涵蓋整章的脈絡
- 公式用 LaTeX，繁體中文搭配必要英文
- 不要超過 7 個概念`,
  });

  // 3) Persist to cache (best effort)
  await supabase.from("chapter_previews").upsert(
    { chapter_number: chapter, content: object, generated_at: new Date().toISOString() },
    { onConflict: "chapter_number" },
  );

  return NextResponse.json({
    chapter,
    content: object,
    generatedAt: new Date().toISOString(),
    cached: false,
  });
}
