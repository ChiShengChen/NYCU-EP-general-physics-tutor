-- Per-attempt "AI 錯題分析" cache.
--
-- When a student asks for an analysis of a quiz / exam / oral attempt we
-- run one LLM call that classifies each wrong answer (concept / calculation
-- / reading / incomplete), explains the fix, and points to the lecture
-- pages (chapter + page) the student should re-read. That call is not
-- cheap and the result is deterministic enough to reuse, so we store it
-- keyed by attempt_id and serve the cached row on every later view
-- (錯題本, 測驗紀錄, 結果頁).
--
-- prompt_version mirrors the chapter_previews pattern (migration 018): bump
-- ANALYSIS_PROMPT_VERSION after changing the prompt and stale rows are
-- regenerated on the next request instead of being served forever.
--
-- The same row is what a future "考完試寄 email 報告" job would read, so
-- the analysis stays decoupled from any particular delivery channel.

create table if not exists attempt_analyses (
  attempt_id bigint primary key references attempts(id) on delete cascade,
  student_id uuid not null references student_profiles(id) on delete cascade,
  analysis jsonb not null,
  prompt_version text not null default 'v1',
  model text,
  created_at timestamptz not null default now()
);

create index if not exists idx_attempt_analyses_student
  on attempt_analyses (student_id, created_at desc);

-- RLS: students can read their own analyses via PostgREST; writes always go
-- through the service role in the API route.
alter table attempt_analyses enable row level security;
drop policy if exists "analyses self read" on attempt_analyses;
create policy "analyses self read"
  on attempt_analyses for select
  using (student_id = public.auth_student_id());
