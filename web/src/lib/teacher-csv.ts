import { z } from "zod";

/**
 * Pure helpers for the teacher question bank: a tolerant CSV parser, the
 * zod schema every create / update / import goes through, and the CSV ⇄
 * row mapping. No Supabase here so the unit tests stay dependency-free;
 * the DB-touching pieces live in `teacher-questions.ts` and the admin
 * routes.
 */

/* ─── Question input schema (shared by form, PATCH and CSV import) ─── */

export const TEACHER_CHAPTER_MIN = 1;
export const TEACHER_CHAPTER_MAX = 37;

const MC_ANSWERS = ["A", "B", "C", "D"] as const;

const BaseQuestionSchema = z.object({
  chapter: z.number().int().min(TEACHER_CHAPTER_MIN).max(TEACHER_CHAPTER_MAX),
  type: z.enum(["multiple_choice", "short_answer"]),
  concept: z.string().trim().max(200).default(""),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  question: z.string().trim().min(1, "題目不可空白").max(5000),
  options: z.array(z.string().trim().max(1000)).nullable().optional(),
  correct_answer: z.string().trim().min(1, "正確答案不可空白").max(5000),
  explanation: z.string().trim().max(10000).default(""),
  points: z.number().int().min(1).max(100).default(1),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

/**
 * Full validation of one question. MC rows must carry exactly 4 non-empty
 * options and a letter answer (normalized to upper case); short-answer rows
 * get `options` forced to null so the DB check constraint is satisfied no
 * matter what the client sent.
 */
export const TeacherQuestionInputSchema = BaseQuestionSchema.transform((q, ctx) => {
  if (q.type === "multiple_choice") {
    const opts = (q.options ?? []).map((o) => o.trim());
    if (opts.length !== 4 || opts.some((o) => o.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "選擇題必須有 4 個非空白選項（A–D）" });
      return z.NEVER;
    }
    const letter = q.correct_answer.trim().toUpperCase().replace(/[().（）。．、:：\s]/g, "");
    if (!(MC_ANSWERS as readonly string[]).includes(letter)) {
      ctx.addIssue({ code: "custom", path: ["correct_answer"], message: "選擇題的正確答案必須是 A / B / C / D" });
      return z.NEVER;
    }
    return { ...q, options: opts, correct_answer: letter };
  }
  return { ...q, options: null };
});

export type TeacherQuestionInput = z.infer<typeof TeacherQuestionInputSchema>;

/** Turn a zod failure into one short Traditional-Chinese line for the UI. */
export function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("；");
}

/* ─── CSV parsing (RFC 4180-ish) ─── */

/**
 * Parse CSV text into rows of cells. Handles:
 *   - quoted fields with embedded commas, newlines and doubled quotes;
 *   - CRLF / LF / CR line endings;
 *   - a leading UTF-8 BOM (Excel adds one, and so does our own exporter);
 *   - trailing newline / fully blank lines (skipped).
 * Cells are returned verbatim (no trimming) so callers decide.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => {
    endCell();
    // Skip rows that are entirely empty (e.g. the trailing newline).
    if (row.some((c) => c.trim().length > 0)) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }  // escaped quote
        inQuotes = false; i += 1; continue;
      }
      cell += ch; i += 1; continue;
    }
    if (ch === '"') {
      // Opening quote. Anything before it in the same cell (rare, sloppy
      // input like ` "abc"`) is kept as-is.
      inQuotes = true; i += 1; continue;
    }
    if (ch === ",") { endCell(); i += 1; continue; }
    if (ch === "\r") {
      if (src[i + 1] === "\n") i += 1;
      endRow(); i += 1; continue;
    }
    if (ch === "\n") { endRow(); i += 1; continue; }
    cell += ch; i += 1;
  }
  // Flush the last row when the file doesn't end with a newline.
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}

/* ─── Teacher CSV format ─── */

export const TEACHER_CSV_HEADER = [
  "chapter", "type", "concept", "difficulty", "question",
  "optionA", "optionB", "optionC", "optionD",
  "correct_answer", "explanation", "points", "tags",
] as const;

export type TeacherCsvColumn = (typeof TEACHER_CSV_HEADER)[number];

/** Columns a row can't do without; everything else falls back to a default. */
const REQUIRED_COLUMNS: TeacherCsvColumn[] = ["chapter", "type", "question", "correct_answer"];

/** Separator for the multi-valued `tags` cell (commas would need quoting). */
export const TAG_SEPARATOR = ";";

// Teachers type Chinese labels as often as the enum keys, so accept both.
const TYPE_ALIASES: Record<string, "multiple_choice" | "short_answer"> = {
  multiple_choice: "multiple_choice", mc: "multiple_choice", choice: "multiple_choice",
  "選擇": "multiple_choice", "選擇題": "multiple_choice",
  short_answer: "short_answer", sa: "short_answer", short: "short_answer",
  "簡答": "short_answer", "簡答題": "short_answer",
};
const DIFFICULTY_ALIASES: Record<string, "easy" | "medium" | "hard"> = {
  easy: "easy", "簡單": "easy", "基礎": "easy", "易": "easy",
  medium: "medium", "中等": "medium", "中": "medium",
  hard: "hard", "困難": "hard", "進階": "hard", "難": "hard",
};

export interface TeacherCsvError {
  /** 1-based row number as a spreadsheet shows it (header = row 1). */
  row: number;
  message: string;
}

export interface TeacherCsvParseResult {
  rows: TeacherQuestionInput[];
  errors: TeacherCsvError[];
}

/** Normalize a header cell: strip BOM / whitespace / case so `Chapter ` matches. */
function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

const HEADER_LOOKUP = new Map<string, TeacherCsvColumn>(
  TEACHER_CSV_HEADER.map((c) => [normalizeHeader(c), c]),
);

/**
 * Map one CSV record (already keyed by column name) into the shape the
 * zod schema expects. Returns the *unvalidated* object so the caller can
 * run the shared schema and get uniform error messages.
 */
export function csvRecordToInput(rec: Partial<Record<TeacherCsvColumn, string>>): unknown {
  const get = (c: TeacherCsvColumn) => (rec[c] ?? "").trim();
  const chapterRaw = get("chapter");
  const chapter = /^\d+$/.test(chapterRaw) ? Number(chapterRaw) : Number.NaN;
  const typeKey = get("type").toLowerCase();
  const type = TYPE_ALIASES[typeKey] ?? TYPE_ALIASES[get("type")] ?? get("type");
  const diffRaw = get("difficulty");
  const difficulty = diffRaw === "" ? undefined : (DIFFICULTY_ALIASES[diffRaw.toLowerCase()] ?? diffRaw);
  const pointsRaw = get("points");
  const points = pointsRaw === "" ? undefined : (/^\d+$/.test(pointsRaw) ? Number(pointsRaw) : Number.NaN);
  const tags = get("tags")
    .split(TAG_SEPARATOR)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const options = [get("optionA"), get("optionB"), get("optionC"), get("optionD")];
  const hasAnyOption = options.some((o) => o.length > 0);
  return {
    chapter,
    type,
    concept: get("concept"),
    difficulty,
    question: get("question"),
    // Keep `options` undefined for SA rows so a stray value in optionA on a
    // short-answer line doesn't masquerade as a 1-option MC.
    options: type === "multiple_choice" || hasAnyOption ? options : undefined,
    correct_answer: get("correct_answer"),
    explanation: get("explanation"),
    points,
    tags,
  };
}

/**
 * Parse + validate a whole teacher CSV. One bad row never aborts the file:
 * valid rows come back in `rows`, failures in `errors` with the row number
 * the teacher sees in their spreadsheet. A missing / wrong header is the
 * only fatal case (reported as row 1).
 */
export function parseTeacherCsv(text: string): TeacherCsvParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [{ row: 1, message: "檔案是空的" }] };

  const header = table[0].map(normalizeHeader);
  const columnIndex = new Map<TeacherCsvColumn, number>();
  header.forEach((h, idx) => {
    const col = HEADER_LOOKUP.get(h);
    if (col && !columnIndex.has(col)) columnIndex.set(col, idx);
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !columnIndex.has(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: `表頭缺少欄位：${missing.join(", ")}（請用「下載 CSV 範本」的格式）` }],
    };
  }

  const rows: TeacherQuestionInput[] = [];
  const errors: TeacherCsvError[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const rec: Partial<Record<TeacherCsvColumn, string>> = {};
    for (const [col, idx] of columnIndex) rec[col] = cells[idx] ?? "";
    const parsed = TeacherQuestionInputSchema.safeParse(csvRecordToInput(rec));
    if (parsed.success) rows.push(parsed.data);
    else errors.push({ row: r + 1, message: formatIssues(parsed.error) });
  }
  return { rows, errors };
}

/**
 * Inverse of `csvRecordToInput`: one question → one CSV row in the import
 * format, so an export can be edited in Excel and re-imported unchanged.
 */
export function questionToCsvRow(q: {
  chapter: number;
  type: string;
  concept: string;
  difficulty: string;
  question: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  points: number;
  tags: string[];
}): (string | number)[] {
  const opts = q.options ?? [];
  return [
    q.chapter, q.type, q.concept, q.difficulty, q.question,
    opts[0] ?? "", opts[1] ?? "", opts[2] ?? "", opts[3] ?? "",
    q.correct_answer, q.explanation, q.points, q.tags.join(TAG_SEPARATOR),
  ];
}

/** Two example rows (one MC, one SA) that ship in the downloadable template. */
export const TEACHER_CSV_TEMPLATE_ROWS: (string | number)[][] = [
  [
    4, "multiple_choice", "牛頓第二定律", "easy",
    "質量 2 kg 的物體受 10 N 合力，加速度為？",
    "2 m/s^2", "5 m/s^2", "10 m/s^2", "20 m/s^2",
    "B", "由 $F = ma$，$a = F/m = 10/2 = 5\\ \\mathrm{m/s^2}$。", 1, "期中;計算",
  ],
  [
    7, "short_answer", "能量守恆", "medium",
    "從高度 $h$ 靜止釋放的物體落地時的速率為何？（忽略空氣阻力）",
    "", "", "", "",
    "$v = \\sqrt{2gh}$", "位能 $mgh$ 全數轉為動能 $\\tfrac12 mv^2$，解得 $v=\\sqrt{2gh}$。", 1, "",
  ],
];
