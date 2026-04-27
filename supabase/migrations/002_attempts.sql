-- Persistent record of every quiz / exam attempt a student completes.
-- Lets students review past sessions: their answers, the correct answers,
-- per-question feedback, and overall grade.

create table attempts (
  id bigint primary key generated always as identity,
  student_id uuid not null references student_profiles(id) on delete cascade,
  kind text not null check (kind in ('quiz', 'exam')),
  exam_type text check (exam_type in ('midterm', 'final')),  -- null for quiz
  title text not null default '',
  questions jsonb not null,     -- full question objects (incl. correctAnswer, explanation, sourceChapter)
  answers jsonb not null,       -- { "<questionId>": "<student answer>" }
  results jsonb not null,       -- per-question grading: [{questionId, isCorrect, score, earnedPoints?, feedback}]
  total_score real not null default 0,
  max_score real not null default 0,
  grade text,                   -- exam only: "A+", "A", ... "F"
  overall_feedback text,
  created_at timestamptz not null default now()
);

create index idx_attempts_student on attempts (student_id, created_at desc);
create index idx_attempts_kind on attempts (student_id, kind, created_at desc);
