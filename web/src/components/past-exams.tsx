"use client";

import { useState } from "react";
import useSWR from "swr";
import { ApiError, apiFetcher } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { stripOptionLetter } from "@/lib/strip-option-letter";
import { CHAPTER_NODES } from "@/lib/concept-graph";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThemeToggle } from "./theme-provider";

/**
 * 📜 考古題 — practise the teacher's past exam questions one set at a time.
 *
 * Data comes from `/api/past-exams` (teacher bank rows tagged `考古題` +
 * `2024-期中`-style year-term tags). The flow is deliberately lightweight:
 * no attempt is recorded, each question is checked on its own, and the
 * per-set progress («已作答 n / N») lives in component state mirrored to
 * localStorage so a refresh doesn't wipe it.
 *
 * Per question:
 *   「對答案」            → POST check   (MC deterministic / SA one LLM grade)
 *   「📖 這題在講義哪裡」 → POST locate  (RAG, no LLM) → chips that deep-link
 *                                        into 教學模式 via onNavigateToTeaching
 *   「🔁 出一題類似的」   → POST similar (one LLM call) → inline variant with
 *                                        its own answer box
 */

/* ─── Types ─── */

type QuestionType = "multiple_choice" | "short_answer";
type Difficulty = "easy" | "medium" | "hard";

interface PastExamSet {
  tag: string;
  count: number;
  chapters: number[];
}

interface SetsResponse {
  sets: PastExamSet[];
  total: number;
}

interface PastExamQuestion {
  id: number;
  chapter: number;
  type: QuestionType;
  concept: string;
  difficulty: Difficulty;
  question: string;
  options: string[] | null;
  points: number;
  tags: string[];
}

interface SetResponse {
  set: string;
  questions: PastExamQuestion[];
}

interface CheckResult {
  isCorrect: boolean;
  score: number;
  feedback: string;
  correctAnswer: string;
  explanation: string;
}

interface LocatePage {
  chapter: number;
  page: number;
  sectionTitle: string;
  snippet: string;
}

interface Variant {
  type: QuestionType;
  concept: string;
  difficulty: Difficulty;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  sourceChapter: number;
}

/** What we keep per answered question (state + localStorage). */
interface SavedAnswer {
  answer: string;
  result: CheckResult;
}

type Progress = Record<number, SavedAnswer>;

/* ─── Helpers ─── */

const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "基礎", medium: "中等", hard: "進階" };
const DIFFICULTY_TONES: Record<Difficulty, string> = {
  easy: "bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-300",
  medium: "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-600 dark:text-yellow-300",
  hard: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300",
};
const TYPE_LABELS: Record<QuestionType, string> = { multiple_choice: "選擇題", short_answer: "簡答題" };

function chapterLabel(n: number): string {
  return `Ch${String(n).padStart(2, "0")}`;
}

function chapterTitle(n: number): string {
  const node = CHAPTER_NODES.find((c) => c.chapter === n);
  return node ? `${chapterLabel(n)} ${node.label}` : chapterLabel(n);
}

function progressKey(studentId: string | null, set: string): string {
  return `physics_tutor_past_exam_${studentId || "anon"}_${set}`;
}

function loadProgress(key: string): Progress {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Progress) : {};
  } catch {
    return {};
  }
}

function saveProgress(key: string, progress: Progress): void {
  try {
    localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // Private mode / quota — progress just won't survive a refresh.
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | undefined;
    if (body?.message) return body.message;
    if (body?.error && body.error !== "quota_exceeded") return body.error;
    return `請求失敗（HTTP ${err.status}）`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function postPastExams<T>(body: Record<string, unknown>): Promise<T> {
  return apiFetcher<T>("/api/past-exams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ─── Component ─── */

interface PastExamsProps {
  onBack: () => void;
  /** Deep link into 教學模式 at a specific slide (from 「這題在講義哪裡」). */
  onNavigateToTeaching?: (chapter: number, page: number) => void;
}

export function PastExams({ onBack, onNavigateToTeaching }: PastExamsProps) {
  const [selectedSet, setSelectedSet] = useState<string | null>(null);
  const studentId = useStudentId();
  const { data, error, isLoading } = useSWR<SetsResponse>("/api/past-exams");

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={selectedSet ? () => setSelectedSet(null) : onBack}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📜</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">考古題</h1>
        {selectedSet && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium">
            {selectedSet}
          </span>
        )}
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
          {data ? `共 ${data.total} 題` : ""}
        </span>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-3xl mx-auto space-y-4">
          {selectedSet ? (
            <SetView
              key={selectedSet}
              set={selectedSet}
              studentId={studentId}
              onBackToSets={() => setSelectedSet(null)}
              onNavigateToTeaching={onNavigateToTeaching}
            />
          ) : isLoading && !data ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-12">載入中...</div>
          ) : error ? (
            <div className="text-center text-rose-600 dark:text-rose-300 py-12 text-sm">讀取失敗：{errorMessage(error)}</div>
          ) : !data || data.sets.length === 0 ? (
            <EmptyState />
          ) : (
            <SetPicker sets={data.sets} studentId={studentId} onPick={setSelectedSet} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Empty state ─── */

function EmptyState() {
  return (
    <div className="text-center text-slate-400 dark:text-slate-500 py-12 space-y-3">
      <p className="text-3xl">📜</p>
      <p className="text-slate-600 dark:text-slate-300 font-medium">老師還沒上傳考古題</p>
      <p className="text-xs max-w-md mx-auto leading-relaxed">
        考古題來自老師題庫。管理員請到 🛡️ 後台 → 📚 題庫 新增題目（或 CSV 匯入），在標籤加上
        <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">考古題</code>
        以及一個「年度-學期」標籤，例如
        <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">2024-期中</code>
        /
        <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">2023-期末</code>
        ，這裡就會依年度分組出現。
      </p>
    </div>
  );
}

/* ─── Set picker ─── */

function SetPicker({ sets, studentId, onPick }: { sets: PastExamSet[]; studentId: string | null; onPick: (tag: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">選一份歷年考題開始練習；每題可以對答案、查講義頁、再出一題類似的。</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sets.map((s) => {
          const done = Object.keys(loadProgress(progressKey(studentId, s.tag))).length;
          return (
            <button
              key={s.tag}
              onClick={() => onPick(s.tag)}
              className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{s.tag}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{s.count} 題</span>
                {done > 0 && (
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
                    已作答 {Math.min(done, s.count)} / {s.count}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {s.chapters.map((ch) => (
                  <span
                    key={ch}
                    title={chapterTitle(ch)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  >
                    {chapterLabel(ch)}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── One set: filter + progress + question list ─── */

function SetView({
  set, studentId, onBackToSets, onNavigateToTeaching,
}: {
  set: string;
  studentId: string | null;
  onBackToSets: () => void;
  onNavigateToTeaching?: (chapter: number, page: number) => void;
}) {
  const key = progressKey(studentId, set);
  const [progress, setProgress] = useState<Progress>(() => loadProgress(key));
  const [chapterFilter, setChapterFilter] = useState<number | null>(null);
  const { data, error, isLoading } = useSWR<SetResponse>(`/api/past-exams?set=${encodeURIComponent(set)}`);

  const record = (questionId: number, saved: SavedAnswer) => {
    setProgress((prev) => {
      const next = { ...prev, [questionId]: saved };
      saveProgress(key, next);
      return next;
    });
  };

  const reset = () => {
    if (!window.confirm("清除這份考古題的作答紀錄？")) return;
    setProgress({});
    saveProgress(key, {});
  };

  if (isLoading && !data) return <div className="text-center text-slate-400 dark:text-slate-500 py-12">載入中...</div>;
  if (error) return <div className="text-center text-rose-600 dark:text-rose-300 py-12 text-sm">讀取失敗：{errorMessage(error)}</div>;
  if (!data || data.questions.length === 0) {
    return (
      <div className="text-center text-slate-400 dark:text-slate-500 py-12">
        <p>這份考古題目前沒有題目</p>
        <button onClick={onBackToSets} className="mt-2 text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300">← 回到考題列表</button>
      </div>
    );
  }

  const chapters = Array.from(new Set(data.questions.map((q) => q.chapter))).sort((a, b) => a - b);
  const visible = chapterFilter === null ? data.questions : data.questions.filter((q) => q.chapter === chapterFilter);
  const total = data.questions.length;
  const answered = data.questions.filter((q) => progress[q.id]).length;
  const correct = data.questions.filter((q) => progress[q.id]?.result.isCorrect).length;
  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);

  return (
    <>
      {/* Progress strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3">
        <div className="flex items-center gap-2 text-xs mb-2">
          <span className="font-medium text-slate-700 dark:text-slate-200">已作答 {answered} / {total}</span>
          {answered > 0 && <span className="text-emerald-600 dark:text-emerald-300">答對 {correct}</span>}
          <span className="ml-auto text-slate-400 dark:text-slate-500">{pct}%</span>
          {answered > 0 && (
            <button onClick={reset} className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-300" title="清除作答紀錄">
              重來
            </button>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Chapter filter */}
      {chapters.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <FilterChip selected={chapterFilter === null} onClick={() => setChapterFilter(null)}>全部</FilterChip>
          {chapters.map((ch) => (
            <FilterChip key={ch} selected={chapterFilter === ch} onClick={() => setChapterFilter(chapterFilter === ch ? null : ch)} title={chapterTitle(ch)}>
              {chapterLabel(ch)}
              <span className="opacity-70"> ({data.questions.filter((q) => q.chapter === ch).length})</span>
            </FilterChip>
          ))}
        </div>
      )}

      {visible.map((q, idx) => (
        <QuestionCard
          key={q.id}
          index={data.questions.indexOf(q) + 1}
          q={q}
          studentId={studentId}
          saved={progress[q.id]}
          onResult={(saved) => record(q.id, saved)}
          onNavigateToTeaching={onNavigateToTeaching}
          autoFocus={idx === 0}
        />
      ))}
    </>
  );
}

function FilterChip({ selected, onClick, title, children }: { selected: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2.5 py-1 rounded-lg border ${
        selected
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

/* ─── Question card ─── */

function QuestionCard({
  index, q, studentId, saved, onResult, onNavigateToTeaching, autoFocus,
}: {
  index: number;
  q: PastExamQuestion;
  studentId: string | null;
  saved?: SavedAnswer;
  onResult: (saved: SavedAnswer) => void;
  onNavigateToTeaching?: (chapter: number, page: number) => void;
  autoFocus?: boolean;
}) {
  const [answer, setAnswer] = useState(saved?.answer ?? "");
  const [result, setResult] = useState<CheckResult | null>(saved?.result ?? null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [pages, setPages] = useState<LocatePage[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const [variant, setVariant] = useState<Variant | null>(null);
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);

  const check = async () => {
    if (!answer.trim() || checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      const r = await postPastExams<CheckResult>({ action: "check", questionId: q.id, answer, studentId });
      setResult(r);
      onResult({ answer, result: r });
    } catch (err) {
      setCheckError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const locate = async () => {
    if (locating) return;
    setLocating(true);
    setLocateError(null);
    try {
      const r = await postPastExams<{ pages: LocatePage[] }>({ action: "locate", questionId: q.id, studentId });
      setPages(r.pages);
    } catch (err) {
      setLocateError(errorMessage(err));
    } finally {
      setLocating(false);
    }
  };

  const similar = async () => {
    if (variantLoading) return;
    setVariantLoading(true);
    setVariantError(null);
    try {
      const r = await postPastExams<{ question: Variant }>({ action: "similar", questionId: q.id, studentId });
      setVariant(r.question);
    } catch (err) {
      setVariantError(errorMessage(err));
    } finally {
      setVariantLoading(false);
    }
  };

  const locked = result !== null;

  return (
    <div className={`bg-white dark:bg-slate-900 border rounded-2xl shadow-sm p-4 space-y-3 ${
      result ? (result.isCorrect ? "border-emerald-200 dark:border-emerald-800" : "border-rose-200 dark:border-rose-800") : "border-slate-200 dark:border-slate-700"
    }`}>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="font-semibold text-slate-700 dark:text-slate-200">第 {index} 題</span>
        <span className="font-mono text-slate-500 dark:text-slate-400" title={chapterTitle(q.chapter)}>{chapterLabel(q.chapter)}</span>
        <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300 font-medium">{TYPE_LABELS[q.type]}</span>
        <span className={`px-2 py-0.5 rounded-full font-medium ${DIFFICULTY_TONES[q.difficulty]}`}>{DIFFICULTY_LABELS[q.difficulty]}</span>
        {q.concept && <span className="text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{q.concept}</span>}
        {q.points !== 1 && <span className="text-slate-400 dark:text-slate-500">{q.points} 分</span>}
        {result && (
          <span className={`ml-auto px-2 py-0.5 rounded-full font-medium ${
            result.isCorrect
              ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
              : result.score > 0
                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                : "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
          }`}>
            {result.isCorrect ? "✓ 答對" : result.score > 0 ? "△ 部分正確" : "✗ 答錯"}
          </span>
        )}
      </div>

      <div className="text-sm text-slate-800 dark:text-slate-100">
        <MarkdownRenderer content={q.question} />
      </div>

      <AnswerInput
        type={q.type}
        options={q.options ?? undefined}
        value={answer}
        onChange={setAnswer}
        locked={locked}
        correctAnswer={result?.correctAnswer}
        autoFocus={autoFocus}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!locked && (
          <button
            onClick={check}
            disabled={!answer.trim() || checking}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {checking ? "批改中…" : "對答案"}
          </button>
        )}
        <button
          onClick={locate}
          disabled={locating}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {locating ? "搜尋講義中…" : "📖 這題在講義哪裡"}
        </button>
        <button
          onClick={similar}
          disabled={variantLoading}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {variantLoading ? "出題中…" : variant ? "🔁 再出一題" : "🔁 出一題類似的"}
        </button>
      </div>

      {checkError && <p className="text-xs text-rose-600 dark:text-rose-300">{checkError}</p>}
      {result && <ResultBox result={result} type={q.type} />}

      {/* Locate results */}
      {locateError && <p className="text-xs text-rose-600 dark:text-rose-300">{locateError}</p>}
      {pages && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">講義相關頁面</div>
          {pages.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">這一章的講義裡找不到夠相關的頁面。</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {pages.map((p) => <PageChip key={`${p.chapter}-${p.page}`} p={p} onNavigateToTeaching={onNavigateToTeaching} />)}
            </div>
          )}
        </div>
      )}

      {/* Variant */}
      {variantError && <p className="text-xs text-rose-600 dark:text-rose-300">{variantError}</p>}
      {variant && <VariantCard key={variant.question} variant={variant} studentId={studentId} />}
    </div>
  );
}

/* ─── Variant (類似題) ─── */

function VariantCard({ variant, studentId }: { variant: Variant; studentId: string | null }) {
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    if (!answer.trim() || checking) return;
    setChecking(true);
    setError(null);
    try {
      // The server grades against the echoed variant (MC deterministically,
      // SA with one LLM call) and blends mastery for its concept.
      const r = await postPastExams<CheckResult>({ action: "check", variant, answer, studentId });
      setResult(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">🔁 類似題（AI 生成）</span>
        <span className="text-slate-500 dark:text-slate-400">{TYPE_LABELS[variant.type]} · {DIFFICULTY_LABELS[variant.difficulty]}</span>
        {result && (
          <span className={`ml-auto font-medium ${result.isCorrect ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
            {result.isCorrect ? "✓ 答對" : result.score > 0 ? "△ 部分正確" : "✗ 答錯"}
          </span>
        )}
      </div>
      <div className="text-sm text-slate-800 dark:text-slate-100">
        <MarkdownRenderer content={variant.question} />
      </div>
      <AnswerInput
        type={variant.type}
        options={variant.options}
        value={answer}
        onChange={setAnswer}
        locked={result !== null}
        correctAnswer={result?.correctAnswer}
      />
      {!result && (
        <button
          onClick={check}
          disabled={!answer.trim() || checking}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700 disabled:opacity-50"
        >
          {checking ? "批改中…" : "對答案"}
        </button>
      )}
      {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}
      {result && <ResultBox result={result} type={variant.type} />}
    </div>
  );
}

/* ─── Shared pieces ─── */

function AnswerInput({
  type, options, value, onChange, locked, correctAnswer, autoFocus,
}: {
  type: QuestionType;
  options?: string[];
  value: string;
  onChange: (v: string) => void;
  locked: boolean;
  correctAnswer?: string;
  autoFocus?: boolean;
}) {
  if (type === "multiple_choice" && options && options.length > 0) {
    const key = correctAnswer?.trim().toUpperCase().charAt(0);
    return (
      <div className="space-y-2">
        {options.map((option, i) => {
          const letter = String.fromCharCode(65 + i);
          const isSelected = value === letter;
          const isKey = locked && key === letter;
          let cls = "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800";
          if (isKey) cls = "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30";
          else if (locked && isSelected) cls = "border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30";
          else if (isSelected) cls = "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 ring-2 ring-indigo-200 dark:ring-indigo-800";
          return (
            <button
              key={letter}
              type="button"
              disabled={locked}
              onClick={() => onChange(letter)}
              className={`w-full text-left px-4 py-2.5 rounded-xl border transition-all duration-200 flex items-start gap-2 text-sm ${cls} ${locked ? "cursor-default" : ""}`}
            >
              <span className={`font-semibold shrink-0 ${isSelected || isKey ? "text-indigo-700 dark:text-indigo-300" : "text-slate-600 dark:text-slate-300"}`}>{letter}.</span>
              <span className="flex-1 text-slate-700 dark:text-slate-200"><MarkdownRenderer content={stripOptionLetter(option, i)} /></span>
              {isKey && <span className="text-xs shrink-0 text-emerald-700 dark:text-emerald-300">正解</span>}
              {locked && isSelected && !isKey && <span className="text-xs shrink-0 text-rose-700 dark:text-rose-300">你的答案</span>}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={locked}
      autoFocus={autoFocus}
      placeholder="在此輸入你的答案...（公式可用 $..$ 或 $$..$$ 包住）"
      className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none h-28 disabled:opacity-70"
    />
  );
}

function ResultBox({ result, type }: { result: CheckResult; type: QuestionType }) {
  return (
    <div className="space-y-2 text-sm">
      <div className={`px-3 py-2 rounded-xl border ${
        result.isCorrect
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100"
          : "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100"
      }`}>
        <MarkdownRenderer content={result.feedback} />
      </div>
      {type === "short_answer" && (
        <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mr-2">參考答案</span>
          <span className="text-emerald-900 dark:text-emerald-100"><MarkdownRenderer content={result.correctAnswer} /></span>
        </div>
      )}
      {result.explanation ? (
        <details open={!result.isCorrect}>
          <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300">查看解析</summary>
          <div className="mt-2 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 text-slate-700 dark:text-slate-200">
            <MarkdownRenderer content={result.explanation} />
          </div>
        </details>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500">（老師沒有提供解析）</p>
      )}
    </div>
  );
}

function PageChip({ p, onNavigateToTeaching }: { p: LocatePage; onNavigateToTeaching?: (chapter: number, page: number) => void }) {
  const label = `📖 ${chapterLabel(p.chapter)} p.${p.page}${p.sectionTitle ? ` 〈${p.sectionTitle}〉` : ""}`;
  const cls = "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300";
  return onNavigateToTeaching ? (
    <button
      onClick={() => onNavigateToTeaching(p.chapter, p.page)}
      title={p.snippet || "在教學模式開啟這一頁"}
      className={`${cls} hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors`}
    >
      {label} →
    </button>
  ) : (
    <span className={cls} title={p.snippet}>{label}</span>
  );
}
