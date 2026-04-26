import { google } from "@ai-sdk/google";
import { streamText, tool, convertToModelMessages } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt, type RetrievedChunk } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const QA_SYSTEM_PROMPT = `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教。

你的角色：
- 幫助學生理解普通物理的概念、公式推導、和物理意義（涵蓋力學、熱學、電磁學）
- 用繁體中文回答，專有名詞可附英文
- 數學公式用 LaTeX 格式：行內 $...$ 或獨立 $$...$$
- 回答時引用具體的教材內容（Ch 幾、哪個章節）

重要原則：
1. 優先根據提供的教材內容回答。如果教材中沒有相關內容，可以使用 webSearch 工具搜尋網路補充，但要標明來源
2. 如果檢索到標記為 ⚠️ 反例的內容，務必向學生說明那是錯誤示範，並解釋為什麼是錯的
3. 推導公式時，保持完整的邏輯鏈，不跳步驟（特別是向量與微積分形式的推導）
4. 如果學生的理解有誤，溫和地指出並引導到正確概念
5. 適時鼓勵學生，讓學習過程有正向回饋

以下是從教材中檢索到的相關內容：

{context}`;

const TEACHING_SYSTEM_PROMPT = `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，現在正在「教學模式」中。

你的角色：
- 根據以下講義內容，為學生提供清晰、完整的教學說明
- 用繁體中文教學，專有名詞可附英文
- 數學公式用 LaTeX 格式：行內 $...$ 或獨立 $$...$$

教學模式規則：
1. 學生正在逐頁閱讀講義，你要幫助他們理解當前頁面的內容
2. 系統性地解釋頁面中的概念、公式、圖表（包含力學自由體圖、向量分解、電磁場示意）
3. 推導公式時保持完整邏輯鏈，不跳步驟
4. 如果內容有標記為 ⚠️ 反例的部分，務必說明那是錯誤示範並解釋原因
5. 鼓勵學生提出問題，並針對當前頁面的內容回答追問
6. 適時連結前後章節的概念，幫助學生建立完整的物理直覺

當前講義內容（Ch{chapter}, Page {page}）：

{context}`;

export async function POST(req: Request) {
  const { messages, studentId, mode, chapterNumber, pageNumber } = await req.json();

  // Lazy-create anonymous student profile if needed
  if (studentId) {
    const supabase = createServiceClient();
    await supabase.from("student_profiles").upsert(
      { id: studentId, display_name: "匿名同學" },
      { onConflict: "id" },
    );
  }

  // v6 DefaultChatTransport sends UIMessage format (parts[]) — extract query text
  const lastUserMessage = [...messages].reverse().find((m: { role: string }) => m.role === "user");
  const query =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : (lastUserMessage?.parts as { type: string; text: string }[] | undefined)
          ?.filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("") ?? "";

  let context: string;
  let chunkIds: number[];
  let systemPrompt: string;

  if (mode === "teaching" && chapterNumber != null && pageNumber != null) {
    // Teaching mode: fetch chunks directly by chapter/page
    const supabaseForChunks = createServiceClient();
    const { data: pageChunks, error: chunkError } = await supabaseForChunks
      .from("lecture_chunks")
      .select("id, chapter_number, page_number, section_title, content, content_type, is_counterexample")
      .eq("chapter_number", chapterNumber)
      .eq("page_number", pageNumber)
      .order("id");

    if (chunkError) {
      console.error("Teaching mode chunk fetch error:", chunkError);
    }

    const chunks = (pageChunks ?? []).map((c) => ({
      ...c,
      similarity: 1,
    }));
    context = formatChunksForPrompt(chunks as RetrievedChunk[]);
    chunkIds = chunks.map((c) => c.id);
    systemPrompt = TEACHING_SYSTEM_PROMPT
      .replace("{chapter}", String(chapterNumber).padStart(2, "0"))
      .replace("{page}", String(pageNumber))
      .replace("{context}", context);
  } else {
    // Q&A mode: RAG similarity search
    const chunks = await retrieveChunks(query);
    context = formatChunksForPrompt(chunks);
    chunkIds = chunks.map((c) => c.id);
    systemPrompt = QA_SYSTEM_PROMPT.replace("{context}", context);
  }

  // Convert UIMessages → ModelMessages for streamText (with fallback for robustness)
  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch {
    // Fallback: manually build model messages from parts
    modelMessages = messages.map((m: { role: string; parts?: { type: string; text: string }[]; content?: string }) => {
      const text = m.parts?.filter(p => p.type === "text").map(p => p.text).join("") ?? m.content ?? "";
      return { role: m.role as "user" | "assistant", content: text };
    });
  }

  const result = streamText({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    system: systemPrompt,
    messages: modelMessages,
    tools: {
      updateStudentModel: tool({
        description:
          "After answering, assess the student's understanding and update their learning profile. " +
          "Call this silently after every substantive answer.",
        inputSchema: z.object({
          concept: z.string().describe("The physics concept discussed (e.g., 'Newtons_Second_Law', 'Conservation_of_Momentum', 'Gauss_Law', 'Faradays_Law', 'Simple_Harmonic_Motion')"),
          masteryScore: z.number().min(0).max(1).describe("Estimated mastery: 0=no understanding, 0.5=partial, 1=solid"),
          misconception: z.string().optional().describe("Any misconception detected in the student's question, or null"),
        }),
        execute: async ({ concept, masteryScore, misconception }) => {
          if (!studentId) return { status: "skipped" };

          const supabase = createServiceClient();
          const { error } = await supabase.from("student_state").upsert(
            {
              student_id: studentId,
              concept,
              mastery_score: masteryScore,
              attempt_count: 1,
              last_misconception: misconception ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "student_id,concept" },
          );

          if (error) console.error("Student model update error:", error);
          return { status: error ? "error" : "updated" };
        },
      }),
      webSearch: tool({
        description:
          "Search the web for general physics topics (mechanics, thermodynamics, electromagnetism) when the lecture materials don't cover the student's question. " +
          "Use this for supplementary information, worked examples, or topics beyond the course scope.",
        inputSchema: z.object({
          query: z.string().describe("Search query in English for better results"),
        }),
        execute: async ({ query: searchQuery }) => {
          const apiKey = process.env.BRAVE_SEARCH_API_KEY;
          if (!apiKey) return { results: [], error: "Web search not configured" };

          const res = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=3`,
            { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
          );

          if (!res.ok) return { results: [], error: res.statusText };

          const data = await res.json();
          return {
            results: (data.web?.results ?? []).slice(0, 3).map((r: { title: string; url: string; description: string }) => ({
              title: r.title,
              url: r.url,
              snippet: r.description,
            })),
          };
        },
      }),
    },
    onFinish: async ({ text }) => {
      if (!studentId || !text) return;
      const supabase = createServiceClient();
      await supabase.from("chat_messages").insert([
        { student_id: studentId, role: "user", content: query, chunks_used: chunkIds },
        { student_id: studentId, role: "assistant", content: text, chunks_used: chunkIds },
      ]);
    },
  });

  return result.toUIMessageStreamResponse();
}
