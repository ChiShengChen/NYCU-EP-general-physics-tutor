import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { toCsv, csvResponse } from "@/lib/csv";
import {
  TeacherQuestionInputSchema,
  TEACHER_CSV_HEADER,
  TEACHER_CHAPTER_MAX,
  TEACHER_CHAPTER_MIN,
  formatIssues,
  questionToCsvRow,
} from "@/lib/teacher-csv";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 20;

/**
 * Admin CRUD for the teacher question bank (`teacher_questions`).
 *
 * GET    /api/admin/questions?chapter=&q=&active=true|false|all&format=csv
 *        → { questions: Row[], counts: {chapter,total,active}[], total }
 *        Newest first, capped at 200. `counts` covers the whole bank (not
 *        just the filtered page) so the chapter chips stay stable while
 *        the admin filters. `format=csv` streams the same filtered rows in
 *        the import format so they round-trip through Excel.
 * POST   /api/admin/questions   { chapter, type, question, ... } → { question }
 * PATCH  /api/admin/questions   { id, ...fields }                 → { question }
 *        Partial update; the merged row is re-validated so an MC question
 *        can't end up with 3 options via a sneaky PATCH.
 * DELETE /api/admin/questions   { id }                            → { ok }
 *
 * All four are gated on getAdminContext() and use the service role (the
 * table has RLS on with no policies, see migration 023).
 */

const LIST_LIMIT = 200;
const COUNT_SCAN_LIMIT = 10_000;
const CSV_LIMIT = 5000;

const ROW_COLUMNS =
  "id, created_by_email, chapter, type, concept, difficulty, question, options, correct_answer, explanation, points, tags, is_active, created_at, updated_at";

interface TeacherQuestionRow {
  id: number;
  created_by_email: string | null;
  chapter: number;
  type: "multiple_choice" | "short_answer";
  concept: string;
  difficulty: "easy" | "medium" | "hard";
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

/** PostgREST `or=` filter value; escape commas / parens so a search term can't inject extra clauses. */
function likePattern(term: string): string {
  return `%${term.replace(/[%_,()\\]/g, "")}%`;
}

export async function GET(req: NextRequest) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const chapterRaw = params.get("chapter");
  const chapter = chapterRaw ? Number(chapterRaw) : null;
  if (chapter !== null && !(Number.isInteger(chapter) && chapter >= TEACHER_CHAPTER_MIN && chapter <= TEACHER_CHAPTER_MAX)) {
    return NextResponse.json({ error: "invalid chapter" }, { status: 400 });
  }
  const active = params.get("active") ?? "all";
  if (!["true", "false", "all"].includes(active)) {
    return NextResponse.json({ error: "invalid active" }, { status: 400 });
  }
  const term = (params.get("q") ?? "").trim().slice(0, 100);
  const wantCsv = params.get("format") === "csv";

  const supabase = createServiceClient();
  let q = supabase
    .from("teacher_questions")
    .select(ROW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(wantCsv ? CSV_LIMIT : LIST_LIMIT);
  if (chapter !== null) q = q.eq("chapter", chapter);
  if (active === "true") q = q.eq("is_active", true);
  if (active === "false") q = q.eq("is_active", false);
  if (term) {
    const p = likePattern(term);
    q = q.or(`question.ilike.${p},concept.ilike.${p},explanation.ilike.${p}`);
  }

  const [{ data, error }, { data: countRows, error: countErr }] = await Promise.all([
    q,
    supabase.from("teacher_questions").select("chapter, is_active").limit(COUNT_SCAN_LIMIT),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

  const questions = (data ?? []) as TeacherQuestionRow[];

  if (wantCsv) {
    const chapterTag = chapter !== null ? `_ch${String(chapter).padStart(2, "0")}` : "";
    const csv = toCsv([...TEACHER_CSV_HEADER], questions.map(questionToCsvRow));
    return csvResponse(`teacher_questions${chapterTag}_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const byChapter = new Map<number, { total: number; active: number }>();
  for (const r of (countRows ?? []) as { chapter: number; is_active: boolean }[]) {
    const slot = byChapter.get(r.chapter) ?? { total: 0, active: 0 };
    slot.total += 1;
    if (r.is_active) slot.active += 1;
    byChapter.set(r.chapter, slot);
  }
  const counts = Array.from(byChapter.entries())
    .sort(([a], [b]) => a - b)
    .map(([ch, v]) => ({ chapter: ch, total: v.total, active: v.active }));

  return NextResponse.json({
    questions,
    counts,
    total: (countRows ?? []).length,
  });
}

export async function POST(req: Request) {
  const { isAdmin, email } = await getAdminContext();
  if (!isAdmin || !email) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = TeacherQuestionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatIssues(parsed.error) }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("teacher_questions")
    .insert({ ...parsed.data, created_by_email: email })
    .select(ROW_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ question: data });
}

export async function PATCH(req: Request) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  if (!body || !Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: existing, error: readErr } = await supabase
    .from("teacher_questions")
    .select(ROW_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Merge the patch over the stored row and re-run the full schema so type /
  // options / correct_answer stay mutually consistent.
  const current = existing as TeacherQuestionRow;
  const mergedInput = {
    chapter: current.chapter,
    type: current.type,
    concept: current.concept,
    difficulty: current.difficulty,
    question: current.question,
    options: current.options,
    correct_answer: current.correct_answer,
    explanation: current.explanation,
    points: current.points,
    tags: current.tags,
    ...pickEditable(body),
  };
  const parsed = TeacherQuestionInputSchema.safeParse(mergedInput);
  if (!parsed.success) {
    return NextResponse.json({ error: formatIssues(parsed.error) }, { status: 400 });
  }
  const update: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (typeof body.is_active === "boolean") update.is_active = body.is_active;

  const { data, error } = await supabase
    .from("teacher_questions")
    .update(update)
    .eq("id", id)
    .select(ROW_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ question: data });
}

export async function DELETE(req: Request) {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from("teacher_questions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const EDITABLE_FIELDS = [
  "chapter", "type", "concept", "difficulty", "question",
  "options", "correct_answer", "explanation", "points", "tags",
] as const;

/** Only copy over keys the schema knows; `id` / `is_active` / timestamps are handled separately. */
function pickEditable(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) if (k in body && body[k] !== undefined) out[k] = body[k];
  return out;
}
