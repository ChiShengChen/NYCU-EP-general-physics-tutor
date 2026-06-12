-- Admin moderation: track when a question_report has been triaged so the
-- admin panel can hide already-handled reports by default and filter on
-- "still open" cleanly.
--
-- resolved_at + resolved_by_email are nullable; existing rows stay
-- "open" until someone marks them. We store the admin's email (not a
-- student_profiles id) because admins authenticate via Supabase auth
-- directly and may not have a student_profile row — and even if they
-- do, the audit trail is more useful with the email than with an opaque
-- UUID.

alter table question_reports
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_email text,
  add column if not exists resolution_note text;

-- Partial index so the "open reports" list — the default admin view —
-- doesn't scan resolved rows.
create index if not exists idx_reports_open
  on question_reports (created_at desc)
  where resolved_at is null;
