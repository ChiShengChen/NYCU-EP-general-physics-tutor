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
  const topics = isMidterm
    ? [
        "Vectors", "Kinematics", "Newton's Laws of Motion", "Work and Kinetic Energy",
        "Conservation of Energy", "Momentum and Collisions", "Rotational Motion",
        "Angular Momentum", "Static Equilibrium", "Gravitation",
        "Simple Harmonic Motion", "Fluid Mechanics", "Mechanical Waves", "Sound",
      ]
    : [
        "Temperature and Heat", "Ideal Gas", "First Law of Thermodynamics", "Second Law of Thermodynamics",
        "Electric Field", "Gauss's Law", "Electric Potential", "Capacitance",
        "Current and Resistance", "DC Circuits", "Magnetic Field", "Ampere's Law",
        "Electromagnetic Induction", "Inductance", "AC Circuits",
      ];

  const allChunks = await Promise.all(
    topics.map((t) => retrieveChunks(t, { matchCount: 3, matchThreshold: 0.45 })),
  );
  const seen = new Set<number>();
  const uniqueChunks = allChunks.flat().filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
  const context = formatChunksForPrompt(uniqueChunks);

  const { object: exam } = await generateObject({
    model: google(process.env.CHAT_MODEL ?? "gemini-2.5-flash"),
    schema: ExamSchema,
    prompt: `你是交通大學電物系「普通物理」課程（楊本立老師）的出題教授，請出一份${isMidterm ? "期中考" : "期末考"}模擬試題。

範圍：${chapterRange}
主要主題：${topics.join("、")}

要求：
- 共 10 題：7 題選擇題（每題 8 分）+ 3 題簡答題（每題 10 分，需要推導或解釋）
- 總分 86 分（模擬真實考試不一定滿 100）
- 難度分布：3 題 easy、4 題 medium、3 題 hard
- 選擇題每題 4 個選項 A/B/C/D
- 簡答題需要完整推導或解釋
- 數學公式用 LaTeX
- 題目用繁體中文，專有名詞可附英文
- 每題標注對應的 sourceChapter（1..31）

教材內容：
${context}`,
  });

  return NextResponse.json({ exam, examType, timeLimit: isMidterm ? 50 : 60 });
}

async function handleGrade(body: {
  studentId?: string;
  questions: z.infer<typeof ExamSchema>["questions"];
  answers: Record<number, string>;
  examType: string;
}) {
  const { studentId, questions, answers, examType } = body;

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

  // Update student_state
  if (studentId) {
    const supabase = createServiceClient();
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
  }

  return NextResponse.json({ result });
}
