-- Per-question quality reports. Lets students flag a generated question as
-- bad (wrong answer / unclear / impossible / etc.) so we can audit which
-- prompts / chapters produce low-quality output and tune accordingly.

create table question_reports (
  id bigint primary key generated always as identity,
  student_id uuid references student_profiles(id) on delete set null,
  attempt_id bigint references attempts(id) on delete set null,
  question_id int,                    -- id inside the attempt's questions array
  source_chapter int,                 -- copy from question.sourceChapter for fast filtering
  question_text text,                 -- snapshot of the question
  correct_answer text,                -- snapshot of the answer
  reason text not null check (reason in ('unclear', 'wrong_answer', 'bad_explanation', 'too_easy', 'too_hard', 'off_topic', 'other')),
  detail text,                        -- optional free-form
  created_at timestamptz not null default now()
);

create index idx_reports_chapter on question_reports (source_chapter, created_at desc);
create index idx_reports_student on question_reports (student_id, created_at desc);
