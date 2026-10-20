-- 概念圖譜人工校對 (concept_graph_overrides + concept_graph_history).
--
-- The chapter-level prerequisite graph ships as static data in
-- `web/src/lib/concept-graph.ts` (CHAPTER_NODES / CHAPTER_EDGES). It was
-- auto-generated and the README has carried a "needs teacher review" TODO
-- since day one. Rather than have the teacher edit TypeScript, the admin
-- 「🕸️ 圖譜」 tab stores a *diff* against the static graph here and every
-- consumer (knowledge-graph, prereq-path, /api/concept-graph) merges it at
-- read time via `applyGraphOverride()`. The static graph stays the default,
-- so an empty table (or an unreachable DB) still renders the full graph.
--
-- Single-row-per-key design: `key` names which graph the row overrides
-- ('chapter' today; the detail / formula graphs could reuse the same table
-- later). `data` is the override document:
--
--   {
--     "nodes": { "ch07": { "title": "...", "group": "mechanics", "hidden": true } },
--     "edges": { "added": [{ "from": "ch04", "to": "ch13" }],
--                "removed": [{ "from": "ch07", "to": "ch13" }] }
--   }
--
-- `concept_graph_history` is an append-only log of every saved version so
-- an admin can 「回復到此版本」 after a bad edit. Rows are small (a few KB),
-- so there is no retention policy; the admin API only reads the last 20.

create table if not exists concept_graph_overrides (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create table if not exists concept_graph_history (
  id bigint generated always as identity primary key,
  key text not null,
  data jsonb not null,
  updated_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_concept_graph_history_key_created
  on concept_graph_history (key, created_at desc);

-- RLS: the override is public-readable (students render the merged graph,
-- and nothing in it is sensitive — it is the same data the static graph
-- already ships to the browser). There are deliberately NO insert / update
-- / delete policies: writes come only from the admin route through the
-- service-role key, which bypasses RLS. History is admin-only, so it gets
-- RLS on with no policies at all (same pattern as teacher_questions, 023).
alter table concept_graph_overrides enable row level security;
drop policy if exists "concept graph overrides readable" on concept_graph_overrides;
create policy "concept graph overrides readable"
  on concept_graph_overrides for select
  to anon, authenticated
  using (true);

alter table concept_graph_history enable row level security;
