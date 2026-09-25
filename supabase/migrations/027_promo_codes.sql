-- ================================================================
-- 027 — Promo codes: one extra free swing per code
--
--   promo_codes          the codes. Each has a cap on its total uses and an
--                        expiry date, and can be switched off. Made and
--                        edited at /admin/promos; no deploy needed.
--   bets.promo_code_id   the code a promo swing ('tier_promo', migration
--                        026) was played on. The promo swing IS the
--                        redemption: there is no separate table of uses to
--                        drift out of step with the bets.
--
-- The rules are held here, not by the route that hands the swing out:
--
--   one use of a code per golfer    unique index on (promo_code_id, user_id)
--   a promo swing names its code,   check constraint
--     and only a promo swing does
--   the cap, the expiry, the off    BEFORE INSERT trigger on bets. It locks
--     switch                        the code row before counting, so two
--                                   golfers taking the last use at the same
--                                   moment are queued and the second is
--                                   refused.
--
-- A refused insert raises P0001 with one of PROMO_CODE_INVALID,
-- PROMO_CODE_DISABLED, PROMO_CODE_EXPIRED or PROMO_CODE_EXHAUSTED as the
-- message; /api/bets/promo turns those into the golfer's answer.
--
-- Also here: the free swing report (migration 024) counted every bet that
-- was not 'tier_free' as a paid one. A promo swing is not paid, so both
-- functions now count only bets with a stake. Before this migration the
-- two definitions pick out the same rows.
--
-- Reads: service role only (a golfer never lists codes; the route checks
-- one for them). Writes: service role, through /api/admin/promos.
-- Must run after 026. Additive. Idempotent.
-- ================================================================

create table if not exists public.promo_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9-]{4,40}$'),
  max_uses     integer not null check (max_uses between 1 and 100000),
  expires_at   timestamptz not null,
  note         text check (note is null or char_length(note) <= 200),
  disabled_at  timestamptz,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.promo_codes is
  'Promo codes, each worth one extra free swing (tier_promo) per golfer, up to max_uses in total and until expires_at. Managed at /admin/promos.';

alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

-- ----------------------------------------------------------------
-- The bet side
-- ----------------------------------------------------------------
alter table public.bets
  add column if not exists promo_code_id uuid references public.promo_codes on delete restrict;

comment on column public.bets.promo_code_id is
  'The promo code a tier_promo bet was played on; null for every other bet. A code that has been used cannot be deleted, only switched off.';

create unique index if not exists bets_one_promo_swing_per_code_per_user
  on public.bets (promo_code_id, user_id)
  where promo_code_id is not null;

comment on index public.bets_one_promo_swing_per_code_per_user is
  'One swing per code per golfer. Also what the per-code use count reads.';

alter table public.bets drop constraint if exists bets_promo_code_matches_tier;
alter table public.bets
  add constraint bets_promo_code_matches_tier
  check ((tier = 'tier_promo') = (promo_code_id is not null));

create or replace function public.enforce_promo_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.promo_codes%rowtype;
  v_used bigint;
begin
  if new.promo_code_id is null then
    return new;
  end if;

  -- Lock first, count second. A second golfer redeeming the same code waits
  -- here until the first commits, and its count then includes that bet.
  select * into v_code from public.promo_codes where id = new.promo_code_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROMO_CODE_INVALID';
  end if;
  if v_code.disabled_at is not null then
    raise exception using errcode = 'P0001', message = 'PROMO_CODE_DISABLED';
  end if;
  if v_code.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'PROMO_CODE_EXPIRED';
  end if;

  select count(*) into v_used from public.bets where promo_code_id = new.promo_code_id;
  if v_used >= v_code.max_uses then
    raise exception using errcode = 'P0001', message = 'PROMO_CODE_EXHAUSTED',
      detail = format('%s of %s uses taken', v_used, v_code.max_uses);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bets_enforce_promo_code on public.bets;
create trigger trg_bets_enforce_promo_code
  before insert on public.bets
  for each row execute function public.enforce_promo_code();

-- ----------------------------------------------------------------
-- /admin/promos: per code, how many used it, how many of those swings
-- became a claim, and how many of those golfers have staked since.
-- Exact counts in SQL, as the other admin aggregates are (migration 010).
-- ----------------------------------------------------------------
create or replace function public.admin_promo_code_usage()
returns table (promo_code_id uuid, uses bigint, claimed bigint, converted bigint)
language sql
security definer set search_path = public
stable
as $$
  -- One row per golfer per code: the unique index above guarantees it.
  select p.promo_code_id,
         count(*),
         count(*) filter (where p.status in ('claimed', 'verified', 'paid')),
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

-- ----------------------------------------------------------------
-- Migration 024's two functions, with "paid" meaning a bet with a stake
-- (it read "any bet that is not tier_free", which a promo swing now is).
-- Otherwise unchanged.
-- ----------------------------------------------------------------
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
    'claimed', (select count(*) from free where status in ('claimed', 'verified', 'paid')),
    'median_hours_to_first_paid', (
      select percentile_cont(0.5) within group (
               order by extract(epoch from (p.first_paid_at - f.created_at)) / 3600
             )
        from free f join first_paid p on p.user_id = f.user_id
    )
  );
$$;

create or replace function public.admin_free_swing_by_week()
returns table (week_start date, taken bigint, matured bigint, converted_7d bigint)
language sql
security definer set search_path = public
stable
as $$
  with free as (
    select user_id, created_at
      from public.bets
     where tier = 'tier_free'
       and created_at >= date_trunc('week', now() - interval '12 weeks')
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
  select date_trunc('week', f.created_at)::date,
         count(*),
         count(*) filter (where f.created_at <= now() - interval '7 days'),
         count(*) filter (
           where f.created_at <= now() - interval '7 days'
             and p.first_paid_at is not null
             and p.first_paid_at <= f.created_at + interval '7 days'
         )
    from free f
    left join first_paid p on p.user_id = f.user_id
   group by 1
   order by 1 desc;
$$;

revoke execute on function public.admin_free_swing_funnel()  from public, anon, authenticated;
revoke execute on function public.admin_free_swing_by_week() from public, anon, authenticated;
grant  execute on function public.admin_free_swing_funnel()  to service_role;
grant  execute on function public.admin_free_swing_by_week() to service_role;

-- Verify
select to_regclass('public.promo_codes') as promo_codes,
       to_regclass('public.bets_one_promo_swing_per_code_per_user') as one_per_code_per_user,
       (select count(*) from pg_trigger where tgname = 'trg_bets_enforce_promo_code') as trigger_installed;
select * from public.admin_promo_code_usage();
select public.admin_free_swing_funnel();
