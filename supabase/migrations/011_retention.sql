-- ================================================================
-- 011 — Retention markers (AUDIT.md B.10, Batch 8)
--
-- Footage and claim documents are personal information (faces, voices,
-- signatures, other people's details) and are kept only as long as they
-- serve a purpose:
--
--   miss      the golfer said the shot missed: the footage is evidence of
--             nothing after the dispute window. Purged RETENTION_DAYS after
--             declared_at (default 90).
--   rejected  the claim was reviewed and refused. Documents and footage are
--             purged RETENTION_DAYS after the review.
--   verified / paid   kept: the insurer's record of a payout.
--
-- The purge itself is done by the nightly /api/cron/retention route (Vercel
-- cron), which removes the storage objects and stamps these columns. The
-- columns exist so the sweep never rescans rows it has already handled and
-- so the claim_events log shows when the purge happened.
--
-- Idempotent. Apply BEFORE deploying the Batch 8 code: the sweep filters on
-- these columns and fails (loudly, into Sentry) without them.
-- ================================================================

alter table public.bets
  add column if not exists footage_purged_at timestamptz;

alter table public.verifications
  add column if not exists documents_purged_at timestamptz;

comment on column public.bets.footage_purged_at is
  'When the retention sweep removed the shot-videos object for this bet (video_url is nulled at the same time; video_sha256 and video_bytes stay as the record that footage existed).';
comment on column public.verifications.documents_purged_at is
  'When the retention sweep removed the certificate and affidavit objects for this rejected claim.';

-- The sweep's two scans, each a partial index over the small unpurged set.
create index if not exists idx_bets_retention_miss
  on public.bets (declared_at)
  where status = 'miss' and footage_purged_at is null;

create index if not exists idx_verifications_retention_rejected
  on public.verifications (updated_at)
  where status = 'rejected' and documents_purged_at is null;

-- Verify
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and column_name in ('footage_purged_at', 'documents_purged_at')
 order by table_name;
