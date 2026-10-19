import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { pickModel } from "@/lib/models";
import { retrieveChunks, type RetrievedChunk } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { withLLMRetry } from "@/lib/llm-retry";
import { addBreadcrumb } from "@/lib/sentry";

/**
 * AI 錯題分析 — one structured diagnosis per attempt.
 *
 * Why this lives in lib/ instead of inline in the route: the same analysis
 * is wanted from three places today (結果頁, 測驗紀錄, 錯題本) and from a
 * future "考完寄 email 報告" job. Keeping it a plain async function with
 * no Request/Response coupling means the cron / edge-function version is
 * just `await analyzeAttempt(...)` + a mail call.
 *
 * Pipeline:
 *   1. Load the attempt (ownership-checked) and pick the wrong questions.
 *   2. For each wrong question, pull the 4 most similar lecture chunks
 *      restricted to its sourceChapter. These become the ONLY pages the
 *      LLM is allowed to cite, so every (chapter, page) we show the student
 *      is a real slide — never a hallucinated page number.
 *   3. One generateObject call produces: error-type per question, a short
 *      diagnosis + fix, which candidate pages to re-read and why, and a
 *      prioritised review plan.
 *   4. Post-validate page citations against the candidate set, then cache
 *      in attempt_analyses keyed by attempt_id + prompt_version.
 */

export const ANALYSIS_PROMPT_VERSION = process.env.ANALYSIS_PROMPT_VERSION?.trim() || "v1";

const MODEL_NAME = pickModel("analysis");

/* ─── Shapes ─── */

/** Mirror of the question object stored in attempts.questions. We only
 *  read the fields the analysis needs; extra keys (options, optics, …)
 *  are ignored. */
interface StoredQuestion {
  id: number;
  type: string;
  concept?: string;
  question: string;
  correctAnswer?: string;
  explanation?: string;
  sourceChapter?: number;
}

interface StoredResult {
  questionId: number;
  isCorrect: boolean;
  score: number;
  feedback?: string;
}

interface StoredAttempt {
  id: number;
  student_id: string;
  kind: string;
  title: string;
  questions: StoredQuestion[];
  answers: Record<string, string>;
  results: StoredResult[];
  total_score: number;
  max_score: number;
  created_at: string;
}

const LecturePageSchema = z.object({
  chapter: z.number(),
  page: z.number(),
  sectionTitle: z.string().describe("候選片段的 section_title，沒有就空字串"),
  why: z.string().describe("一句話：為什麼要回去看這一頁"),
});

const QuestionAnalysisSchema = z.object({
  questionId: z.number(),
  errorType: z.enum(["concept", "calculation", "reading", "incomplete", "unanswered"])
    .describe("concept=概念誤解, calculation=計算/代數錯, reading=審題/條件看錯, incomplete=方向對但不完整, unanswered=未作答"),
  diagnosis: z.string().describe("1–2 句：學生到底錯在哪（引用學生的答案）"),
  fix: z.string().describe("1–2 句：正確的思路 / 關鍵公式"),
  lecturePages: z.array(LecturePageSchema).min(1).max(3)
    .describe("只能從候選講義頁裡挑，1–3 頁"),
});

const ReviewItemSchema = z.object({
  chapter: z.number(),
  pages: z.array(z.number()).min(1),
  reason: z.string(),
  priority: z.number().int().min(1).max(3).describe("1 = 最優先"),
});

export const AnalysisSchema = z.object({
  summary: z.string().describe("2–3 句整體診斷，直接對學生說話"),
  errorPatterns: z.array(z.object({
    label: z.string().describe("例：『動能與功的正負號』、『看漏題目給的初速條件』"),
    questionIds: z.array(z.number()),
  })).describe("跨題目的共同錯誤模式，0–3 個"),
  questions: z.array(QuestionAnalysisSchema),
  reviewPlan: z.array(ReviewItemSchema).max(5)
    .describe("建議複習順序，依優先度排序"),
});

export type AttemptAnalysis = z.infer<typeof AnalysisSchema>;

export interface AnalysisRecord {
  attemptId: number;
  analysis: AttemptAnalysis;
  promptVersion: string;
  model: string | null;
  createdAt: string;
  /** True when this call hit the cache rather than the LLM. */
  cached: boolean;
}

/* ─── Helpers ─── */

function chapterLabel(ch?: number): string {
  return ch ? `Ch${String(ch).padStart(2, "0")}` : "Ch??";
}

function errorTypeLabel(t: AttemptAnalysis["questions"][number]["errorType"]): string {
  return {
    concept: "概念誤解",
    calculation: "計算錯誤",
    reading: "審題錯誤",
    incomplete: "回答不完整",
    unanswered: "未作答",
  }[t];
}

/** Candidate chunks for one wrong question, retrieved within its chapter
 *  so the citations stay on-topic even when the embedding similarity is
 *  low for short MC stems. Falls back to a cross-chapter search when the
 *  question has no sourceChapter (older rows). */
async function candidatePages(q: StoredQuestion): Promise<RetrievedChunk[]> {
  const query = `${q.concept ?? ""} ${q.question.slice(0, 300)}`.trim() || "physics concept";
  const chunks = await retrieveChunks(query, {
    matchCount: 4,
    matchThreshold: 0.3,
    filterChapter: q.sourceChapter,
  });
  if (chunks.length > 0 || !q.sourceChapter) return chunks;
  // Chapter filter returned nothing (e.g. chapter not ingested yet) —
  // widen so the student still gets *some* pointer.
  return retrieveChunks(query, { matchCount: 3, matchThreshold: 0.3 });
}

/** Ensure every page the model cited was in the candidate set. The prompt
 *  already says "only pick from candidates" but Gemini occasionally
 *  invents a neighbouring page number; a wrong slide link is worse than
 *  no link, so we drop those and fall back to the top candidate. */
function validatePages(
  analysis: AttemptAnalysis,
  candidates: Map<number, RetrievedChunk[]>,
): AttemptAnalysis {
  const questions = analysis.questions.map((qa) => {
    const allowed = candidates.get(qa.questionId) ?? [];
    const allowedKeys = new Set(allowed.map((c) => `${c.chapter_number}:${c.page_number}`));
    let pages = qa.lecturePages.filter((p) => allowedKeys.has(`${p.chapter}:${p.page}`));
    if (pages.length === 0 && allowed.length > 0) {
      const top = allowed[0];
      pages = [{
        chapter: top.chapter_number,
        page: top.page_number,
        sectionTitle: top.section_title ?? "",
        why: "這一頁是教材裡跟這題最相關的段落。",
      }];
    }
    // De-dupe (same chapter+page cited twice).
    const seen = new Set<string>();
    pages = pages.filter((p) => {
      const k = `${p.chapter}:${p.page}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...qa, lecturePages: pages };
  });

  // Review plan: keep only chapters/pages that appear somewhere in the
  // per-question citations so the plan can't point at phantom pages.
  const citedByChapter = new Map<number, Set<number>>();
  for (const qa of questions) {
    for (const p of qa.lecturePages) {
      if (!citedByChapter.has(p.chapter)) citedByChapter.set(p.chapter, new Set());
      citedByChapter.get(p.chapter)!.add(p.page);
    }
  }
  const reviewPlan = analysis.reviewPlan
    .map((item) => {
      const cited = citedByChapter.get(item.chapter);
      if (!cited) return null;
      const pages = item.pages.filter((p) => cited.has(p));
      return pages.length > 0 ? { ...item, pages: [...new Set(pages)].sort((a, b) => a - b) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.priority - b.priority);

  return { ...analysis, questions, reviewPlan };
}

/* ─── Public API ─── */

export async function getCachedAnalysis(
  attemptId: number,
  studentId: string,
): Promise<AnalysisRecord | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("attempt_analyses")
    .select("attempt_id, analysis, prompt_version, model, created_at")
    .eq("attempt_id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!data || data.prompt_version !== ANALYSIS_PROMPT_VERSION) return null;
  return {
    attemptId: data.attempt_id,
    analysis: data.analysis as AttemptAnalysis,
    promptVersion: data.prompt_version,
    model: data.model,
    createdAt: data.created_at,
    cached: true,
  };
}

/**
 * Analyse one attempt. Returns the cached row when present (unless
 * `force`), otherwise runs the LLM and stores the result.
 *
 * Throws on "attempt not found / not yours" so the route can 404; LLM
 * errors propagate too (the route maps them to 500 + Sentry).
 */
export async function analyzeAttempt(
  attemptId: number,
  studentId: string,
  opts: { force?: boolean } = {},
): Promise<AnalysisRecord> {
  if (!opts.force) {
    const cached = await getCachedAnalysis(attemptId, studentId);
    if (cached) return cached;
  }

  const supabase = createServiceClient();
  const { data: attemptRaw, error } = await supabase
    .from("attempts")
    .select("id, student_id, kind, title, questions, answers, results, total_score, max_score, created_at")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .single();
  if (error || !attemptRaw) {
    throw Object.assign(new Error("attempt not found"), { status: 404 });
  }
  const attempt = attemptRaw as StoredAttempt;

  const qById = new Map(attempt.questions.map((q) => [q.id, q]));
  const wrong = attempt.results
    .filter((r) => !r.isCorrect)
    .map((r) => ({ r, q: qById.get(r.questionId) }))
    .filter((x): x is { r: StoredResult; q: StoredQuestion } => !!x.q);

  addBreadcrumb({
    category: "analysis",
    message: "attempt loaded",
    data: { attemptId, kind: attempt.kind, wrong: wrong.length, total: attempt.questions.length },
  });

  let analysis: AttemptAnalysis;

  if (wrong.length === 0) {
    // Nothing to diagnose — skip the LLM entirely. The UI still gets a
    // well-formed object so it doesn't need a special "perfect score"
    // branch.
    analysis = {
      summary: "這份全對，沒有需要分析的錯題。可以挑同章節再出一份難一點的測驗，或用費曼模式把關鍵概念講一遍看會不會卡。",
      errorPatterns: [],
      questions: [],
      reviewPlan: [],
    };
  } else {
    // Retrieve candidate pages for every wrong question in parallel.
    const candidateList = await Promise.all(wrong.map(({ q }) => candidatePages(q)));
    const candidates = new Map<number, RetrievedChunk[]>();
    wrong.forEach(({ q }, i) => candidates.set(q.id, candidateList[i]));

    const questionBlocks = wrong.map(({ q, r }, i) => {
      const cands = candidateList[i];
      const candText = cands.length === 0
        ? "（教材中沒找到候選頁；lecturePages 請填 sourceChapter 的第 1 頁並在 why 說明是章節起點）"
        : cands.map((c) =>
            `  - ${chapterLabel(c.chapter_number)} p.${c.page_number}${c.section_title ? ` 〈${c.section_title}〉` : ""}：${c.content.slice(0, 220).replace(/\s+/g, " ")}…`,
          ).join("\n");
      return `### 題 ${q.id}（${chapterLabel(q.sourceChapter)} · ${q.concept ?? "未標概念"} · ${q.type}）
題目：${q.question}
參考答案：${q.correctAnswer ?? "（無）"}
學生答案：${attempt.answers[String(q.id)] ?? "(未作答)"}
批改回饋：${r.feedback ?? "（無）"}
候選講義頁（lecturePages 只能從這裡挑）：
${candText}`;
    }).join("\n\n");

    const { object } = await withLLMRetry(() => generateObject({
      model: google(MODEL_NAME),
      schema: AnalysisSchema,
      prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的 AI 助教，正在為一位學生做「錯題分析」。
這位學生剛完成「${attempt.title || attempt.kind}」，得分 ${attempt.total_score}/${attempt.max_score}，共 ${attempt.questions.length} 題，答錯 ${wrong.length} 題。

請針對每一題錯題：
1. errorType：判斷錯誤類型（concept / calculation / reading / incomplete / unanswered）。未作答一律 unanswered。
2. diagnosis：直接引用學生的答案指出錯在哪，不要重複題目。
3. fix：給正確思路或關鍵公式（LaTeX 用 $..$），1–2 句即可，不要寫完整解答。
4. lecturePages：**只能從該題的候選講義頁中挑 1–3 頁**，chapter / page 必須與候選完全一致，why 寫一句為什麼要回去看那頁。

接著：
- errorPatterns：找出跨題目的共同模式（例如多題都是正負號、都看漏單位），沒有就給空陣列。
- reviewPlan：依優先度排出複習順序，每項列 chapter + 該看的 pages（同樣只能用上面引用過的頁碼）+ reason。最多 5 項。
- summary：2–3 句，對學生說話，具體、不要空泛鼓勵。

全部繁體中文，專有名詞可附英文。

${questionBlocks}`,
    }), { studentId, endpoint: "/api/attempt-analysis", model: MODEL_NAME, label: "attempt-analysis" });

    analysis = validatePages(restoreLatexInObject(object), candidates);
  }

  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase.from("attempt_analyses").upsert({
    attempt_id: attemptId,
    student_id: studentId,
    analysis,
    prompt_version: ANALYSIS_PROMPT_VERSION,
    model: wrong.length === 0 ? null : MODEL_NAME,
    created_at: now,
  }, { onConflict: "attempt_id" });
  if (upsertErr) console.error("attempt_analyses upsert error:", upsertErr);

  return {
    attemptId,
    analysis,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    model: wrong.length === 0 ? null : MODEL_NAME,
    createdAt: now,
    cached: false,
  };
}

/**
 * Plain-text rendering, for channels that can't show the React panel
 * (the planned post-exam email, admin CSV, logs). Kept next to the
 * schema so a shape change can't silently drift from the renderer.
 */
export function renderAnalysisText(a: AttemptAnalysis): string {
  const lines: string[] = [a.summary, ""];
  if (a.errorPatterns.length > 0) {
    lines.push("共同錯誤模式：");
    for (const p of a.errorPatterns) lines.push(`- ${p.label}（題 ${p.questionIds.join("、")}）`);
    lines.push("");
  }
  for (const q of a.questions) {
    lines.push(`題 ${q.questionId} · ${errorTypeLabel(q.errorType)}`);
    lines.push(`  錯在哪：${q.diagnosis}`);
    lines.push(`  怎麼修：${q.fix}`);
    for (const p of q.lecturePages) {
      lines.push(`  📖 ${chapterLabel(p.chapter)} p.${p.page}${p.sectionTitle ? ` 〈${p.sectionTitle}〉` : ""} — ${p.why}`);
    }
    lines.push("");
  }
  if (a.reviewPlan.length > 0) {
    lines.push("建議複習順序：");
    for (const r of a.reviewPlan) {
      lines.push(`${r.priority}. ${chapterLabel(r.chapter)} p.${r.pages.join(", ")} — ${r.reason}`);
    }
  }
  return lines.join("\n").trim();
}
