-- ================================================================
-- 014 — Independent confirmation (Stage 4, Batch 11;
--        docs/stage-4-proposal.md §1.2 and §1.7)
--
--   claim_witnesses.*      a one-time token (stored hashed) sent to each
--                          person named on a claim, and what they answered,
--                          when, and from where (hashed IP). `source` says
--                          whether the claimant named them or the course's
--                          standing contact list did.
--   course_contacts        the club official(s) for a partner course, so a
--                          certificate can be confirmed by the club without
--                          going through the claimant.
--
-- Additive. Idempotent. Apply BEFORE deploying Batch 11.
-- ================================================================

alter table public.claim_witnesses
  add column if not exists source              text not null default 'claimant' check (source in ('claimant', 'course')),
  add column if not exists token_hash          text,
  add column if not exists token_expires_at    timestamptz,
  add column if not exists requested_at        timestamptz,
  add column if not exists request_count       integer not null default 0,
  add column if not exists responded_at        timestamptz,
  add column if not exists response            text check (response in ('confirmed', 'denied')),
  add column if not exists response_note       text,
  add column if not exists response_ip_hash    text,
  add column if not exists response_user_agent text;

create unique index if not exists claim_witnesses_token_hash_idx on public.claim_witnesses (token_hash) where token_hash is not null;

comment on column public.claim_witnesses.token_hash is 'SHA-256 of the one-time link token emailed to this person. The token itself is never stored.';
comment on column public.claim_witnesses.response is 'confirmed = they say they saw it (or the club issued the certificate); denied = they say they did not.';

create table if not exists public.course_contacts (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses on delete cascade,
  name        text not null,
  email       text not null,
  role        text not null default 'club_official' check (role in ('club_official')),
  created_at  timestamptz not null default now()
);

comment on table public.course_contacts is
  'Standing club contacts per course. Every claim at the course sends them a certificate-confirmation request, independent of what the claimant uploaded.';

create index if not exists course_contacts_course_id_idx on public.course_contacts (course_id);

alter table public.course_contacts enable row level security;
revoke all on public.course_contacts from anon, authenticated;

-- Verify
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'claim_witnesses' and column_name in ('source', 'token_hash', 'response')) or table_name = 'course_contacts')
 order by table_name, column_name;
