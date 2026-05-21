-- 學習目標 (learning goals). A student sets a short-term target like
-- "this week I want to nail Ch08 動量". We track progress via the same
-- attempts / student_state data so progress bars stay coherent with the
-- rest of the system.

create table learning_goals (
  id bigint primary key generated always as identity,
  student_id uuid not null references student_profiles(id) on delete cascade,
  title text not null,
  target_chapter int,            -- optional: scope progress checks to this chapter
  target_concept text,           -- optional: free-form concept tag (matches student_state.concept)
  target_date date,              -- when the student wants to finish by
  status text not null default 'active' check (status in ('active', 'done', 'abandoned')),
  notes text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_goals_student on learning_goals (student_id, status, created_at desc);
