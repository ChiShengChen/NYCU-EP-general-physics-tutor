import { google } from "@ai-sdk/google";
import { pickModel } from "@/lib/models";
import { captureRouteError, initBreadcrumbs } from "@/lib/sentry";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { restoreLatexInObject } from "@/lib/restore-latex";
import { withLLMRetry } from "@/lib/llm-retry";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { checkIpRateLimit, ipRateLimitedResponse } from "@/lib/rate-limit";
import { resolveStudentId } from "@/lib/resolve-student-id";
import {
  signOralPayload,
  verifyOralPayload,
  type OralExamPayload,
  type OralQuestion,
} from "@/lib/oral-payload";
import { NextResponse, after } from "next/server";

export const maxDuration = 60;

/**
 * POST /api/oral-exam — 口試模式 (text-based AI oral exam).
 *
 * Three actions, all stateless (see lib/oral-payload.ts for why the
 * question set round-trips through the client as a signed blob):
 *
 *   start  { chapters?: number[] }
 *     → { sessionId, examPayload, questions: [{ id, kind, concept,
 *         question, sourceChapter }] }   (modelAnswer / rubric withheld)
 *
 *   turn   { examPayload, questionIndex, transcript, studentText }
 *     → { reply, action: "followup" | "next", followUpsUsed }
 *
 *   finish { examPayload, transcripts, skipped, elapsed }
 *     → { result } — graded with the premium tier, persisted to
 *       `attempts` (kind = 'oral') + student_state off the hot path.
 *
 * Model tiers: question generation + examiner turns use pickModel("oral")
 * (standard); the final rubric grade uses pickModel("exam") (premium),
 * mirroring how exam-mode treats grading as the high-stakes call.
 */

const MODEL_NAME = pickModel("oral");
const GRADE_MODEL_NAME = pickModel("exam");

const QUESTION_COUNT = 3;
const MAX_FOLLOWUPS = 2;
const POINTS_PER_QUESTION = 10;

/* ─── Zod schemas ─── */

const OralQuestionSchema = z.object({
  id: z.number().describe("1..3"),
  kind: z.enum(["concept", "derivation", "application"]),
  concept: z.string().describe("The physics concept this question targets (繁體中文，可附英文)"),
  question: z.string().describe("The examiner's opening question, in Traditional Chinese, LaTeX allowed"),
  modelAnswer: z.string().describe("A complete model answer a strong student would give — hidden until results"),
  rubric: z.array(z.string()).min(3).max(5).describe("3–5 key points the examiner listens for; each one short + checkable"),
  sourceChapter: z.number().describe("Chapter (1..37) the question is grounded in"),
});

const OralSetSchema = z.object({
  questions: z.array(OralQuestionSchema).length(QUESTION_COUNT),
});

const TurnSchema = z.object({
  reply: z.string().describe("What the examiner says next, in Traditional Chinese"),
  action: z.enum(["followup", "next"]).describe("followup = ask one more probing question; next = done with this question"),
});

const GradeSchema = z.object({
  results: z.array(
    z.object({
      questionId: z.number(),
      correctness: z.number().min(0).max(4).describe("正確性 0–4"),
      completeness: z.number().min(0).max(3).describe("完整性 0–3（對照 rubric 要點）"),
      clarity: z.number().min(0).max(3).describe("表達清晰 0–3"),
      feedback: z.string().describe("2–4 句繁體中文回饋：答對了什麼、漏了哪個 rubric 要點、哪裡說錯"),
    }),
  ),
  overallFeedback: z.string().describe("整體回饋 + 具體複習建議，繁體中文"),
});

/* ─── Shared types ─── */

type Turn = { role: "examiner" | "student"; text: string };

interface QuestionResult {
  questionId: number;
  correctness: number;
  completeness: number;
  clarity: number;
  score: number;        // 0..1 = (correctness + completeness + clarity) / 10
  isCorrect: boolean;   // score >= 0.6
  earnedPoints: number; // 0..10, so attempts-history can show it like exam rows
  feedback: string;
  skipped: boolean;
  elapsedSeconds: number;
}

/* Same wording the chat route pins to every system prompt, adapted for a
 * structured-output call where there are no tools to describe. */
const OUTPUT_DISCIPLINE = `
⚠️ 輸出規範（絕對不可違反）：
- 你寫出的文字就是學生會看到的全部。不要寫任何 meta-commentary（例：「The user asked for…」、「Now I need to…」、「I will choose…」、「My plan is…」）。
- 不要描述你的評分過程或內部判斷；不要在對話中提到 rubric、模範答案、分數這些字眼。
- 整段用繁體中文；專有名詞 / 公式可附英文，但不要寫整段英文段落來總結或自述思路。
- 數學公式用 LaTeX：行內 $...$。
- 如果你發現自己快寫出 "The user…" 或 "Now I…" 這種句子，立刻停下來並改寫成對學生說話的方式（或乾脆刪掉）。`;

/* ─── Helpers ─── */

function chapterLabel(ch: number): string {
  return `Ch${String(ch).padStart(2, "0")}`;
}

/** Same thresholds as /api/exam's grading prompt, computed server-side so
 *  the letter can't drift from the number. */
function letterGrade(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 85) return "A";
  if (pct >= 80) return "B+";
  if (pct >= 75) return "B";
  if (pct >= 70) return "C+";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}

function isTurnArray(v: unknown): v is Turn[] {
  return Array.isArray(v) && v.every((t) =>
    t && typeof t === "object"
    && ((t as Turn).role === "examiner" || (t as Turn).role === "student")
    && typeof (t as Turn).text === "string");
}

/** Examiner messages after the opening question = follow-ups spent. */
function countFollowUps(transcript: Turn[]): number {
  const examinerTurns = transcript.filter((t) => t.role === "examiner").length;
  return Math.max(0, examinerTurns - 1);
}

function formatTranscript(turns: Turn[]): string {
  if (turns.length === 0) return "（學生尚未作答）";
  return turns.map((t) => `${t.role === "examiner" ? "口試委員" : "學生"}：${t.text}`).join("\n");
}

/* ─── POST ─── */

export async function POST(req: Request) {
  initBreadcrumbs();
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  // Auth-derived studentId beats body-supplied so a logged-in student
  // can't burn another student's daily quota by passing their UUID here.
  const { studentId } = await resolveStudentId(body.studentId);
  body.studentId = studentId;

  const rate = checkIpRateLimit(req);
  if (!rate.allowed) {
    const ipResp = ipRateLimitedResponse(rate);
    return NextResponse.json(ipResp.body, { status: ipResp.status });
  }

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  try {
    if (action === "start") return await handleStart(body);
    if (action === "turn") return await handleTurn(body);
    if (action === "finish") return await handleFinish(body);
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    captureRouteError(err, { endpoint: "/api/oral-exam", studentId, meta: { action } });
    return NextResponse.json({ error: "口試系統暫時無法回應，請稍後再試" }, { status: 500 });
  }
}

/* ─── start ─── */

async function handleStart(body: { studentId?: string; chapters?: unknown }) {
  const { studentId } = body;
  const supabase = createServiceClient();

  // Validate the chapter picks the same way /api/quiz's synthesis branch
  // does; anything else falls back to 依弱點 mode.
  const rawChapters = Array.isArray(body.chapters) ? body.chapters : [];
  const chapters = Array.from(new Set(
    rawChapters.filter((c): c is number => Number.isInteger(c) && c >= 1 && c <= 37),
  )).sort((a, b) => a - b).slice(0, 3);

  let context: string;
  let scopeBlurb: string;
  let chapterRule: string;

  if (chapters.length > 0) {
    const chunksPerChapter = await Promise.all(
      chapters.map((ch) =>
        retrieveChunks(
          "key concepts, definitions, derivations, formulas, worked examples",
          { matchCount: 6, matchThreshold: 0.3, filterChapter: ch },
        ),
      ),
    );
    const seen = new Set<number>();
    const uniqueChunks = chunksPerChapter.flat().filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    context = formatChunksForPrompt(uniqueChunks);
    scopeBlurb = `範圍：${chapters.map(chapterLabel).join(" + ")}（即第 ${chapters.join(", ")} 章）`;
    chapterRule = `- 每題的 sourceChapter 必須從 ${chapters.join(", ")} 中選；三題盡量分散到不同章節或不同主題`;
  } else {
    // 依弱點：same weak-concept lookup as /api/quiz's default branch.
    let weakConcepts: { concept: string; mastery_score: number; last_misconception: string | null }[] = [];
    if (studentId) {
      const { data } = await supabase
        .from("student_state")
        .select("concept, mastery_score, last_misconception")
        .eq("student_id", studentId)
        .lt("mastery_score", 0.6)
        .order("mastery_score", { ascending: true })
        .limit(5);
      weakConcepts = data ?? [];
    }
    const isIntro = weakConcepts.length === 0;
    const conceptQueries = isIntro
      ? ["Newton's Laws of Motion", "Conservation of Energy", "Conservation of Momentum", "Gauss's Law", "Faraday's Law"]
      : weakConcepts.map((wc) => wc.concept);

    const allChunks = await Promise.all(
      conceptQueries.slice(0, 5).map((q) => retrieveChunks(q, { matchCount: 4, matchThreshold: 0.5 })),
    );
    const seen = new Set<number>();
    const uniqueChunks = allChunks.flat().filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    context = formatChunksForPrompt(uniqueChunks);
    scopeBlurb = isIntro
      ? "範圍：全範圍。這位學生還沒有答題紀錄，請以基礎核心概念為主（牛頓定律、能量守恆、動量守恆、高斯定律、法拉第定律）。"
      : `範圍：針對學生的薄弱概念出題：\n${weakConcepts.map((wc) => `- ${wc.concept}（掌握度：${(wc.mastery_score * 100).toFixed(0)}%${wc.last_misconception ? `，迷思概念：${wc.last_misconception}` : ""}）`).join("\n")}`;
    chapterRule = "- 每題的 sourceChapter 填入 1..37 之間最主要的章節編號";
  }

  const prompt = `你是交通大學電物系「普通物理」課程（楊本立老師）的口試委員，請為一場 3 題的口試出題。

${scopeBlurb}

口試題型（三題各一，順序固定）：
1. id=1, kind="concept"（概念解釋）：請學生用自己的話解釋一個概念的物理意義、成立條件、與常見誤解
2. id=2, kind="derivation"（推導）：請學生一步一步推導或論證一個公式 / 關係式，從什麼出發、用了哪些假設
3. id=3, kind="application"（情境應用）：給一個具體物理情境，請學生用概念分析會發生什麼、為什麼

每題要求：
- question：口試委員開場會問的那句話，口語但精確，1–3 句；不要在題目裡暗示答案
- modelAnswer：一位準備充分的學生應該講出來的完整回答（含關鍵公式、條件、物理意義），之後會在成績頁給學生看
- rubric：3–5 個簡短、可勾選的得分要點（例：「指出合外力為零是前提」），口試委員追問與最後評分都看這個
- concept：這題對應的核心概念名稱
${chapterRule}
- 題目要能在純文字口試中回答（不需要畫圖、不需要大量數值計算）
- 題目用繁體中文，公式用 LaTeX（$..$）

教材內容：
${context}
${OUTPUT_DISCIPLINE}`;

  const { object } = await withLLMRetry(() => generateObject({
    model: google(MODEL_NAME),
    schema: OralSetSchema,
    prompt,
  }), { studentId, endpoint: "/api/oral-exam", model: MODEL_NAME, label: "oral/start" });

  const questions: OralQuestion[] = restoreLatexInObject(object.questions)
    .map((q, idx) => ({ ...q, id: idx + 1 }));  // re-id 1..3 in case the model drifted

  const payload: OralExamPayload = {
    sessionId: crypto.randomUUID(),
    chapters,
    questions,
    createdAt: Date.now(),
  };

  // Strip the hidden fields before the question set leaves the server;
  // the signed examPayload is the only copy that carries them.
  const publicQuestions = questions.map(({ id, kind, concept, question, sourceChapter }) =>
    ({ id, kind, concept, question, sourceChapter }));

  return NextResponse.json({
    sessionId: payload.sessionId,
    examPayload: signOralPayload(payload),
    questions: publicQuestions,
    chapters,
  });
}

/* ─── turn ─── */

async function handleTurn(body: {
  studentId?: string;
  examPayload?: unknown;
  questionIndex?: unknown;
  transcript?: unknown;
  studentText?: unknown;
}) {
  const { studentId } = body;
  const payload = verifyOralPayload(body.examPayload);
  if (!payload) return NextResponse.json({ error: "invalid examPayload" }, { status: 400 });

  const idx = typeof body.questionIndex === "number" ? body.questionIndex : -1;
  const q = payload.questions[idx];
  if (!q) return NextResponse.json({ error: "invalid questionIndex" }, { status: 400 });

  const transcript: Turn[] = isTurnArray(body.transcript) ? body.transcript : [];
  const studentText = typeof body.studentText === "string" ? body.studentText.trim() : "";
  if (!studentText) return NextResponse.json({ error: "studentText required" }, { status: 400 });

  const followUpsUsed = countFollowUps(transcript);
  const dialogue: Turn[] = [...transcript, { role: "student", text: studentText }];

  // Hard cap, enforced here rather than trusted to the model: once both
  // follow-ups are spent the examiner only gets to close the question.
  // No LLM call needed for a canned neutral acknowledgement.
  if (followUpsUsed >= MAX_FOLLOWUPS) {
    return NextResponse.json({ reply: "好，這題到這裡。", action: "next", followUpsUsed });
  }

  const prompt = `你是交通大學電物系「普通物理」課程（楊本立老師）的口試委員，風格嚴格、簡潔、不給提示。現在正在進行第 ${idx + 1} 題（${q.kind === "concept" ? "概念解釋" : q.kind === "derivation" ? "推導" : "情境應用"}）。

【這題的題目】
${q.question}

【只有你看得到的評分要點（rubric）】
${q.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}

【到目前為止的對話】
${formatTranscript(dialogue)}

【追問次數】已用 ${followUpsUsed} / ${MAX_FOLLOWUPS} 次

請決定下一步，二選一：
- action="followup"：學生的回答有漏掉的要點、模糊的地方、或講錯的主張，而且你還有追問次數 → reply 寫「一個」追問。追問可以是：要求補上缺少的條件、請他解釋某一步的理由、或針對錯誤的說法提出質疑（例：「你說 ___，那在 ___ 的情況下也成立嗎？」）。一次只問一件事。
- action="next"：學生已經把要點都講到了，或你判斷再追問也不會有新資訊 → reply 只寫一句中性的結束語，例如「好，這題到這裡。」，不要評論對錯、不要說分數、不要補充正確答案。

鐵則：
- 絕對不要給提示、不要說出答案的任何片段、不要糾正學生（糾正留到最後評分）
- 不要說「很好」「正確」「錯了」這類評價詞；維持中性口吻
- 一次只問一個問題；追問要具體到學生的話，不要泛泛地問「還有嗎？」
- 學生如果反問你答案或要求提示，簡短拒絕並重申問題
- 追問次數用完就必須 action="next"
- reply 用繁體中文，2–3 句以內
${OUTPUT_DISCIPLINE}`;

  const { object } = await withLLMRetry(() => generateObject({
    model: google(MODEL_NAME),
    schema: TurnSchema,
    prompt,
  }), { studentId, endpoint: "/api/oral-exam", model: MODEL_NAME, label: "oral/turn" });

  const turn = restoreLatexInObject(object);
  // Belt-and-braces: even if the model chose "followup" on its last
  // allowed probe, the count after this reply would hit the cap, which
  // is fine — the NEXT call short-circuits above. But if it somehow
  // emits a follow-up with an empty reply, close the question instead.
  const action = turn.reply.trim() ? turn.action : "next";
  const reply = action === "next" && !turn.reply.trim() ? "好，這題到這裡。" : turn.reply;

  return NextResponse.json({ reply, action, followUpsUsed });
}

/* ─── finish ─── */

async function handleFinish(body: {
  studentId?: string;
  examPayload?: unknown;
  transcripts?: unknown;
  skipped?: unknown;
  elapsed?: unknown;
}) {
  const { studentId } = body;
  const payload = verifyOralPayload(body.examPayload);
  if (!payload) return NextResponse.json({ error: "invalid examPayload" }, { status: 400 });
  const { questions, chapters } = payload;

  const rawTranscripts = Array.isArray(body.transcripts) ? body.transcripts : [];
  const transcripts: Turn[][] = questions.map((_, i) => (isTurnArray(rawTranscripts[i]) ? rawTranscripts[i] : []));
  const skipped = new Set<number>(
    Array.isArray(body.skipped) ? body.skipped.filter((x): x is number => typeof x === "number") : [],
  );
  const elapsedRaw = (body.elapsed && typeof body.elapsed === "object") ? body.elapsed as Record<string, unknown> : {};
  const elapsedFor = (qid: number): number => {
    const v = elapsedRaw[String(qid)];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  };

  // Student's concatenated replies per question — the `answers` shape the
  // review pages already understand ({ qid: text }).
  const answers: Record<number, string> = {};
  questions.forEach((q, i) => {
    const said = transcripts[i].filter((t) => t.role === "student").map((t) => t.text.trim()).filter(Boolean);
    answers[q.id] = skipped.has(q.id) || said.length === 0 ? "" : said.join("\n\n");
  });

  // Only questions the student actually spoke to go to the grader.
  // Skipped (or silently abandoned) ones are hard zeros — no LLM call.
  const gradable = questions.filter((q) => !skipped.has(q.id) && answers[q.id]);

  let graded: z.infer<typeof GradeSchema> = { results: [], overallFeedback: "" };
  if (gradable.length > 0) {
    const packet = gradable.map((q) => ({
      questionId: q.id,
      kind: q.kind,
      concept: q.concept,
      question: q.question,
      rubric: q.rubric,
      modelAnswer: q.modelAnswer,
      dialogue: formatTranscript(transcripts[questions.indexOf(q)]),
    }));

    const { object } = await withLLMRetry(() => generateObject({
      model: google(GRADE_MODEL_NAME),
      schema: GradeSchema,
      prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的口試委員，口試已結束，請依 rubric 評分。

${JSON.stringify(packet, null, 2)}

評分規則（每題滿分 10）：
- correctness 正確性 0–4：物理敘述是否正確。有明確錯誤主張且未在追問後修正 → 最多 1；大致正確但有小錯 → 2–3；完全正確 → 4
- completeness 完整性 0–3：對照 rubric 要點，講到的比例。全部要點都有 → 3；一半左右 → 1–2；幾乎沒碰到要點 → 0
- clarity 表達清晰 0–3：邏輯是否有條理、是否能用自己的話說明、公式與文字是否對得上。只丟公式不解釋 → 1
- 評分依據是學生在對話中「實際講出來」的內容；口試委員追問後才補上的要點可以算，但 completeness 酌減 1
- 「我不知道」「跳過」或與題目無關的回答 → 三項都 0
- 每題的 feedback：2–4 句繁體中文，先說答對什麼，再具體點出漏掉哪個 rubric 要點或哪句話說錯；可以引用模範答案的關鍵公式
- overallFeedback：整體評語 + 具體複習建議（哪一章、哪個概念），3–5 句，語氣像口試後的教授講評：直接但有建設性
- 公式用 LaTeX（$..$）
${OUTPUT_DISCIPLINE}`,
    }), { studentId, endpoint: "/api/oral-exam", model: GRADE_MODEL_NAME, label: "oral/grade" });
    graded = restoreLatexInObject(object);
  }

  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  const results: QuestionResult[] = questions.map((q) => {
    const r = graded.results.find((x) => x.questionId === q.id);
    const wasSkipped = skipped.has(q.id) || !answers[q.id];
    const correctness = r && !wasSkipped ? clamp(r.correctness, 4) : 0;
    const completeness = r && !wasSkipped ? clamp(r.completeness, 3) : 0;
    const clarity = r && !wasSkipped ? clamp(r.clarity, 3) : 0;
    const earnedPoints = correctness + completeness + clarity;
    const score = earnedPoints / POINTS_PER_QUESTION;
    return {
      questionId: q.id,
      correctness,
      completeness,
      clarity,
      score,
      isCorrect: score >= 0.6,
      earnedPoints,
      feedback: wasSkipped
        ? "這題跳過未作答。"
        : (r?.feedback ?? "（系統未取得這題的評語）"),
      skipped: wasSkipped,
      elapsedSeconds: elapsedFor(q.id),
    };
  });

  const totalScore = results.reduce((s, r) => s + r.earnedPoints, 0);
  const maxScore = questions.length * POINTS_PER_QUESTION;
  const grade = letterGrade((totalScore / maxScore) * 100);
  const overallFeedback = graded.overallFeedback.trim()
    || "這次口試沒有任何一題作答，所以沒有可評的內容。建議先用「自由問答」或「章節預習」熟悉概念，再回來挑戰口試。";

  const title = chapters.length > 0
    ? `口試模擬 · ${chapters.map(chapterLabel).join(" + ")}`
    : "口試模擬 · 依弱點";

  const result = {
    sessionId: payload.sessionId,
    title,
    results,
    totalScore,
    maxScore,
    grade,
    overallFeedback,
    // Reveal the hidden fields now that grading is done.
    questions: questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      concept: q.concept,
      question: q.question,
      modelAnswer: q.modelAnswer,
      rubric: q.rubric,
      sourceChapter: q.sourceChapter,
    })),
  };

  // Persist AFTER the response goes out — the premium-tier grading call
  // already eats most of the 60s budget, same reasoning as /api/exam.
  if (studentId) {
    after(async () => {
      const supabase = createServiceClient();

      // Group by concept so two questions on the same concept do one
      // read-modify-write rather than racing within the request.
      const byConcept = new Map<string, { scores: number[]; firstMisconception: string | null }>();
      for (const r of results) {
        const q = questions.find((x) => x.id === r.questionId);
        if (!q) continue;
        const slot = byConcept.get(q.concept) ?? { scores: [], firstMisconception: null };
        slot.scores.push(r.score);
        if (!r.isCorrect && !r.skipped && !slot.firstMisconception) slot.firstMisconception = r.feedback.slice(0, 200);
        byConcept.set(q.concept, slot);
      }

      await Promise.all(
        Array.from(byConcept.entries()).map(async ([concept, { scores, firstMisconception }]) => {
          const avgScore = scores.reduce((s, x) => s + x, 0) / scores.length;
          const { data: existing } = await supabase
            .from("student_state").select("mastery_score, attempt_count")
            .eq("student_id", studentId).eq("concept", concept).single();
          const cur = existing?.mastery_score ?? 0;
          const attempts = existing?.attempt_count ?? 0;
          const newMastery = Math.min(1, Math.max(0, 0.6 * cur + 0.4 * avgScore));
          await supabase.from("student_state").upsert({
            student_id: studentId, concept, mastery_score: newMastery,
            attempt_count: attempts + 1,
            last_misconception: firstMisconception,
            updated_at: new Date().toISOString(),
          }, { onConflict: "student_id,concept" });
        }),
      );

      // Question objects stored in the shape quiz/exam review pages read:
      // correctAnswer ← modelAnswer, explanation ← rubric bullets.
      const storedQuestions = questions.map((q) => ({
        id: q.id,
        type: "oral" as const,
        kind: q.kind,
        concept: q.concept,
        question: q.question,
        correctAnswer: q.modelAnswer,
        explanation: q.rubric.map((r) => `- ${r}`).join("\n"),
        sourceChapter: q.sourceChapter,
        points: POINTS_PER_QUESTION,
      }));

      const transcript = questions.map((q, i) => ({
        questionId: q.id,
        skipped: skipped.has(q.id),
        elapsedSeconds: elapsedFor(q.id),
        turns: transcripts[i],
      }));

      const { error: insertErr } = await supabase.from("attempts").insert({
        student_id: studentId,
        kind: "oral",
        exam_type: null,
        title,
        questions: storedQuestions,
        answers,
        confidences: {},
        hint_usage: {},
        results,
        total_score: totalScore,
        max_score: maxScore,
        grade,
        overall_feedback: overallFeedback,
        transcript,
      });
      if (insertErr) console.error("Oral attempt persist error:", insertErr);
    });
  }

  return NextResponse.json({ result });
}
