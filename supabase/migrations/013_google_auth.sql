-- Phase A: Google login.
-- Link student_profiles rows to Supabase Auth users without forcing existing
-- anonymous data to be re-created. The localStorage-based id stays the
-- primary key (so all attempts / chat_messages / goals / token_usage rows
-- referencing student_id continue to work); we add a nullable auth_user_id
-- that the first OAuth sign-in stamps onto the matching profile.
--
-- Nothing here forces auth. Anonymous use keeps working. RLS is left off
-- (still gated by service-role keys in API routes) — that's Phase B.

alter table student_profiles
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists email text;

create index if not exists idx_profiles_auth on student_profiles(auth_user_id);
create index if not exists idx_profiles_email on student_profiles(email);
