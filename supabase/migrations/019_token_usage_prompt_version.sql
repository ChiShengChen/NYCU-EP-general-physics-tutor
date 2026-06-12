-- Stamp every token_usage row with the prompt template version that was
-- in effect when the call ran. Enables side-by-side comparison of cost /
-- quality across prompt iterations: if v2 burns 20% more tokens but the
-- question_reports rate drops, that's a winning trade — but we need
-- per-version aggregates to see that.
--
-- All existing rows back-fill to 'v1', the prompt era they came from.
-- Index supports (version, created_at) sweeps in the admin breakdown.

alter table token_usage
  add column if not exists prompt_version text not null default 'v1';

create index if not exists idx_token_usage_version
  on token_usage (prompt_version, created_at desc);
