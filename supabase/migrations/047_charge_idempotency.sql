-- ================================================================
-- 047 — A retried charge is one charge
--
-- On a golf course the answer to a saved-card or wallet charge is often
-- lost on the way back. The phone retries; without a key the server
-- charged twice. Now the phone sends an Idempotency-Key with the charge,
-- the ledger row carries it, and a second request with the same key
-- replays the first row's outcome instead of charging again.
--
--   payfast_payments.idempotency_key   the client's key, once per golfer
--   claim_witnesses                    one row per person per claim, so
--                                      two submissions arriving together
--                                      cannot name a witness twice
--
-- Idempotent.
-- ================================================================

alter table public.payfast_payments
  add column if not exists idempotency_key text
    check (idempotency_key is null or char_length(idempotency_key) between 8 and 64);

create unique index if not exists payfast_payments_user_idempotency_key
  on public.payfast_payments (user_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.payfast_payments.idempotency_key is
  'The Idempotency-Key the phone sent with a saved-card or wallet charge. A second request with the same key replays this row''s outcome; nothing is charged again.';

-- A duplicate witness row from two submissions that raced is refused by
-- the database, not noticed afterwards.
create unique index if not exists claim_witnesses_bet_email_source_key
  on public.claim_witnesses (bet_id, lower(email), source);
