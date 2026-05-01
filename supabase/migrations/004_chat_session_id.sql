-- Each "open a fresh 自由問答 chat" should be its own session, regardless of
-- time gaps. Add an explicit session_id that the chat client generates on
-- mount; persisted with every message. Legacy rows (pre-migration) stay NULL
-- and the history API falls back to the original 30-minute-gap heuristic for
-- those.

alter table chat_messages add column session_id uuid;

create index idx_chat_session on chat_messages (student_id, session_id, created_at);
