-- ================================================================
-- 046 — A card on the account profile, held by Stitch
--
-- The fallback for a golfer with neither Apple Pay nor Google Pay: they
-- add a card once, on Stitch's hosted page (3-D Secure there), and Stitch
-- keeps it as a payment consent. We store the consent id as the token,
-- exactly as payment_cards already stores PayFast's token, and the same
-- one-tap charge route uses whichever provider the row names.
--
--   payment_cards.provider        'payfast' (every row so far) or 'stitch'
--   stitch_consent_requests       every consent we started: who asked, and
--                                 how it ended. The return leg and the
--                                 webhook both look the id up here, so a
--                                 consent nobody on our side started is
--                                 never attached to anyone.
--   reserve_saved_card_charge     gains p_provider so the pending ledger
--                                 row names the provider that will charge
--
-- Idempotent.
-- ================================================================

alter table public.payment_cards
  add column if not exists provider text not null default 'payfast'
    check (provider in ('payfast', 'stitch'));

comment on column public.payment_cards.provider is
  'Who holds the card: payfast (tokenization at checkout) or stitch (a payment consent added under Account). The token column is that provider''s id.';

create table if not exists public.stitch_consent_requests (
  id          text primary key,
  user_id     uuid not null references auth.users on delete cascade,
  status      text not null default 'pending'
    check (status in ('pending', 'granted', 'closed', 'failed', 'expired', 'revoked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists stitch_consent_requests_user_idx on public.stitch_consent_requests (user_id, created_at desc);

comment on table public.stitch_consent_requests is
  'Stitch payment consent requests we created for a golfer adding a card. The return leg and the webhook attach a granted consent to payment_cards only when its id is here.';

alter table public.stitch_consent_requests enable row level security;
revoke all on public.stitch_consent_requests from anon, authenticated;

-- The reservation writes the provider too.
drop function if exists public.reserve_saved_card_charge(uuid, text, uuid, uuid, text, integer, integer, interval);

create or replace function public.reserve_saved_card_charge(
  p_user_id       uuid,
  p_m_payment_id  text,
  p_course_id     uuid,
  p_hole_id       uuid,
  p_tier          text,
  p_amount_cents  integer,
  p_cap_cents     integer,
  p_window        interval,
  p_provider      text default 'payfast'
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_spent integer;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001', hint = 'A charge needs a positive amount.';
  end if;
  if p_provider not in ('payfast', 'stitch') then
    raise exception 'BAD_PROVIDER' using errcode = 'P0001', hint = 'Unknown payment provider.';
  end if;

  perform pg_advisory_xact_lock(hashtext('saved_card:' || p_user_id::text));

  select coalesce(sum(amount_cents), 0)::integer into v_spent
    from public.payfast_payments
   where user_id = p_user_id
     and raw_payload->>'source' = 'saved_card'
     and status in ('complete', 'pending', 'unknown')
     and created_at >= clock_timestamp() - p_window;

  if v_spent + p_amount_cents > p_cap_cents then
    raise exception 'SAVED_CARD_LIMIT' using errcode = 'P0001',
      hint = 'Over the saved-card daily cap.', detail = v_spent::text;
  end if;

  insert into public.payfast_payments (m_payment_id, user_id, course_id, hole_id, tier, amount_cents, status, provider, raw_payload)
  values (p_m_payment_id, p_user_id, p_course_id, p_hole_id, p_tier::bet_tier, p_amount_cents, 'pending', p_provider, jsonb_build_object('source', 'saved_card'));

  return v_spent;
end;
$$;

revoke execute on function public.reserve_saved_card_charge(uuid, text, uuid, uuid, text, integer, integer, interval, text) from public, anon, authenticated;
grant  execute on function public.reserve_saved_card_charge(uuid, text, uuid, uuid, text, integer, integer, interval, text) to service_role;
