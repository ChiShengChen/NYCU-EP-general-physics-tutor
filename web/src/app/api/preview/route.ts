import { google } from "@ai-sdk/google";
import { streamObject } from "ai";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { PreviewSchema } from "@/lib/preview-schema";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const MODEL_NAME = process.env.CHAT_MODEL ?? "gemini-2.5-flash";

function validChapter(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 37;
}

function buildPrompt(chapter: number, context: string): string {
  const chLabel = `Ch${String(chapter).padStart(2, "0")}`;
  return `你正在為「普通物理」課程（楊本立老師）的學生準備 ${chLabel} 的「章節預習卡」。
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
- 不要超過 7 個概念`;
}

/**
 * GET /api/preview?chapter=N
 *
 * Cache lookup only — fast and free. Returns the cached preview if one
 * exists for this chapter, otherwise `{ cached: false }`. Clients should
 * POST to this same route to trigger streaming generation on a miss.
 *
 * `?force=1` bypasses the cache (still returns cached:false so the client
 * follows up with POST, which overwrites).
 */
export async function GET(req: NextRequest) {
  const chapterParam = req.nextUrl.searchParams.get("chapter");
  if (!chapterParam) {
    return NextResponse.json({ error: "chapter required" }, { status: 400 });
  }
  const chapter = parseInt(chapterParam);
  if (!validChapter(chapter)) {
    return NextResponse.json({ error: "invalid chapter" }, { status: 400 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";

  if (force) {
    return NextResponse.json({ chapter, cached: false });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("chapter_previews")
    .select("content, generated_at")
    .eq("chapter_number", chapter)
    .single();

  if (data) {
    return NextResponse.json({
      chapter,
      content: restoreLatexInObject(data.content),
      generatedAt: data.generated_at,
      cached: true,
    });
  }
  return NextResponse.json({ chapter, cached: false });
}

/**
 * POST /api/preview { chapter: N }
 *
 * Streams a freshly generated preview via streamObject + the AI SDK text
 * stream protocol (matches `experimental_useObject` on the client). On
 * completion, restores LaTeX escapes and upserts into `chapter_previews`
 * so the next GET hits the cache.
 *
 * No retry wrapper here: a mid-stream failure can't be transparently
 * retried without losing partial progress — let the client offer a retry
 * button instead.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const chapter = Number(body?.chapter);
  const { studentId } = await resolveStudentId(body?.studentId);
  if (!validChapter(chapter)) {
    return NextResponse.json({ error: "invalid chapter" }, { status: 400 });
  }

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  const chunks = await retrieveChunks(
    "key concepts, central formulas, derivations, definitions, worked examples",
    { matchCount: 14, matchThreshold: 0.3, filterChapter: chapter },
  );
  const prompt = buildPrompt(chapter, formatChunksForPrompt(chunks));

  const result = streamObject({
    model: google(MODEL_NAME),
    schema: PreviewSchema,
    prompt,
  });

  // Cache the final, restored object once streaming finishes. Fire-and-
  // forget — the user has already received the streamed bytes.
  void result.object
    .then((obj) => {
      const restored = restoreLatexInObject(obj);
      const supabase = createServiceClient();
      return supabase.from("chapter_previews").upsert(
        { chapter_number: chapter, content: restored, generated_at: new Date().toISOString() },
        { onConflict: "chapter_number" },
      );
    })
    .catch(() => {});

  return result.toTextStreamResponse();
}
