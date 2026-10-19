"use client";

/**
 * 口試模式 (🎤 口試模擬) — a text-based AI oral exam.
 *
 * Flow: pick 1–3 chapters (or 依弱點) → /api/oral-exam start → 3 questions
 * (概念解釋 / 推導 / 情境應用). For each, the examiner asks, the student
 * types (or dictates) an answer, and the examiner may probe at most twice
 * before moving on. No hints, no answers, no timer — just elapsed seconds
 * per question. At the end /api/oral-exam finish grades every question on
 * a 10-point rubric (正確性 /4, 完整性 /3, 表達清晰 /3) and shows the
 * model answers.
 *
 * The question set lives in an opaque, server-signed `examPayload` string
 * that we round-trip on every call (the server is stateless — see
 * lib/oral-payload.ts). The client never sees modelAnswer / rubric until
 * the results screen.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import { apiFetcher, apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { MarkdownRenderer } from "./markdown-renderer";
import { AttemptAnalysisPanel } from "./attempt-analysis-panel";
import { ThemeToggle } from "./theme-provider";
import { VoiceInputButton } from "./voice-input-button";

/* ─── Types ─── */

type OralKind = "concept" | "derivation" | "application";

interface OralQuestionPublic {
  id: number;
  kind: OralKind;
  concept: string;
  question: string;
  sourceChapter: number;
}

interface Turn {
  role: "examiner" | "student";
  text: string;
}

interface StartResponse {
  sessionId: string;
  examPayload: string;
  questions: OralQuestionPublic[];
  chapters: number[];
}

interface TurnResponse {
  reply: string;
  action: "followup" | "next";
  followUpsUsed: number;
}

interface QuestionResult {
  questionId: number;
  correctness: number;
  completeness: number;
  clarity: number;
  score: number;
  isCorrect: boolean;
  earnedPoints: number;
  feedback: string;
  skipped: boolean;
  elapsedSeconds: number;
}

interface OralResult {
  sessionId: string;
  title: string;
  results: QuestionResult[];
  totalScore: number;
  maxScore: number;
  grade: string;
  overallFeedback: string;
  questions: (OralQuestionPublic & { modelAnswer: string; rubric: string[] })[];
}

interface ChapterInfo {
  chapter_number: number;
  page_count: number;
  sections: string[];
}

type OralState = "select" | "loading" | "exam" | "grading" | "results";

const MAX_FOLLOWUPS = 2;

const KIND_LABEL: Record<OralKind, string> = {
  concept: "概念解釋",
  derivation: "推導",
  application: "情境應用",
};

const KIND_BADGE: Record<OralKind, string> = {
  concept: "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300",
  derivation: "bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-300",
  application: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-300",
};

function chapterLabel(ch: number): string {
  return `Ch${String(ch).padStart(2, "0")}`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/** Examiner messages after the opening question = follow-ups spent. */
function countFollowUps(transcript: Turn[]): number {
  return Math.max(0, transcript.filter((t) => t.role === "examiner").length - 1);
}

/* ─── Component ─── */

interface OralExamProps {
  onBack: () => void;
  /** Deep link into 教學模式 at a specific slide, used by the AI 錯題分析
   *  panel's "📖 ChXX p.N" citations on the results page. */
  onNavigateToTeaching?: (chapter: number, page: number) => void;
}

export function OralExam({ onBack, onNavigateToTeaching }: OralExamProps) {
  const studentId = useStudentId() ?? "";
  const [state, setState] = useState<OralState>("select");
  const [error, setError] = useState<string | null>(null);
  /** ISO timestamp taken right before grading; the attempt row lands in
   *  after() so the analysis panel locates it by kind + time. */
  const [gradedAt, setGradedAt] = useState<string | null>(null);

  // Session data from `start`.
  const [examPayload, setExamPayload] = useState<string>("");
  const [questions, setQuestions] = useState<OralQuestionPublic[]>([]);
  const [chapters, setChapters] = useState<number[]>([]);

  // Per-question dialogue state, indexed by position in `questions`.
  const [transcripts, setTranscripts] = useState<Turn[][]>([]);
  const [doneFlags, setDoneFlags] = useState<boolean[]>([]);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState<Record<number, number>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  // Wall-clock stamp for the question currently on screen. Set in the
  // `start` handler / on advance (never during render — Date.now() in a
  // render path trips react-hooks/purity).
  const questionStartRef = useRef<number>(0);

  const [result, setResult] = useState<OralResult | null>(null);

  const startExam = useCallback(async (picked: number[]) => {
    setState("loading");
    setError(null);
    setResult(null);
    try {
      const data = await apiFetcher<StartResponse>("/api/oral-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", studentId, chapters: picked.length ? picked : undefined }),
      });
      if (!data.questions?.length || !data.examPayload) throw new Error("empty question set");
      setExamPayload(data.examPayload);
      setQuestions(data.questions);
      setChapters(data.chapters ?? picked);
      // Seed every transcript with the examiner's opening question so the
      // follow-up count (examiner turns − 1) starts at 0.
      setTranscripts(data.questions.map((q) => [{ role: "examiner", text: q.question }]));
      setDoneFlags(data.questions.map(() => false));
      setSkipped([]);
      setElapsed({});
      setQuestionIndex(0);
      questionStartRef.current = Date.now();
      setState("exam");
    } catch (err) {
      setError("口試題目生成失敗，請稍後再試");
      setState("select");
      console.error("Oral exam start error:", err);
    }
  }, [studentId]);

  const finishExam = useCallback(async (
    finalTranscripts: Turn[][],
    finalSkipped: number[],
    finalElapsed: Record<number, number>,
  ) => {
    setState("grading");
    setError(null);
    setGradedAt(new Date().toISOString());
    try {
      const data = await apiFetcher<{ result: OralResult }>("/api/oral-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          studentId,
          examPayload,
          transcripts: finalTranscripts,
          skipped: finalSkipped,
          elapsed: finalElapsed,
        }),
      });
      setResult(data.result);
      setState("results");
    } catch (err) {
      setError("評分失敗，請稍後再試");
      setState("exam");
      console.error("Oral exam grading error:", err);
    }
  }, [studentId, examPayload]);

  /** Move on from the current question — or finish if it was the last. */
  const advance = useCallback((
    nextTranscripts: Turn[][],
    nextSkipped: number[],
  ) => {
    const q = questions[questionIndex];
    const secs = Math.max(0, Math.round((Date.now() - questionStartRef.current) / 1000));
    const nextElapsed = q ? { ...elapsed, [q.id]: secs } : elapsed;
    setElapsed(nextElapsed);
    if (questionIndex >= questions.length - 1) {
      finishExam(nextTranscripts, nextSkipped, nextElapsed);
      return;
    }
    setQuestionIndex(questionIndex + 1);
    questionStartRef.current = Date.now();
  }, [questions, questionIndex, elapsed, finishExam]);

  const handleSkip = useCallback(() => {
    const q = questions[questionIndex];
    if (!q) return;
    const nextSkipped = skipped.includes(q.id) ? skipped : [...skipped, q.id];
    setSkipped(nextSkipped);
    setDoneFlags((prev) => prev.map((d, i) => (i === questionIndex ? true : d)));
    advance(transcripts, nextSkipped);
  }, [questions, questionIndex, skipped, transcripts, advance]);

  const handleNext = useCallback(() => {
    advance(transcripts, skipped);
  }, [advance, transcripts, skipped]);

  const handleStudentTurn = useCallback(async (text: string) => {
    const transcript = transcripts[questionIndex] ?? [];
    const data = await apiFetcher<TurnResponse>("/api/oral-exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "turn", studentId, examPayload, questionIndex, transcript, studentText: text }),
    });
    const updated: Turn[] = [...transcript, { role: "student", text }, { role: "examiner", text: data.reply }];
    setTranscripts((prev) => prev.map((t, i) => (i === questionIndex ? updated : t)));
    if (data.action === "next") {
      setDoneFlags((prev) => prev.map((d, i) => (i === questionIndex ? true : d)));
    }
  }, [transcripts, questionIndex, studentId, examPayload]);

  const restart = useCallback(() => {
    setState("select");
    setError(null);
    setResult(null);
    setExamPayload("");
    setQuestions([]);
    setTranscripts([]);
    setDoneFlags([]);
    setSkipped([]);
    setElapsed({});
    setQuestionIndex(0);
  }, []);

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
        <span className="text-xl">🎤</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {state === "results" ? "口試結果" : "口試模擬"}
        </h1>
        {state === "exam" && questions.length > 0 ? (
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
            第 {questionIndex + 1} / {questions.length} 題
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">NYCU 電物系</span>
        )}
        <ThemeToggle />
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {state === "select" && <RangePicker onStart={startExam} error={error} />}
        {state === "loading" && <LoadingState chapters={chapters} />}
        {state === "exam" && questions.length > 0 && (
          <ExamView
            key={questionIndex}
            question={questions[questionIndex]}
            index={questionIndex}
            total={questions.length}
            transcript={transcripts[questionIndex] ?? []}
            done={doneFlags[questionIndex] ?? false}
            isLast={questionIndex >= questions.length - 1}
            onStudentTurn={handleStudentTurn}
            onSkip={handleSkip}
            onNext={handleNext}
            error={error}
            clearError={() => setError(null)}
          />
        )}
        {state === "grading" && <GradingState />}
        {state === "results" && result && (
          <OralResults
            result={result}
            transcripts={transcripts}
            gradedAt={gradedAt}
            onNavigateToTeaching={onNavigateToTeaching}
            onRetry={restart}
            onBack={onBack}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Range Picker ─── */

function RangePicker({ onStart, error }: { onStart: (chapters: number[]) => void; error: string | null }) {
  const { data } = useSWR<{ chapters: ChapterInfo[] }>(apiKey("/api/lectures"));
  const chapters = data?.chapters ?? [];
  const [picks, setPicks] = useState<number[]>([]);

  const toggle = (ch: number) => {
    setPicks((prev) => {
      if (prev.includes(ch)) return prev.filter((x) => x !== ch);
      if (prev.length >= 3) return prev;
      return [...prev, ch].sort((a, b) => a - b);
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="text-center">
        <p className="text-4xl mb-3">🎤</p>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">口試模擬</h2>
        <p className="text-slate-500 dark:text-slate-400">
          AI 口試委員問，你用文字（或語音）回答。委員會追問，但不會給提示。
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-300 text-center">
          {error}
        </div>
      )}

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
        <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-2">📋 口試規則</h4>
        <ul className="text-sm text-amber-600 dark:text-amber-300 space-y-1">
          <li>• 共 3 題：概念解釋、推導、情境應用各一題</li>
          <li>• 每題委員最多追問 2 次，追問會針對你漏講或講錯的地方</li>
          <li>• 口試中不給提示、不公布答案；可以按「跳過這題」（計 0 分）</li>
          <li>• 沒有時間限制，但會記錄每題花了多久</li>
          <li>• 每題 10 分：正確性 4、完整性 3、表達清晰 3；結束後才看得到模範答案</li>
          <li>• 成績會更新你的概念掌握度，並存入測驗紀錄</li>
        </ul>
      </div>

      {/* 依弱點 */}
      <button
        onClick={() => onStart([])}
        className="w-full text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all group"
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎯</span>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">依我的弱點自動出題</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              AI 從你掌握度最低的概念裡挑 3 題；新同學會拿到基礎核心概念題。
            </p>
          </div>
          <span className="text-indigo-500 group-hover:translate-x-0.5 transition-transform">→</span>
        </div>
      </button>

      {/* Chapter multi-select */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            或指定章節 <span className="text-xs font-normal text-slate-500 dark:text-slate-400">(選 1–3 章)</span>
          </h3>
        </div>
        {chapters.length === 0 ? (
          <div className="text-center text-sm text-slate-400 dark:text-slate-500 py-6">載入章節列表中...</div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
            {chapters.map((c) => {
              const picked = picks.includes(c.chapter_number);
              return (
                <button
                  key={c.chapter_number}
                  onClick={() => toggle(c.chapter_number)}
                  className={`p-1.5 rounded-lg text-xs font-medium transition-all border ${
                    picked
                      ? "bg-indigo-600 text-white border-indigo-700"
                      : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700"
                  }`}
                >
                  {chapterLabel(c.chapter_number)}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-3 pt-1">
          <span className="text-xs text-slate-600 dark:text-slate-300">
            已選 <strong>{picks.length}</strong> / 最多 3 章
            {picks.length > 0 && `：${picks.map(chapterLabel).join(" + ")}`}
          </span>
          <button
            onClick={() => onStart(picks)}
            disabled={picks.length === 0}
            className="ml-auto px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            開始口試 →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Loading / Grading ─── */

function LoadingState({ chapters }: { chapters: number[] }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
        <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
      </div>
      <p className="text-slate-600 dark:text-slate-300 font-medium">口試委員正在準備題目...</p>
      <p className="text-sm text-slate-400 dark:text-slate-500">
        {chapters.length > 0 ? `範圍：${chapters.map(chapterLabel).join(" + ")}` : "依你的薄弱概念出題"}
      </p>
    </div>
  );
}

function GradingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
        <div className="absolute inset-0 rounded-full border-4 border-green-500 border-t-transparent animate-spin" />
      </div>
      <p className="text-slate-600 dark:text-slate-300 font-medium">口試委員正在評分...</p>
      <p className="text-sm text-slate-400 dark:text-slate-500">依 rubric 逐題評分，請稍候</p>
    </div>
  );
}

/* ─── Exam View (one question) ─── */

function ExamView({
  question,
  index,
  total,
  transcript,
  done,
  isLast,
  onStudentTurn,
  onSkip,
  onNext,
  error,
  clearError,
}: {
  question: OralQuestionPublic;
  index: number;
  total: number;
  transcript: Turn[];
  done: boolean;
  isLast: boolean;
  onStudentTurn: (text: string) => Promise<void>;
  onSkip: () => void;
  onNext: () => void;
  error: string | null;
  clearError: () => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followUpsUsed = countFollowUps(transcript);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, sending]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || done) return;
    setSending(true);
    setTurnError(null);
    try {
      await onStudentTurn(text);
      setInput("");
    } catch (err) {
      setTurnError("送出失敗，請再試一次");
      console.error("Oral exam turn error:", err);
    } finally {
      setSending(false);
    }
  }, [input, sending, done, onStudentTurn]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4 flex flex-col min-h-full">
      {/* Question header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">第 {index + 1} / {total} 題</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${KIND_BADGE[question.kind]}`}>
            {KIND_LABEL[question.kind]}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {question.concept} · {chapterLabel(question.sourceChapter)}
          </span>
          <span
            className={`ml-auto px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              followUpsUsed >= MAX_FOLLOWUPS
                ? "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
            }`}
            title="口試委員每題最多追問 2 次"
          >
            追問 {followUpsUsed}/{MAX_FOLLOWUPS}
          </span>
        </div>
      </div>

      {/* Dialogue for this question */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto max-h-[50vh] pr-1">
        {transcript.map((t, i) => (
          <div key={i} className={`flex ${t.role === "student" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                t.role === "student"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-slate-800 dark:text-slate-100 shadow-sm rounded-bl-sm"
              }`}
            >
              {t.role === "student" ? (
                <p className="whitespace-pre-wrap text-sm">{t.text}</p>
              ) : (
                <>
                  <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-1">
                    🎓 口試委員{i > 0 ? `（追問 ${countFollowUps(transcript.slice(0, i + 1))}）` : ""}
                  </p>
                  <MarkdownRenderer content={t.text} />
                </>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {(error || turnError) && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm text-red-600 dark:text-red-300 flex items-center gap-3">
          <span className="flex-1">{error ?? turnError}</span>
          <button
            onClick={() => { clearError(); setTurnError(null); }}
            className="text-xs underline hover:no-underline"
          >
            關閉
          </button>
        </div>
      )}

      {/* Input / next controls */}
      {done ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-300 flex-1 text-center sm:text-left">
            這題結束。{isLast ? "三題都問完了，交卷後口試委員會評分。" : "準備好就進下一題。"}
          </p>
          <button
            onClick={onNext}
            className={`px-6 py-2 rounded-xl text-sm font-medium text-white transition-colors ${
              isLast ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {isLast ? "交卷並評分" : "下一題 →"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder="用你自己的話回答口試委員...（公式可用 $..$；Shift+Enter 換行）"
            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none h-32 disabled:opacity-60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <VoiceInputButton
              disabled={sending}
              onPartial={(text) => setInput(text)}
              onFinal={(text) => setInput(text)}
            />
            {showSkipConfirm ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>跳過後這題計 0 分，確定？</span>
                <button
                  type="button"
                  onClick={() => { setShowSkipConfirm(false); onSkip(); }}
                  className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                >
                  確定跳過
                </button>
                <button
                  type="button"
                  onClick={() => setShowSkipConfirm(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  繼續作答
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSkipConfirm(true)}
                disabled={sending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
              >
                跳過這題
              </button>
            )}
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="ml-auto rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              送出
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ─── Results ─── */

function OralResults({
  result,
  transcripts,
  gradedAt,
  onNavigateToTeaching,
  onRetry,
  onBack,
}: {
  result: OralResult;
  transcripts: Turn[][];
  gradedAt: string | null;
  onNavigateToTeaching?: (chapter: number, page: number) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const percentage = result.maxScore > 0 ? Math.round((result.totalScore / result.maxScore) * 100) : 0;
  const totalSeconds = result.results.reduce((s, r) => s + r.elapsedSeconds, 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Score summary */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm text-center">
        <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-4">{result.title}</h2>
        <div className="flex items-center justify-center gap-8 mb-4">
          <div>
            <div className="text-5xl font-bold mb-1">
              <span
                className={`${
                  result.grade.startsWith("A")
                    ? "text-green-600 dark:text-green-300"
                    : result.grade.startsWith("B")
                      ? "text-blue-600 dark:text-blue-300"
                      : result.grade.startsWith("C")
                        ? "text-yellow-600 dark:text-yellow-300"
                        : "text-red-500"
                }`}
              >
                {result.grade}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">等第</p>
          </div>
          <div>
            <div className="text-4xl font-bold mb-1 text-slate-800 dark:text-slate-100">
              {result.totalScore}<span className="text-lg text-slate-400 dark:text-slate-500">/{result.maxScore}</span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">得分（{percentage}%）</p>
          </div>
        </div>
        <div className="bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden max-w-md mx-auto">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              percentage >= 80 ? "bg-green-500" : percentage >= 60 ? "bg-yellow-500" : "bg-red-500"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">口試總時長 {formatElapsed(totalSeconds)}</p>
      </div>

      {/* Overall feedback */}
      <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-2">🎓 口試委員總評</h3>
        <MarkdownRenderer content={result.overallFeedback} />
      </div>

      {/* AI 錯題分析 — only when at least one question fell below the bar */}
      {gradedAt && result.results.some((r) => !r.isCorrect) && (
        <AttemptAnalysisPanel
          locate={{ kind: "oral", since: gradedAt }}
          onNavigateToTeaching={onNavigateToTeaching}
        />
      )}

      {/* Per-question */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">逐題評分</h3>
        {result.questions.map((q, idx) => {
          const r = result.results.find((x) => x.questionId === q.id);
          if (!r) return null;
          const studentTurns = (transcripts[idx] ?? []).filter((t) => t.role === "student");
          return (
            <div
              key={q.id}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-sm ${
                r.isCorrect ? "border-green-200 dark:border-green-800" : "border-red-200 dark:border-red-800"
              }`}
            >
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className={`text-lg ${r.isCorrect ? "text-green-500" : "text-red-500"}`}>
                  {r.skipped ? "⏭️" : r.isCorrect ? "✅" : "❌"}
                </span>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">第 {idx + 1} 題</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${KIND_BADGE[q.kind]}`}>
                  {KIND_LABEL[q.kind]}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">({q.concept} · {chapterLabel(q.sourceChapter)})</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
                  {r.earnedPoints}/10 分 · {formatElapsed(r.elapsedSeconds)}
                </span>
              </div>

              <div className="mb-3">
                <MarkdownRenderer content={q.question} />
              </div>

              {/* Rubric breakdown */}
              <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                <RubricCell label="正確性" value={r.correctness} max={4} />
                <RubricCell label="完整性" value={r.completeness} max={3} />
                <RubricCell label="表達清晰" value={r.clarity} max={3} />
              </div>

              {/* Student's answers */}
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2 mb-3 text-sm space-y-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">你的回答</span>
                {r.skipped || studentTurns.length === 0 ? (
                  <p className="text-slate-400 dark:text-slate-500">(跳過未作答)</p>
                ) : (
                  studentTurns.map((t, i) => (
                    <p key={i} className="whitespace-pre-wrap text-slate-700 dark:text-slate-200 border-l-2 border-indigo-300 dark:border-indigo-700 pl-2">
                      {t.text}
                    </p>
                  ))
                )}
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-3 text-sm">
                <MarkdownRenderer content={r.feedback} />
              </div>

              <details className="mt-3">
                <summary className="text-xs text-indigo-600 dark:text-indigo-300 cursor-pointer hover:underline">
                  查看模範答案與評分要點 ({chapterLabel(q.sourceChapter)})
                </summary>
                <div className="mt-2 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl px-4 py-3 text-sm space-y-3">
                  <div>
                    <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">模範答案</p>
                    <MarkdownRenderer content={q.modelAnswer} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">評分要點</p>
                    <ul className="list-disc pl-5 space-y-0.5 text-slate-700 dark:text-slate-200">
                      {q.rubric.map((pt, i) => (
                        <li key={i}><MarkdownRenderer content={pt} /></li>
                      ))}
                    </ul>
                  </div>
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
          className="px-6 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          返回首頁
        </button>
      </div>
    </div>
  );
}

function RubricCell({ label, value, max }: { label: string; value: number; max: number }) {
  const full = value >= max;
  const zero = value === 0;
  return (
    <div
      className={`rounded-xl px-2 py-2 border ${
        full
          ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
          : zero
            ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800"
            : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
      }`}
    >
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-base font-semibold text-slate-800 dark:text-slate-100">
        {value}<span className="text-xs text-slate-400 dark:text-slate-500">/{max}</span>
      </div>
    </div>
  );
}
