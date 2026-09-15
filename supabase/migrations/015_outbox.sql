-- ================================================================
-- 015 — Outbox (Stage 4, Batch 12; docs/stage-4-proposal.md §2)
--
-- Work that should not hold a request: emails, today; anything else that
-- talks to a third party, tomorrow. A request inserts a row; the
-- /api/cron/outbox route (every minute on Vercel Pro) claims due rows and
-- runs them, with backoff on failure and a dead-letter alert after the last
-- attempt.
--
-- Claiming is a conditional update on next_attempt_at, which doubles as the
-- lease: a runner that dies mid-job leaves the row to be retried when the
-- lease lapses. No advisory locks, no second table.
--
-- Additive. Idempotent. Apply BEFORE deploying Batch 12.
-- ================================================================

create table if not exists public.outbox (
  id              bigint generated always as identity primary key,
  kind            text not null,
  payload         jsonb not null,
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  done_at         timestamptz,
  failed_at       timestamptz
);

comment on table public.outbox is
  'Background jobs: kind + payload, drained by /api/cron/outbox. done_at set on success; failed_at after the last retry (dead letter, alerted).';

create index if not exists outbox_due_idx
  on public.outbox (next_attempt_at)
  where done_at is null and failed_at is null;

alter table public.outbox enable row level security;
revoke all on public.outbox from anon, authenticated;

-- Verify
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'outbox' order by ordinal_position;
