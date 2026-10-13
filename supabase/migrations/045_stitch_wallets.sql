-- ================================================================
-- 045 — A second payment provider: Stitch for Apple Pay and Google Pay
--
-- The ledger keeps its name (payfast_payments) and its reference
-- (m_payment_id, our gl_… value): every route, the grant and the return
-- page key on that. What changes:
--
--   provider      'payfast' (the default, every row so far) or 'stitch'
--   provider_ref  the provider's own id for the transaction; for PayFast
--                 that stays pf_payment_id, for Stitch it is the GraphQL
--                 node id the webhook and the lookups use
--
-- stitch_webhook_events remembers every Svix event id we have processed,
-- so a redelivered webhook is a no-op: the ledger is written at most once
-- per event, and grantBetForPayment is idempotent on top of that.
--
-- Idempotent.
-- ================================================================

alter table public.payfast_payments
  add column if not exists provider text not null default 'payfast'
    check (provider in ('payfast', 'stitch'));

alter table public.payfast_payments
  add column if not exists provider_ref text
    check (provider_ref is null or char_length(provider_ref) <= 200);

create index if not exists payfast_payments_provider_ref_idx
  on public.payfast_payments (provider, provider_ref)
  where provider_ref is not null;

comment on column public.payfast_payments.provider is
  'Who moved the money: payfast (cards, Instant EFT, the PayFast saved card) or stitch (Apple Pay, Google Pay). The reference and the grant are the same whoever it was.';
comment on column public.payfast_payments.provider_ref is
  'The provider''s own id for the transaction. Stitch: the transaction node id. PayFast keeps pf_payment_id.';

create table if not exists public.stitch_webhook_events (
  id           text primary key,
  event_type   text not null,
  reference    text,
  status       text,
  received_at  timestamptz not null default now()
);

comment on table public.stitch_webhook_events is
  'Every Stitch (Svix) webhook id we have acted on. A redelivery finds its id here and is acknowledged without touching the ledger again.';

alter table public.stitch_webhook_events enable row level security;
revoke all on public.stitch_webhook_events from anon, authenticated;
