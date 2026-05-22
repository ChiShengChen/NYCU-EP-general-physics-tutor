-- Track LLM token usage per student per endpoint.
-- One row per generateObject() / streamText() call. Cost is computed at
-- query time from prompt_tokens + completion_tokens against the model's
-- per-token rate so we don't have to rewrite rows when rates change.

create table token_usage (
  id bigint primary key generated always as identity,
  student_id uuid references student_profiles(id) on delete set null,
  endpoint text not null,          -- e.g. "/api/quiz", "/api/chat"
  label text,                      -- finer-grained: "quiz/synthesis-MC", "chat/turn"
  model text not null,             -- e.g. "gemini-2.5-flash"
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  total_tokens int not null default 0,
  created_at timestamptz not null default now()
);

create index token_usage_student_id_created_at_idx
  on token_usage (student_id, created_at desc);

create index token_usage_endpoint_idx on token_usage (endpoint);
