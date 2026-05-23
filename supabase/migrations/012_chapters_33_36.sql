-- Course material expanded to include Ch33-Ch36 (光學：光的傳播、幾何光學、干涉、繞射).
-- Widen the chapter_previews CHECK constraint to 1..36.
-- Other tables (lecture_chunks, attempts) are unconstrained on chapter_number.

alter table chapter_previews drop constraint chapter_previews_chapter_number_check;
alter table chapter_previews add constraint chapter_previews_chapter_number_check
  check (chapter_number between 1 and 36);
