-- Course material expanded to include Ch37 (Relativity / 相對論).
-- Widen the chapter_previews CHECK constraint from 1..36 to 1..37. Other
-- tables (lecture_chunks, attempts) are unconstrained on chapter_number,
-- so they need no change. The chunk_and_embed pipeline will populate
-- lecture_chunks rows for Ch37 in the same deploy window.

alter table chapter_previews drop constraint chapter_previews_chapter_number_check;
alter table chapter_previews add constraint chapter_previews_chapter_number_check
  check (chapter_number between 1 and 37);
