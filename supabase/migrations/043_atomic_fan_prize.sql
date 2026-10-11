-- ================================================================
-- 043 — The fan prize freeze and draw are each one transaction, and the
--       seed source is committed before the shot
--
-- Why (independent audit, 11 October 2026, S1–S4).
--
-- S2. The freeze was pages of reads and chunks of inserts from the app,
--     with frozen_at set last. A failure between chunks left a partial
--     snapshot on an unfrozen event, and the next attempt hit the primary
--     key on rows already there: stuck, by hand, on the morning of the
--     shot. Picks could also still change while the pages were read.
-- S3. The draw wrote drawn_at first and the winners second. A failure in
--     between left a drawn event with no winners, and every later call
--     said ALREADY_DRAWN.
-- S4. The published hash covered user_id:icon_id only, so two lists with
--     different eligibility had the same commitment.
-- S1. The seed was whatever the admin typed on the night. The record
--     now carries, from the freeze, WHICH public value will be the seed
--     (seed_source), published with the hash, and the admin who froze the
--     list cannot be the one who runs the draw.
--
--   freeze_icon_event(event, actor, seed_source) → jsonb
--       locks the event and icon_votes, copies every pick with eligibility
--       in one INSERT … SELECT, hashes the list in SQL, writes the event.
--   draw_icon_event(event, actor, icon, seed, draw_sha256, winners) → jsonb
--       locks the event, checks frozen / not drawn / another admin / every
--       winner an eligible backer of that Icon in the frozen list, writes
--       the event and the winners together.
--
-- The snapshot hash (v2) is SHA-256 over these lines joined by "\n":
--   event:<event_id>
--   <user_id>:<icon_id>:<eligible|under_18|staff|suspended|no_profile>   one per backer, sorted by user_id (byte order)
-- src/lib/fan-prize.ts computes the same thing; the record route
-- recomputes it from the stored rows and says whether it matches.
--
-- Refusals are exceptions whose MESSAGE is the code and whose HINT is the
-- sentence. Service role only. Idempotent.
-- ================================================================

alter table public.icon_events
  add column if not exists seed_source text
    check (seed_source is null or char_length(seed_source) between 8 and 300);

comment on column public.icon_events.seed_source is
  'Committed at the freeze, published with the snapshot hash: which public value, observed when and where, will be typed in as the draw seed. The draw checks nothing about it (it cannot); publishing it beforehand is what makes a chosen seed visible.';

alter table public.icon_events drop constraint if exists icon_events_seed_committed;
alter table public.icon_events
  add constraint icon_events_seed_committed check ((frozen_at is null) = (seed_source is null));

-- ----------------------------------------------------------------
create or replace function public.freeze_icon_event(
  p_event_id    uuid,
  p_actor_id    uuid,
  p_seed_source text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_frozen   timestamptz;
  v_sha      text;
  v_now      timestamptz := clock_timestamp();
  v_count    integer;
  v_eligible integer;
  v_lines    text;
begin
  select frozen_at, snapshot_sha256
    into v_frozen, v_sha
    from public.icon_events
   where id = p_event_id
     for update;
  if not found then
    raise exception 'NO_EVENT' using errcode = 'P0001', hint = 'No event is set up.';
  end if;
  if v_frozen is not null then
    raise exception 'ALREADY_FROZEN' using errcode = 'P0001', hint = 'The backer list is already frozen.', detail = v_sha;
  end if;
  if p_seed_source is null or char_length(btrim(p_seed_source)) < 8 then
    raise exception 'SEED_SOURCE_REQUIRED' using errcode = 'P0001', hint = 'Say which public value will be the seed before freezing.';
  end if;

  -- No pick can change until this transaction commits, and from then the
  -- trigger on icon_votes refuses them: the list is one cutoff.
  lock table public.icon_votes in share row exclusive mode;

  insert into public.icon_vote_snapshot (event_id, user_id, icon_id, email, eligible, ineligible_reason, picked_at)
  select p_event_id,
         v.user_id,
         v.icon_id,
         p.email,
         (p.id is not null and not coalesce(p.is_admin, false) and p.suspended_at is null and p.age_verified_at is not null),
         case
           when p.id is null                 then 'no_profile'
           when coalesce(p.is_admin, false)  then 'staff'
           when p.suspended_at is not null   then 'suspended'
           when p.age_verified_at is null    then 'under_18'
           else null
         end,
         coalesce(v.updated_at, v.created_at)
    from public.icon_votes v
    left join public.profiles p on p.id = v.user_id;
  get diagnostics v_count = row_count;

  select count(*) filter (where eligible),
         string_agg(user_id::text || ':' || icon_id::text || ':' || coalesce(ineligible_reason, 'eligible'),
                    E'\n' order by user_id::text collate "C")
    into v_eligible, v_lines
    from public.icon_vote_snapshot
   where event_id = p_event_id;

  v_sha := encode(sha256(convert_to(concat_ws(E'\n', 'event:' || p_event_id::text, v_lines), 'UTF8')), 'hex');

  update public.icon_events
     set frozen_at       = v_now,
         frozen_by       = p_actor_id,
         snapshot_sha256 = v_sha,
         snapshot_count  = v_count,
         seed_source     = btrim(p_seed_source)
   where id = p_event_id;

  return jsonb_build_object('frozen_at', v_now, 'snapshot_sha256', v_sha, 'snapshot_count', v_count, 'eligible_count', v_eligible);
end;
$$;

revoke execute on function public.freeze_icon_event(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.freeze_icon_event(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------
create or replace function public.draw_icon_event(
  p_event_id        uuid,
  p_actor_id        uuid,
  p_winning_icon_id uuid,
  p_seed            text,
  p_draw_sha256     text,
  p_winners         jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_frozen    timestamptz;
  v_frozen_by uuid;
  v_drawn     timestamptz;
  v_max       integer;
  v_now       timestamptz := clock_timestamp();
  v_bad       integer;
begin
  select frozen_at, frozen_by, drawn_at, winners_count
    into v_frozen, v_frozen_by, v_drawn, v_max
    from public.icon_events
   where id = p_event_id
     for update;
  if not found then
    raise exception 'NO_EVENT' using errcode = 'P0001', hint = 'No event is set up.';
  end if;
  if v_frozen is null then
    raise exception 'NOT_FROZEN' using errcode = 'P0001', hint = 'Freeze the backer list before drawing.';
  end if;
  if v_drawn is not null then
    raise exception 'ALREADY_DRAWN' using errcode = 'P0001', hint = 'The draw has already run.';
  end if;
  if v_frozen_by is not null and v_frozen_by = p_actor_id then
    raise exception 'SAME_ADMIN' using errcode = 'P0001', hint = 'The admin who froze the list cannot run the draw. Ask another admin to run it.';
  end if;
  if not exists (select 1 from public.icons where id = p_winning_icon_id) then
    raise exception 'ICON_NOT_FOUND' using errcode = 'P0001', hint = 'That Icon is not in the field';
  end if;
  if p_winners is null or jsonb_typeof(p_winners) <> 'array' or jsonb_array_length(p_winners) = 0 then
    raise exception 'NO_WINNERS' using errcode = 'P0001', hint = 'A draw needs at least one winner.';
  end if;
  if jsonb_array_length(p_winners) > v_max then
    raise exception 'TOO_MANY_WINNERS' using errcode = 'P0001', hint = format('The event has %s prizes.', v_max);
  end if;

  -- Every winner must be an eligible backer of that Icon in the frozen list.
  select count(*)
    into v_bad
    from jsonb_array_elements(p_winners) w
   where not exists (
     select 1 from public.icon_vote_snapshot s
      where s.event_id = p_event_id
        and s.icon_id  = p_winning_icon_id
        and s.eligible
        and s.user_id  = (w->>'user_id')::uuid
   );
  if v_bad > 0 then
    raise exception 'WINNER_NOT_ELIGIBLE' using errcode = 'P0001', hint = 'A winner is not an eligible backer of that Icon in the frozen list.';
  end if;

  update public.icon_events
     set drawn_at        = v_now,
         drawn_by        = p_actor_id,
         winning_icon_id = p_winning_icon_id,
         draw_seed       = p_seed,
         draw_sha256     = p_draw_sha256
   where id = p_event_id;

  insert into public.fan_prize_winners (event_id, position, user_id, icon_id, email, draw_rank)
  select p_event_id, (w->>'position')::integer, (w->>'user_id')::uuid, p_winning_icon_id, s.email, w->>'rank'
    from jsonb_array_elements(p_winners) w
    join public.icon_vote_snapshot s on s.event_id = p_event_id and s.user_id = (w->>'user_id')::uuid;

  return jsonb_build_object('drawn_at', v_now);
end;
$$;

revoke execute on function public.draw_icon_event(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.draw_icon_event(uuid, uuid, uuid, text, text, jsonb) to service_role;
