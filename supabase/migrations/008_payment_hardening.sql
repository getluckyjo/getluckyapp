-- ================================================================
-- 008 — Payment path hardening (AUDIT.md B.3, Batch 3)
--
-- The ITN used to overwrite bets.payment_intent_id with PayFast's own id,
-- which broke /api/bets/create's idempotency lookup (it searches by our
-- reference) and allowed a second bet for one payment on a retried return.
--
-- Now PayFast's id lives in its own column, our reference is never
-- rewritten, and the ledger row links back to the bet it produced.
--
-- Idempotent. Apply BEFORE deploying the Batch 3 code (it writes
-- bets.pf_payment_id and payfast_payments.bet_id). Nothing here breaks the
-- Batch 2 code.
-- ================================================================

alter table public.bets
  add column if not exists pf_payment_id text;

create index if not exists bets_pf_payment_id_idx on public.bets (pf_payment_id);

alter table public.payfast_payments
  add column if not exists bet_id uuid references public.bets on delete set null;

create index if not exists payfast_payments_bet_id_idx on public.payfast_payments (bet_id);

comment on column public.bets.pf_payment_id is
  'PayFast''s own payment id, for reconciliation. payment_intent_id is our gl_ reference and is never rewritten.';
comment on column public.payfast_payments.bet_id is
  'The bet granted for this payment, set by /api/bets/create. Null = paid but no bet yet (or amount_mismatch).';

-- ----------------------------------------------------------------
-- Backfill 1: bets whose reference was swapped to a PayFast id by the old
-- ITN. Restore our reference from the ledger and keep PayFast's in the new
-- column. Skipped where restoring would collide with a second bet that
-- already carries the gl_ reference (the double-bet case); those are
-- listed at the end for manual resolution.
-- ----------------------------------------------------------------
update public.bets b
   set pf_payment_id     = b.payment_intent_id,
       payment_intent_id = p.m_payment_id
  from public.payfast_payments p
 where p.pf_payment_id = b.payment_intent_id
   and b.payment_intent_id not like 'gl_%'
   and not exists (select 1 from public.bets o where o.payment_intent_id = p.m_payment_id and o.id <> b.id);

-- Backfill 2: bets that still carry the gl_ reference get PayFast's id.
update public.bets b
   set pf_payment_id = p.pf_payment_id
  from public.payfast_payments p
 where p.m_payment_id = b.payment_intent_id
   and b.pf_payment_id is null
   and p.pf_payment_id is not null;

-- Backfill 3: link ledger rows to their bets.
update public.payfast_payments p
   set bet_id = b.id
  from public.bets b
 where b.payment_intent_id = p.m_payment_id
   and p.bet_id is null;

-- ----------------------------------------------------------------
-- Verify: anything listed here needs a human.
--   duplicates      = one payment, two bets (refund one, then delete it)
--   swapped_orphans = a bet still holding a PayFast id we could not restore
-- ----------------------------------------------------------------
select 'duplicates' as issue, p.m_payment_id, array_agg(b.id) as bet_ids
  from public.payfast_payments p
  join public.bets b on b.payment_intent_id = p.m_payment_id or b.pf_payment_id = p.pf_payment_id
 group by p.m_payment_id
having count(distinct b.id) > 1
union all
select 'swapped_orphans', b.payment_intent_id, array_agg(b.id)
  from public.bets b
 where b.payment_intent_id is not null and b.payment_intent_id not like 'gl_%'
 group by b.payment_intent_id;
