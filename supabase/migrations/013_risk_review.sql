-- ================================================================
-- 013 — Risk signals and review discipline (Stage 4, Batch 10;
--        docs/stage-4-proposal.md §1.5–1.7)
--
--   bets.created_ip_hash / claim_ip_hash / claim_ua_hash
--        salted SHA-256 of the IP at bet creation and at claim, and of the
--        user agent at claim. Useful for "same person, many accounts";
--        useless as PII (the salt is RISK_HASH_SALT, never stored).
--   bets.risk_score / risk_flags / risk_evaluated_at
--        the current rule hits for a claim, recomputed on submission and
--        whenever an admin opens it. Changes to risk_flags land in
--        claim_events like any other bet change, so the history is kept;
--        risk_evaluated_at alone is excluded from the diff.
--   bets.payout_reference
--        the bank or PayFast reference for a paid prize. "paid" is never a
--        bare status again.
--   verifications.review_checklist
--        what the reviewer confirmed before approving, with who and when.
--   profiles.updated_by + account_events
--        who suspended, unsuspended or changed the admin flag on an account,
--        append-only, same pattern as claim_events.
--   deleted_accounts
--        a hashed email and bet count for every deleted account, so a
--        returning deleter is visible (closes the Batch 8 risk).
--
-- All additive. Idempotent. Apply BEFORE deploying Batch 10.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------
alter table public.bets
  add column if not exists created_ip_hash   text,
  add column if not exists claim_ip_hash     text,
  add column if not exists claim_ua_hash     text,
  add column if not exists risk_score        integer not null default 0,
  add column if not exists risk_flags        jsonb,
  add column if not exists risk_evaluated_at timestamptz,
  add column if not exists payout_reference  text;

comment on column public.bets.risk_flags is 'Array of {rule, severity, detail} from src/lib/risk/rules.ts. Advisory: nothing is blocked by a flag.';
comment on column public.bets.payout_reference is 'Bank or PayFast reference for the payout; required to move to paid.';

alter table public.verifications
  add column if not exists review_checklist jsonb;

comment on column public.verifications.review_checklist is 'The approve checklist as confirmed by the reviewer, plus completed_by and completed_at. {batch: true} when approved through the batch action.';

alter table public.profiles
  add column if not exists updated_by uuid;

comment on column public.profiles.updated_by is 'auth.users id of the admin behind the last server-side change to the managed columns. Read by the account_events trigger.';

create index if not exists bets_ip_hash_idx        on public.bets (claim_ip_hash)   where claim_ip_hash is not null;
create index if not exists bets_created_ip_hash_idx on public.bets (created_ip_hash) where created_ip_hash is not null;
create index if not exists bets_video_sha256_idx   on public.bets (video_sha256)    where video_sha256 is not null;
create index if not exists bets_risk_score_idx     on public.bets (risk_score desc) where status = 'claimed';
create index if not exists bets_hole_claimed_idx   on public.bets (hole_id, created_at) where status in ('claimed', 'verified', 'paid');

-- ----------------------------------------------------------------
-- 2. claim_events: risk_evaluated_at changes every time a claim is opened
--    and is not a change worth a row; risk_flags changes are.
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
       and key not in ('updated_at', 'risk_evaluated_at');
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

-- ----------------------------------------------------------------
-- 3. account_events — append-only log of admin actions on accounts
-- ----------------------------------------------------------------
create table if not exists public.account_events (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null,
  actor_id    uuid,
  actor_role  text not null,
  changed     jsonb not null,
  created_at  timestamptz not null default now()
);

comment on table public.account_events is
  'Every change to profiles.is_admin, suspended_at or suspended_reason: who (updated_by or auth.uid()), what (column: {from, to}). Append-only.';

create index if not exists idx_account_events_profile_created on public.account_events (profile_id, created_at);

alter table public.account_events enable row level security;
revoke all on public.account_events from anon, authenticated;
revoke update, delete, truncate on public.account_events from service_role;

drop trigger if exists trg_account_events_append_only on public.account_events;
create trigger trg_account_events_append_only
  before update or delete on public.account_events
  for each row execute function public.claim_events_append_only();

create or replace function public.record_account_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed jsonb := '{}'::jsonb;
  v_uid     uuid;
begin
  if new.is_admin is distinct from old.is_admin then
    v_changed := v_changed || jsonb_build_object('is_admin', jsonb_build_object('from', old.is_admin, 'to', new.is_admin));
  end if;
  if new.suspended_at is distinct from old.suspended_at then
    v_changed := v_changed || jsonb_build_object('suspended_at', jsonb_build_object('from', old.suspended_at, 'to', new.suspended_at));
  end if;
  if new.suspended_reason is distinct from old.suspended_reason then
    v_changed := v_changed || jsonb_build_object('suspended_reason', jsonb_build_object('from', old.suspended_reason, 'to', new.suspended_reason));
  end if;
  if v_changed = '{}'::jsonb then
    return new;
  end if;

  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  insert into public.account_events (profile_id, actor_id, actor_role, changed)
  values (new.id, coalesce(new.updated_by, v_uid), current_user, v_changed);
  return new;
end;
$$;

drop trigger if exists trg_profiles_account_event on public.profiles;
create trigger trg_profiles_account_event
  after update on public.profiles
  for each row execute function public.record_account_event();

-- ----------------------------------------------------------------
-- 4. deleted_accounts — memory of who left
-- ----------------------------------------------------------------
create table if not exists public.deleted_accounts (
  id          uuid primary key default gen_random_uuid(),
  email_hash  text not null,
  bets        integer not null default 0,
  claims      integer not null default 0,
  deleted_at  timestamptz not null default now()
);

comment on table public.deleted_accounts is
  'Salted hash of the email of every self-deleted account, with how many bets and claims it had. No name, no id. Read by the deleted_and_back risk rule.';

create index if not exists deleted_accounts_email_hash_idx on public.deleted_accounts (email_hash);

alter table public.deleted_accounts enable row level security;
revoke all on public.deleted_accounts from anon, authenticated;

-- Verify
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and (column_name in ('risk_score', 'risk_flags', 'payout_reference', 'review_checklist', 'updated_by', 'claim_ip_hash')
        or table_name in ('account_events', 'deleted_accounts'))
 order by table_name, column_name;
