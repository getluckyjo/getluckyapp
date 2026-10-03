-- ================================================================
-- 033 — Golf trips: one link for a tour of several days
--
-- A golf day (029) is one day, one swing each, one rand prize. A golf
-- trip is a golf day that runs over several days, with a free swing for
-- each player in every round, on that round's hole, and a prize that can
-- be in dollars. Random Golf Club's South Africa trip is the first: Cape
-- Town, 14–21 February 2027, a swing a round on each course's signature
-- par 3, for $5 000.
--
--   golf_days.ends_on        the trip's last day; null for a golf day of
--                            one day. Swings and joining run from plays_on
--                            to ends_on, South African time.
--   golf_days.prize_currency 'ZAR' (every golf day so far) or 'USD'.
--                            prize_pence is in that currency's cents.
--   golf_day_holes.plays_on  the date of the round a trip's hole is played
--                            in. Its swing opens on that date only. Null
--                            on a golf day of one day.
--   bets.prize_currency      the currency of potential_win_pence. 'ZAR'
--                            for every bet but a golf trip's.
--   bets.golf_day_slot       what the one-swing rule counts, set by the
--                            swing trigger: 'day' on a golf day (one swing
--                            each, as before), the hole on a trip (one
--                            swing each per round).
--
-- The rules stay the database's:
--
--   one swing per player per golf day,    unique index on
--     or per round of a trip              bets (golf_day_id, user_id, golf_day_slot)
--   a trip's hole only on its round's     BEFORE INSERT trigger on bets
--     date; the trip's prize, in its      (enforce_golf_day_swing, replaced)
--     currency
--   joining closes after the last day     BEFORE INSERT trigger on
--                                         golf_day_players (replaced)
--   only a golf day swing can be in a     check constraint on bets
--     currency other than rand
--
-- A refused insert raises P0001 with a GOLF_DAY_* message, as in 029. New:
-- GOLF_DAY_WRONG_DAY (that hole's round is another day).
--
-- The admin totals and the payout by tier (010, 032) add up rand only; a
-- dollar prize is reported apart (total_payout_usd_cents,
-- prizes_owed_usd_cents), never added to rand.
--
-- Every existing golf day keeps working as it did: no end date, rand, one
-- prize, one swing each (its swings are backfilled with the slot 'day').
-- Must run after 029. Additive. Idempotent.
-- ================================================================

-- ----------------------------------------------------------------
-- Golf days: an end date and a currency
-- ----------------------------------------------------------------
alter table public.golf_days
  add column if not exists ends_on        date,
  add column if not exists prize_currency text not null default 'ZAR';

alter table public.golf_days drop constraint if exists golf_days_ends_on_check;
alter table public.golf_days
  add constraint golf_days_ends_on_check
  check (ends_on is null or ends_on between plays_on + 1 and plays_on + 30);

alter table public.golf_days drop constraint if exists golf_days_prize_currency_check;
alter table public.golf_days
  add constraint golf_days_prize_currency_check
  check (prize_currency in ('ZAR', 'USD'));

comment on column public.golf_days.ends_on is
  'A golf trip''s last day (029 golf days are one day: null). Joining and swings run plays_on to ends_on, South African time.';
comment on column public.golf_days.prize_currency is
  'ZAR or USD. prize_pence and the swings'' potential_win_pence are in its cents.';

-- ----------------------------------------------------------------
-- A trip's holes, each on its round's date
-- ----------------------------------------------------------------
alter table public.golf_day_holes add column if not exists plays_on date;

comment on column public.golf_day_holes.plays_on is
  'The date of the round this hole is played in, on a golf trip; its swing opens that day only. Null on a golf day of one day.';

-- ----------------------------------------------------------------
-- Joining closes after a trip's last day
-- ----------------------------------------------------------------
create or replace function public.enforce_golf_day_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day     public.golf_days%rowtype;
  v_players bigint;
begin
  -- Lock first, count second, so two players taking the last place at once
  -- are queued and the second is refused.
  select * into v_day from public.golf_days where id = new.golf_day_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_NOT_FOUND';
  end if;
  if v_day.disabled_at is not null then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_CLOSED';
  end if;
  if now() >= ((coalesce(v_day.ends_on, v_day.plays_on) + 1)::timestamp at time zone 'Africa/Johannesburg') then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_OVER';
  end if;

  select count(*) into v_players from public.golf_day_players where golf_day_id = new.golf_day_id;
  if v_players >= v_day.max_players then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_FULL',
      detail = format('%s of %s places taken', v_players, v_day.max_players);
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------
-- Bets: the prize's currency, and what the one-swing rule counts
-- ----------------------------------------------------------------
alter table public.bets
  add column if not exists prize_currency text not null default 'ZAR',
  add column if not exists golf_day_slot  text;

comment on column public.bets.prize_currency is
  'The currency of potential_win_pence: ZAR, or a golf trip''s USD. Every bet outside a golf day is ZAR.';
comment on column public.bets.golf_day_slot is
  'Set by enforce_golf_day_swing: ''day'' on a golf day (one swing each), the hole id on a golf trip (one swing each per round). Null outside golf days.';

alter table public.bets drop constraint if exists bets_prize_currency_check;
alter table public.bets
  add constraint bets_prize_currency_check
  check (prize_currency in ('ZAR', 'USD') and (prize_currency = 'ZAR' or golf_day_id is not null));

update public.bets set golf_day_slot = 'day' where golf_day_id is not null and golf_day_slot is null;

alter table public.bets drop constraint if exists bets_golf_day_slot_check;
alter table public.bets
  add constraint bets_golf_day_slot_check
  check ((golf_day_id is null) = (golf_day_slot is null));

-- The new rule before the old one goes, so there is never a moment without one.
create unique index if not exists bets_one_swing_per_golf_day_slot
  on public.bets (golf_day_id, user_id, golf_day_slot)
  where golf_day_id is not null;
drop index if exists public.bets_one_swing_per_golf_day_player;

create or replace function public.enforce_golf_day_swing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    public.golf_days%rowtype;
  v_hole   public.golf_day_holes%rowtype;
  v_today  date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if new.golf_day_id is null then
    return new;
  end if;

  select * into v_day from public.golf_days where id = new.golf_day_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_NOT_FOUND';
  end if;
  if v_day.disabled_at is not null then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_CLOSED';
  end if;
  if now() < (v_day.plays_on::timestamp at time zone 'Africa/Johannesburg') then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_NOT_YET';
  end if;
  if now() >= ((coalesce(v_day.ends_on, v_day.plays_on) + 1)::timestamp at time zone 'Africa/Johannesburg') then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_OVER';
  end if;

  if not exists (select 1 from public.golf_day_players
                  where golf_day_id = new.golf_day_id and user_id = new.user_id) then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_NOT_JOINED';
  end if;

  select * into v_hole from public.golf_day_holes
   where golf_day_id = new.golf_day_id and hole_id = new.hole_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_WRONG_HOLE';
  end if;
  if v_hole.plays_on is not null and v_hole.plays_on <> v_today then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_WRONG_DAY';
  end if;

  if new.stake_pence <> 0
     or new.potential_win_pence <> v_day.prize_pence
     or new.prize_currency <> v_day.prize_currency then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_WRONG_PRIZE';
  end if;

  new.golf_day_slot := case when v_day.ends_on is null then 'day' else new.hole_id::text end;
  return new;
end;
$$;

-- ----------------------------------------------------------------
-- Admin totals: rand stays rand; dollars are counted apart
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
    'prizes_owed_cents',       coalesce((select sum(potential_win_pence) from public.bets where status = 'verified' and prize_currency = 'ZAR'), 0),
    'prizes_owed_usd_cents',   coalesce((select sum(potential_win_pence) from public.bets where status = 'verified' and prize_currency = 'USD'), 0),
    'total_users',             (select count(*) from public.profiles)
  );
$$;

revoke execute on function public.admin_totals() from public, anon, authenticated;
grant  execute on function public.admin_totals() to service_role;

create or replace function public.admin_revenue_by_tier()
returns table (tier text, bet_count bigint, revenue_cents bigint, payout_cents bigint)
language sql
security definer set search_path = public
stable
as $$
  select tier::text,
         count(*),
         coalesce(sum(stake_pence), 0),
         coalesce(sum(potential_win_pence) filter (where status = 'paid' and prize_currency = 'ZAR'), 0)
    from public.bets
   group by tier;
$$;

revoke execute on function public.admin_revenue_by_tier() from public, anon, authenticated;
grant  execute on function public.admin_revenue_by_tier() to service_role;

-- Verify: every golf day as a trip or a day, its currency, and
-- every swing's slot (expect 'day' for each swing taken before this ran).
select d.slug, d.plays_on, d.ends_on, d.prize_currency, d.prize_pence,
       (select count(*) from public.bets b where b.golf_day_id = d.id) as swings,
       (select count(*) from public.bets b where b.golf_day_id = d.id and b.golf_day_slot = 'day') as day_slots
  from public.golf_days d
 order by d.plays_on desc, d.slug;
