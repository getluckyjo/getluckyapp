-- ================================================================
-- Reset before launch: remove every test entry from the PRODUCTION
-- database so the first real golfer is the first row.
--
-- Run ONCE, by hand, in the Supabase SQL editor (as postgres), on the day
-- before launch, after the last smoke test. Not a migration; not run by
-- any script; refuses to run unless you edit the guard below.
--
-- What it removes: bets, payments, verifications, witnesses, events,
-- risk history, outbox jobs, rate-limit counters, deleted-account memory,
-- and every object in the two storage buckets.
-- What it keeps: courses, holes, course contacts, profiles (your admin
-- and any team accounts), auth users.
--
-- Test *accounts* you want gone: delete them under Authentication → Users
-- afterwards; the cascade takes their profile. Or leave them; with no bets
-- they are harmless.
-- ================================================================

do $$
declare
  guard text := 'I have run the last smoke test';   -- edit to match the line below to arm
  bets  bigint;
begin
  if guard <> 'I have run the last smoke test and this is production' then
    raise exception 'Guard not armed. Edit the guard text in this script to run it.';
  end if;

  select count(*) into bets from public.bets;
  raise notice 'Removing % bets and everything attached to them.', bets;

  -- Append-only tables refuse deletes even from postgres while their
  -- triggers are on. Off, delete, on.
  alter table public.claim_events   disable trigger trg_claim_events_append_only;
  alter table public.account_events disable trigger trg_account_events_append_only;

  delete from public.claim_events;
  delete from public.account_events;
  delete from public.claim_witnesses;
  delete from public.verifications;
  delete from public.payfast_payments;
  delete from public.bets;
  delete from public.outbox;
  delete from public.rate_limits;
  delete from public.deleted_accounts;

  alter table public.claim_events   enable trigger trg_claim_events_append_only;
  alter table public.account_events enable trigger trg_account_events_append_only;

  -- Profiles keep their people but lose their test history.
  update public.profiles set total_attempts = 0, suspended_at = null, suspended_reason = null;

  -- Storage: every object in both buckets. (Deleting the rows removes the
  -- objects; Supabase reconciles the files.)
  delete from storage.objects where bucket_id in ('shot-videos', 'verification-docs');

  raise notice 'Done. Verify with the SELECT below.';
end $$;

select 'bets' as t, count(*) from public.bets
union all select 'payfast_payments', count(*) from public.payfast_payments
union all select 'verifications', count(*) from public.verifications
union all select 'claim_witnesses', count(*) from public.claim_witnesses
union all select 'claim_events', count(*) from public.claim_events
union all select 'outbox', count(*) from public.outbox
union all select 'storage objects', count(*) from storage.objects where bucket_id in ('shot-videos', 'verification-docs');
