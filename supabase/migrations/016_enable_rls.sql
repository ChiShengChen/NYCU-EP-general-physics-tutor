-- Phase C (defense in depth): enable Row-Level Security on every table
-- that holds student-owned data.
--
-- Background
-- ----------
-- Up to migration 015 the app relied entirely on the application layer to
-- enforce identity — every Next.js API route used the service role key
-- and queried with `.eq("student_id", X)` where X came from the request.
-- The audit + Sprint 1 / 2 work moved every route over to the
-- `resolveStudentId` helper so the studentId is auth-derived whenever a
-- Supabase session is present, but as long as RLS is off any future
-- route that forgets to pin the WHERE clause leaks the entire table.
--
-- This migration flips RLS ON and writes per-table policies. The
-- service-role key keeps full access (Supabase exempts it from RLS),
-- so the existing routes continue to work without changes. Direct
-- PostgREST access by anon / authenticated keys — which we don't
-- currently use, but Supabase Auth could enable later — now needs to
-- match `auth.uid()` against student_profiles.auth_user_id.
--
-- The policies are conservative: SELECT/INSERT/UPDATE/DELETE are all
-- gated on the requesting auth.uid()'s owned student_profile, so even
-- a leaked anon key can't cross-read. Anonymous (localStorage-only)
-- users never use PostgREST directly — they hit our routes which use
-- the service role — so they're unaffected.
--
-- Reviewer note: this is migration 016, applied via Supabase SQL Editor
-- like every previous migration. Test in a preview branch before main if
-- you have one; flipping RLS in production should be paired with a
-- smoke test that hits every read endpoint to confirm the service role
-- still works.

-- Helper: returns the student_profiles.id linked to the JWT subject,
-- or NULL when no auth user is associated. Stable + parallel-safe so
-- Postgres can fold it into the policy USING / WITH CHECK clauses.
create or replace function public.auth_student_id()
returns uuid
language sql
stable
parallel safe
security definer
set search_path = public
as $$
  select id
  from student_profiles
  where auth_user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.auth_student_id() to anon, authenticated;

-- ─── student_profiles ───────────────────────────────────────────────
alter table student_profiles enable row level security;
drop policy if exists "profile self read" on student_profiles;
create policy "profile self read"
  on student_profiles for select
  using (id = public.auth_student_id());
drop policy if exists "profile self update" on student_profiles;
create policy "profile self update"
  on student_profiles for update
  using (id = public.auth_student_id())
  with check (id = public.auth_student_id());

-- ─── student_state (concept mastery) ────────────────────────────────
alter table student_state enable row level security;
drop policy if exists "state self all" on student_state;
create policy "state self all"
  on student_state for all
  using (student_id = public.auth_student_id())
  with check (student_id = public.auth_student_id());

-- ─── attempts (quiz + exam results) ─────────────────────────────────
alter table attempts enable row level security;
drop policy if exists "attempts self all" on attempts;
create policy "attempts self all"
  on attempts for all
  using (student_id = public.auth_student_id())
  with check (student_id = public.auth_student_id());

-- ─── chat_messages ──────────────────────────────────────────────────
alter table chat_messages enable row level security;
drop policy if exists "chat self all" on chat_messages;
create policy "chat self all"
  on chat_messages for all
  using (student_id = public.auth_student_id())
  with check (student_id = public.auth_student_id());

-- ─── reflections ────────────────────────────────────────────────────
alter table reflections enable row level security;
drop policy if exists "reflections self all" on reflections;
create policy "reflections self all"
  on reflections for all
  using (student_id = public.auth_student_id())
  with check (student_id = public.auth_student_id());

-- ─── learning_goals ─────────────────────────────────────────────────
alter table learning_goals enable row level security;
drop policy if exists "goals self all" on learning_goals;
create policy "goals self all"
  on learning_goals for all
  using (student_id = public.auth_student_id())
  with check (student_id = public.auth_student_id());

-- ─── token_usage ────────────────────────────────────────────────────
alter table token_usage enable row level security;
drop policy if exists "usage self read" on token_usage;
create policy "usage self read"
  on token_usage for select
  using (student_id = public.auth_student_id());
-- Inserts always go through logUsage() which uses the service role —
-- the anon key has no reason to write into this table directly.

-- ─── question_reports ───────────────────────────────────────────────
alter table question_reports enable row level security;
drop policy if exists "reports self insert" on question_reports;
create policy "reports self insert"
  on question_reports for insert
  with check (student_id is null or student_id = public.auth_student_id());
-- No SELECT policy: only admins (service role) should browse reports.

-- ─── chapter_previews (shared, not per-student) ─────────────────────
-- Public-readable cache. Writes only via service role.
alter table chapter_previews enable row level security;
drop policy if exists "chapter previews readable" on chapter_previews;
create policy "chapter previews readable"
  on chapter_previews for select
  to anon, authenticated
  using (true);

-- ─── lecture_chunks (shared) ────────────────────────────────────────
alter table lecture_chunks enable row level security;
drop policy if exists "lecture chunks readable" on lecture_chunks;
create policy "lecture chunks readable"
  on lecture_chunks for select
  to anon, authenticated
  using (true);
