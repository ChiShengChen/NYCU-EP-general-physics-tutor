-- Course material expanded to include Ch32 (Electromagnetic Waves).
-- Widen the chapter_previews CHECK constraint that originally pinned the
-- valid range to 1..31. Other tables (lecture_chunks, attempts) were
-- already unconstrained on chapter_number so they need no change.

alter table chapter_previews drop constraint chapter_previews_chapter_number_check;
alter table chapter_previews add constraint chapter_previews_chapter_number_check
  check (chapter_number between 1 and 32);
