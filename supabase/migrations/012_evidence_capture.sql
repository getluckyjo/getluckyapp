-- ================================================================
-- 012 — Evidence capture (Stage 4, Batch 9; docs/stage-4-proposal.md §1.2)
--
--   bets.capture_*             what the recorder reported at the moment of
--                              capture: when recording started and stopped,
--                              how long it ran, where the phone was, how
--                              accurate that fix was, and how far that is
--                              from the course. Written once by
--                              /api/videos/upload-url, before the footage
--                              is sealed. Location is advisory: missing or
--                              far away is a flag for the reviewer, never a
--                              block.
--   verifications.*_sha256/bytes
--                              hash and size of the certificate and
--                              affidavit as read back from storage at
--                              submission, so the reviewed file can be
--                              proven to be the submitted file.
--   claim_witnesses            the people the claimant names: playing
--                              partners and the club official who signed the
--                              certificate. Batch 11 asks them to confirm.
--
-- All additive and nullable. Idempotent. Apply BEFORE deploying Batch 9.
-- ================================================================

alter table public.bets
  add column if not exists capture_started_at  timestamptz,
  add column if not exists capture_ended_at    timestamptz,
  add column if not exists capture_duration_ms integer,
  add column if not exists capture_lat         double precision,
  add column if not exists capture_lng         double precision,
  add column if not exists capture_accuracy_m  real,
  add column if not exists capture_distance_m  real,
  add column if not exists capture_user_agent  text;

comment on column public.bets.capture_started_at is 'Recorder start time as reported by the device. Compare with created_at and video_uploaded_at.';
comment on column public.bets.capture_distance_m is 'Metres from the reported capture position to the course''s coordinates; null when either is unknown.';

alter table public.verifications
  add column if not exists certificate_sha256 text,
  add column if not exists certificate_bytes  bigint,
  add column if not exists affidavit_sha256   text,
  add column if not exists affidavit_bytes    bigint;

create table if not exists public.claim_witnesses (
  id              uuid primary key default gen_random_uuid(),
  bet_id          uuid not null references public.bets on delete cascade,
  verification_id uuid references public.verifications on delete cascade,
  role            text not null check (role in ('witness', 'club_official')),
  name            text not null,
  email           text not null,
  created_at      timestamptz not null default now()
);

comment on table public.claim_witnesses is
  'People named on a claim: playing partners (witness) and the club official who signed the certificate. Replaced as a set on each submission while the claim is open; purged with a rejected claim''s documents.';

create index if not exists claim_witnesses_bet_id_idx on public.claim_witnesses (bet_id);
create index if not exists claim_witnesses_email_lower_idx on public.claim_witnesses (lower(email));

-- Service role only. Nobody reads or writes this through the client.
alter table public.claim_witnesses enable row level security;
revoke all on public.claim_witnesses from anon, authenticated;

-- Verify
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and (column_name like 'capture_%' or column_name like '%_sha256' or table_name = 'claim_witnesses')
 order by table_name, column_name;
