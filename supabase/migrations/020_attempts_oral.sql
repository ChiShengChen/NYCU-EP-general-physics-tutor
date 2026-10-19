-- 口試模式 (AI oral exam): persist each oral-exam session as an attempt so
-- 錯題本 / 測驗紀錄 / future analysis pick it up through the same table
-- as quiz + exam, instead of growing a parallel oral_sessions table.
--
-- Two changes:
--   1. attempts.kind gains 'oral'. 002_attempts.sql declared the check
--      inline (`check (kind in ('quiz', 'exam'))`), so Postgres auto-named
--      it attempts_kind_check — drop + re-add with the wider set.
--   2. A `transcript` jsonb column holds the full examiner ↔ student
--      dialogue. The existing `answers` column still gets the student's
--      concatenated replies per question (so review pages that only know
--      {qid: text} keep working), but the turn-by-turn exchange — with
--      the examiner's follow-up probes — is what makes an oral attempt
--      worth re-reading, so it's kept verbatim here.
--
-- Shape: [{ questionId, skipped, elapsedSeconds,
--           turns: [{ role: 'examiner' | 'student', text }] }]
-- Quiz / exam rows keep the default '[]'.

alter table attempts drop constraint if exists attempts_kind_check;
alter table attempts
  add constraint attempts_kind_check check (kind in ('quiz', 'exam', 'oral'));

alter table attempts
  add column if not exists transcript jsonb not null default '[]'::jsonb;
