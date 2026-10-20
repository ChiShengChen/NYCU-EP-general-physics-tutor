"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { MarkdownRenderer } from "./markdown-renderer";
import { CHAPTER_NODES } from "@/lib/concept-graph";

/**
 * 「📚 題庫」 — admin tab body for the teacher question bank.
 *
 * Teachers add questions one at a time with the form, or in bulk via CSV
 * (paste or file). Rows live in `teacher_questions` and are mixed into the
 * AI chapter / multi-chapter quizzes by `lib/teacher-questions.ts`, so a
 * row toggled off here stops appearing in new quizzes immediately.
 *
 * All requests go to /api/admin/questions (+ /import); the routes 403 for
 * non-admins and we render the same "forbidden" state as the other tabs.
 */

/* ─── Types ─── */

type QuestionType = "multiple_choice" | "short_answer";
type Difficulty = "easy" | "medium" | "hard";

interface TeacherQuestion {
  id: number;
  created_by_email: string | null;
  chapter: number;
  type: QuestionType;
  concept: string;
  difficulty: Difficulty;
  question: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  points: number;
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BankData {
  questions: TeacherQuestion[];
  counts: { chapter: number; total: number; active: number }[];
  total: number;
}

interface ImportResult {
  inserted: number;
  errors: { row: number; message: string }[];
}

type ActiveFilter = "all" | "true" | "false";

/* ─── Constants ─── */

const CHAPTER_MIN = 1;
const CHAPTER_MAX = 37;
const ALL_CHAPTERS = Array.from({ length: CHAPTER_MAX - CHAPTER_MIN + 1 }, (_, i) => i + CHAPTER_MIN);
const LETTERS = ["A", "B", "C", "D"] as const;

const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "基礎", medium: "中等", hard: "進階" };
const DIFFICULTY_TONES: Record<Difficulty, string> = {
  easy: "bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-300",
  medium: "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-600 dark:text-yellow-300",
  hard: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300",
};
const TYPE_LABELS: Record<QuestionType, string> = { multiple_choice: "選擇題", short_answer: "簡答題" };
const TYPE_TONES: Record<QuestionType, string> = {
  multiple_choice: "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300",
  short_answer: "bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-300",
};

function chapterLabel(n: number): string {
  const node = CHAPTER_NODES.find((c) => c.chapter === n);
  return `Ch${String(n).padStart(2, "0")}${node ? ` ${node.label}` : ""}`;
}

/** Tag convention for 考古題模式: this marker + a year-term tag like `2024-期中`. */
const PAST_EXAM_TAG = "考古題";

/** SWR key with only the present filters (apiKey() would null out the fetch on an empty param). */
function listKey(chapter: number | null, q: string, active: ActiveFilter, tag: string | null): string {
  const params = new URLSearchParams();
  if (chapter !== null) params.set("chapter", String(chapter));
  if (q) params.set("q", q);
  if (active !== "all") params.set("active", active);
  if (tag) params.set("tag", tag);
  const qs = params.toString();
  return `/api/admin/questions${qs ? `?${qs}` : ""}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/* ─── Tab body ─── */

export function AdminQuestionBank() {
  const [chapter, setChapter] = useState<number | null>(null);
  const [active, setActive] = useState<ActiveFilter>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"none" | "create" | "import">("none");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const key = listKey(chapter, query, active, tagFilter);
  const { data, error, isLoading, mutate } = useSWR<BankData>(key);

  if (error) {
    const status = (error as { status?: number })?.status;
    if (status === 403) return <Forbidden />;
    return <Centered>讀取失敗：{String(error)}</Centered>;
  }

  const patch = async (id: number, fields: Record<string, unknown>) => {
    setActionError(null);
    const res = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) { setActionError(await readError(res)); return false; }
    await mutate();
    return true;
  };

  const remove = async (q: TeacherQuestion) => {
    if (!window.confirm(`確定刪除這題？\n\n${q.question.slice(0, 80)}${q.question.length > 80 ? "…" : ""}`)) return;
    setActionError(null);
    const res = await fetch("/api/admin/questions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: q.id }),
    });
    if (!res.ok) { setActionError(await readError(res)); return; }
    if (expandedId === q.id) setExpandedId(null);
    if (editingId === q.id) setEditingId(null);
    await mutate();
  };

  const counts = data?.counts ?? [];
  const countFor = (ch: number) => counts.find((c) => c.chapter === ch);
  const chaptersWithRows = counts.map((c) => c.chapter);
  const exportHref = `${key}${key.includes("?") ? "&" : "?"}format=csv`;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          onClick={() => setPanel((p) => (p === "create" ? "none" : "create"))}
          className={`px-3 py-1.5 rounded-lg ${panel === "create" ? "bg-indigo-600 text-white" : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"}`}
        >
          ＋ 新增題目
        </button>
        <button
          onClick={() => setPanel((p) => (p === "import" ? "none" : "import"))}
          className={`px-3 py-1.5 rounded-lg ${panel === "import" ? "bg-indigo-600 text-white" : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"}`}
        >
          ⬆ CSV 匯入
        </button>
        <DownloadLink href="/api/admin/questions/import" title="含表頭與 2 筆範例，UTF-8 BOM，Excel 直接打開不會亂碼">
          下載 CSV 範本
        </DownloadLink>
        <DownloadLink href={exportHref} title="匯出目前篩選結果（與匯入格式相同，可改完再匯回）">
          匯出 CSV
        </DownloadLink>
        <span className="ml-auto text-slate-400 dark:text-slate-500">
          題庫共 {data?.total ?? 0} 題
        </span>
      </div>

      {panel === "create" && (
        <Section title="新增題目">
          <QuestionForm
            onCancel={() => setPanel("none")}
            onSaved={async () => { setPanel("none"); await mutate(); }}
          />
        </Section>
      )}
      {panel === "import" && (
        <Section title="CSV 匯入">
          <ImportPanel onImported={async () => { await mutate(); }} />
        </Section>
      )}

      {/* Chapter chips */}
      <div className="flex items-center gap-1.5 flex-wrap text-xs">
        <Chip selected={chapter === null} onClick={() => setChapter(null)}>
          全部 <span className="opacity-70">({data?.total ?? 0})</span>
        </Chip>
        {ALL_CHAPTERS.filter((ch) => chaptersWithRows.includes(ch) || ch === chapter).map((ch) => {
          const c = countFor(ch);
          return (
            <Chip key={ch} selected={chapter === ch} onClick={() => setChapter(chapter === ch ? null : ch)} title={chapterLabel(ch)}>
              Ch{String(ch).padStart(2, "0")}
              <span className="opacity-70"> ({c?.active ?? 0}{c && c.active !== c.total ? `/${c.total}` : ""})</span>
            </Chip>
          );
        })}
        <select
          value={chapter ?? ""}
          onChange={(e) => setChapter(e.target.value ? Number(e.target.value) : null)}
          className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
          aria-label="選擇章節"
        >
          <option value="">其他章節…</option>
          {ALL_CHAPTERS.map((ch) => (
            <option key={ch} value={ch}>{chapterLabel(ch)}</option>
          ))}
        </select>
      </div>

      {/* Search + active filter */}
      <form
        className="flex items-center gap-2 flex-wrap text-xs"
        onSubmit={(e) => { e.preventDefault(); setQuery(queryInput.trim()); }}
      >
        <input
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="搜尋題目 / 概念 / 解析…"
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
        />
        <button type="submit" className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          搜尋
        </button>
        {query && (
          <button type="button" onClick={() => { setQuery(""); setQueryInput(""); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            清除
          </button>
        )}
        {(["all", "true", "false"] as const).map((a) => (
          <Chip key={a} selected={active === a} onClick={() => setActive(a)}>
            {a === "all" ? "全部" : a === "true" ? "啟用中" : "已停用"}
          </Chip>
        ))}
        <Chip
          selected={tagFilter === PAST_EXAM_TAG}
          onClick={() => setTagFilter(tagFilter === PAST_EXAM_TAG ? null : PAST_EXAM_TAG)}
          title="只看標籤含「考古題」的題目（學生端 📜 考古題模式用）"
        >
          📜 考古題
        </Chip>
      </form>

      {actionError && (
        <p className="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 rounded-lg px-3 py-2">{actionError}</p>
      )}

      {/* List */}
      {isLoading && !data ? (
        <Centered>載入中...</Centered>
      ) : !data || data.questions.length === 0 ? (
        <Centered>
          {data?.total === 0 ? "題庫還是空的 — 用「＋ 新增題目」或「⬆ CSV 匯入」加入第一題。" : "這個篩選條件下沒有題目"}
        </Centered>
      ) : (
        <div className="space-y-3">
          {data.questions.length >= 200 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">只顯示最新 200 題，請用章節 / 搜尋縮小範圍。</p>
          )}
          {data.questions.map((q) =>
            editingId === q.id ? (
              <Section key={q.id} title={`編輯 #${q.id}`}>
                <QuestionForm
                  initial={q}
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => { setEditingId(null); await mutate(); }}
                />
              </Section>
            ) : (
              <QuestionCard
                key={q.id}
                q={q}
                expanded={expandedId === q.id}
                onToggle={() => setExpandedId((curr) => (curr === q.id ? null : q.id))}
                onEdit={() => { setEditingId(q.id); setExpandedId(null); }}
                onToggleActive={() => patch(q.id, { is_active: !q.is_active })}
                onDelete={() => remove(q)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Question card ─── */

function QuestionCard({
  q, expanded, onToggle, onEdit, onToggleActive, onDelete,
}: {
  q: TeacherQuestion;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 shadow-sm ${q.is_active ? "border-slate-200 dark:border-slate-700" : "border-dashed border-slate-300 dark:border-slate-600 opacity-70"}`}>
      <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
        <span className="font-mono text-slate-500 dark:text-slate-400" title={chapterLabel(q.chapter)}>
          Ch{String(q.chapter).padStart(2, "0")}
        </span>
        <span className={`px-2 py-0.5 rounded-full font-medium ${TYPE_TONES[q.type]}`}>{TYPE_LABELS[q.type]}</span>
        <span className={`px-2 py-0.5 rounded-full font-medium ${DIFFICULTY_TONES[q.difficulty]}`}>{DIFFICULTY_LABELS[q.difficulty]}</span>
        {q.concept && <span className="text-slate-500 dark:text-slate-400">{q.concept}</span>}
        {q.points !== 1 && <span className="text-slate-400 dark:text-slate-500">{q.points} 分</span>}
        {q.tags.map((t) => (
          <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">#{t}</span>
        ))}
        {!q.is_active && (
          <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">已停用</span>
        )}
        <button
          onClick={onToggle}
          className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {expanded ? "▾ 收合" : "▸ 展開答案"}
        </button>
      </div>

      <div className="text-sm text-slate-800 dark:text-slate-100">
        <MarkdownRenderer content={q.question} />
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2 text-sm">
          {q.type === "multiple_choice" && q.options && (
            <ol className="space-y-1">
              {q.options.map((opt, i) => {
                const letter = LETTERS[i];
                const correct = letter === q.correct_answer;
                return (
                  <li
                    key={i}
                    className={`flex gap-2 px-3 py-1.5 rounded-xl ${correct ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200"}`}
                  >
                    <span className="font-semibold">{letter}.</span>
                    <span className="flex-1"><MarkdownRenderer content={opt} /></span>
                    {correct && <span className="text-xs">✓</span>}
                  </li>
                );
              })}
            </ol>
          )}
          {q.type === "short_answer" && (
            <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
              <span className="text-xs font-medium">參考答案：</span>
              <MarkdownRenderer content={q.correct_answer} />
            </div>
          )}
          {q.explanation ? (
            <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200">
              <span className="text-xs font-medium">解析：</span>
              <MarkdownRenderer content={q.explanation} />
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">（沒有解析）</p>
          )}
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            #{q.id} · {q.created_by_email ?? "—"} · {new Date(q.created_at).toLocaleString("zh-TW")}
            {q.updated_at !== q.created_at && ` · 更新 ${new Date(q.updated_at).toLocaleDateString("zh-TW")}`}
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onEdit}
          className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          編輯
        </button>
        <button
          onClick={onToggleActive}
          className={`px-3 py-1 rounded-lg text-xs ${q.is_active ? "border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
        >
          {q.is_active ? "停用" : "啟用"}
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1 rounded-lg border border-rose-300 dark:border-rose-700 text-xs text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          刪除
        </button>
      </div>
    </div>
  );
}

/* ─── Create / edit form ─── */

interface FormState {
  chapter: number;
  type: QuestionType;
  concept: string;
  difficulty: Difficulty;
  question: string;
  options: [string, string, string, string];
  correct_answer: string;
  explanation: string;
  points: number;
  tags: string;
}

function emptyForm(): FormState {
  return {
    chapter: 1, type: "multiple_choice", concept: "", difficulty: "medium", question: "",
    options: ["", "", "", ""], correct_answer: "A", explanation: "", points: 1, tags: "",
  };
}

function formFromQuestion(q: TeacherQuestion): FormState {
  const opts = q.options ?? [];
  return {
    chapter: q.chapter,
    type: q.type,
    concept: q.concept,
    difficulty: q.difficulty,
    question: q.question,
    options: [opts[0] ?? "", opts[1] ?? "", opts[2] ?? "", opts[3] ?? ""],
    correct_answer: q.correct_answer,
    explanation: q.explanation,
    points: q.points,
    tags: q.tags.join(", "),
  };
}

const INPUT_CLS =
  "w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400";
const LABEL_CLS = "block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1";

function QuestionForm({
  initial, onSaved, onCancel,
}: {
  initial?: TeacherQuestion;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => (initial ? formFromQuestion(initial) : emptyForm()));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isMc = form.type === "multiple_choice";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const payload = {
      chapter: form.chapter,
      type: form.type,
      concept: form.concept,
      difficulty: form.difficulty,
      question: form.question,
      options: isMc ? form.options : null,
      correct_answer: form.correct_answer,
      explanation: form.explanation,
      points: form.points,
      tags: form.tags.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean),
    };
    const res = await fetch("/api/admin/questions", {
      method: initial ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initial ? { id: initial.id, ...payload } : payload),
    });
    setSaving(false);
    if (!res.ok) { setErr(await readError(res)); return; }
    if (!initial) setForm((f) => ({ ...emptyForm(), chapter: f.chapter, type: f.type }));  // keep context for the next entry
    await onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={LABEL_CLS}>章節</label>
          <select value={form.chapter} onChange={(e) => set("chapter", Number(e.target.value))} className={INPUT_CLS}>
            {ALL_CHAPTERS.map((ch) => <option key={ch} value={ch}>{chapterLabel(ch)}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>題型</label>
          <select
            value={form.type}
            onChange={(e) => {
              const type = e.target.value as QuestionType;
              setForm((f) => ({ ...f, type, correct_answer: type === "multiple_choice" ? "A" : "" }));
            }}
            className={INPUT_CLS}
          >
            <option value="multiple_choice">選擇題</option>
            <option value="short_answer">簡答題</option>
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>難度</label>
          <select value={form.difficulty} onChange={(e) => set("difficulty", e.target.value as Difficulty)} className={INPUT_CLS}>
            <option value="easy">基礎</option>
            <option value="medium">中等</option>
            <option value="hard">進階</option>
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>配分</label>
          <input type="number" min={1} max={100} value={form.points} onChange={(e) => set("points", Math.max(1, Number(e.target.value) || 1))} className={INPUT_CLS} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>概念（給掌握度追蹤用，例：牛頓第二定律）</label>
          <input value={form.concept} onChange={(e) => set("concept", e.target.value)} className={INPUT_CLS} placeholder="可留空" />
        </div>
        <div>
          <label className={LABEL_CLS}>標籤（逗號分隔）</label>
          <input value={form.tags} onChange={(e) => set("tags", e.target.value)} className={INPUT_CLS} placeholder="期中, 計算" />
          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
            要出現在學生端「📜 考古題」：加 <code>{PAST_EXAM_TAG}</code> 再加一個年度-學期標籤，例如 <code>2024-期中</code>、<code>2023-期末</code>。
          </p>
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>題目（支援 Markdown + LaTeX，$…$ 行內公式）</label>
        <textarea value={form.question} onChange={(e) => set("question", e.target.value)} rows={3} required className={INPUT_CLS} />
      </div>

      {isMc ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {LETTERS.map((letter, i) => (
            <div key={letter} className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0" title="勾選為正確答案">
                <input
                  type="radio"
                  name="correct"
                  checked={form.correct_answer === letter}
                  onChange={() => set("correct_answer", letter)}
                />
                {letter}.
              </label>
              <input
                value={form.options[i]}
                onChange={(e) => {
                  const next = [...form.options] as FormState["options"];
                  next[i] = e.target.value;
                  set("options", next);
                }}
                required
                className={INPUT_CLS}
                placeholder={`選項 ${letter}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div>
          <label className={LABEL_CLS}>參考答案（AI 批改時以此為準，可寫公式或數值）</label>
          <textarea value={form.correct_answer} onChange={(e) => set("correct_answer", e.target.value)} rows={2} required className={INPUT_CLS} />
        </div>
      )}

      <div>
        <label className={LABEL_CLS}>解析（學生交卷後看得到）</label>
        <textarea value={form.explanation} onChange={(e) => set("explanation", e.target.value)} rows={3} className={INPUT_CLS} />
      </div>

      {form.question.trim() && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">預覽：</span>
          <div className="mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-sm text-slate-800 dark:text-slate-100">
            <MarkdownRenderer content={form.question} />
          </div>
        </div>
      )}

      {err && <p className="text-xs text-rose-600 dark:text-rose-300">{err}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          取消
        </button>
        <button type="submit" disabled={saving} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700 disabled:opacity-50">
          {saving ? "儲存中…" : initial ? "儲存修改" : "新增"}
        </button>
      </div>
    </form>
  );
}

/* ─── CSV import ─── */

function ImportPanel({ onImported }: { onImported: () => Promise<void> }) {
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      res = await fetch("/api/admin/questions/import", { method: "POST", body: fd });
    } else {
      res = await fetch("/api/admin/questions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
    }
    setBusy(false);
    if (!res.ok) { setErr(await readError(res)); return; }
    const data = (await res.json()) as ImportResult;
    setResult(data);
    if (data.inserted > 0) {
      setCsv("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await onImported();
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500 dark:text-slate-400">
        表頭：<code className="font-mono">chapter,type,concept,difficulty,question,optionA,optionB,optionC,optionD,correct_answer,explanation,points,tags</code>
        <br />
        type 可填 <code>multiple_choice</code> / <code>short_answer</code>（或「選擇題」/「簡答題」）；選擇題的 correct_answer 填 A–D；tags 用「;」分隔。有錯的列會跳過，其餘照常匯入。
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-slate-600 dark:text-slate-300 file:mr-2 file:px-2 file:py-1 file:rounded-lg file:border file:border-slate-200 dark:file:border-slate-700 file:bg-white dark:file:bg-slate-900 file:text-xs file:text-slate-600 dark:file:text-slate-300"
        />
        <span className="text-slate-400 dark:text-slate-500">或直接貼上：</span>
      </div>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={6}
        disabled={!!file}
        placeholder={"chapter,type,concept,difficulty,question,optionA,optionB,optionC,optionD,correct_answer,explanation,points,tags\n4,multiple_choice,牛頓第二定律,easy,...,A,...,1,期中"}
        className={`${INPUT_CLS} font-mono text-xs disabled:opacity-50`}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={busy || (!file && !csv.trim())}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "匯入中…" : "開始匯入"}
        </button>
        {file && <span className="text-slate-500 dark:text-slate-400">{file.name}（{(file.size / 1024).toFixed(1)} KB）</span>}
      </div>

      {err && <p className="text-rose-600 dark:text-rose-300">{err}</p>}
      {result && (
        <div className={`rounded-xl px-3 py-2 ${result.errors.length === 0 ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"}`}>
          <p className="font-medium">已匯入 {result.inserted} 題{result.errors.length > 0 && `，${result.errors.length} 列有問題`}</p>
          {result.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
              {result.errors.map((e, i) => (
                <li key={i} className="font-mono">
                  {e.row > 0 ? `第 ${e.row} 列：` : ""}{e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Small primitives (mirrors admin-panel.tsx; kept local so the tab stays self-contained) ─── */

function Chip({ selected, onClick, title, children }: { selected: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
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

function DownloadLink({ href, title, children }: { href: string; title?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      title={title}
      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1"
    >
      ⬇ {children}
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center text-sm text-slate-500 dark:text-slate-400">{children}</div>
  );
}

function Forbidden() {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center space-y-3">
      <p className="text-4xl">🛡️</p>
      <p className="text-slate-700 dark:text-slate-200 font-medium">沒有管理員權限</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        這個頁面只開放給 ADMIN_EMAILS 環境變數中列名的帳號。請改用既有的學生功能。
      </p>
    </div>
  );
}
