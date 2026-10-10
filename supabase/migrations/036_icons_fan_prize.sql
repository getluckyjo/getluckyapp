-- ================================================================
-- 036 — The fan prize: picks close at first tee, the backer list is
--       frozen and hashed, and the draw is reproducible.
--
-- Why. Three R1m prizes go to fans who backed the Icon who holes it at
-- Icons Cup South Africa. Until now a pick could be changed at any time,
-- including seconds after the ace, no history of picks was kept, deleting
-- an Icon in the admin cascaded through every pick for them, and nothing
-- drew the winners. Indwe and the public need to see who had backed the
-- Icon when the ball dropped, and that the three names came from that list
-- by a method anyone can re-run.
--
--   icon_events           the event: first tee (picks close), when the
--                         backer list was frozen and its SHA-256, the
--                         winning Icon, the draw seed, when it was drawn.
--   icon_vote_events      append-only log of every pick, change and
--                         removal on icon_votes, written by trigger.
--   icon_vote_snapshot    the backer list as frozen: one row per golfer
--                         with the Icon they backed and whether they were
--                         eligible (18+, not staff, not suspended). The
--                         hash on icon_events is over these rows.
--   fan_prize_winners     the drawn names, in order, with the rank each
--                         was given by the seeded draw.
--   icon_vote_counts      a view: backers per Icon, so the public route
--                         stops reading every vote row (PostgREST caps a
--                         read at 1,000 rows; counts were going to freeze
--                         there).
--
-- Also: icon_votes.icon_id no longer cascades; an Icon with picks cannot
-- be deleted, only hidden. And a trigger refuses any pick once the event
-- is frozen or first tee has passed, whatever route tries.
--
-- Additive. Idempotent. Apply before deploying the code that reads it.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. An Icon with picks cannot be deleted
-- ----------------------------------------------------------------
alter table public.icon_votes drop constraint if exists icon_votes_icon_id_fkey;
alter table public.icon_votes
  add constraint icon_votes_icon_id_fkey
  foreign key (icon_id) references public.icons (id) on delete restrict;

-- ----------------------------------------------------------------
-- 2. A generic append-only guard (claim_events has its own; this one
--    names the table it is on)
-- ----------------------------------------------------------------
create or replace function public.append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

revoke execute on function public.append_only() from public, anon, authenticated;

-- ----------------------------------------------------------------
-- 3. The event
-- ----------------------------------------------------------------
create table if not exists public.icon_events (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name             text not null check (char_length(name) between 1 and 120),
  first_tee_at     timestamptz,
  winners_count    integer not null default 3 check (winners_count between 1 and 100),
  frozen_at        timestamptz,
  frozen_by        uuid references auth.users on delete set null,
  snapshot_sha256  text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_count   integer,
  winning_icon_id  uuid references public.icons on delete restrict,
  draw_seed        text check (draw_seed is null or char_length(draw_seed) between 8 and 200),
  draw_sha256      text check (draw_sha256 is null or draw_sha256 ~ '^[0-9a-f]{64}$'),
  drawn_at         timestamptz,
  drawn_by         uuid references auth.users on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint icon_events_frozen_complete check (
    (frozen_at is null and snapshot_sha256 is null and snapshot_count is null)
    or (frozen_at is not null and snapshot_sha256 is not null and snapshot_count is not null)
  ),
  constraint icon_events_drawn_complete check (
    (drawn_at is null and winning_icon_id is null and draw_seed is null and draw_sha256 is null)
    or (drawn_at is not null and winning_icon_id is not null and draw_seed is not null and draw_sha256 is not null and frozen_at is not null)
  )
);

comment on table public.icon_events is
  'The event the fan pick is for. Picks close at first_tee_at or when frozen_at is set, whichever comes first. snapshot_sha256 is the SHA-256 of the frozen backer list (icon_vote_snapshot); draw_seed and draw_sha256 make the draw reproducible. Managed at /admin/icons.';

alter table public.icon_events enable row level security;
revoke all on public.icon_events from anon, authenticated;

drop trigger if exists trg_icon_events_touch on public.icon_events;
create trigger trg_icon_events_touch
  before update on public.icon_events
  for each row execute function public.touch_updated_at();

-- Icons Cup South Africa, The Links at Fancourt, 11–13 December 2026.
-- First tee is a placeholder (07:00 SAST on the first day) until the
-- organisers confirm the tee time; the admin sets the real one.
insert into public.icon_events (slug, name, first_tee_at)
values ('icons-cup-sa-2026', 'Icons Cup South Africa', '2026-12-11 05:00:00+00')
on conflict (slug) do nothing;

-- ----------------------------------------------------------------
-- 4. The pick log
-- ----------------------------------------------------------------
create table if not exists public.icon_vote_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  from_icon_id  uuid,
  to_icon_id    uuid,
  action        text not null check (action in ('pick', 'change', 'remove')),
  actor_id      uuid,
  actor_role    text not null,
  created_at    timestamptz not null default now()
);

comment on table public.icon_vote_events is
  'Every pick, change of pick and removal on icon_votes, written by trigger. Append-only: who (auth.uid() when a session is present), from which Icon to which. The history the snapshot hash can be checked against.';

create index if not exists icon_vote_events_user_created_idx on public.icon_vote_events (user_id, created_at);

alter table public.icon_vote_events enable row level security;
revoke all on public.icon_vote_events from anon, authenticated;
revoke update, delete, truncate on public.icon_vote_events from service_role;

drop trigger if exists trg_icon_vote_events_append_only on public.icon_vote_events;
create trigger trg_icon_vote_events_append_only
  before update or delete on public.icon_vote_events
  for each row execute function public.append_only();

create or replace function public.record_icon_vote_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  if tg_op = 'INSERT' then
    insert into public.icon_vote_events (user_id, from_icon_id, to_icon_id, action, actor_id, actor_role)
    values (new.user_id, null, new.icon_id, 'pick', v_uid, current_user);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.icon_id is distinct from old.icon_id then
      insert into public.icon_vote_events (user_id, from_icon_id, to_icon_id, action, actor_id, actor_role)
      values (new.user_id, old.icon_id, new.icon_id, 'change', v_uid, current_user);
    end if;
    return new;
  else
    insert into public.icon_vote_events (user_id, from_icon_id, to_icon_id, action, actor_id, actor_role)
    values (old.user_id, old.icon_id, null, 'remove', v_uid, current_user);
    return old;
  end if;
end;
$$;

revoke execute on function public.record_icon_vote_event() from public, anon, authenticated;

drop trigger if exists trg_icon_votes_record_event on public.icon_votes;
create trigger trg_icon_votes_record_event
  after insert or update or delete on public.icon_votes
  for each row execute function public.record_icon_vote_event();

-- ----------------------------------------------------------------
-- 5. Picks close at first tee, or when the list is frozen
--    (removals still go through: deleting an account cascades here)
-- ----------------------------------------------------------------
create or replace function public.enforce_icon_picks_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.icon_events
    where frozen_at is not null
       or (first_tee_at is not null and now() >= first_tee_at)
  ) then
    raise exception 'ICON_PICKS_CLOSED' using errcode = 'P0001', hint = 'Picks closed at first tee.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_icon_picks_open() from public, anon, authenticated;

drop trigger if exists trg_icon_votes_picks_open on public.icon_votes;
create trigger trg_icon_votes_picks_open
  before insert or update on public.icon_votes
  for each row execute function public.enforce_icon_picks_open();

-- ----------------------------------------------------------------
-- 6. The frozen backer list
-- ----------------------------------------------------------------
create table if not exists public.icon_vote_snapshot (
  event_id           uuid not null references public.icon_events on delete restrict,
  user_id            uuid not null,
  icon_id            uuid not null references public.icons on delete restrict,
  email              text,
  eligible           boolean not null,
  ineligible_reason  text check (ineligible_reason is null or ineligible_reason in ('under_18', 'staff', 'suspended', 'no_profile')),
  picked_at          timestamptz not null,
  created_at         timestamptz not null default now(),
  primary key (event_id, user_id)
);

comment on table public.icon_vote_snapshot is
  'icon_votes as it stood when the admin froze the event: one row per backer, the Icon, the email at the time (so a winner can be reached even if the account goes), and eligibility. Append-only; the hash on icon_events covers user_id:icon_id of every row.';

create index if not exists icon_vote_snapshot_event_icon_idx on public.icon_vote_snapshot (event_id, icon_id);

alter table public.icon_vote_snapshot enable row level security;
revoke all on public.icon_vote_snapshot from anon, authenticated;
revoke update, delete, truncate on public.icon_vote_snapshot from service_role;

drop trigger if exists trg_icon_vote_snapshot_append_only on public.icon_vote_snapshot;
create trigger trg_icon_vote_snapshot_append_only
  before update or delete on public.icon_vote_snapshot
  for each row execute function public.append_only();

-- ----------------------------------------------------------------
-- 7. The winners
-- ----------------------------------------------------------------
create table if not exists public.fan_prize_winners (
  event_id    uuid not null references public.icon_events on delete restrict,
  position    integer not null check (position >= 1),
  user_id     uuid not null,
  icon_id     uuid not null references public.icons on delete restrict,
  email       text,
  draw_rank   text not null check (draw_rank ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  primary key (event_id, position),
  unique (event_id, user_id)
);

comment on table public.fan_prize_winners is
  'The fans drawn for the prize, in order. draw_rank is HMAC-SHA256(draw_seed, user_id): the eligible backers of the winning Icon sorted by it, lowest first, are the winners. Append-only.';

alter table public.fan_prize_winners enable row level security;
revoke all on public.fan_prize_winners from anon, authenticated;
revoke update, delete, truncate on public.fan_prize_winners from service_role;

drop trigger if exists trg_fan_prize_winners_append_only on public.fan_prize_winners;
create trigger trg_fan_prize_winners_append_only
  before update or delete on public.fan_prize_winners
  for each row execute function public.append_only();

-- ----------------------------------------------------------------
-- 8. Backers per Icon, counted in SQL
-- ----------------------------------------------------------------
create or replace view public.icon_vote_counts
with (security_invoker = true)
as
  select icon_id, count(*)::integer as votes
  from public.icon_votes
  group by icon_id;

comment on view public.icon_vote_counts is
  'Backers per Icon. Service role only: golfers can read only their own vote, and the public route counts through this.';

revoke all on public.icon_vote_counts from anon, authenticated;
grant select on public.icon_vote_counts to service_role;

-- ----------------------------------------------------------------
-- Verify
-- ----------------------------------------------------------------
select slug, first_tee_at, frozen_at, drawn_at from public.icon_events;
select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'icon_votes_icon_id_fkey';
select tgname from pg_trigger where tgrelid = 'public.icon_votes'::regclass and not tgisinternal order by 1;
