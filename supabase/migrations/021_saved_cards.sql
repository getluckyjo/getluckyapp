-- ================================================================
-- 021 — Saved cards (PayFast tokenization)
--
--   payment_cards   one row per golfer: the PayFast token for the card they
--                   chose to save at checkout ("subscription_type=2" on the
--                   first payment; PayFast returns the token on the ITN).
--                   The card itself never touches us. Removing the card
--                   deletes the row and cancels the agreement at PayFast.
--
--   payfast_payments.status gains 'pending' and 'failed': a charge against
--   a saved card writes its ledger row (user, course, hole, tier) BEFORE
--   asking PayFast to charge, so the ITN that follows can never attach the
--   payment to the wrong hole, and a declined charge is kept for the books.
--
-- Reads: a golfer reads only their own card row (the token is never sent
-- to the browser; the API answers "saved" or "none"). Writes: service role.
-- Additive. Idempotent.
-- ================================================================

create table if not exists public.payment_cards (
  user_id       uuid primary key references auth.users on delete cascade,
  token         text not null check (char_length(token) between 8 and 200),
  label         text not null default 'Saved card' check (char_length(label) <= 40),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table public.payment_cards is
  'PayFast tokenization: the ad hoc agreement token for a golfer''s saved card. Charged by /api/payments/payfast/charge.';

alter table public.payment_cards enable row level security;

drop policy if exists "Golfers read their own saved card" on public.payment_cards;
create policy "Golfers read their own saved card"
  on public.payment_cards for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies: the anon and authenticated roles cannot write.

-- Ledger: allow the two states a token charge passes through.
alter table public.payfast_payments drop constraint if exists payfast_payments_status_check;
alter table public.payfast_payments
  add constraint payfast_payments_status_check
  check (status in ('complete', 'amount_mismatch', 'pending', 'failed'));
