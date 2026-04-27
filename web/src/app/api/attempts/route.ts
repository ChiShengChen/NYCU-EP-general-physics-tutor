import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/attempts?studentId=xxx
 *   List recent quiz/exam attempts for a student (summary fields only).
 *
 * GET /api/attempts?studentId=xxx&id=123
 *   Full detail of one attempt: original questions, student answers,
 *   per-question grading results.
 */
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const studentId = req.nextUrl.searchParams.get("studentId");
  const idParam = req.nextUrl.searchParams.get("id");

  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  if (idParam) {
    const { data, error } = await supabase
      .from("attempts")
      .select("*")
      .eq("student_id", studentId)
      .eq("id", parseInt(idParam))
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ attempt: data });
  }

  const { data, error } = await supabase
    .from("attempts")
    .select("id, kind, exam_type, title, total_score, max_score, grade, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const attempts = (data ?? []).map((a) => ({
    ...a,
    percentage: a.max_score > 0 ? Math.round((a.total_score / a.max_score) * 100) : 0,
  }));

  return NextResponse.json({ attempts });
}
