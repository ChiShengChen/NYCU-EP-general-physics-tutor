-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- Parsed lecture chunks for RAG retrieval
-- chapter_number maps 1..31 to Ch01..Ch31 of the General Physics course
create table lecture_chunks (
  id bigint primary key generated always as identity,
  chapter_number int not null,
  page_number int not null,
  section_title text not null default '',
  content text not null,
  content_type text not null default 'text' check (content_type in ('text', 'formula', 'figure_description', 'table', 'counterexample')),
  is_counterexample boolean not null default false,
  metadata jsonb not null default '{}',
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index on lecture_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 20);
create index idx_chunks_chapter on lecture_chunks (chapter_number);
create index idx_chunks_type on lecture_chunks (content_type);

-- Student learning state
create table student_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table student_state (
  id bigint primary key generated always as identity,
  student_id uuid not null references student_profiles(id) on delete cascade,
  concept text not null,
  mastery_score real not null default 0.0 check (mastery_score between 0 and 1),
  attempt_count int not null default 0,
  last_misconception text,
  updated_at timestamptz not null default now(),
  unique (student_id, concept)
);

create index idx_state_student on student_state (student_id);

-- Chat history for context continuity
create table chat_messages (
  id bigint primary key generated always as identity,
  student_id uuid not null references student_profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  chunks_used bigint[] default '{}',
  created_at timestamptz not null default now()
);

create index idx_messages_student on chat_messages (student_id, created_at desc);

-- RPC: similarity search function
create or replace function match_chunks(
  query_embedding vector(768),
  match_threshold float default 0.7,
  match_count int default 5,
  filter_chapter int default null
)
returns table (
  id bigint,
  chapter_number int,
  page_number int,
  section_title text,
  content text,
  content_type text,
  is_counterexample boolean,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    lc.id,
    lc.chapter_number,
    lc.page_number,
    lc.section_title,
    lc.content,
    lc.content_type,
    lc.is_counterexample,
    lc.metadata,
    1 - (lc.embedding <=> query_embedding) as similarity
  from lecture_chunks lc
  where 1 - (lc.embedding <=> query_embedding) > match_threshold
    and (filter_chapter is null or lc.chapter_number = filter_chapter)
  order by lc.embedding <=> query_embedding
  limit match_count;
end;
$$;
