-- ================================================================
-- 032 — Admin fixes from the September 2026 audit
--
--   admin_totals()               'active_bets' counted every bet still
--                                marked active, and a swing that expires
--                                unplayed stays active for ever, so the
--                                dashboard's number only ever grew. It now
--                                counts bets whose window is still open, and
--                                reports the expired ones apart. Claims are
--                                split into the admin's work (documents in,
--                                under review) and the golfer's (pending:
--                                waiting on their documents). Existing keys
--                                keep their names.
--   admin_unmatched_payments     payments that took money and produced no
--                                bet: complete or amount_mismatch, no bet_id,
--                                and no bet carrying their reference. The
--                                admin's "Paid, but no bet" filter pages and
--                                counts this view, instead of filtering on
--                                the best-effort bet_id link.
--   payfast_payments indexes     the payments list sorts by created_at on
--                                every page, with and without a status.
--
-- Service role only. Additive (a replaced function keeps its signature).
-- Idempotent.
-- ================================================================

create or replace function public.admin_totals()
returns json
language sql
security definer set search_path = public
stable
as $$
  select json_build_object(
    'total_revenue_cents', coalesce((select sum(stake_pence) from public.bets), 0),
    'total_payout_cents',  coalesce((select sum(potential_win_pence) from public.bets where status = 'paid'), 0),
    'total_bets',          (select count(*) from public.bets),
    'active_bets',         (select count(*) from public.bets where status = 'active' and (expires_at is null or expires_at > now())),
    'expired_bets',        (select count(*) from public.bets where status = 'active' and expires_at <= now()),
    'pending_claims',      (select count(*) from public.verifications where status in ('pending', 'documents_received', 'under_review')),
    'claims_to_review',    (select count(*) from public.verifications where status in ('documents_received', 'under_review')),
    'claims_waiting',      (select count(*) from public.verifications where status = 'pending'),
    'prizes_owed_cents',   coalesce((select sum(potential_win_pence) from public.bets where status = 'verified'), 0),
    'total_users',         (select count(*) from public.profiles)
  );
$$;

revoke execute on function public.admin_totals() from public, anon, authenticated;
grant  execute on function public.admin_totals() to service_role;

create or replace view public.admin_unmatched_payments
with (security_invoker = true) as
select p.*
  from public.payfast_payments p
 where p.status in ('complete', 'amount_mismatch')
   and p.bet_id is null
   and not exists (select 1 from public.bets b where b.payment_intent_id = p.m_payment_id);

revoke all on public.admin_unmatched_payments from public, anon, authenticated;
grant select on public.admin_unmatched_payments to service_role;

create index if not exists payfast_payments_created_at_idx on public.payfast_payments (created_at desc);
create index if not exists payfast_payments_status_created_at_idx on public.payfast_payments (status, created_at desc);

-- Verify: the new totals, and how many paid-but-no-bet payments there are.
select public.admin_totals() as totals,
       (select count(*) from public.admin_unmatched_payments) as unmatched_payments;
