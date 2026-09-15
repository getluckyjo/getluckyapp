-- ================================================================
-- 009 — Rate limiting (AUDIT.md B.8, Batch 4)
--
-- The old limiter was an in-memory Map inside the Next proxy. On Vercel every
-- instance has its own empty map and instances come and go constantly, so it
-- limited nothing. This replaces it with one atomic counter per (rule, key)
-- in Postgres, called by the API routes through the service role.
--
-- Fixed window: the first hit in a window starts it; hits are counted until
-- the window ends; then it starts again. Simple, atomic (single upsert), and
-- good enough for "stop a script hammering checkout". Postgres was chosen
-- over a Redis vendor because it already exists in every environment,
-- needs no new secret, and volumes are tiny. If it ever shows up in query
-- timings, src/lib/rate-limit.ts is the only file that knows the backend.
--
-- Idempotent. Apply BEFORE deploying the Batch 4 code: without the function
-- the limiter fails open (allows and logs), so the order is not critical,
-- but the code is only doing its job once this is in.
-- ================================================================

create table if not exists public.rate_limits (
  key          text primary key,
  count        integer not null,
  window_start timestamptz not null
);

comment on table public.rate_limits is
  'Fixed-window request counters keyed "<rule>:<scope>:<id>". Written only by rate_limit_hit(); rows older than a day are cleaned opportunistically.';

-- Nobody reads or writes this through PostgREST; the function below is
-- security definer and the service role is the only caller.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_window interval    := make_interval(secs => p_window_seconds);
  v_count  integer;
  v_start  timestamptz;
begin
  insert into public.rate_limits as r (key, count, window_start)
  values (p_key, 1, v_now)
  on conflict (key) do update
    set count        = case when r.window_start + v_window <= v_now then 1 else r.count + 1 end,
        window_start = case when r.window_start + v_window <= v_now then v_now else r.window_start end
  returning r.count, r.window_start into v_count, v_start;

  -- Opportunistic cleanup: about one call in a hundred sweeps stale rows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < v_now - interval '1 day';
  end if;

  return query select v_count <= p_limit, greatest(p_limit - v_count, 0), v_start + v_window;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant  execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Verify
select public.rate_limit_hit('migration-009-selftest', 2, 60);
select public.rate_limit_hit('migration-009-selftest', 2, 60);
select public.rate_limit_hit('migration-009-selftest', 2, 60); -- allowed = false
delete from public.rate_limits where key = 'migration-009-selftest';
