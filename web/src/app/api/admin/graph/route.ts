import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/is-admin";
import {
  STATIC_CHAPTER_GRAPH,
  EMPTY_GRAPH_OVERRIDE,
  applyGraphOverride,
  normalizeGraphOverride,
  parseGraphOverride,
  type GraphOverride,
} from "@/lib/concept-graph";
import { NextResponse } from "next/server";

export const maxDuration = 15;

/**
 * Admin editor backend for the chapter concept graph (migration 024).
 *
 * GET  /api/admin/graph
 *      → { override, updatedBy, updatedAt, history: HistoryEntry[] }
 *        `override` is the raw stored diff (EMPTY_GRAPH_OVERRIDE when no
 *        row exists); `history` is the last 20 saved versions, newest
 *        first, each `{ id, data, updatedByEmail, createdAt }`.
 * PUT  /api/admin/graph { override }
 *      → { ok, override, graph }   (400 with `{ error, cycle? }` when the
 *        override fails `applyGraphOverride`, e.g. a prerequisite cycle)
 *        Normalizes, writes the row and appends a history entry. Sending an
 *        empty override is how 「還原預設」 works.
 * POST /api/admin/graph { action: "revert", historyId }
 *      → { ok, override, graph }   re-validates the stored version (the
 *        static graph may have changed since) before it becomes current,
 *        and appends it to history again so the audit trail stays linear.
 *
 * All three are gated on getAdminContext() and write through the service
 * role (the table has no write policies, see migration 024).
 */

const KEY = "chapter";
const HISTORY_LIMIT = 20;

interface OverrideRow {
  data: unknown;
  updated_by_email: string | null;
  updated_at: string;
}

interface HistoryRow {
  id: number;
  data: unknown;
  updated_by_email: string | null;
  created_at: string;
}

export async function GET() {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = createServiceClient();
  const [{ data: row, error }, { data: hist, error: histErr }] = await Promise.all([
    supabase.from("concept_graph_overrides").select("data, updated_by_email, updated_at").eq("key", KEY).maybeSingle(),
    supabase
      .from("concept_graph_history")
      .select("id, data, updated_by_email, created_at")
      .eq("key", KEY)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (histErr) return NextResponse.json({ error: histErr.message }, { status: 500 });

  const current = row as OverrideRow | null;
  const parsed = current ? parseGraphOverride(current.data) : null;
  const override = parsed && parsed.ok ? parsed.override : EMPTY_GRAPH_OVERRIDE;

  return NextResponse.json({
    override,
    updatedBy: current?.updated_by_email ?? null,
    updatedAt: current?.updated_at ?? null,
    history: ((hist ?? []) as HistoryRow[]).map((h) => ({
      id: h.id,
      data: h.data,
      updatedByEmail: h.updated_by_email,
      createdAt: h.created_at,
    })),
  });
}

export async function PUT(req: Request) {
  const { isAdmin, email } = await getAdminContext();
  if (!isAdmin || !email) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { override?: unknown } | null;
  const parsed = parseGraphOverride(body?.override);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  return saveOverride(parsed.override, email);
}

export async function POST(req: Request) {
  const { isAdmin, email } = await getAdminContext();
  if (!isAdmin || !email) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; historyId?: unknown } | null;
  const historyId = Number(body?.historyId);
  if (body?.action !== "revert" || !Number.isInteger(historyId)) {
    return NextResponse.json({ error: "invalid action or historyId" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: row, error } = await supabase
    .from("concept_graph_history")
    .select("id, data, updated_by_email, created_at")
    .eq("key", KEY)
    .eq("id", historyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = parseGraphOverride((row as HistoryRow).data);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  return saveOverride(parsed.override, email);
}

/** Validate against the static graph, upsert the current row and append to history. */
async function saveOverride(raw: GraphOverride, email: string) {
  const override = normalizeGraphOverride(raw, STATIC_CHAPTER_GRAPH);
  const applied = applyGraphOverride(STATIC_CHAPTER_GRAPH, override);
  if (!applied.ok) {
    return NextResponse.json({ error: applied.error, cycle: applied.cycle ?? null }, { status: 400 });
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("concept_graph_overrides")
    .upsert({ key: KEY, data: override, updated_by_email: email, updated_at: now }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: histErr } = await supabase
    .from("concept_graph_history")
    .insert({ key: KEY, data: override, updated_by_email: email });
  if (histErr) return NextResponse.json({ error: histErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, override, graph: applied.graph });
}
