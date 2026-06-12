import { createServiceClient } from "@/lib/supabase/server";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 20;

/**
 * 學習目標 (learning goals) CRUD + progress aggregation.
 *
 * GET    /api/goals?studentId=xxx       → list goals with computed progress
 * POST   /api/goals                     → create  { studentId, title, target_chapter?, target_concept?, target_date?, notes? }
 * PATCH  /api/goals?id=N                → update  { status? | notes? } (ownership enforced)
 * DELETE /api/goals?id=N                → remove (ownership enforced)
 *
 * Security: studentId always resolved via the auth session when one is
 * present; the request-supplied id is only honoured for anonymous users
 * who don't have one yet. PATCH and DELETE additionally check that the
 * `learning_goals` row belongs to the resolved studentId before mutating
 * — previously they trusted only the `id` param, which was an IDOR vector
 * (any signed-in user could complete/delete any other user's goal).
 *
 * Progress derivation per goal (no separate table, computed live):
 *   - If target_chapter set:
 *       attemptsForChapter = count(attempts where any result.sourceChapter matches)
 *       accuracyForChapter = correct / total on that chapter
 *   - If target_concept set:
 *       mastery_score from student_state for that exact concept
 *   - Days remaining = target_date - today (if target_date set)
 */
export async function GET(req: NextRequest) {
  const querySid = req.nextUrl.searchParams.get("studentId");
  const { studentId } = await resolveStudentId(querySid);
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: goals, error } = await supabase
    .from("learning_goals")
    .select("*")
    .eq("student_id", studentId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cheaply pull attempts + state once so we can attach progress per goal.
  const [attemptsResp, stateResp] = await Promise.all([
    supabase.from("attempts").select("questions, results, created_at").eq("student_id", studentId).limit(200),
    supabase.from("student_state").select("concept, mastery_score, attempt_count").eq("student_id", studentId),
  ]);

  type Q = { id: number; sourceChapter?: number; concept?: string };
  type R = { questionId: number; isCorrect: boolean };
  const attempts = (attemptsResp.data ?? []) as { questions: Q[]; results: R[]; created_at: string }[];
  const stateByConcept = new Map(((stateResp.data ?? []) as { concept: string; mastery_score: number; attempt_count: number }[]).map((s) => [s.concept, s] as const));

  const withProgress = (goals ?? []).map((g) => {
    let chapterAttempts = 0, chapterCorrect = 0, chapterTotal = 0;
    if (g.target_chapter) {
      for (const a of attempts) {
        const qById = new Map(a.questions.map((q) => [q.id, q] as const));
        let attemptedThis = false;
        for (const r of a.results) {
          const q = qById.get(r.questionId);
          if (q?.sourceChapter !== g.target_chapter) continue;
          chapterTotal++;
          if (r.isCorrect) chapterCorrect++;
          attemptedThis = true;
        }
        if (attemptedThis) chapterAttempts++;
      }
    }
    const conceptMastery = g.target_concept ? stateByConcept.get(g.target_concept)?.mastery_score ?? null : null;
    const conceptAttempts = g.target_concept ? stateByConcept.get(g.target_concept)?.attempt_count ?? 0 : null;
    const daysRemaining = g.target_date
      ? Math.ceil((new Date(g.target_date).getTime() - Date.now()) / 86400_000)
      : null;

    return {
      ...g,
      progress: {
        chapterAttempts,
        chapterAccuracy: chapterTotal > 0 ? Math.round((chapterCorrect / chapterTotal) * 100) : null,
        chapterAnswered: chapterTotal,
        conceptMastery: conceptMastery !== null ? Math.round(conceptMastery * 100) : null,
        conceptAttempts,
        daysRemaining,
      },
    };
  });

  return NextResponse.json({ goals: withProgress });
}

export async function POST(req: Request) {
  const body = await req.json();
  // Resolve from auth so a signed-in user can't insert goals into another
  // student's account by passing their UUID in the body.
  const { studentId } = await resolveStudentId(body.studentId);
  const title = String(body.title ?? "").trim();
  if (!studentId || !title) return NextResponse.json({ error: "studentId + title required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("learning_goals").insert({
    student_id: studentId,
    title,
    target_chapter: typeof body.target_chapter === "number" ? body.target_chapter : null,
    target_concept: typeof body.target_concept === "string" && body.target_concept.trim() ? body.target_concept.trim() : null,
    target_date: typeof body.target_date === "string" && body.target_date ? body.target_date : null,
    notes: typeof body.notes === "string" ? body.notes : null,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json();

  const { studentId } = await resolveStudentId(body.studentId);
  if (!studentId) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const update: Record<string, unknown> = {};
  if (typeof body.status === "string" && ["active", "done", "abandoned"].includes(body.status)) {
    update.status = body.status;
    if (body.status === "done") update.completed_at = new Date().toISOString();
  }
  if (typeof body.notes === "string") update.notes = body.notes;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  // Ownership guard: the WHERE clause pins to BOTH the row id AND the
  // resolved student_id. If the goal belongs to someone else, the update
  // matches zero rows and the caller gets a 404, never a write through.
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("learning_goals")
    .update(update)
    .eq("id", parseInt(id))
    .eq("student_id", studentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json().catch(() => ({}));

  const { studentId } = await resolveStudentId(body?.studentId);
  if (!studentId) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("learning_goals")
    .delete()
    .eq("id", parseInt(id))
    .eq("student_id", studentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
