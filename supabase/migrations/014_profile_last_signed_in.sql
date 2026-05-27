-- Phase B (auth hardening): track sign-in activity per profile.
--
-- Why: today we can't tell which anonymous profiles are abandoned (left
-- around when a student cleared cookies, switched devices, etc.) vs. which
-- belong to active users. A simple last-sign-in timestamp lets us
-- distinguish "this Google account was active last Tuesday" from "this
-- anonymous row hasn't been touched since 6 months ago" — useful both for
-- analytics on dashboards and for eventual orphan cleanup.
--
-- Only /api/auth/sync stamps this column today (every successful sign-in
-- refreshes it). Anonymous-only profiles get NULL, which makes the
-- distinction itself meaningful.

alter table student_profiles
  add column if not exists last_signed_in_at timestamptz;

create index if not exists idx_profiles_last_signed_in
  on student_profiles (last_signed_in_at)
  where last_signed_in_at is not null;
