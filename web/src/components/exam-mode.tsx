"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { FormulaHelp } from "./formula-help";

/* ─── Types ─── */

interface ExamQuestion {
  id: number;
  type: "multiple_choice" | "short_answer";
  concept: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  sourceChapter: number;
  points: number;
}

interface Exam {
  title: string;
  questions: ExamQuestion[];
}

interface GradeResultItem {
  questionId: number;
  isCorrect: boolean;
  score: number;
  earnedPoints: number;
  feedback: string;
}

interface GradeResult {
  results: GradeResultItem[];
  totalScore: number;
  maxScore: number;
  grade: string;
  overallFeedback: string;
}

type ExamState = "select" | "loading" | "exam" | "grading" | "results";

/* ─── Component ─── */

interface ExamModeProps {
  onBack: () => void;
}

export function ExamMode({ onBack }: ExamModeProps) {
  const [state, setState] = useState<ExamState>("select");
  const [examType, setExamType] = useState<"midterm" | "final">("midterm");
  const [exam, setExam] = useState<Exam | null>(null);
  const [timeLimit, setTimeLimit] = useState(50);
  const [timeLeft, setTimeLeft] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSubmitRef = useRef(false);

  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("physics_tutor_student_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem("physics_tutor_student_id", id);
    return id;
  });

  // Timer countdown
  useEffect(() => {
    if (state !== "exam") return;
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          autoSubmitRef.current = true;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  // Auto-submit when time runs out
  useEffect(() => {
    if (autoSubmitRef.current && state === "exam" && timeLeft === 0 && exam) {
      autoSubmitRef.current = false;
      handleSubmit();
    }
  }, [timeLeft, state, exam]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateExam = useCallback(async () => {
    setState("loading");
    setError(null);
    setAnswers({});
    setGradeResult(null);
    setCurrentQuestion(0);

    try {
      const res = await fetch("/api/exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", examType }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setExam(data.exam);
      setTimeLimit(data.timeLimit);
      setTimeLeft(data.timeLimit * 60);
      setState("exam");
    } catch (err) {
      setError("考試生成失敗，請稍後再試");
      setState("select");
      console.error("Exam generation error:", err);
    }
  }, [examType]);

  const handleSubmit = useCallback(async () => {
    if (!exam) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setState("grading");

    try {
      const res = await fetch("/api/exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grade",
          studentId,
          questions: exam.questions,
          answers,
          examType,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setGradeResult(data.result);
      setState("results");
    } catch (err) {
      setError("批改失敗，請稍後再試");
      setState("exam");
      console.error("Exam grading error:", err);
    }
  }, [exam, answers, studentId, examType]);

  const answeredCount = exam ? exam.questions.filter((q) => answers[q.id]?.trim()).length : 0;
  const totalQuestions = exam?.questions.length ?? 0;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">🎓</span>
        <h1 className="text-lg font-semibold text-slate-800">
          {state === "results" ? "考試結果" : "考試模擬"}
        </h1>
        {state === "exam" && (
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-slate-400">
              已答 {answeredCount}/{totalQuestions}
            </span>
            <TimerDisplay seconds={timeLeft} />
          </div>
        )}
        {state !== "exam" && (
          <span className="text-xs text-slate-400 ml-auto">NYCU 電物系</span>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {state === "select" && (
          <ExamSelector examType={examType} setExamType={setExamType} onStart={generateExam} />
        )}
        {state === "loading" && <LoadingState examType={examType} />}
        {state === "exam" && exam && (
          <ExamView
            exam={exam}
            answers={answers}
            setAnswers={setAnswers}
            currentQuestion={currentQuestion}
            setCurrentQuestion={setCurrentQuestion}
            onSubmit={handleSubmit}
            answeredCount={answeredCount}
          />
        )}
        {state === "grading" && <GradingState />}
        {state === "results" && exam && gradeResult && (
          <ExamResults
            exam={exam}
            answers={answers}
            gradeResult={gradeResult}
            examType={examType}
            onRetry={() => setState("select")}
            onBack={onBack}
          />
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-red-500">{error}</p>
            <button
              onClick={() => { setError(null); setState("select"); }}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              重試
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Timer Display ─── */

function TimerDisplay({ seconds }: { seconds: number }) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isUrgent = seconds < 300;

  return (
    <span
      className={`font-mono text-sm font-semibold px-3 py-1 rounded-lg ${
        isUrgent ? "bg-red-50 text-red-600 animate-pulse" : "bg-slate-100 text-slate-700"
      }`}
    >
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </span>
  );
}

/* ─── Exam Selector ─── */

function ExamSelector({
  examType,
  setExamType,
  onStart,
}: {
  examType: "midterm" | "final";
  setExamType: (t: "midterm" | "final") => void;
  onStart: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center">
        <p className="text-4xl mb-3">🎓</p>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">考試模擬模式</h2>
        <p className="text-slate-500">模擬真實考試環境：限時作答、不顯示答案、交卷後統一批改</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => setExamType("midterm")}
          className={`flex flex-col items-center p-6 rounded-2xl border-2 transition-all duration-200 ${
            examType === "midterm"
              ? "border-indigo-500 bg-indigo-50 shadow-md"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <span className="text-3xl mb-2">📘</span>
          <h3 className="text-lg font-semibold text-slate-800">期中考模擬</h3>
          <p className="text-sm text-slate-500 mt-1">Ch01 ~ Ch16（力學、振盪、流體、波動、聲學）</p>
          <p className="text-xs text-slate-400 mt-2">50 分鐘 | 7 選擇 + 3 簡答</p>
        </button>

        <button
          onClick={() => setExamType("final")}
          className={`flex flex-col items-center p-6 rounded-2xl border-2 transition-all duration-200 ${
            examType === "final"
              ? "border-indigo-500 bg-indigo-50 shadow-md"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <span className="text-3xl mb-2">📗</span>
          <h3 className="text-lg font-semibold text-slate-800">期末考模擬</h3>
          <p className="text-sm text-slate-500 mt-1">Ch17 ~ Ch31（熱學、電磁學、電路）</p>
          <p className="text-xs text-slate-400 mt-2">60 分鐘 | 7 選擇 + 3 簡答</p>
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <h4 className="text-sm font-semibold text-amber-700 mb-2">📋 考試規則</h4>
        <ul className="text-sm text-amber-600 space-y-1">
          <li>• 考試開始後即計時，時間到自動交卷</li>
          <li>• 作答過程中不會顯示正確答案</li>
          <li>• 交卷後 AI 統一批改並給予回饋</li>
          <li>• 選擇題每題 8 分，簡答題每題 10 分</li>
          <li>• 成績會更新你的概念掌握度</li>
        </ul>
      </div>

      <div className="text-center">
        <button
          onClick={onStart}
          className="px-8 py-3 rounded-xl bg-indigo-600 text-white text-base font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          開始{examType === "midterm" ? "期中" : "期末"}考試
        </button>
      </div>
    </div>
  );
}

/* ─── Loading State ─── */

function LoadingState({ examType }: { examType: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
        <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
      </div>
      <p className="text-slate-600 font-medium">
        正在生成{examType === "midterm" ? "期中" : "期末"}考模擬試題...
      </p>
      <p className="text-sm text-slate-400">AI 教授正在根據教材內容出題</p>
    </div>
  );
}

/* ─── Grading State ─── */

function GradingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
        <div className="absolute inset-0 rounded-full border-4 border-green-500 border-t-transparent animate-spin" />
      </div>
      <p className="text-slate-600 font-medium">AI 正在批改你的試卷...</p>
      <p className="text-sm text-slate-400">統一批改中，請稍候</p>
    </div>
  );
}

/* ─── Exam View ─── */

function ExamView({
  exam,
  answers,
  setAnswers,
  currentQuestion,
  setCurrentQuestion,
  onSubmit,
  answeredCount,
}: {
  exam: Exam;
  answers: Record<number, string>;
  setAnswers: (a: Record<number, string>) => void;
  currentQuestion: number;
  setCurrentQuestion: (n: number) => void;
  onSubmit: () => void;
  answeredCount: number;
}) {
  const q = exam.questions[currentQuestion];
  const total = exam.questions.length;
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">{exam.title}</h2>
        <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
          <span>共 {total} 題</span>
          <span>•</span>
          <span>已答 {answeredCount}/{total}</span>
        </div>
      </div>

      {/* Question navigation dots */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {exam.questions.map((eq, i) => (
          <button
            key={eq.id}
            onClick={() => setCurrentQuestion(i)}
            className={`w-8 h-8 rounded-full text-xs font-medium transition-all duration-200 ${
              i === currentQuestion
                ? "bg-indigo-600 text-white scale-110"
                : answers[eq.id]?.trim()
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Current question */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              q.type === "multiple_choice"
                ? "bg-blue-50 text-blue-600"
                : "bg-purple-50 text-purple-600"
            }`}
          >
            {q.type === "multiple_choice" ? "選擇題" : "簡答題"}
          </span>
          <span className="text-xs text-slate-400">{q.points} 分</span>
        </div>

        <div className="mb-5">
          <MarkdownRenderer content={`**${q.id}.** ${q.question}`} />
        </div>

        {q.type === "multiple_choice" && q.options ? (
          <div className="space-y-2">
            {q.options.map((option, i) => {
              const letter = String.fromCharCode(65 + i);
              const isSelected = answers[q.id] === letter;
              return (
                <button
                  key={letter}
                  onClick={() => setAnswers({ ...answers, [q.id]: letter })}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ${
                    isSelected
                      ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className={`font-medium ${isSelected ? "text-indigo-700" : "text-slate-600"}`}>
                    {letter}.{" "}
                  </span>
                  <span className={isSelected ? "text-indigo-700" : "text-slate-700"}>
                    <MarkdownRenderer content={option} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              placeholder="在此輸入你的答案（支援推導過程；公式請用 $..$ 或 $$..$$）..."
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none h-40"
            />
            <FormulaHelp />
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
          disabled={currentQuestion === 0}
          className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          上一題
        </button>

        {currentQuestion < total - 1 ? (
          <button
            onClick={() => setCurrentQuestion(currentQuestion + 1)}
            className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            下一題
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <>
            {showConfirm ? (
              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                <span className="text-sm text-slate-500 text-right">
                  {answeredCount < total ? `還有 ${total - answeredCount} 題未答，確定交卷？` : "確定交卷？"}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={onSubmit}
                    className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                  >
                    確定交卷
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
                  >
                    繼續作答
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowConfirm(true)}
                className="px-6 py-2 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
              >
                交卷（{answeredCount}/{total}）
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Exam Results ─── */

function ExamResults({
  exam,
  answers,
  gradeResult,
  examType,
  onRetry,
  onBack,
}: {
  exam: Exam;
  answers: Record<number, string>;
  gradeResult: GradeResult;
  examType: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  const percentage = Math.round((gradeResult.totalScore / gradeResult.maxScore) * 100);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Score summary */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">
          {examType === "midterm" ? "期中考" : "期末考"}模擬成績
        </h2>
        <div className="flex items-center justify-center gap-8 mb-4">
          <div>
            <div className="text-5xl font-bold mb-1">
              <span
                className={`${
                  gradeResult.grade.startsWith("A")
                    ? "text-green-600"
                    : gradeResult.grade.startsWith("B")
                      ? "text-blue-600"
                      : gradeResult.grade.startsWith("C")
                        ? "text-yellow-600"
                        : "text-red-500"
                }`}
              >
                {gradeResult.grade}
              </span>
            </div>
            <p className="text-sm text-slate-500">等第</p>
          </div>
          <div>
            <div className="text-4xl font-bold mb-1 text-slate-800">
              {gradeResult.totalScore}<span className="text-lg text-slate-400">/{gradeResult.maxScore}</span>
            </div>
            <p className="text-sm text-slate-500">得分（{percentage}%）</p>
          </div>
        </div>
        <div className="bg-slate-100 rounded-full h-3 overflow-hidden max-w-md mx-auto">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              percentage >= 80 ? "bg-green-500" : percentage >= 60 ? "bg-yellow-500" : "bg-red-500"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Overall feedback */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-indigo-700 mb-2">💡 AI 批改總評</h3>
        <MarkdownRenderer content={gradeResult.overallFeedback} />
      </div>

      {/* Per-question results */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">逐題詳解</h3>
        {exam.questions.map((q) => {
          const result = gradeResult.results.find((r) => r.questionId === q.id);
          if (!result) return null;

          return (
            <div
              key={q.id}
              className={`bg-white border rounded-2xl p-5 shadow-sm ${
                result.isCorrect ? "border-green-200" : "border-red-200"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-lg ${result.isCorrect ? "text-green-500" : "text-red-500"}`}>
                  {result.isCorrect ? "✅" : "❌"}
                </span>
                <span className="text-sm font-medium text-slate-700">第 {q.id} 題</span>
                <span className="text-xs text-slate-400">({q.concept})</span>
                <span className="text-xs text-slate-400 ml-auto">
                  {result.earnedPoints}/{q.points} 分
                </span>
              </div>

              <div className="mb-3">
                <MarkdownRenderer content={q.question} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-sm">
                <div className="bg-slate-50 rounded-xl px-3 py-2">
                  <span className="text-slate-500">你的答案：</span>{" "}
                  <span className="font-medium text-slate-700">{answers[q.id] || "(未作答)"}</span>
                </div>
                <div className="bg-green-50 rounded-xl px-3 py-2">
                  <span className="text-green-600">正確答案：</span>{" "}
                  <span className="font-medium text-green-700">{q.correctAnswer}</span>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm">
                <MarkdownRenderer content={result.feedback} />
              </div>

              <details className="mt-3">
                <summary className="text-xs text-indigo-600 cursor-pointer hover:underline">
                  查看完整解析 (Ch{String(q.sourceChapter).padStart(2, "0")})
                </summary>
                <div className="mt-2 bg-indigo-50 rounded-xl px-4 py-3 text-sm">
                  <MarkdownRenderer content={q.explanation} />
                </div>
              </details>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex justify-center gap-4 pb-6">
        <button
          onClick={onRetry}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          再考一次
        </button>
        <button
          onClick={onBack}
          className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
        >
          返回首頁
        </button>
      </div>
    </div>
  );
}
