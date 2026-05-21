-- 反思日誌 (reflection journal) — weekly metacognition entries with an AI
-- summary / follow-up. Each row is one reflection; students can write more
-- than one per week if they want, but the UI nudges weekly cadence.

create table reflections (
  id bigint primary key generated always as identity,
  student_id uuid not null references student_profiles(id) on delete cascade,
  content text not null,
  ai_feedback text,
  prompt_used text,
  created_at timestamptz not null default now()
);

create index idx_reflections_student on reflections (student_id, created_at desc);
