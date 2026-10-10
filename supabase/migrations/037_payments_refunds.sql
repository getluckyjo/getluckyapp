-- ================================================================
-- 037 — Unknown charges, refunds, and the saved-card cap
--
-- Why. Three money gaps from the October 2026 review of saved cards:
--
--   1. A saved-card charge that timed out was marked 'failed' and the
--      golfer told to pay the usual way. When PayFast had in fact taken
--      the money, its late ITN flipped the row to 'complete' and a second
--      payment followed. payfast_payments.status gains 'unknown': the
--      charge was sent and no answer came back. Home shows it as
--      "confirming", the ITN resolves it, and a cron reconciliation
--      asks PayFast's transaction history after two minutes.
--   2. There was no refund path. The `refunds` table is the record of
--      every refund an admin asks PayFast for: one per payment, written
--      as 'requested' before the call, then 'sent' or 'failed'. The
--      payment keeps `refunded_at` so the admin screen and the export
--      say so. Nothing here touches the bet.
--   3. The per-user rolling cap on saved-card charges reads the last
--      24 hours of a golfer's ledger rows; an index covers that read.
--
-- Service role only (the refunds table has RLS on and no policies).
-- Additive. Idempotent. Apply before deploying the code that reads it.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. The ledger: 'unknown' and refunded_at
-- ----------------------------------------------------------------
alter table public.payfast_payments drop constraint if exists payfast_payments_status_check;
alter table public.payfast_payments
  add constraint payfast_payments_status_check
  check (status in ('complete', 'amount_mismatch', 'pending', 'failed', 'unknown'));

alter table public.payfast_payments add column if not exists refunded_at timestamptz;

comment on column public.payfast_payments.status is
  'complete | amount_mismatch | pending (saved-card charge in flight) | failed (declined) | unknown (charge sent, no answer; the ITN or the reconciliation cron settles it)';
comment on column public.payfast_payments.refunded_at is
  'When PayFast accepted the refund request (see public.refunds). The bet is not touched.';

-- The saved-card cap: a golfer's charges in the last 24 hours.
create index if not exists payfast_payments_user_created_at_idx
  on public.payfast_payments (user_id, created_at desc);

-- ----------------------------------------------------------------
-- 2. Refunds
-- ----------------------------------------------------------------
create table if not exists public.refunds (
  id             uuid primary key default gen_random_uuid(),
  -- The payment's reference. No foreign key: the ledger keeps a row for a
  -- deleted user with user_id nulled, and a refund record must outlive
  -- everything else about the payment.
  m_payment_id   text not null unique,
  pf_payment_id  text,
  amount_cents   integer not null check (amount_cents > 0),
  reason         text not null check (char_length(reason) between 3 and 255),
  status         text not null default 'requested' check (status in ('requested', 'sent', 'failed')),
  pf_refund_id   text,
  -- What PayFast (or the network) said when the request failed. Never shown to a golfer.
  failure_reason text check (char_length(failure_reason) <= 500),
  requested_by   uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.refunds is
  'One refund request per payment, made by an admin through POST /api/admin/payments/[mPaymentId]/refund. Written as requested, then sent or failed. Append-only: only status, pf_refund_id and failure_reason change.';

alter table public.refunds enable row level security;
-- No policies: the anon and authenticated roles can neither read nor write.
revoke all on public.refunds from public, anon, authenticated;
grant select, insert, update on public.refunds to service_role;

-- Append-only except the outcome columns, even for the service role.
create or replace function public.refunds_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'refunds are append-only' using errcode = 'P0001';
  end if;
  if new.id            is distinct from old.id
  or new.m_payment_id  is distinct from old.m_payment_id
  or new.pf_payment_id is distinct from old.pf_payment_id
  or new.amount_cents  is distinct from old.amount_cents
  or new.reason        is distinct from old.reason
  or new.requested_by  is distinct from old.requested_by
  or new.created_at    is distinct from old.created_at then
    raise exception 'refunds: only status, pf_refund_id and failure_reason may change' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists refunds_guard on public.refunds;
create trigger refunds_guard
  before update or delete on public.refunds
  for each row execute function public.refunds_guard();

-- Verify: the widened check, the new column, and an empty refunds table.
select
  (select count(*) from public.payfast_payments where status = 'unknown')     as unknown_payments,
  (select count(*) from public.payfast_payments where refunded_at is not null) as refunded_payments,
  (select count(*) from public.refunds)                                        as refunds;
