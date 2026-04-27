import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieveChunks, formatChunksForPrompt } from "@/lib/rag";
import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const ExamSchema = z.object({
  title: z.string(),
  questions: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["multiple_choice", "short_answer"]),
      concept: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      question: z.string(),
      options: z.array(z.string()).optional(),
      correctAnswer: z.string(),
      explanation: z.string(),
      sourceChapter: z.number(),
      points: z.number().describe("配分：選擇題每題 8 分，簡答題每題 10 分"),
    }),
  ),
});

const GradeSchema = z.object({
  results: z.array(
    z.object({
      questionId: z.number(),
      isCorrect: z.boolean(),
      score: z.number().min(0).max(1),
      earnedPoints: z.number(),
      feedback: z.string(),
    }),
  ),
  totalScore: z.number(),
  maxScore: z.number(),
  grade: z.string().describe("A+/A/B+/B/C+/C/D/F"),
  overallFeedback: z.string(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const { action } = body;

  if (action === "generate") return handleGenerate(body);
  if (action === "grade") return handleGrade(body);
  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

async function handleGenerate(body: { examType: string }) {
  const { examType } = body as { examType: "midterm" | "final" };

  const isMidterm = examType === "midterm";
  const chapterRange = isMidterm ? "Ch01–Ch16（力學、振盪、流體、波動、聲學）" : "Ch17–Ch31（熱學、電磁學、電路）";

  // Topic blurb for the prompt (full breadth shown to the model).
  const topicListForPrompt = isMidterm
    ? "Kinematics, Newton's Laws, Work & Energy, Conservation of Energy, Momentum & Collisions, Rotational Motion, Angular Momentum, Static Equilibrium, Gravitation, Simple Harmonic Motion, Fluid Mechanics, Mechanical Waves, Sound"
    : "Temperature & Heat, Ideal Gas, First Law of Thermodynamics, Second Law of Thermodynamics, Electric Field, Gauss's Law, Electric Potential, Capacitance, Current & Resistance, DC Circuits, Magnetic Field, Ampere's Law, Electromagnetic Induction, Inductance, AC Circuits";

  // Retrieval queries: collapsed to 4 broad themes (was 14–15 fine-grained,
  // which exhausted the 60s Vercel Hobby timeout).
  const retrievalQueries = isMidterm
    ? [
        "kinematics, Newton's laws, free-body diagrams, friction",
        "work, kinetic energy, potential energy, conservation of energy, momentum, collisions",
        "rotational motion, torque, angular momentum, static equilibrium, gravitation",
        "simple harmonic motion, fluid mechanics, mechanical waves, sound, beats, Doppler",
      ]
    : [
        "temperature, heat, ideal gas, kinetic theory, equipartition",
        "first and second laws of thermodynamics, entropy, heat engines, Carnot cycle",
        "electric charge, electric field, Gauss's law, electric potential, capacitance, dielectrics",
        "current, resistance, DC circuits, magnetic field, Ampere's law, electromagnetic induction, inductance, AC circuits",
      ];

  const allChunks = await Promise.all(
    retrievalQueries.map((q) => retrieveChunks(q, { matchCount: 6, matchThreshold: 0.45 })),
  );
  const seen = new Set<number>();
  const uniqueChunks = allChunks.flat().filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
  const context = formatChunksForPrompt(uniqueChunks);

  // Generate 15 questions in two parallel batches to stay under 60s.
  // Batch A: 8 MC questions (5 pts each = 40 pts).
  // Batch B: 7 questions = 4 MC (5 pts) + 3 short-answer (10 pts) = 50 pts.
  // Total 15 questions, 90 pts.
  const buildPrompt = (
    label: string,
    count: number,
    breakdown: string,
    difficultyDist: string,
    idStart: number,
  ) => `你是交通大學電物系「普通物理」課程（楊本立老師）的出題教授，請出一份${isMidterm ? "期中考" : "期末考"}模擬試題的「${label}」。

範圍：${chapterRange}
主要主題：${topicListForPrompt}

要求：
- 共 ${count} 題：${breakdown}
- 難度分布：${difficultyDist}
- 題目 id 從 ${idStart} 開始連續編號
- 選擇題每題 4 個選項 A/B/C/D
- 簡答題需要完整推導或解釋
- 數學公式用 LaTeX
- 題目用繁體中文，專有名詞可附英文
- 每題標注對應的 sourceChapter（1..31）
- 整份試題的 title 訂為「普通物理 ${isMidterm ? "(I) 期中考" : "(II) 期末考"}模擬試題」

教材內容：
${context}`;

  const model = google(process.env.CHAT_MODEL ?? "gemini-2.5-flash");
  const [partA, partB] = await Promise.all([
    generateObject({
      model,
      schema: ExamSchema,
      prompt: buildPrompt(
        "選擇題部分",
        8,
        "8 題選擇題（每題 5 分，總計 40 分）",
        "3 題 easy、3 題 medium、2 題 hard",
        1,
      ),
    }),
    generateObject({
      model,
      schema: ExamSchema,
      prompt: buildPrompt(
        "進階與簡答部分",
        7,
        "4 題選擇題（每題 5 分）+ 3 題簡答題（每題 10 分），總計 50 分",
        "1 題 easy、3 題 medium、3 題 hard",
        9,
      ),
    }),
  ]);

  const merged = [...partA.object.questions, ...partB.object.questions]
    .map((q, idx) => ({ ...q, id: idx + 1 }));  // re-id 1..15 just in case the model drifted
  const exam = {
    title: partA.object.title || partB.object.title || `普通物理 ${isMidterm ? "(I) 期中考" : "(II) 期末考"}模擬試題`,
    questions: merged,
  };

  return NextResponse.json({ exam, examType, timeLimit: isMidterm ? 75 : 90 });
}

async function handleGrade(body: {
  studentId?: string;
  questions: z.infer<typeof ExamSchema>["questions"];
  answers: Record<number, string>;
  examType: string;
  examTitle?: string;
}) {
  const { studentId, questions, answers, examType, examTitle } = body;

  const qa = questions.map((q) => ({
    id: q.id, type: q.type, concept: q.concept, question: q.question,
    correctAnswer: q.correctAnswer, studentAnswer: answers[q.id] ?? "(未作答)", points: q.points,
  }));

  const { object: result } = await generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: GradeSchema,
    prompt: `批改${examType === "midterm" ? "期中考" : "期末考"}模擬試題。

${JSON.stringify(qa, null, 2)}

批改規則：
- 選擇題：正確得滿分，錯誤 0 分
- 簡答題：完全正確得滿分，部分正確依比例給分，完全錯誤 0 分
- earnedPoints = score * points
- 計算 totalScore 和 maxScore
- grade 依照：90+ A+, 85+ A, 80+ B+, 75+ B, 70+ C+, 60+ C, 50+ D, <50 F（以百分比計）
- 每題給繁體中文回饋
- 整體回饋包含學習建議`,
  });

  if (studentId) {
    const supabase = createServiceClient();

    // Update mastery per concept.
    for (const r of result.results) {
      const q = questions.find((x) => x.id === r.questionId);
      if (!q) continue;
      const { data: existing } = await supabase
        .from("student_state").select("mastery_score, attempt_count")
        .eq("student_id", studentId).eq("concept", q.concept).single();
      const cur = existing?.mastery_score ?? 0;
      const attempts = existing?.attempt_count ?? 0;
      const newMastery = Math.min(1, Math.max(0, 0.6 * cur + 0.4 * r.score));
      await supabase.from("student_state").upsert({
        student_id: studentId, concept: q.concept, mastery_score: newMastery,
        attempt_count: attempts + 1,
        last_misconception: r.isCorrect ? null : r.feedback.slice(0, 200),
        updated_at: new Date().toISOString(),
      }, { onConflict: "student_id,concept" });
    }

    // Persist the full attempt for later review.
    await supabase.from("attempts").insert({
      student_id: studentId,
      kind: "exam",
      exam_type: examType,
      title: examTitle ?? (examType === "midterm" ? "期中考模擬" : "期末考模擬"),
      questions,
      answers,
      results: result.results,
      total_score: result.totalScore,
      max_score: result.maxScore,
      grade: result.grade,
      overall_feedback: result.overallFeedback,
    });
  }

  return NextResponse.json({ result });
}
