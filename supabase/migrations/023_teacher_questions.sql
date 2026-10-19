-- 老師自訂題庫 (teacher_questions).
--
-- Admins (ADMIN_EMAILS) can add their own questions — one at a time via the
-- 「📚 題庫」 tab or in bulk via CSV import — and the quiz generator mixes a
-- slice of them (TEACHER_MIX_RATIO, default 30%) into the AI-generated
-- chapter / multi-chapter quizzes for the same chapters. The rows share
-- the quiz question shape so grading needs no special casing: `type`,
-- `options` (4 strings for MC, null for short answer), `correct_answer`
-- (A/B/C/D for MC, free text for short answer), `explanation`.
--
-- `is_active` is a soft on/off switch so a teacher can park a question
-- without losing it; only active rows are ever sampled. `tags` is free-form
-- (e.g. '{期中,計算}') and is only used for filtering in the admin UI.
--
-- Chapter range is 1..37 — the same bound the quiz / oral routes validate
-- against (Ch32 / Ch33–36 / Ch37 were added by migrations 005 / 012 / 015).

create table if not exists teacher_questions (
  id bigint generated always as identity primary key,
  created_by_email text,
  chapter int not null check (chapter between 1 and 37),
  type text not null check (type in ('multiple_choice', 'short_answer')),
  concept text not null default '',
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  question text not null,
  -- jsonb array of exactly 4 option strings for multiple_choice; null for
  -- short_answer. Enforced at the DB so a hand-written INSERT can't ship
  -- an MC question with 3 options that the UI then renders broken.
  options jsonb check (
    (type = 'short_answer' and options is null)
    or (type = 'multiple_choice' and jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4)
  ),
  correct_answer text not null,
  explanation text not null default '',
  points int not null default 1 check (points >= 1),
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The quiz generator's only query: "active rows for these chapters".
create index if not exists idx_teacher_questions_chapter_active
  on teacher_questions (chapter, is_active);

-- RLS on with NO policies: this table is written by admins and read by the
-- quiz generator, both through the service-role key (which bypasses RLS).
-- There is deliberately no anon / authenticated policy — the rows contain
-- the correct answers, so a student with the anon key must not be able to
-- SELECT the bank directly via PostgREST.
alter table teacher_questions enable row level security;
