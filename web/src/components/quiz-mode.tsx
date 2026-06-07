"use client";

import { useState, useEffect, useCallback } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { FormulaHelp } from "./formula-help";
import { ConfidenceSelector } from "./confidence-selector";
import { HintPanel } from "./hint-panel";
import { ReportQuestionButton } from "./report-question-button";
import { RegenerateQuestionButton } from "./regenerate-question-button";
import { stripOptionLetter } from "@/lib/strip-option-letter";
import { ThemeToggle } from "./theme-provider";

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

type QuizState = "select" | "loading" | "answering" | "grading" | "results";

interface ChapterInfo {
  chapter_number: number;
  page_count: number;
  sections: string[];
}

/* ─── Component ─── */

interface QuizModeProps {
  onBack: () => void;
}

export function QuizMode({ onBack }: QuizModeProps) {
  const [state, setState] = useState<QuizState>("select");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [isIntroQuiz, setIsIntroQuiz] = useState(false);
  const [scopeChapter, setScopeChapter] = useState<number | null>(null);  // null = full range
  const [scopeAppliedChapters, setScopeAppliedChapters] = useState<number[] | null>(null);  // 2–3 chapters for synthesis quiz
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [confidences, setConfidences] = useState<Record<number, number>>({});
  const [hintUsage, setHintUsage] = useState<Record<number, number>>({});
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

  // Load chapter list once for the picker
  useEffect(() => {
    fetch("/api/lectures")
      .then((r) => r.json())
      .then((d) => setChapters(d.chapters ?? []))
      .catch(() => {});
  }, []);

  /** Trigger generation. `mode === "applied"` runs the multi-chapter synthesis
   *  branch; other modes are full-range or single-chapter (existing behaviour). */
  const generateQuiz = useCallback(async (
    spec: { mode: "full" | "chapter" | "applied"; chapter?: number; chapters?: number[] },
  ) => {
    setState("loading");
    setError(null);
    setAnswers({});
    setConfidences({});
    setHintUsage({});
    setGradeResult(null);
    setCurrentQuestion(0);
    setScopeChapter(spec.mode === "chapter" ? (spec.chapter ?? null) : null);
    setScopeAppliedChapters(spec.mode === "applied" ? (spec.chapters ?? null) : null);

    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          studentId,
          chapter: spec.mode === "chapter" ? spec.chapter : undefined,
          chapters: spec.mode === "applied" ? spec.chapters : undefined,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setQuiz(data.quiz);
      setIsIntroQuiz(data.isIntroQuiz);
      setState("answering");
    } catch (err) {
      setError("測驗生成失敗，請稍後再試");
      console.error("Quiz generation error:", err);
      setState("select");
    }
  }, [studentId]);

  const restart = useCallback(() => {
    setState("select");
    setQuiz(null);
    setAnswers({});
    setConfidences({});
    setHintUsage({});
    setGradeResult(null);
    setCurrentQuestion(0);
    setScopeChapter(null);
    setScopeAppliedChapters(null);
  }, []);

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
          confidences,
          hintUsage,
          quizTitle: quiz.title,
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
  }, [quiz, answers, studentId, confidences, hintUsage]);

  const answeredCount = quiz ? quiz.questions.filter((q) => answers[q.id]?.trim()).length : 0;
  const totalQuestions = quiz?.questions.length ?? 0;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <ThemeToggle />
        <span className="text-xl">📝</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {state === "results" ? "測驗結果" : "自動測驗"}
        </h1>
        {state === "answering" && (
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">
            {scopeChapter
              ? `Ch${String(scopeChapter).padStart(2, "0")} · `
              : scopeAppliedChapters
                ? `${scopeAppliedChapters.map((c) => `Ch${String(c).padStart(2, "0")}`).join("+")} 綜合 · `
                : ""}
            已答 {answeredCount}/{totalQuestions}
          </span>
        )}
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">NYCU 電物系</span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {state === "select" && (
          <ScopeSelector chapters={chapters} onPick={generateQuiz} />
        )}
        {state === "loading" && <LoadingState scopeChapter={scopeChapter} scopeAppliedChapters={scopeAppliedChapters} />}
        {state === "answering" && quiz && (
          <AnsweringState
            quiz={quiz}
            isIntroQuiz={isIntroQuiz}
            answers={answers}
            setAnswers={setAnswers}
            confidences={confidences}
            setConfidences={setConfidences}
            hintUsage={hintUsage}
            setHintUsage={setHintUsage}
            currentQuestion={currentQuestion}
            setCurrentQuestion={setCurrentQuestion}
            onSubmit={handleSubmit}
            answeredCount={answeredCount}
            onReplaceQuestion={(oldId, newQ) => {
              setQuiz({
                ...quiz,
                questions: quiz.questions.map((qq) => (qq.id === oldId ? { ...newQ, id: oldId } : qq)),
              });
            }}
            onResetForQuestion={(qid) => {
              const a = { ...answers }; delete a[qid]; setAnswers(a);
              const c = { ...confidences }; delete c[qid]; setConfidences(c);
              const h = { ...hintUsage }; delete h[qid]; setHintUsage(h);
            }}
          />
        )}
        {state === "grading" && <GradingState />}
        {state === "results" && quiz && gradeResult && (
          <ResultsState
            quiz={quiz}
            answers={answers}
            gradeResult={gradeResult}
            onRetry={restart}
            onBack={onBack}
          />
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-red-500">{error}</p>
            <button
              onClick={restart}
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

/* ─── Scope Selector (initial screen) ─── */

function ScopeSelector({
  chapters,
  onPick,
}: {
  chapters: ChapterInfo[];
  onPick: (spec: { mode: "full" | "chapter" | "applied"; chapter?: number; chapters?: number[] }) => void;
}) {
  // Multi-select state for the applied-synthesis branch (2–3 chapters).
  const [appliedPicks, setAppliedPicks] = useState<number[]>([]);
  const toggleApplied = (ch: number) => {
    setAppliedPicks((prev) => {
      if (prev.includes(ch)) return prev.filter((x) => x !== ch);
      if (prev.length >= 3) return prev;
      return [...prev, ch].sort((a, b) => a - b);
    });
  };

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <p className="text-3xl mb-2">📝</p>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">選擇測驗範圍</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">每份測驗 5 題（3 選擇題 + 2 簡答題）</p>
      </div>

      {/* Full-range option */}
      <button
        onClick={() => onPick({ mode: "full" })}
        className="w-full text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 transition-all group"
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">🌐</span>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">全範圍（依薄弱概念）</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              AI 根據你過去答題狀況挑出最薄弱的概念出題；新同學會收到入門題。
            </p>
          </div>
          <span className="text-indigo-500 group-hover:translate-x-0.5 transition-transform">→</span>
        </div>
      </button>

      {/* Chapter grid */}
      <div>
        <h3 className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">或選擇特定章節（單章測驗，20 題）</h3>
        {chapters.length === 0 ? (
          <div className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">載入章節列表中...</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
            {chapters.map((c) => (
              <button
                key={c.chapter_number}
                onClick={() => onPick({ mode: "chapter", chapter: c.chapter_number })}
                className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-center hover:border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50/50 transition-all"
              >
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Ch{String(c.chapter_number).padStart(2, "0")}
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500">{c.page_count} 頁</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Multi-chapter applied (synthesis) */}
      {chapters.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
              🧩 跨章節綜合應用題 <span className="text-xs font-normal text-amber-700 dark:text-amber-300">(選 2–3 章)</span>
            </h3>
            <p className="text-xs text-amber-700/80 mt-0.5">
              出 5 題真的需要綜合運用所選章節的應用題（例：滾球＝能量＋角動量，RLC＝SHM＋電路）。難度偏高，考前複習神器。
            </p>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
            {chapters.map((c) => {
              const picked = appliedPicks.includes(c.chapter_number);
              return (
                <button
                  key={c.chapter_number}
                  onClick={() => toggleApplied(c.chapter_number)}
                  className={`p-1.5 rounded-lg text-xs font-medium transition-all border ${
                    picked
                      ? "bg-amber-500 text-white border-amber-600"
                      : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:border-amber-700"
                  }`}
                >
                  Ch{String(c.chapter_number).padStart(2, "0")}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs text-amber-800 dark:text-amber-200">
              已選 <strong>{appliedPicks.length}</strong> / 最多 3 章
              {appliedPicks.length > 0 && `：${appliedPicks.map((c) => `Ch${String(c).padStart(2, "0")}`).join(" + ")}`}
            </span>
            <button
              onClick={() => onPick({ mode: "applied", chapters: appliedPicks })}
              disabled={appliedPicks.length < 2}
              className="ml-auto px-4 py-1.5 rounded-xl bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              出綜合應用題 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Loading State ─── */

function LoadingState({
  scopeChapter,
  scopeAppliedChapters,
}: {
  scopeChapter: number | null;
  scopeAppliedChapters: number[] | null;
}) {
  const isChapter = scopeChapter !== null;
  const isApplied = scopeAppliedChapters !== null && scopeAppliedChapters.length > 0;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
        <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
      </div>
      <p className="text-slate-600 dark:text-slate-300 font-medium">
        {isApplied
          ? `正在出 ${scopeAppliedChapters.map((c) => `Ch${String(c).padStart(2, "0")}`).join(" + ")} 的綜合應用題...`
          : isChapter
            ? `正在從 Ch${String(scopeChapter).padStart(2, "0")} 出題...`
            : "正在根據你的學習狀況生成測驗..."}
      </p>
      <p className="text-sm text-slate-400 dark:text-slate-500">
        {isApplied
          ? "AI 正在交織多章節概念設計綜合題（這類題比較難，請耐心等）"
          : isChapter
            ? "AI 正在閱讀該章教材"
            : "AI 正在分析薄弱概念並出題"}
      </p>
    </div>
  );
}

/* ─── Grading State ─── */

function GradingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
        <div className="absolute inset-0 rounded-full border-4 border-green-500 border-t-transparent animate-spin" />
      </div>
      <p className="text-slate-600 dark:text-slate-300 font-medium">AI 正在批改你的答案...</p>
    </div>
  );
}

/* ─── Answering State ─── */

function AnsweringState({
  quiz,
  isIntroQuiz,
  answers,
  setAnswers,
  confidences,
  setConfidences,
  hintUsage,
  setHintUsage,
  currentQuestion,
  setCurrentQuestion,
  onSubmit,
  answeredCount,
  onReplaceQuestion,
  onResetForQuestion,
}: {
  quiz: Quiz;
  isIntroQuiz: boolean;
  answers: Record<number, string>;
  setAnswers: (a: Record<number, string>) => void;
  confidences: Record<number, number>;
  setConfidences: (c: Record<number, number>) => void;
  hintUsage: Record<number, number>;
  setHintUsage: (h: Record<number, number>) => void;
  currentQuestion: number;
  setCurrentQuestion: (n: number) => void;
  onSubmit: () => void;
  answeredCount: number;
  onReplaceQuestion: (oldId: number, newQ: QuizQuestion) => void;
  onResetForQuestion: (qid: number) => void;
}) {
  const q = quiz.questions[currentQuestion];
  const total = quiz.questions.length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Quiz info */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">{quiz.title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{quiz.description}</p>
        {isIntroQuiz && (
          <p className="text-xs text-indigo-500 mt-2 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-1 rounded-full inline-block">
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
                  ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Current question */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              q.type === "multiple_choice"
                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300"
                : "bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-300"
            }`}
          >
            {q.type === "multiple_choice" ? "選擇題" : "簡答題"}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              q.difficulty === "easy"
                ? "bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-300"
                : q.difficulty === "medium"
                  ? "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-600 dark:text-yellow-300"
                  : "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300"
            }`}
          >
            {q.difficulty === "easy" ? "基礎" : q.difficulty === "medium" ? "中等" : "進階"}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">Ch{String(q.sourceChapter).padStart(2, "0")}</span>
          <span className="ml-auto flex items-center gap-2">
            <RegenerateQuestionButton
              question={q}
              onReplace={(newQ) => onReplaceQuestion(q.id, newQ as QuizQuestion)}
              onResetForQuestion={onResetForQuestion}
            />
            <ReportQuestionButton
              questionId={q.id}
              question={{ question: q.question, correctAnswer: q.correctAnswer, sourceChapter: q.sourceChapter }}
            />
          </span>
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
                      ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 ring-2 ring-indigo-200"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className={`font-medium ${isSelected ? "text-indigo-700 dark:text-indigo-300" : "text-slate-600 dark:text-slate-300"}`}>
                    {letter}.{" "}
                  </span>
                  <span className={isSelected ? "text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-200"}>
                    <MarkdownRenderer content={stripOptionLetter(option, i)} />
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
              placeholder="在此輸入你的答案...（公式可用 $..$ 或 $$..$$ 包住）"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none h-32"
            />
            <FormulaHelp />
            <HintPanel
              key={`hint-${q.id}`}
              question={q.question}
              correctAnswer={q.correctAnswer}
              sourceChapter={q.sourceChapter ?? null}
              draftAnswer={answers[q.id] ?? ""}
              onLevelChange={(lvl) => setHintUsage({ ...hintUsage, [q.id]: lvl })}
            />
          </div>
        )}

        {/* Confidence calibration — feeds dashboard + flags misconceptions */}
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <ConfidenceSelector
            value={confidences[q.id] ?? null}
            onChange={(v) => setConfidences({ ...confidences, [q.id]: v })}
          />
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
          disabled={currentQuestion === 0}
          className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          上一題
        </button>

        {currentQuestion < total - 1 ? (
          <button
            onClick={() => setCurrentQuestion(currentQuestion + 1)}
            className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm text-center">
        <div className="text-5xl font-bold mb-2">
          <span
            className={
              percentage >= 80
                ? "text-green-600 dark:text-green-300"
                : percentage >= 60
                  ? "text-yellow-600 dark:text-yellow-300"
                  : "text-red-500"
            }
          >
            {percentage}%
          </span>
        </div>
        <p className="text-slate-600 dark:text-slate-300">
          答對 {correctCount} / {maxScore} 題
        </p>
        <div className="mt-4 bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
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
      <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-2">💡 AI 學習建議</h3>
        <MarkdownRenderer content={gradeResult.overallFeedback} />
      </div>

      {/* Per-question results */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">詳細結果</h3>
        {quiz.questions.map((q) => {
          const result = gradeResult.results.find((r) => r.questionId === q.id);
          if (!result) return null;

          return (
            <div
              key={q.id}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-sm ${
                result.isCorrect ? "border-green-200 dark:border-green-800" : "border-red-200 dark:border-red-800"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-lg ${result.isCorrect ? "text-green-500" : "text-red-500"}`}>
                  {result.isCorrect ? "✅" : "❌"}
                </span>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">第 {q.id} 題</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">({q.concept})</span>
                {result.score === 0.5 && (
                  <span className="text-xs bg-yellow-50 dark:bg-yellow-950/30 text-yellow-600 dark:text-yellow-300 px-2 py-0.5 rounded-full">部分正確</span>
                )}
              </div>

              <div className="mb-3">
                <MarkdownRenderer content={q.question} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-sm">
                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2">
                  <span className="text-slate-500 dark:text-slate-400">你的答案：</span>{" "}
                  <span className="font-medium text-slate-700 dark:text-slate-200">{answers[q.id] || "(未作答)"}</span>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 rounded-xl px-3 py-2">
                  <span className="text-green-600 dark:text-green-300">正確答案：</span>{" "}
                  <span className="font-medium text-green-700 dark:text-green-300">{q.correctAnswer}</span>
                </div>
              </div>

              {/* Feedback */}
              <div className="bg-slate-50 dark:bg-slate-900 rounded-xl px-4 py-3 text-sm">
                <MarkdownRenderer content={result.feedback} />
              </div>

              {/* Detailed explanation */}
              <details className="mt-3">
                <summary className="text-xs text-indigo-600 dark:text-indigo-300 cursor-pointer hover:underline">
                  查看完整解析 (Ch{String(q.sourceChapter).padStart(2, "0")})
                </summary>
                <div className="mt-2 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl px-4 py-3 text-sm">
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
          className="px-6 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          返回首頁
        </button>
      </div>
    </div>
  );
}
