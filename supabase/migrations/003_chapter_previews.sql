-- Cached chapter previews. The first user to open a chapter triggers a Gemini
-- generation; the structured result is stored here so subsequent users get an
-- instant load. To regenerate: delete the row (or all rows) and reopen.

create table chapter_previews (
  chapter_number int primary key check (chapter_number between 1 and 31),
  content jsonb not null,
  generated_at timestamptz not null default now()
);
