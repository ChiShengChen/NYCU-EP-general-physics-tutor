"use client";

import { useRef, useState } from "react";
import { useStudentId } from "@/lib/use-student-id";
import { stripOptionLetter } from "@/lib/strip-option-letter";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThemeToggle } from "./theme-provider";

/**
 * 「📷 從我的筆記出題」mode.
 *
 * Lightweight self-quiz built straight off the student's own lecture
 * notes (1–4 phone photos). Calls /api/notes-quiz which OCRs the
 * images with Gemini multimodal and generates 3–8 questions whose
 * topic comes from what the student actually wrote down — not from
 * the course corpus.
 *
 * No persistence: results live in component state and disappear on
 * back. The images themselves never reach the lecture_chunks table.
 *
 * Self-grade flow: for each question the student sees the prompt +
 * MC options OR a free-form box; clicking "看解答" reveals the
 * correct answer + explanation. No server-side grading round-trip —
 * if the student wants formal grading they can use 自動測驗 instead.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 4;

type Stage = "pick" | "loading" | "quiz" | "error";

interface Question {
  id: number;
  type: "multiple_choice" | "short_answer";
  concept: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
}

interface NotesQuizResponse {
  notesSummary: string;
  questions: Question[];
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

interface NotesQuizProps {
  onBack: () => void;
}

export function NotesQuiz({ onBack }: NotesQuizProps) {
  const studentId = useStudentId();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("pick");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resp, setResp] = useState<NotesQuizResponse | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPick = (picked: File[]) => {
    setErrorMsg(null);
    const accepted: File[] = [];
    const newPreviews: string[] = [];
    for (const f of picked) {
      if (!f.type.startsWith("image/")) {
        setErrorMsg(`只能上傳圖片：${f.name}`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setErrorMsg(`圖片太大（>${(MAX_BYTES / 1024 / 1024) | 0}MB）：${f.name}`);
        continue;
      }
      accepted.push(f);
      newPreviews.push(URL.createObjectURL(f));
    }
    setFiles((cur) => {
      const out = [...cur, ...accepted].slice(0, MAX_IMAGES);
      setPreviews((p) => [...p, ...newPreviews].slice(0, MAX_IMAGES));
      return out;
    });
  };

  const removeAt = (i: number) => {
    URL.revokeObjectURL(previews[i] ?? "");
    setFiles((cur) => cur.filter((_, j) => j !== i));
    setPreviews((cur) => cur.filter((_, j) => j !== i));
  };

  const submit = async () => {
    if (files.length === 0) return;
    setStage("loading");
    setErrorMsg(null);
    try {
      const images = await Promise.all(
        files.map(async (f) => ({ url: await fileToDataUrl(f), mediaType: f.type || "image/jpeg" })),
      );
      const res = await fetch("/api/notes-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, studentId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as NotesQuizResponse;
      if (!data.questions?.length) throw new Error("AI 沒讀出能出題的內容");
      setResp(data);
      setStage("quiz");
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "出題失敗");
      setStage("error");
    }
  };

  const reset = () => {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setFiles([]);
    setPreviews([]);
    setResp(null);
    setAnswers({});
    setRevealedIds(new Set());
    setErrorMsg(null);
    setStage("pick");
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📷</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">從我的筆記出題</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">圖片不儲存</span>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {stage === "pick" && (
            <PickStage
              files={files}
              previews={previews}
              fileInputRef={fileInputRef}
              onPick={onPick}
              onRemove={removeAt}
              onSubmit={submit}
              errorMsg={errorMsg}
            />
          )}

          {stage === "loading" && <LoadingStage count={files.length} />}

          {stage === "error" && (
            <div className="text-center py-12 space-y-3">
              <p className="text-3xl">⚠️</p>
              <p className="text-sm text-rose-600 dark:text-rose-300">{errorMsg}</p>
              <button onClick={reset} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm">重新挑選</button>
            </div>
          )}

          {stage === "quiz" && resp && (
            <QuizStage
              resp={resp}
              answers={answers}
              setAnswers={setAnswers}
              revealedIds={revealedIds}
              setRevealedIds={setRevealedIds}
              onReset={reset}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PickStage({
  files,
  previews,
  fileInputRef,
  onPick,
  onRemove,
  onSubmit,
  errorMsg,
}: {
  files: File[];
  previews: string[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (files: File[]) => void;
  onRemove: (i: number) => void;
  onSubmit: () => void;
  errorMsg: string | null;
}) {
  return (
    <>
      <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 p-4 text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed">
        <p className="font-medium mb-1">怎麼用？</p>
        <ol className="list-decimal pl-5 text-xs space-y-1">
          <li>拍 1–4 張你自己的筆記（手寫、講義截圖都可以）</li>
          <li>AI 會 OCR 讀內容，根據筆記裡寫的東西出 3–8 題</li>
          <li>練習完按重做可以換一批筆記</li>
        </ol>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {previews.map((src, i) => (
          <div key={i} className="relative aspect-[3/4] rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="筆記預覽" className="w-full h-full object-cover" />
            <button
              onClick={() => onRemove(i)}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 text-white text-xs"
              aria-label="移除"
            >
              ×
            </button>
          </div>
        ))}
        {files.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="aspect-[3/4] rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300 flex flex-col items-center justify-center gap-2 transition-colors"
          >
            <span className="text-3xl">＋</span>
            <span className="text-xs">加照片</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {errorMsg && <p className="text-xs text-rose-600 dark:text-rose-300">{errorMsg}</p>}

      <div className="flex justify-center">
        <button
          onClick={onSubmit}
          disabled={files.length === 0}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
        >
          開始出題 →
        </button>
      </div>
    </>
  );
}

function LoadingStage({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
        <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">AI 在讀你的 {count} 張筆記...（約 10–20 秒）</p>
    </div>
  );
}

function QuizStage({
  resp,
  answers,
  setAnswers,
  revealedIds,
  setRevealedIds,
  onReset,
}: {
  resp: NotesQuizResponse;
  answers: Record<number, string>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  revealedIds: Set<number>;
  setRevealedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  onReset: () => void;
}) {
  return (
    <>
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">📝 AI 讀到的內容</p>
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{resp.notesSummary}</p>
      </div>

      {resp.questions.map((q, i) => {
        const revealed = revealedIds.has(q.id);
        const userAns = answers[q.id] ?? "";
        const isMC = q.type === "multiple_choice" && q.options && q.options.length > 0;
        return (
          <div key={q.id} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-300">第 {i + 1} 題</span>
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300">
                {q.concept}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {q.difficulty}
              </span>
            </div>
            <div className="text-slate-800 dark:text-slate-100 mb-3">
              <MarkdownRenderer content={q.question} />
            </div>

            {isMC ? (
              <div className="space-y-2 mb-3">
                {q.options!.map((opt, j) => {
                  const letter = String.fromCharCode(65 + j);
                  const isSelected = userAns === letter;
                  const isCorrect = revealed && q.correctAnswer.toUpperCase() === letter;
                  return (
                    <button
                      key={letter}
                      onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: letter }))}
                      disabled={revealed}
                      className={`w-full text-left px-4 py-2 rounded-xl border text-sm transition ${
                        isCorrect
                          ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200"
                          : isSelected
                            ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-200"
                            : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="font-medium mr-2">{letter}.</span>
                      <MarkdownRenderer content={stripOptionLetter(opt, j)} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={userAns}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                disabled={revealed}
                placeholder="在這裡寫下你的答案..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm h-24 resize-none disabled:opacity-70"
              />
            )}

            <div className="flex items-center gap-2">
              {!revealed && (
                <button
                  onClick={() => setRevealedIds((prev) => new Set(prev).add(q.id))}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs"
                >
                  看解答
                </button>
              )}
              {revealed && (
                <div className="mt-2 w-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2 text-sm text-emerald-900 dark:text-emerald-200">
                  <p className="font-semibold mb-1">正解：{q.correctAnswer}</p>
                  <MarkdownRenderer content={q.explanation} />
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex justify-center pt-2">
        <button onClick={onReset} className="px-5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
          換一批筆記
        </button>
      </div>
    </>
  );
}
