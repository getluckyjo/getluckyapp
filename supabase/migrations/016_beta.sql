-- ================================================================
-- 016 — Closed beta: access list and in-app feedback (docs/pwa-plan.md)
--
--   beta_access   who may use the app while BETA_GATE=on. Two kinds of row:
--                 an email (matched against the signed-in user's email) or
--                 an invite code (redeemed once at /beta, kept in a cookie).
--                 Edited from /admin/beta; no deploy needed to add a tester.
--   beta_check()  the one question the proxy asks on every gated page view,
--                 as a security-definer function so the list itself is never
--                 readable through the public API.
--   feedback      what testers send from the floating button, with the
--                 context that makes it actionable (route, device, build).
--
-- Additive. Idempotent. Apply before enabling BETA_GATE or deploying the
-- feedback button.
-- ================================================================

create table if not exists public.beta_access (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('email', 'code')),
  value       text not null,
  note        text,
  added_by    uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, value)
);

comment on table public.beta_access is
  'Closed-beta allow-list. kind=email: value is the lower-cased address. kind=code: value is the lower-cased invite code.';

alter table public.beta_access enable row level security;
revoke all on public.beta_access from anon, authenticated;

create or replace function public.beta_check(p_email text, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.beta_access
     where (kind = 'email' and p_email is not null and value = lower(trim(p_email)))
        or (kind = 'code'  and p_code  is not null and value = lower(trim(p_code)))
  );
$$;

revoke all on function public.beta_check(text, text) from public;
grant execute on function public.beta_check(text, text) to anon, authenticated, service_role;

create table if not exists public.feedback (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users on delete set null,
  message      text not null check (char_length(message) between 1 and 4000),
  route        text,
  user_agent   text,
  standalone   boolean,
  app_version  text,
  build_date   text,
  screen       text,
  created_at   timestamptz not null default now()
);

comment on table public.feedback is
  'In-app beta feedback. Written by /api/feedback with the service role; emailed to ops through the outbox.';

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- Verify
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('beta_access', 'feedback') order by 1;
