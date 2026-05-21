-- Track how many scaffolded hints the student used per question so that:
--   1. The attempts review shows a small "💡 used N/3 hints" badge.
--   2. Future analytics can distinguish "got it solo" vs "needed all hints"
--      when ranking weak concepts.
--
-- Shape: { "<questionId>": <hintLevel 0..3> } (0 = unused; missing key = unused)

alter table attempts add column hint_usage jsonb not null default '{}'::jsonb;
