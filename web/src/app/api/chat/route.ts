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
6. 如果學生附了圖片（公式、題目、自由體圖、電路圖、相量圖、向量圖等），請嚴格依下面流程作答，**不要跳步驟**：

   STEP 1 — 視覺事實層（只描述，不推論）：
   - 條列圖中每個有 label 的物件（向量、力、座標軸、節點…）：寫出「這個 label 是 [X]，它的位置 / 方向 / 與其他物件的相對關係」
   - 例如相量圖：「向量 $I_\\max$ 為紫色，與 +x 軸夾約 60°；向量 $\\Delta V_\\max$ 為橘色，與 +x 軸夾約 30°」
   - 如果圖片不清楚或顏色不易辨識，**明確標示「我不確定」**並請學生確認

   STEP 1.5 — 若是「圖示」（相量圖、自由體圖、向量圖、電路圖、幾何圖），呼叫 \`sketchVisualUnderstanding\` 工具吐一個 SVG，把你 STEP 1 描述的東西重畫一遍給學生看。**只有當原圖含有幾何元素時呼叫此工具**；單純的公式照片或文字截圖不必呼叫。

   STEP 2 — 物理慣例層（敘述你要用的判準）：
   - 寫出你將套用的物理定義 / 慣例（例：「相量圖以逆時針方向視為相位超前；$\\phi$ 定義為 V 相對於 I 的相位」）
   - 對應的公式（例：$\\tan\\phi = (X_L - X_C)/R$）

   STEP 3 — 推論層：
   - 用 STEP 1 觀察 + STEP 2 慣例 → 推出結論
   - **自我檢查**：回頭驗證每個句子的主詞與你 STEP 1 的描述是否一致。如果你寫了「X 領先 Y」就停下來確認「X 在 STEP 1 是不是真的逆時針超前 Y」
   - 如果 STEP 1 描述跟結論互相矛盾，**重新從 STEP 1 開始**，不要硬推

7. 如果學生指出你判斷錯誤，立刻重新走一次 STEP 1–3，不要捍衛先前的答案。學生對著實體圖片，視覺判斷通常更可靠。

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
7. 如果圖片中有相量圖、自由體圖、向量圖、電路圖等需要視覺判讀的圖示，依下面三步驟作答：
   - STEP 1 視覺事實：先逐一條列每個有 label 的物件（label 是什麼、位置 / 方向 / 與其他物件的相對關係），不確定的地方明說「不確定」
   - STEP 1.5 若是幾何圖（相量、自由體、向量、電路、幾何），呼叫 \`sketchVisualUnderstanding\` 工具重畫你看到的，給學生對照
   - STEP 2 物理慣例：寫出你要套用的定義或公式（例：$\\phi$ 是 V 相對於 I 的相位、逆時針 = 超前）
   - STEP 3 推論並自我檢查：用 STEP 1+2 推導，最後檢查每個結論的主詞跟 STEP 1 描述是否一致；若打架，重新從 STEP 1 開始
   - 若學生指出你判斷錯，立刻重做，不要捍衛先前答案

當前講義內容（Ch{chapter}, Page {page}）：

{context}`;

export async function POST(req: Request) {
  const { messages, studentId, mode, chapterNumber, pageNumber, sessionId } = await req.json();

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
  type Part = { type: string; text?: string; mediaType?: string };
  const lastParts = (lastUserMessage?.parts as Part[] | undefined) ?? [];
  const query =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : lastParts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");

  // Count image attachments on the latest user turn (used both for the
  // RAG query and for tagging the persisted chat_messages row).
  const imageCount = lastParts.filter(
    (p) => p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image/"),
  ).length;

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
      sketchVisualUnderstanding: tool({
        description:
          "Use this immediately after STEP 1 of the structured visual-reasoning workflow, whenever the student attached an image that contains a diagram " +
          "(phasor diagram, free-body diagram, vector diagram, circuit, geometric figure). " +
          "Emit a minimal SVG that re-draws what you observed: each labelled object with its name, position, direction. " +
          "Skip this tool for photos of typed text / formulas where there is nothing geometric to draw. " +
          "Students will compare your sketch with their original image and immediately tell you if anything was misread. " +
          "Keep the SVG self-contained (no external resources) and keep it small (≤ 480px wide).",
        inputSchema: z.object({
          title: z.string().describe("Short label for the sketch in Traditional Chinese, e.g. '相量圖 (a) — 我看到的'"),
          svg: z.string().describe(
            "Self-contained SVG markup. MUST start with <svg ...> and end with </svg>. " +
            "Use a viewBox like '0 0 320 240' so it scales. Add labels with <text>. " +
            "Use stroke colors that distinguish vectors (e.g. purple for current, orange for voltage). " +
            "Do NOT include <script>, on* attributes, javascript: URIs, or any external <image href>. " +
            "If you must label LaTeX, just write the variable name in plain text (e.g. 'I_max', 'phi') — students will understand.",
          ),
          notes: z.string().optional().describe("Optional 1-line caption summarising the key visual feature, e.g. 'I_max 比 ΔV_max 更靠近 +y 軸'"),
        }),
        execute: async ({ title, svg, notes }) => ({ title, svg, notes: notes ?? "" }),
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
      // Persist user content with an "[已附圖 N]" prefix when images were
      // attached, so the history view can show that an image existed even
      // though we don't store the bytes themselves.
      const userContentForDb = imageCount > 0
        ? `[已附圖 ×${imageCount}] ${query}`.trim()
        : query;
      await supabase.from("chat_messages").insert([
        { student_id: studentId, role: "user", content: userContentForDb, chunks_used: chunkIds, session_id: sessionId ?? null },
        { student_id: studentId, role: "assistant", content: text, chunks_used: chunkIds, session_id: sessionId ?? null },
      ]);
    },
  });

  return result.toUIMessageStreamResponse();
}
