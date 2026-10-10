-- ================================================================
-- 040 — Nothing in the public API schema runs as the owner unless it
--       has to, and nothing that must is callable from the outside.
--
-- Why. Every function in `public` is reachable through PostgREST at
-- /rest/v1/rpc/<name>, and Postgres grants EXECUTE to PUBLIC on a new
-- function by default. Supabase's security linter listed nine SECURITY
-- DEFINER functions the anon key could call. Eight are trigger functions
-- (a call from outside fails, "trigger functions can only be called as
-- triggers", but there is no reason to leave the door on the latch), and
-- one, beta_check, was meant to be called with the anon key and is the
-- one that matters: it is an oracle over the closed-beta list. Anyone with
-- the public key could ask "is this email on the list?" as fast as the
-- API would answer. The gate is off for launch, and the function stays,
-- but from here only the service role may ask: the proxy and the redeem
-- route call it with the service key (src/lib/beta.ts).
--
--   trigger functions   EXECUTE revoked from public, anon, authenticated
--                       (triggers run as the table owner; revoking changes
--                       nothing about how they fire).
--   beta_check          EXECUTE revoked from public, anon, authenticated;
--                       granted to service_role.
--   search_path         pinned on the three trigger functions that had
--                       none (refunds_guard, touch_updated_at,
--                       claim_events_append_only), the linter's other
--                       warning.
--   default privileges  a function created by postgres in `public` from
--                       now on starts with no EXECUTE for anyone but its
--                       owner. Every later migration that adds a function
--                       the app calls must say `grant execute ... to
--                       service_role` (or to authenticated, if a golfer's
--                       session is meant to call it). The admin functions
--                       from 010 onwards already do.
--
-- Idempotent. Independent of the app code; deploy in either order.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Trigger functions: nobody calls these, so nobody may
-- ----------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 2. beta_check: service role only
-- ----------------------------------------------------------------
revoke execute on function public.beta_check(text, text) from public, anon, authenticated;
grant  execute on function public.beta_check(text, text) to service_role;

-- ----------------------------------------------------------------
-- 3. A fixed search_path on the trigger functions that lacked one
-- ----------------------------------------------------------------
alter function public.refunds_guard()            set search_path = public;
alter function public.touch_updated_at()         set search_path = public;
alter function public.claim_events_append_only() set search_path = public;

-- ----------------------------------------------------------------
-- 4. New functions start closed
-- ----------------------------------------------------------------
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- ----------------------------------------------------------------
-- Verify: no function in public is executable by anon or authenticated
-- (the list should be empty), and the service role can still ask the
-- beta question.
-- ----------------------------------------------------------------
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (has_function_privilege('anon', p.oid, 'execute')
     or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 1;
select has_function_privilege('service_role', 'public.beta_check(text, text)', 'execute') as service_role_can_check;
