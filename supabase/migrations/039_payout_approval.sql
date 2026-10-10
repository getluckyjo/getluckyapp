-- ================================================================
-- 039 — Second sign-off on payouts
--
-- Why. One admin could approve a claim and, on the same screen, mark the
-- prize paid. Nothing in the app made a second person look at the money
-- before it left. ARCHITECTURE.md §11 listed "second sign-off on a payout
-- is outside the app"; this brings it inside.
--
--   bet_status 'payout_approved'   a new state between verified and paid:
--                                  the claim is verified and one admin has
--                                  approved the payout. A different admin
--                                  marks it paid (the state machine refuses
--                                  the same actor; the trigger below is the
--                                  backstop).
--   bets.payout_approved_by/at     who approved the payout, and when. Set by
--                                  the app on verified → payout_approved
--                                  from the acting admin. The claim_events
--                                  trigger records both like any other
--                                  change, so the two names are on the
--                                  record.
--   admin aggregates               every function that treated 'verified'
--                                  as "prize owed" or counted a claim with
--                                  ('claimed','verified','paid') now takes
--                                  the new state too, so nothing is
--                                  miscounted while a payout waits for its
--                                  second signature.
--
-- Additive. Idempotent. Apply BEFORE deploying the code that uses the new
-- status (an insert of 'payout_approved' fails until it exists).
--
-- On the enum value: Postgres (12+) lets ALTER TYPE ... ADD VALUE run inside
-- a transaction, but refuses to *use* the new value in that same
-- transaction. The bootstrap applies each file as one transaction, so
-- nothing below names 'payout_approved' as a bet_status: the aggregates
-- compare `status::text`, and the trigger is plpgsql, whose body is not
-- resolved until it runs. The partial index bets_hole_claimed_idx
-- (migration 013) keeps its old predicate; a query that includes the new
-- state falls back to bets_status_created_idx, which is fine at this size.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. The status, and who approved the payout
-- ----------------------------------------------------------------
alter type public.bet_status add value if not exists 'payout_approved' before 'paid';

alter table public.bets
  add column if not exists payout_approved_by uuid references auth.users (id) on delete set null,
  add column if not exists payout_approved_at timestamptz;

comment on column public.bets.payout_approved_by is
  'auth.users id of the admin who approved the payout (verified → payout_approved). A different admin must mark it paid.';
comment on column public.bets.payout_approved_at is
  'When the payout was approved. Set with payout_approved_by.';

-- ----------------------------------------------------------------
-- 2. Backstop: paid needs an approver, and not the same person
--
-- The app checks this first and answers 409 SECOND_APPROVER_REQUIRED.
-- The trigger is for anything that reaches the table another way.
-- ----------------------------------------------------------------
create or replace function public.enforce_payout_second_approver()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status::text = 'paid' and old.status::text <> 'paid' then
    if new.payout_approved_by is null then
      raise exception 'A payout must be approved before it is marked paid.'
        using errcode = 'P0001';
    end if;
    if new.updated_by is not null and new.updated_by = new.payout_approved_by then
      raise exception 'A different admin must mark the payout as paid.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bets_payout_second_approver on public.bets;
create trigger trg_bets_payout_second_approver
  before update of status on public.bets
  for each row execute function public.enforce_payout_second_approver();

-- ----------------------------------------------------------------
-- 3. Aggregates: a payout waiting for its second signature is still owed,
--    and still a claim. Bodies otherwise as in 033, 029 and 027.
-- ----------------------------------------------------------------
create or replace function public.admin_totals()
returns json
language sql
security definer set search_path = public
stable
as $$
  select json_build_object(
    'total_revenue_cents',     coalesce((select sum(stake_pence) from public.bets), 0),
    'total_payout_cents',      coalesce((select sum(potential_win_pence) from public.bets where status = 'paid' and prize_currency = 'ZAR'), 0),
    'total_payout_usd_cents',  coalesce((select sum(potential_win_pence) from public.bets where status = 'paid' and prize_currency = 'USD'), 0),
    'total_bets',              (select count(*) from public.bets),
    'active_bets',             (select count(*) from public.bets where status = 'active' and (expires_at is null or expires_at > now())),
    'expired_bets',            (select count(*) from public.bets where status = 'active' and expires_at <= now()),
    'pending_claims',          (select count(*) from public.verifications where status in ('pending', 'documents_received', 'under_review')),
    'claims_to_review',        (select count(*) from public.verifications where status in ('documents_received', 'under_review')),
    'claims_waiting',          (select count(*) from public.verifications where status = 'pending'),
    'prizes_owed_cents',       coalesce((select sum(potential_win_pence) from public.bets where status::text in ('verified', 'payout_approved') and prize_currency = 'ZAR'), 0),
    'prizes_owed_usd_cents',   coalesce((select sum(potential_win_pence) from public.bets where status::text in ('verified', 'payout_approved') and prize_currency = 'USD'), 0),
    'payouts_awaiting_second_approver', (select count(*) from public.bets where status::text = 'payout_approved'),
    'total_users',             (select count(*) from public.profiles)
  );
$$;

revoke execute on function public.admin_totals() from public, anon, authenticated;
grant  execute on function public.admin_totals() to service_role;

create or replace function public.admin_golf_day_usage()
returns table (golf_day_id uuid, players bigint, swings bigint, claimed bigint)
language sql
security definer set search_path = public
stable
as $$
  select d.id,
         (select count(*) from public.golf_day_players p where p.golf_day_id = d.id),
         (select count(*) from public.bets b where b.golf_day_id = d.id),
         (select count(*) from public.bets b
           where b.golf_day_id = d.id and b.status::text in ('claimed', 'verified', 'payout_approved', 'paid'))
    from public.golf_days d;
$$;

revoke execute on function public.admin_golf_day_usage() from public, anon, authenticated;
grant  execute on function public.admin_golf_day_usage() to service_role;

create or replace function public.admin_promo_code_usage()
returns table (promo_code_id uuid, uses bigint, claimed bigint, converted bigint)
language sql
security definer set search_path = public
stable
as $$
  -- One row per golfer per code: the unique index from migration 027 guarantees it.
  select p.promo_code_id,
         count(*),
         count(*) filter (where p.status::text in ('claimed', 'verified', 'payout_approved', 'paid')),
         count(*) filter (where exists (
           select 1 from public.bets b
            where b.user_id = p.user_id
              and b.stake_pence > 0
              and b.created_at > p.created_at
         ))
    from public.bets p
   where p.promo_code_id is not null
   group by p.promo_code_id;
$$;

revoke execute on function public.admin_promo_code_usage() from public, anon, authenticated;
grant  execute on function public.admin_promo_code_usage() to service_role;

create or replace function public.admin_free_swing_funnel()
returns json
language sql
security definer set search_path = public
stable
as $$
  with free as (
    -- One row per golfer: the unique index from migration 023 guarantees it.
    select user_id, created_at, status
      from public.bets
     where tier = 'tier_free'
  ),
  first_paid as (
    select f.user_id, min(b.created_at) as first_paid_at
      from free f
      join public.bets b
        on b.user_id = f.user_id
       and b.stake_pence > 0
       and b.created_at > f.created_at
     group by f.user_id
  )
  select json_build_object(
    'taken',     (select count(*) from free),
    'taken_7d',  (select count(*) from free where created_at >= now() - interval '7 days'),
    'taken_30d', (select count(*) from free where created_at >= now() - interval '30 days'),
    -- Swings old enough for the seven-day window to have closed.
    'matured',   (select count(*) from free where created_at <= now() - interval '7 days'),
    'converted_7d', (
      select count(*)
        from free f
        join first_paid p on p.user_id = f.user_id
       where f.created_at <= now() - interval '7 days'
         and p.first_paid_at <= f.created_at + interval '7 days'
    ),
    -- No window: everyone who came in free and has since staked anything.
    'converted_ever', (select count(*) from first_paid),
    'paid_bets_after_free', (
      select count(*)
        from public.bets b
        join free f on f.user_id = b.user_id
       where b.stake_pence > 0 and b.created_at > f.created_at
    ),
    'revenue_after_free_cents', (
      select coalesce(sum(b.stake_pence), 0)
        from public.bets b
        join free f on f.user_id = b.user_id
       where b.stake_pence > 0 and b.created_at > f.created_at
    ),
    -- The liability side: free swings that went in and became a claim.
    'claimed', (select count(*) from free where status::text in ('claimed', 'verified', 'payout_approved', 'paid')),
    'median_hours_to_first_paid', (
      select percentile_cont(0.5) within group (
               order by extract(epoch from (p.first_paid_at - f.created_at)) / 3600
             )
        from free f join first_paid p on p.user_id = f.user_id
    )
  );
$$;

revoke execute on function public.admin_free_swing_funnel() from public, anon, authenticated;
grant  execute on function public.admin_free_swing_funnel() to service_role;

-- ----------------------------------------------------------------
-- 4. Verify: the enum has the value in the right place, the columns and
--    the trigger exist, and the totals still compute.
-- ----------------------------------------------------------------
select enumlabel, enumsortorder
  from pg_enum
 where enumtypid = 'public.bet_status'::regtype
 order by enumsortorder;
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'bets'
   and column_name in ('payout_approved_by', 'payout_approved_at')
 order by column_name;
select (select count(*) from pg_trigger where tgname = 'trg_bets_payout_second_approver') as trigger_installed,
       public.admin_totals() as totals;
