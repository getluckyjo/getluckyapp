-- ================================================================
-- 044 — Reserving a saved-card charge against the daily cap is one
--       locked step
--
-- Why (independent audit, 11 October 2026, S10). The charge route read
-- the last 24 hours of saved-card rows, compared the sum with the cap,
-- and then inserted its own pending row. Two requests arriving together
-- both saw the same remaining allowance before either row existed, so a
-- golfer at R2,250 spent could reserve two R250 charges at once and go
-- R250 over the promised bound. Unique references stop collisions; they
-- do not serialise the budget.
--
--   reserve_saved_card_charge(user, reference, course, hole, tier, amount, cap, window)
--       takes a transaction-scoped advisory lock on the golfer, sums the
--       charges that took or may have taken money inside the window,
--       refuses with SAVED_CARD_LIMIT (detail = cents already spent) when
--       the new one would cross the cap, otherwise writes the pending
--       ledger row and returns the cents spent before it.
--
-- The lock is held until the transaction commits, which is the end of
-- the RPC: a second request for the same golfer waits, then sees the
-- first row. Service role only. Idempotent.
-- ================================================================

create or replace function public.reserve_saved_card_charge(
  p_user_id       uuid,
  p_m_payment_id  text,
  p_course_id     uuid,
  p_hole_id       uuid,
  p_tier          text,
  p_amount_cents  integer,
  p_cap_cents     integer,
  p_window        interval
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_spent integer;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001', hint = 'A charge needs a positive amount.';
  end if;

  -- One golfer at a time through this check-and-reserve.
  perform pg_advisory_xact_lock(hashtext('saved_card:' || p_user_id::text));

  select coalesce(sum(amount_cents), 0)
    into v_spent
    from public.payfast_payments
   where user_id = p_user_id
     and raw_payload->>'source' = 'saved_card'
     and status in ('complete', 'pending', 'unknown')
     and created_at >= clock_timestamp() - p_window;

  if v_spent + p_amount_cents > p_cap_cents then
    raise exception 'SAVED_CARD_LIMIT' using errcode = 'P0001',
      hint = 'Over the saved-card daily cap.', detail = v_spent::text;
  end if;

  insert into public.payfast_payments (m_payment_id, user_id, course_id, hole_id, tier, amount_cents, status, raw_payload)
  values (p_m_payment_id, p_user_id, p_course_id, p_hole_id, p_tier::bet_tier, p_amount_cents, 'pending', jsonb_build_object('source', 'saved_card'));

  return v_spent;
end;
$$;

revoke execute on function public.reserve_saved_card_charge(uuid, text, uuid, uuid, text, integer, integer, interval) from public, anon, authenticated;
grant  execute on function public.reserve_saved_card_charge(uuid, text, uuid, uuid, text, integer, integer, interval) to service_role;
