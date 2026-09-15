-- ================================================================
-- 007 — Claim integrity (AUDIT.md B.4, Batch 2)
--
-- Adds what an underwriter will ask for and what the state machine needs:
--
--   bets.expires_at          the play window. A bet must be resolved (miss or
--                            claim, footage uploaded) before it. Default 24h
--                            from creation; the app sets it explicitly.
--   bets.video_sha256 / video_bytes / video_uploaded_at
--                            computed by the server from the object in
--                            storage after upload, so later substitution is
--                            detectable and the upload time is ours, not the
--                            client's.
--   bets.updated_at / updated_by, verifications.updated_at / updated_by
--                            who last touched the row. Every route sets
--                            updated_by to the acting user (player or admin).
--   claim_events             append-only audit log. Written by AFTER triggers
--                            on bets and verifications with actor, role and a
--                            column-level before/after diff. Nobody can
--                            update or delete rows in it, service role
--                            included.
--
-- Idempotent. Apply AFTER deploying the Batch 2 code? Either order works:
-- the code tolerates missing columns only in the sense that inserts would
-- fail, so apply the migration FIRST this time, then deploy. Nothing in the
-- migration breaks the Batch 1 code.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------
alter table public.bets
  add column if not exists expires_at        timestamptz,
  add column if not exists video_sha256      text,
  add column if not exists video_bytes       bigint,
  add column if not exists video_uploaded_at timestamptz,
  add column if not exists updated_at        timestamptz,
  add column if not exists updated_by        uuid;

update public.bets set expires_at = created_at + interval '24 hours' where expires_at is null;

alter table public.bets
  alter column expires_at set default (now() + interval '24 hours'),
  alter column expires_at set not null;

alter table public.verifications
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid;

comment on column public.bets.expires_at is
  'End of the play window. After this an active bet cannot be resolved, claimed, or have footage attached.';
comment on column public.bets.video_sha256 is
  'SHA-256 of the footage object as stored, computed server-side after upload. Recompute to detect substitution.';
comment on column public.bets.updated_by is
  'auth.users id of the last actor (player or admin). Read by the claim_events trigger.';

-- ----------------------------------------------------------------
-- 2. updated_at maintenance
-- ----------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_bets_touch_updated_at on public.bets;
create trigger trg_bets_touch_updated_at
  before update on public.bets
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_verifications_touch_updated_at on public.verifications;
create trigger trg_verifications_touch_updated_at
  before update on public.verifications
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------
-- 3. claim_events — append-only audit log
-- ----------------------------------------------------------------
create table if not exists public.claim_events (
  id              bigint generated always as identity primary key,
  bet_id          uuid not null,
  verification_id uuid,
  table_name      text not null,
  action          text not null check (action in ('insert', 'update')),
  actor_id        uuid,
  actor_role      text not null,
  changed         jsonb,
  before          jsonb,
  after           jsonb not null,
  created_at      timestamptz not null default now()
);

comment on table public.claim_events is
  'Immutable record of every insert/update on bets and verifications: who (actor_id = updated_by or auth.uid(); actor_role = db role), what changed (column: {from, to}), and full before/after rows.';

create index if not exists idx_claim_events_bet_id_created_at
  on public.claim_events (bet_id, created_at);

-- No policies: only the service role (which bypasses RLS) can read it, and
-- nothing can write it except the trigger below.
alter table public.claim_events enable row level security;

revoke all on public.claim_events from anon, authenticated;
revoke update, delete, truncate on public.claim_events from service_role;

create or replace function public.claim_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'claim_events is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists trg_claim_events_append_only on public.claim_events;
create trigger trg_claim_events_append_only
  before update or delete on public.claim_events
  for each row execute function public.claim_events_append_only();

-- ----------------------------------------------------------------
-- 4. Recording trigger on bets and verifications
-- ----------------------------------------------------------------
create or replace function public.record_claim_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before  jsonb;
  v_after   jsonb := to_jsonb(new);
  v_changed jsonb;
  v_bet     uuid;
  v_ver     uuid;
  v_actor   uuid;
  v_uid     uuid;
begin
  if tg_table_name = 'bets' then
    v_bet := new.id;
  else
    v_bet := new.bet_id;
    v_ver := new.id;
  end if;

  if tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    select jsonb_object_agg(key, jsonb_build_object('from', v_before -> key, 'to', v_after -> key))
      into v_changed
      from jsonb_each(v_after)
     where v_before -> key is distinct from v_after -> key
       and key <> 'updated_at';
    if v_changed is null then
      return new;
    end if;
  end if;

  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;
  v_actor := coalesce(nullif(v_after ->> 'updated_by', '')::uuid, v_uid);

  insert into public.claim_events
    (bet_id, verification_id, table_name, action, actor_id, actor_role, changed, before, after)
  values
    (v_bet, v_ver, tg_table_name, lower(tg_op), v_actor, current_user, v_changed, v_before, v_after);

  return new;
end;
$$;

drop trigger if exists trg_bets_claim_event on public.bets;
create trigger trg_bets_claim_event
  after insert or update on public.bets
  for each row execute function public.record_claim_event();

drop trigger if exists trg_verifications_claim_event on public.verifications;
create trigger trg_verifications_claim_event
  after insert or update on public.verifications
  for each row execute function public.record_claim_event();

-- ----------------------------------------------------------------
-- 5. Verify
-- ----------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'bets'
   and column_name in ('expires_at', 'video_sha256', 'video_bytes', 'video_uploaded_at', 'updated_at', 'updated_by')
 order by column_name;
