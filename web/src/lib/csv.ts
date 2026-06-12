/**
 * Tiny CSV writer for admin exports. RFC 4180-ish: comma-separated,
 * doubled quotes inside quoted fields, CRLF line endings so the file
 * opens correctly in Excel on Windows without the user fiddling with
 * delimiter detection.
 *
 * We prefix the file with a UTF-8 BOM (`﻿`) because Excel's default
 * encoding-sniffer on macOS / Windows refuses to render CJK without it,
 * and our student labels / chat snippets are mostly Chinese.
 */

type Cell = string | number | boolean | null | undefined | Date;

function escapeCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  // Quote anywhere we have a delimiter, quote, or line break. Doubling
  // inner quotes is the RFC-4180 escape.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((r) => r.map(escapeCell).join(",")),
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/**
 * Build a downloadable Response with proper headers. Use from a Route
 * Handler: `return csvResponse("usage_2026-06-12.csv", csv);`
 */
export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
