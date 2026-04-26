"use client";

import { useState, useEffect, useCallback } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

/* ─── Types ─── */

interface QuizQuestion {
  id: number;
  type: "multiple_choice" | "short_answer";
  concept: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  sourceChapter: number;
}

interface Quiz {
  title: string;
  description: string;
  questions: QuizQuestion[];
}

interface GradeResultItem {
  questionId: number;
  isCorrect: boolean;
  score: number;
  feedback: string;
}

interface GradeResult {
  results: GradeResultItem[];
  overallFeedback: string;
}

type QuizState = "loading" | "answering" | "grading" | "results";

/* ─── Component ─── */

interface QuizModeProps {
  onBack: () => void;
}

export function QuizMode({ onBack }: QuizModeProps) {
  const [state, setState] = useState<QuizState>("loading");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [isIntroQuiz, setIsIntroQuiz] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);

  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("physics_tutor_student_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem("physics_tutor_student_id", id);
    return id;
  });

  // Generate quiz on mount
  useEffect(() => {
    generateQuiz();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generateQuiz = useCallback(async () => {
    setState("loading");
    setError(null);
    setAnswers({});
    setGradeResult(null);
    setCurrentQuestion(0);

    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", studentId }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setQuiz(data.quiz);
      setIsIntroQuiz(data.isIntroQuiz);
      setState("answering");
    } catch (err) {
      setError("測驗生成失敗，請稍後再試");
      console.error("Quiz generation error:", err);
    }
  }, [studentId]);

  const handleSubmit = useCallback(async () => {
    if (!quiz) return;
    setState("grading");

    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grade",
          studentId,
          questions: quiz.questions,
          answers,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setGradeResult(data.gradeResult);
      setState("results");
    } catch (err) {
      setError("批改失敗，請稍後再試");
      setState("answering");
      console.error("Quiz grading error:", err);
    }
  }, [quiz, answers, studentId]);

  const answeredCount = quiz ? quiz.questions.filter((q) => answers[q.id]?.trim()).length : 0;
  const totalQuestions = quiz?.questions.length ?? 0;

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
        <span className="text-xl">📝</span>
        <h1 className="text-lg font-semibold text-slate-800">
          {state === "results" ? "測驗結果" : "自動測驗"}
        </h1>
        {state === "answering" && (
          <span className="text-xs text-slate-400 ml-2">
            已答 {answeredCount}/{totalQuestions}
          </span>
        )}
        <span className="text-xs text-slate-400 ml-auto">NYCU 電物系</span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {state === "loading" && <LoadingState />}
        {state === "answering" && quiz && (
          <AnsweringState
            quiz={quiz}
            isIntroQuiz={isIntroQuiz}
            answers={answers}
            setAnswers={setAnswers}
            currentQuestion={currentQuestion}
            setCurrentQuestion={setCurrentQuestion}
            onSubmit={handleSubmit}
            answeredCount={answeredCount}
          />
        )}
        {state === "grading" && <GradingState />}
        {state === "results" && quiz && gradeResult && (
          <ResultsState
            quiz={quiz}
            answers={answers}
            gradeResult={gradeResult}
            onRetry={generateQuiz}
            onBack={onBack}
          />
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-red-500">{error}</p>
            <button
              onClick={generateQuiz}
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

/* ─── Loading State ─── */

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
        <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
      </div>
      <p className="text-slate-600 font-medium">正在根據你的學習狀況生成測驗...</p>
      <p className="text-sm text-slate-400">AI 正在分析薄弱概念並出題</p>
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
      <p className="text-slate-600 font-medium">AI 正在批改你的答案...</p>
    </div>
  );
}

/* ─── Answering State ─── */

function AnsweringState({
  quiz,
  isIntroQuiz,
  answers,
  setAnswers,
  currentQuestion,
  setCurrentQuestion,
  onSubmit,
  answeredCount,
}: {
  quiz: Quiz;
  isIntroQuiz: boolean;
  answers: Record<number, string>;
  setAnswers: (a: Record<number, string>) => void;
  currentQuestion: number;
  setCurrentQuestion: (n: number) => void;
  onSubmit: () => void;
  answeredCount: number;
}) {
  const q = quiz.questions[currentQuestion];
  const total = quiz.questions.length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Quiz info */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">{quiz.title}</h2>
        <p className="text-sm text-slate-500">{quiz.description}</p>
        {isIntroQuiz && (
          <p className="text-xs text-indigo-500 mt-2 bg-indigo-50 px-3 py-1 rounded-full inline-block">
            📋 入門測驗 — 幫助 AI 了解你的程度
          </p>
        )}
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2">
        {quiz.questions.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentQuestion(i)}
            className={`w-8 h-8 rounded-full text-xs font-medium transition-all duration-200 ${
              i === currentQuestion
                ? "bg-indigo-600 text-white scale-110"
                : answers[quiz.questions[i].id]?.trim()
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
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              q.difficulty === "easy"
                ? "bg-green-50 text-green-600"
                : q.difficulty === "medium"
                  ? "bg-yellow-50 text-yellow-600"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {q.difficulty === "easy" ? "基礎" : q.difficulty === "medium" ? "中等" : "進階"}
          </span>
          <span className="text-xs text-slate-400">Ch{String(q.sourceChapter).padStart(2, "0")}</span>
        </div>

        <div className="mb-5">
          <MarkdownRenderer content={`**${q.id}.** ${q.question}`} />
        </div>

        {/* Multiple choice options */}
        {q.type === "multiple_choice" && q.options ? (
          <div className="space-y-2">
            {q.options.map((option, i) => {
              const letter = String.fromCharCode(65 + i); // A, B, C, D
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
          <textarea
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            placeholder="在此輸入你的答案..."
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none h-32"
          />
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
          <button
            onClick={onSubmit}
            disabled={answeredCount === 0}
            className="px-6 py-2 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            提交測驗（{answeredCount}/{total}）
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Results State ─── */

function ResultsState({
  quiz,
  answers,
  gradeResult,
  onRetry,
  onBack,
}: {
  quiz: Quiz;
  answers: Record<number, string>;
  gradeResult: GradeResult;
  onRetry: () => void;
  onBack: () => void;
}) {
  const totalScore = gradeResult.results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = gradeResult.results.length;
  const percentage = Math.round((totalScore / maxScore) * 100);
  const correctCount = gradeResult.results.filter((r) => r.isCorrect).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Score summary */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center">
        <div className="text-5xl font-bold mb-2">
          <span
            className={
              percentage >= 80
                ? "text-green-600"
                : percentage >= 60
                  ? "text-yellow-600"
                  : "text-red-500"
            }
          >
            {percentage}%
          </span>
        </div>
        <p className="text-slate-600">
          答對 {correctCount} / {maxScore} 題
        </p>
        <div className="mt-4 bg-slate-100 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              percentage >= 80
                ? "bg-green-500"
                : percentage >= 60
                  ? "bg-yellow-500"
                  : "bg-red-500"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Overall feedback */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-indigo-700 mb-2">💡 AI 學習建議</h3>
        <MarkdownRenderer content={gradeResult.overallFeedback} />
      </div>

      {/* Per-question results */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">詳細結果</h3>
        {quiz.questions.map((q) => {
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
                {result.score === 0.5 && (
                  <span className="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">部分正確</span>
                )}
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

              {/* Feedback */}
              <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm">
                <MarkdownRenderer content={result.feedback} />
              </div>

              {/* Detailed explanation */}
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
          再測一次
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
