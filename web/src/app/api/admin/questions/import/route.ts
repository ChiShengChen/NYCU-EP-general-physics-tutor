import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import { toCsv, csvResponse } from "@/lib/csv";
import {
  TEACHER_CSV_HEADER,
  TEACHER_CSV_TEMPLATE_ROWS,
  parseTeacherCsv,
  type TeacherCsvError,
} from "@/lib/teacher-csv";
import { NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * Bulk CSV import for the teacher question bank.
 *
 * GET  /api/admin/questions/import
 *      → downloadable CSV template (header + 2 example rows, UTF-8 BOM so
 *        Excel renders the Chinese).
 * POST /api/admin/questions/import
 *      Body is either multipart/form-data with a `file` field, or JSON
 *      `{ csv: string }` (textarea paste). Every row is validated on its
 *      own; the good ones are inserted, the bad ones come back as
 *      `errors: [{ row, message }]` with spreadsheet row numbers (header =
 *      row 1). Response: `{ inserted, errors }`.
 *
 * Header: chapter,type,concept,difficulty,question,optionA,optionB,optionC,
 *         optionD,correct_answer,explanation,points,tags
 */

const MAX_CSV_BYTES = 2 * 1024 * 1024;  // 2 MB ≈ a few thousand questions
const INSERT_CHUNK = 200;

export async function GET() {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const csv = toCsv([...TEACHER_CSV_HEADER], TEACHER_CSV_TEMPLATE_ROWS);
  return csvResponse("teacher_questions_template.csv", csv);
}

export async function POST(req: Request) {
  const { isAdmin, email } = await getAdminContext();
  if (!isAdmin || !email) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const text = await readCsvBody(req);
  if (text === null) {
    return NextResponse.json({ error: "請提供 CSV（multipart 的 file 欄位或 JSON 的 csv 字串）" }, { status: 400 });
  }
  if (text.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "CSV 太大（上限 2 MB），請分批匯入" }, { status: 413 });
  }

  const { rows, errors } = parseTeacherCsv(text);
  const allErrors: TeacherCsvError[] = [...errors];
  let inserted = 0;

  if (rows.length > 0) {
    const supabase = createServiceClient();
    // Chunked so one huge paste doesn't exceed PostgREST's request limits.
    // A chunk failing at the DB level (should be rare — the schema mirrors
    // the check constraints) is reported as one error rather than aborting
    // the chunks that already went in.
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, created_by_email: email }));
      const { error } = await supabase.from("teacher_questions").insert(chunk);
      if (error) {
        allErrors.push({ row: 0, message: `第 ${i + 1}–${i + chunk.length} 筆寫入失敗：${error.message}` });
        continue;
      }
      inserted += chunk.length;
    }
  }

  return NextResponse.json({ inserted, errors: allErrors.sort((a, b) => a.row - b.row) });
}

/** Pull the CSV text out of either a multipart upload or a JSON body. */
async function readCsvBody(req: Request): Promise<string | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (file instanceof File) return file.text();
    const pasted = form?.get("csv");
    return typeof pasted === "string" ? pasted : null;
  }
  const body = await req.json().catch(() => null);
  return typeof body?.csv === "string" ? body.csv : null;
}
