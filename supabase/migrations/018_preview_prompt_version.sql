-- Tag every cached chapter preview with the prompt version that produced
-- it. When we change the prompt template, bumping the PREVIEW_PROMPT_VERSION
-- env (and the matching DEFAULT_PREVIEW_PROMPT_VERSION constant in the
-- route) makes the lookup miss the stale rows so they regenerate on first
-- request instead of serving the old shape to the student.
--
-- Existing rows are stamped 'v1' since that's what the original prompt was.

alter table chapter_previews
  add column if not exists prompt_version text not null default 'v1';

create index if not exists idx_chapter_previews_version
  on chapter_previews (chapter_number, prompt_version);
