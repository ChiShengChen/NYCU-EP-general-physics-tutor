import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { withLLMRetry } from "@/lib/llm-retry";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { checkIpRateLimit, ipRateLimitedResponse } from "@/lib/rate-limit";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { captureRouteError } from "@/lib/sentry";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const MODEL_NAME = process.env.CHAT_MODEL ?? "gemini-2.5-flash";

const NotesQuizSchema = z.object({
  notesSummary: z.string().describe("3–5 sentence Traditional Chinese summary of what concepts the notes cover — anchors the quiz so the student can confirm the OCR worked."),
  questions: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["multiple_choice", "short_answer"]),
      concept: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      question: z.string(),
      options: z.array(z.string()).optional().describe("4 plain option strings for multiple choice — do NOT prepend 'A.' / 'B.' etc., the UI adds the letter prefix when rendering."),
      correctAnswer: z.string(),
      explanation: z.string(),
    }),
  ).min(3).max(8),
});

/**
 * POST /api/notes-quiz
 * Body: { images: [{ url: data:..., mediaType: "image/..." }, …], studentId? }
 *
 * Take 1–4 photos of the student's own lecture notes / handwritten
 * notes, OCR them with Gemini's multimodal model, and emit 3–8 quiz
 * questions whose content is *grounded in what the photos actually
 * say*. The course textbook RAG is intentionally not consulted —
 * the whole point is that the student gets practice on the stuff
 * THEY chose to write down, even if it diverges from the syllabus.
 *
 * Nothing about the images is persisted server-side; the student's
 * notes don't enter the lecture corpus.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const images: { url?: unknown; mediaType?: unknown }[] = Array.isArray(body?.images) ? body.images : [];
  const cleanImages = images
    .map((img) => ({
      url: typeof img?.url === "string" ? img.url : "",
      mediaType: typeof img?.mediaType === "string" ? img.mediaType : "image/jpeg",
    }))
    .filter((img) => img.url.startsWith("data:") || img.url.startsWith("http"));
  if (cleanImages.length === 0 || cleanImages.length > 4) {
    return NextResponse.json({ error: "1–4 images required" }, { status: 400 });
  }

  const { studentId } = await resolveStudentId(body?.studentId);

  const rate = checkIpRateLimit(req);
  if (!rate.allowed) {
    const r = ipRateLimitedResponse(rate);
    return NextResponse.json(r.body, { status: r.status });
  }

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  const prompt = `你是交通大學電物系「普通物理」課程的 AI 助教。
學生上傳了 ${cleanImages.length} 張**自己的筆記照片**，請：

1. 用 OCR 讀出筆記內容（中英文 + LaTeX 公式都要識別）
2. 在 notesSummary 中用 3–5 句繁體中文摘要「這份筆記在講什麼概念」，讓學生確認你讀對了
3. 根據筆記**實際內容**出 3–8 道測驗題，題目核心概念必須來自筆記，不要憑空加入筆記沒有的東西

要求：
- type: 選擇題 (multiple_choice) 4 選項，或簡答題 (short_answer)
- difficulty: easy / medium / hard 都來一些
- concept: 標出該題對應的物理概念名稱（中文）
- options: 純文字，不要前綴 "A."/"B."，UI 會自己加
- correctAnswer: 選擇題寫 "A" / "B" / "C" / "D"；簡答寫完整參考答案
- explanation: 逐步解釋，引用筆記裡的關鍵語句
- 公式用 LaTeX（$..$ / $$..$$）

如果筆記內容太少或無法判讀，notesSummary 寫「筆記內容不清楚」並只出 1–2 題保守的題目。`;

  try {
    const { object } = await withLLMRetry(() => generateObject({
      model: google(MODEL_NAME),
      schema: NotesQuizSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...cleanImages.map((img) => ({
              type: "image" as const,
              image: img.url,
              mediaType: img.mediaType,
            })),
          ],
        },
      ],
    }), { studentId, endpoint: "/api/notes-quiz", model: MODEL_NAME, label: "notes-quiz" });

    return NextResponse.json(restoreLatexInObject(object));
  } catch (err) {
    captureRouteError(err, { endpoint: "/api/notes-quiz", studentId, meta: { imageCount: cleanImages.length } });
    return NextResponse.json({ error: "出題失敗，請稍後再試" }, { status: 500 });
  }
}
