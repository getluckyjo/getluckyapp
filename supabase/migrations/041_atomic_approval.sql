-- ================================================================
-- 041 — Approving a claim is one transaction
--
-- Why. Approval was two writes from the app: the verification to
-- `approved`, then the bet from `claimed` to `verified`. If the second
-- failed (a dropped connection, a deploy mid-request, the bet changed
-- under it) the record showed an approved claim on a bet that was still
-- `claimed`: a prize nobody owed and nobody could pay, and the review page
-- refusing to approve again because the verification was already final.
-- With R1m claims on a broadcast weekend that is not a state to have to
-- repair by hand.
--
--   approve_claim(verification, actor, notes, checklist)
--       locks both rows, checks both states, writes both, returns the bet
--       id. Either everything happens or nothing does. The claim_events
--       trigger records both changes with the actor, as before.
--
-- Refusals come back as exceptions whose MESSAGE is the app's error code
-- (VERIFICATION_NOT_FOUND, BET_NOT_FOUND, INVALID_TRANSITION) and whose
-- HINT is the sentence the reviewer sees; src/lib/claims/state-machine.ts
-- turns them into the same 404/409 answers the two-write path gave.
--
-- Service role only (migration 040 closed new functions by default; the
-- grant below is explicit). Idempotent. Apply before deploying the code
-- that calls it; until then the app's two-write path still works.
-- ================================================================

create or replace function public.approve_claim(
  p_verification_id uuid,
  p_actor_id        uuid,
  p_notes           text,
  p_checklist       jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_ver_status text;
  v_bet_id     uuid;
  v_bet_status text;
  v_now        timestamptz := now();
begin
  -- Lock the verification, then its bet, always in that order.
  select status::text, bet_id
    into v_ver_status, v_bet_id
    from public.verifications
   where id = p_verification_id
     for update;
  if not found then
    raise exception 'VERIFICATION_NOT_FOUND' using errcode = 'P0001', hint = 'Verification not found';
  end if;
  if v_ver_status not in ('pending', 'documents_received', 'under_review') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      hint = format('Cannot move a verification from %s to approved.', v_ver_status);
  end if;

  select status::text
    into v_bet_status
    from public.bets
   where id = v_bet_id
     for update;
  if not found then
    raise exception 'BET_NOT_FOUND' using errcode = 'P0001', hint = 'Bet not found';
  end if;
  if v_bet_status <> 'claimed' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      hint = format('Cannot approve: the bet is %s, not claimed.', v_bet_status);
  end if;

  update public.verifications
     set status           = 'approved',
         reviewed_by      = p_actor_id,
         updated_by       = p_actor_id,
         reviewer_notes   = coalesce(p_notes, reviewer_notes),
         verified_at      = v_now,
         review_checklist = coalesce(p_checklist, review_checklist)
   where id = p_verification_id;

  update public.bets
     set status     = 'verified',
         updated_by = p_actor_id
   where id = v_bet_id;

  return v_bet_id;
end;
$$;

comment on function public.approve_claim(uuid, uuid, text, jsonb) is
  'Approve a claim: verification to approved and its bet from claimed to verified, in one transaction, with both rows locked. Raises VERIFICATION_NOT_FOUND, BET_NOT_FOUND or INVALID_TRANSITION (the reviewer-facing sentence in the hint). Service role only; called from the admin review route.';

revoke execute on function public.approve_claim(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.approve_claim(uuid, uuid, text, jsonb) to service_role;

-- ----------------------------------------------------------------
-- Verify: the function exists and only the service role may call it.
-- ----------------------------------------------------------------
select has_function_privilege('service_role', 'public.approve_claim(uuid, uuid, text, jsonb)', 'execute') as service_role_can_approve,
       has_function_privilege('authenticated', 'public.approve_claim(uuid, uuid, text, jsonb)', 'execute') as authenticated_can_approve;
