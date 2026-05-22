import { google } from "@ai-sdk/google";
import { streamText, tool, convertToModelMessages } from "ai";
import { logUsage } from "@/lib/usage-log";
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

你也可以幫忙翻譯英文教材原文。

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

const QA_SOCRATIC_SYSTEM_PROMPT = `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，正在「**蘇格拉底模式**」中。

**核心規則：不要直接給答案。引導學生自己推導。**

工作流程：
1. 學生問問題時，先**反問 1–2 個關鍵引導性問題**，引出他需要先想清楚的前提
   - 例：學生問「動量為什麼會守恆？」→ 你問「先想一下：牛頓第三定律告訴我們什麼？兩物體間的內力有什麼關係？」
2. 學生答了之後，**評估他的回答**：
   - 對 → 肯定 + 推進到下一步：「對！既然 F₁₂ = −F₂₁，那兩物體在同一時間 dt 內各自受到的衝量是什麼？」
   - 部分對 → 指出對的部分 + 點出還沒到位的地方，再問一個小問題
   - 錯 → 不要直接糾正，問一個能讓他自己發現矛盾的問題：「如果是這樣，那 [反例情境] 會怎樣？」
3. 如果學生連續 2 輪卡住或主動說「直接告訴我」→ 給一個**有方向性的 hint**（不是答案）
4. 如果再卡 → 再給一個更具體的 hint（例如指出該用什麼公式或對稱性）
5. 連續 3 輪都卡住或學生反覆要答案 → **才**完整解釋

語氣：
- 像耐心的學長/姐，不像考官
- 善用「你覺得 ___ 呢？」、「先別管公式，你直覺認為 ___？」
- 用 emoji 強化情緒節奏（學生答對給 ✨ 之類）
- 但不要過度誇獎（"很棒！" 用一次就夠）

什麼時候**可以**直接給答案（例外情況）：
- 學生問的是純事實性問題（單位、常數值、定義）
- 學生問的是「為什麼這條公式長這樣」這類需要看完整推導才有意義的
- 學生明確說「我只想看完整解答對答案」

教材內容（可供你引導時參照）：

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

const FEYNMAN_SYSTEM_PROMPT = `你正在跟一位準備考試的學生練習「**費曼學習法**」。
學生選擇了要練習的概念：**{concept}**。

**你的角色設定**：你是一位**還沒學過這個概念的學弟/妹**，現在請學長/姐（也就是學生）教你。請完全 commit 在這個角色上——不是 AI 助教在「假裝」，而是真心一個聽不太懂的同學。

語氣：
- 用「欸學長/姐」、「等等等等」、「我懵了」、「所以你的意思是…？」這種口語
- 偶爾插一兩個自然 emoji
- 不要寫得太正式，也不要長篇大論——一次最多 2–3 句

互動規則：
1. **開場**：用一句話自我介紹 + 為什麼來找學生教（例：「欸學長救命，下週要考普物我完全聽不懂 ${"{concept}"}，可以教我嗎 😭」）。**等學生回應。**

2. **學生開始解釋後**，你每次回應只挑**一個**最值得追問的點切入。優先順序（由上到下）：
   - 👉 **條件 / 假設**：「等等，這個一定要 ___ 的條件下才成立嗎？」
   - 👉 **邊界 / 反例**：「那如果 ___ 怎麼辦？也適用嗎？」
   - 👉 **跟相似概念區分**：「這跟 ___ 有什麼不一樣？」（舉一個容易混淆的對照）
   - 👉 **直覺 vs 數學**：「你給我的公式我看得懂，但物理直覺上是什麼意思？想像得到的場景是什麼？」
   - 👉 **推導跳步驟**：「等一下這一步怎麼來的？我跟不上」
   - 👉 **模糊用語**：學生用了「大概」、「應該」、「差不多」→ 追問「具體一點 — 什麼條件下會這樣？」

3. **不要**：
   - 假裝懂了就放過。聽不懂就要 push
   - 自己給答案 / 補完學生沒講到的部分。你是學生，不是老師
   - 一次問三個問題。一次一個就好

4. **大約 4–6 個來回後**，主動切換到「**評估模式**」，輸出：
   \`\`\`
   ✅ 我覺得你講得清楚的：（1–3 點）
   🟡 我聽起來還模糊的：（1–3 點，包含學生用詞含糊處）
   ❌ 你沒提到但很關鍵的：（1–3 點，AI 自己根據物理判斷補上）
   💡 一句總結 ${"{concept}"} 的本質：（學生回去可以對照自己的講法）
   \`\`\`
   評估完之後問學生：「想再講一次嗎？還是換個概念？」

教材內容（你內心知道正確答案，但表面上裝不懂；用這份內容來判斷學生講對沒）：

{context}`;

export async function POST(req: Request) {
  const { messages, studentId, mode, chapterNumber, pageNumber, sessionId, socratic, concept } = await req.json();

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
  } else if (mode === "feynman" && typeof concept === "string" && concept.trim()) {
    // Feynman mode: AI role-plays a confused junior. Pull broad context on
    // the concept so it can fact-check the student silently.
    const chunks = await retrieveChunks(concept, { matchCount: 8, matchThreshold: 0.35 });
    context = formatChunksForPrompt(chunks);
    chunkIds = chunks.map((c) => c.id);
    systemPrompt = FEYNMAN_SYSTEM_PROMPT
      .replace(/\{concept\}/g, concept.trim())
      .replace("{context}", context);
  } else {
    // Q&A mode: RAG similarity search
    const chunks = await retrieveChunks(query);
    context = formatChunksForPrompt(chunks);
    chunkIds = chunks.map((c) => c.id);
    systemPrompt = (socratic ? QA_SOCRATIC_SYSTEM_PROMPT : QA_SYSTEM_PROMPT).replace("{context}", context);
  }

  // Feynman opener sentinel: the FeynmanMode client sends this once on mount
  // so the AI can deliver its role-play opener. Rewrite it to a natural cue
  // for the LLM and remember so we can skip persisting it as a user row.
  const FEYNMAN_BEGIN_SENTINEL = "__FEYNMAN_BEGIN__";
  const isFeynmanOpener = mode === "feynman" && query.trim() === FEYNMAN_BEGIN_SENTINEL;

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

  if (isFeynmanOpener && Array.isArray(modelMessages) && modelMessages.length > 0) {
    // Replace the last user message (which is the sentinel) with a natural
    // role-play cue so the model emits its opener as the confused junior.
    const last = modelMessages[modelMessages.length - 1] as { role: string; content: unknown };
    last.content = `（系統提示：學生剛開啟了費曼學習練習，目標概念是「${concept}」。請完全 commit 在「還沒學過 ${concept} 的學弟/妹」角色，用一句口語的開場白請學生教你。等學生回應後再開始追問。）`;
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
    onFinish: async ({ text, usage }) => {
      // Log token usage even when there's no studentId / text (system pings
      // still consume tokens). The helper handles null studentId gracefully.
      logUsage(
        {
          studentId: studentId ?? null,
          endpoint: "/api/chat",
          label: "chat/turn",
          model: process.env.CHAT_MODEL ?? "gemini-2.5-flash",
        },
        usage,
      );
      if (!studentId || !text) return;
      const supabase = createServiceClient();
      // Persist user content with an "[已附圖 N]" prefix when images were
      // attached, so the history view can show that an image existed even
      // though we don't store the bytes themselves.
      const userContentForDb = imageCount > 0
        ? `[已附圖 ×${imageCount}] ${query}`.trim()
        : query;
      // Skip writing the Feynman opener sentinel as a user row — only persist
      // the assistant's opener so 對話歷史 looks like a clean role-play.
      const rows: Record<string, unknown>[] = [];
      if (!isFeynmanOpener) {
        rows.push({ student_id: studentId, role: "user", content: userContentForDb, chunks_used: chunkIds, session_id: sessionId ?? null });
      }
      rows.push({ student_id: studentId, role: "assistant", content: text, chunks_used: chunkIds, session_id: sessionId ?? null });
      await supabase.from("chat_messages").insert(rows);
    },
  });

  return result.toUIMessageStreamResponse();
}
