-- ================================================================
-- 029 — Golf days: one free swing per player at a sponsored golf day
--
--   golf_days          one row per golf day we sponsor: its link (slug),
--                      the name its players see on their tab, the day it
--                      is played, the prize and how many players it takes.
--                      Made and edited at /admin/golf-days.
--   golf_day_holes     the par 3s the swing can be played on (one per
--                      course when a day is played over two courses).
--   golf_day_players   who joined through the golf day's link. Only they
--                      see the golf day tab, and only they get the swing.
--   bets.golf_day_id   the golf day a swing ('tier_golf_day', migration
--                      028) was played at.
--
-- The rules are held here, not by the routes:
--
--   never more players than the day takes   BEFORE INSERT trigger on
--     (and no joining once it is over)      golf_day_players: locks the
--                                           golf day row, then counts
--   one swing per player                    unique index on
--                                           bets (golf_day_id, user_id)
--   only a joined player, only on the day   BEFORE INSERT trigger on bets
--     (South African time), only on the
--     day's holes, only for the day's prize
--   a golf day swing names its golf day,    check constraint
--     and nothing else does
--
-- A refused insert raises P0001 with a GOLF_DAY_* message; the routes turn
-- those into the player's answer.
--
-- Also here:
--   * The Bomb Squad Golf Day: Royal Johannesburg, Friday 2 October 2026,
--     R100 000, 200 players, on a signature par 3 of about 150 m on each
--     course: East 16 (152 m, over water) and West 7 (144 m, over water).
--   * The West course's par 3s, corrected to the yellow tees on the club's
--     2024 card (4: 178 m, 7: 144 m, 14: 105 m, 17: 185 m). Only rows still
--     carrying migration 019's numbers change; an edit made in the admin
--     since is left alone. The East course already matches the club tees.
--
-- Reads and writes: service role only, through /api/golf-days and
-- /api/admin/golf-days. Must run after 028. Additive. Idempotent.
-- ================================================================

create table if not exists public.golf_days (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name         text not null check (char_length(name) between 1 and 80),
  tab_label    text not null check (char_length(tab_label) between 1 and 12),
  plays_on     date not null,
  prize_pence  integer not null check (prize_pence between 100 and 100000000),
  max_players  integer not null check (max_players between 1 and 5000),
  note         text check (note is null or char_length(note) <= 200),
  disabled_at  timestamptz,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.golf_days is
  'Sponsored golf days. Each joined player gets one free swing (tier_golf_day) on plays_on (South African time), on the golf day''s holes, for prize_pence. Managed at /admin/golf-days.';

create table if not exists public.golf_day_holes (
  golf_day_id  uuid not null references public.golf_days on delete cascade,
  hole_id      uuid not null references public.holes on delete restrict,
  primary key (golf_day_id, hole_id)
);

create table if not exists public.golf_day_players (
  golf_day_id  uuid not null references public.golf_days on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (golf_day_id, user_id)
);

create index if not exists golf_day_players_user_id_idx on public.golf_day_players (user_id);

alter table public.golf_days        enable row level security;
alter table public.golf_day_holes   enable row level security;
alter table public.golf_day_players enable row level security;
revoke all on public.golf_days, public.golf_day_holes, public.golf_day_players from anon, authenticated;

-- ----------------------------------------------------------------
-- Joining: capped, and closed once the day is over
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
  if now() >= ((v_day.plays_on + 1)::timestamp at time zone 'Africa/Johannesburg') then
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

drop trigger if exists trg_golf_day_players_enforce_join on public.golf_day_players;
create trigger trg_golf_day_players_enforce_join
  before insert on public.golf_day_players
  for each row execute function public.enforce_golf_day_join();

-- ----------------------------------------------------------------
-- The swing
-- ----------------------------------------------------------------
alter table public.bets
  add column if not exists golf_day_id uuid references public.golf_days on delete restrict;

comment on column public.bets.golf_day_id is
  'The golf day a tier_golf_day bet was played at; null for every other bet. A golf day with swings cannot be deleted, only switched off.';

create unique index if not exists bets_one_swing_per_golf_day_player
  on public.bets (golf_day_id, user_id)
  where golf_day_id is not null;

alter table public.bets drop constraint if exists bets_golf_day_matches_tier;
alter table public.bets
  add constraint bets_golf_day_matches_tier
  check ((tier = 'tier_golf_day') = (golf_day_id is not null));

create or replace function public.enforce_golf_day_swing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day public.golf_days%rowtype;
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
  if now() >= ((v_day.plays_on + 1)::timestamp at time zone 'Africa/Johannesburg') then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_OVER';
  end if;
  if not exists (select 1 from public.golf_day_players
                  where golf_day_id = new.golf_day_id and user_id = new.user_id) then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_NOT_JOINED';
  end if;
  if not exists (select 1 from public.golf_day_holes
                  where golf_day_id = new.golf_day_id and hole_id = new.hole_id) then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_WRONG_HOLE';
  end if;
  if new.stake_pence <> 0 or new.potential_win_pence <> v_day.prize_pence then
    raise exception using errcode = 'P0001', message = 'GOLF_DAY_WRONG_PRIZE';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bets_enforce_golf_day on public.bets;
create trigger trg_bets_enforce_golf_day
  before insert on public.bets
  for each row execute function public.enforce_golf_day_swing();

-- ----------------------------------------------------------------
-- /admin/golf-days: players joined, swings taken, swings claimed.
-- ----------------------------------------------------------------
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
           where b.golf_day_id = d.id and b.status in ('claimed', 'verified', 'paid'))
    from public.golf_days d;
$$;

revoke execute on function public.admin_golf_day_usage() from public, anon, authenticated;
grant  execute on function public.admin_golf_day_usage() to service_role;

-- ----------------------------------------------------------------
-- Royal Johannesburg West: par 3s from the club's 2024 card, yellow tees.
-- ----------------------------------------------------------------
update public.holes h
   set distance_metres = v.club_tee
  from (values (4, 186, 178), (7, 139, 144), (14, 104, 105), (17, 176, 185))
         as v (hole_number, seeded, club_tee),
       public.courses c
 where c.id = h.course_id
   and lower(c.name) = lower('Royal Johannesburg & Kensington – West')
   and h.hole_number = v.hole_number
   and h.distance_metres = v.seeded;

-- ----------------------------------------------------------------
-- The Bomb Squad Golf Day
-- ----------------------------------------------------------------
insert into public.golf_days (slug, name, tab_label, plays_on, prize_pence, max_players, note)
values ('bombsquad', 'Bomb Squad Golf Day', 'Bomb Squad', date '2026-10-02', 10000000, 200,
        'Royal Johannesburg, East and West. Prize covered by Get Lucky.')
on conflict (slug) do nothing;

insert into public.golf_day_holes (golf_day_id, hole_id)
select d.id, h.id
  from public.golf_days d
  join public.courses c
    on (lower(c.name) = lower('Royal Johannesburg & Kensington – East'))
    or (lower(c.name) = lower('Royal Johannesburg & Kensington – West'))
  join public.holes h on h.course_id = c.id
 where d.slug = 'bombsquad'
   and (   (lower(c.name) = lower('Royal Johannesburg & Kensington – East') and h.hole_number = 16)
        or (lower(c.name) = lower('Royal Johannesburg & Kensington – West') and h.hole_number = 7))
on conflict do nothing;

-- Verify: the golf day, and its two holes (expect East 16 at 152 m and West 7 at
-- 144 m, both par 3, active, at partner courses). West 7 reads 144 only once the
-- correction above has applied; at 139 m it would be under the 140 m minimum and
-- the swing there would be refused.
select d.slug, d.name, d.plays_on, d.prize_pence / 100 as prize_rand, d.max_players,
       c.name as course, h.hole_number, h.par, h.distance_metres, h.is_active, c.is_partner
  from public.golf_days d
  join public.golf_day_holes gh on gh.golf_day_id = d.id
  join public.holes h on h.id = gh.hole_id
  join public.courses c on c.id = h.course_id
 where d.slug = 'bombsquad'
 order by c.name;
