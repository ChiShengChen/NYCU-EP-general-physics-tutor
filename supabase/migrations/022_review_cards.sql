-- 間隔重複排程 (SM-2) for 每日 5 分鐘小複習.
--
-- Until now /api/daily-review re-derived "what to review" on every request
-- from `attempts` with a forgetting-curve heuristic — nothing was stored,
-- so reviewing a question had no effect on when it came back. This table
-- turns every wrong answer into a flashcard with its own SM-2 state
-- (ease / interval / repetitions) and a concrete `due_at`, so a question
-- the student nails keeps receding (1d → 6d → 15d → ...) while one they
-- keep missing snaps back to tomorrow.
--
-- Seeding: /api/daily-review GET runs a cheap "sync" pass that scans the
-- student's recent attempts and inserts a card for every wrong question
-- that doesn't have one yet (`on conflict do nothing` via the unique
-- key). The grading routes (quiz / exam / oral) don't need to know this
-- table exists.
--
-- Columns mirror what `web/src/lib/sm2.ts` reads / writes:
--   ease            SM-2 easiness factor, floor 1.3, starts at 2.5
--   interval_days   days between the last review and `due_at`
--   repetitions     consecutive successful reviews (reset on a lapse)
--   lapses          how many times the card fell back to 0 (struggle signal)
--   last_quality    the 0–5 quality of the most recent review
--
-- attempt_id + question_id locate the question inside attempts.questions
-- (jsonb), so the card itself stays tiny; the route hydrates the question
-- text + the student's original answer on read. Deleting an attempt (or a
-- student) cascades.

create table if not exists review_cards (
  id bigint primary key generated always as identity,
  student_id uuid not null references student_profiles(id) on delete cascade,
  attempt_id bigint not null references attempts(id) on delete cascade,
  question_id int not null,
  concept text,
  source_chapter int,
  ease real not null default 2.5,
  interval_days int not null default 0,
  repetitions int not null default 0,
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  last_quality int check (last_quality between 0 and 5),
  lapses int not null default 0,
  created_at timestamptz not null default now(),
  unique (student_id, attempt_id, question_id)
);

-- The hot query: "give me this student's cards due before now, oldest due
-- first", plus the forecast counts (due_at < tomorrow / < 7 days).
create index if not exists idx_review_cards_student_due
  on review_cards (student_id, due_at);

-- RLS: same self-all pattern as migration 016. The API route uses the
-- service role (exempt), so this only matters for direct PostgREST access.
alter table review_cards enable row level security;
drop policy if exists "review cards self all" on review_cards;
create policy "review cards self all"
  on review_cards for all
  using (student_id = public.auth_student_id())
  with check (student_id = public.auth_student_id());
