-- ================================================================
-- 038 — Prize exposure: a join code on golf days, a daily cap on free swings
--
-- Two ways the free prizes could be farmed, closed at the database:
--
--   golf_days.join_code   A golf day's link is a WhatsApp message, and a
--                         WhatsApp message gets forwarded. With a code set,
--                         joining needs it too (4 to 12 capitals and digits,
--                         compared case-insensitively by the join route). The
--                         code is the organiser's to hand out on the day, not
--                         in the message. Null, the golf day works as before.
--                         The GET for a golf day says only whether a code is
--                         needed; the code itself reaches the admin alone.
--
--   free_swing_caps       One row (id = 1). Each account's one free swing is
--                         a real R10,000 prize with nothing behind it, and
--                         there was no limit on how many of them a day could
--                         hand out. Now: at most daily_cap free swings a day
--                         (South African date), and a pause switch for when
--                         something is wrong. Set at /admin (Free swings) and
--                         through /api/admin/free-swings; no deploy involved.
--                         (The route also honours FREE_SWING_PAUSED=on in the
--                         environment, for the day the database is the problem.)
--
-- The cap is held by a BEFORE INSERT trigger on bets: it locks the caps row
-- before counting, so two golfers taking the last free swing of the day at
-- the same moment are queued and the second is refused. A refused insert
-- raises P0001 with FREE_SWING_CAP or FREE_SWING_PAUSED; /api/bets/free
-- turns those into the golfer's answer (503, try again tomorrow).
--
-- Also from this change, in code: a golf day swing recorded further than
-- the far_from_course threshold from its course is refused at claim time
-- (403 CAPTURE_FAR_FROM_COURSE), where for every other entry it stays a
-- flag for the reviewer.
--
-- Must run after 033 (golf_days) and 022 (tier_free). Additive. Idempotent.
-- ================================================================

-- ----------------------------------------------------------------
-- Golf days: an optional join code
-- ----------------------------------------------------------------
alter table public.golf_days add column if not exists join_code text;

alter table public.golf_days drop constraint if exists golf_days_join_code_check;
alter table public.golf_days
  add constraint golf_days_join_code_check
  check (join_code is null or join_code ~ '^[A-Z0-9]{4,12}$');

comment on column public.golf_days.join_code is
  'When set, joining through the link needs this code too (4–12 capitals and digits; typed case does not matter). Null: anyone with the link can join, as before.';

-- ----------------------------------------------------------------
-- Free swings: the daily cap and the pause switch
-- ----------------------------------------------------------------
create table if not exists public.free_swing_caps (
  id          integer primary key default 1 check (id = 1),
  daily_cap   integer not null default 500 check (daily_cap between 0 and 100000),
  paused      boolean not null default false,
  updated_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.free_swing_caps is
  'One row: how many free swings (tier_free) a day may be granted, South African date, and whether they are paused. Enforced by enforce_free_swing_cap() on bets. Set at /admin.';

insert into public.free_swing_caps (id) values (1) on conflict (id) do nothing;

alter table public.free_swing_caps enable row level security;
revoke all on public.free_swing_caps from anon, authenticated;

create or replace function public.enforce_free_swing_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caps  public.free_swing_caps%rowtype;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_taken bigint;
begin
  if new.tier <> 'tier_free' then
    return new;
  end if;

  -- Lock first, count second. Two golfers taking the last free swing of the
  -- day at once are queued here, and the second one's count includes the first.
  select * into v_caps from public.free_swing_caps where id = 1 for update;
  if not found then
    -- No row: nothing has been set, so nothing is capped.
    return new;
  end if;
  if v_caps.paused then
    raise exception using errcode = 'P0001', message = 'FREE_SWING_PAUSED';
  end if;

  select count(*) into v_taken
    from public.bets
   where tier = 'tier_free'
     and (created_at at time zone 'Africa/Johannesburg')::date = v_today;
  if v_taken >= v_caps.daily_cap then
    raise exception using errcode = 'P0001', message = 'FREE_SWING_CAP',
      detail = format('%s of %s free swings taken on %s', v_taken, v_caps.daily_cap, v_today);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bets_enforce_free_swing_cap on public.bets;
create trigger trg_bets_enforce_free_swing_cap
  before insert on public.bets
  for each row execute function public.enforce_free_swing_cap();

-- Verify: the column, the caps row as it stands, and the trigger.
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'golf_days' and column_name = 'join_code') as join_code_column,
       (select daily_cap from public.free_swing_caps where id = 1) as daily_cap,
       (select paused from public.free_swing_caps where id = 1) as paused,
       (select count(*) from pg_trigger where tgname = 'trg_bets_enforce_free_swing_cap') as trigger_installed,
       (select count(*) from public.bets
         where tier = 'tier_free'
           and (created_at at time zone 'Africa/Johannesburg')::date = (now() at time zone 'Africa/Johannesburg')::date) as free_swings_today;
