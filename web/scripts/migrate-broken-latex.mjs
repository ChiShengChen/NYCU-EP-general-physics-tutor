#!/usr/bin/env node
/**
 * One-shot migration for content stored before the restore-latex helper
 * landed. Rows inserted then have form-feed (and friends) eaten by
 * JSON.parse, so KaTeX renders red errors when the student reviews them.
 *
 *   attempts          → restored in-place (idempotent, no-op on clean rows)
 *   chapter_previews  → wiped (will regen lazily on next GET)
 *
 * Usage:
 *   cd web
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/migrate-broken-latex.mjs --dry-run
 *   # ...then drop --dry-run once the diff looks right.
 *
 * Flags:
 *   --dry-run         : scan + report, no writes
 *   --skip-attempts   : skip attempts migration
 *   --skip-previews   : skip preview cache wipe
 */

import { createClient } from "@supabase/supabase-js";

// ─── mirror of web/src/lib/restore-latex.ts ──────────────────────────────
// Inlined so this script has no TS/transpile step. Keep in sync.

function restoreLatexEscapes(text) {
  if (!text || !text.includes("$")) return text;
  return text.replace(/\$\$[\s\S]+?\$\$|\$[^\n$]+?\$/g, (block) =>
    block
      .replace(/\f(?=[a-z])/g, "\\f")
      .replace(/[\b](?=[a-z])/g, "\\b")
      .replace(/\t(?=[a-z])/g, "\\t")
      .replace(/\r(?=[a-z])/g, "\\r")
      .replace(/\n(?=[a-z])/g, "\\n"),
  );
}

function restoreLatexInObject(value) {
  if (typeof value === "string") return restoreLatexEscapes(value);
  if (Array.isArray(value)) return value.map(restoreLatexInObject);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = restoreLatexInObject(v);
    return out;
  }
  return value;
}

// ─── runner ──────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_ATTEMPTS = process.argv.includes("--skip-attempts");
const SKIP_PREVIEWS = process.argv.includes("--skip-previews");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

if (!SKIP_ATTEMPTS) {
  await migrateAttempts();
}
if (!SKIP_PREVIEWS) {
  await wipePreviews();
}

async function migrateAttempts() {
console.log(`\nMigrating attempts table ${DRY_RUN ? "(dry run)" : "(LIVE)"}...`);

const PAGE_SIZE = 100;
let from = 0;
let totalScanned = 0;
let totalChanged = 0;
const sampleDiffs = [];

while (true) {
  const { data, error } = await supabase
    .from("attempts")
    .select("id, questions, results, overall_feedback")
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    console.error("Read error:", error);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    totalScanned++;
    const fixedQuestions = restoreLatexInObject(row.questions);
    const fixedResults = restoreLatexInObject(row.results);
    const fixedFeedback = restoreLatexInObject(row.overall_feedback);

    const changed =
      JSON.stringify(row.questions) !== JSON.stringify(fixedQuestions) ||
      JSON.stringify(row.results) !== JSON.stringify(fixedResults) ||
      row.overall_feedback !== fixedFeedback;

    if (!changed) continue;
    totalChanged++;

    if (sampleDiffs.length < 3) {
      // Show one short before/after for visual sanity-check.
      const beforeStr = JSON.stringify(row.questions).slice(0, 200);
      const afterStr = JSON.stringify(fixedQuestions).slice(0, 200);
      sampleDiffs.push({ id: row.id, before: beforeStr, after: afterStr });
    }

    if (!DRY_RUN) {
      const { error: updErr } = await supabase
        .from("attempts")
        .update({
          questions: fixedQuestions,
          results: fixedResults,
          overall_feedback: fixedFeedback,
        })
        .eq("id", row.id);
      if (updErr) console.error(`Update failed for attempt ${row.id}:`, updErr);
    }
  }

  if (data.length < PAGE_SIZE) break;
  from += PAGE_SIZE;
}

console.log("");
console.log(`Scanned: ${totalScanned} rows`);
console.log(`Would change: ${totalChanged} rows ${DRY_RUN ? "(dry run, no writes)" : "(written)"}`);
if (sampleDiffs.length) {
  console.log("\nSample diffs (first 3 changed rows, first 200 chars of questions):");
  for (const s of sampleDiffs) {
    console.log(`\n  attempt #${s.id}`);
    console.log(`    BEFORE: ${s.before}`);
    console.log(`    AFTER:  ${s.after}`);
  }
}
}

async function wipePreviews() {
  console.log(`\nWiping chapter_previews cache ${DRY_RUN ? "(dry run)" : "(LIVE)"}...`);
  const { count, error: countErr } = await supabase
    .from("chapter_previews")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    console.error("Count error:", countErr);
    return;
  }
  console.log(`Cached rows: ${count ?? 0}`);
  if (DRY_RUN || !count) return;

  const { error: delErr } = await supabase
    .from("chapter_previews")
    .delete()
    .gte("chapter_number", 0); // match all
  if (delErr) {
    console.error("Delete error:", delErr);
    return;
  }
  console.log(`Deleted ${count} rows. They'll regenerate lazily on next GET.`);
}
