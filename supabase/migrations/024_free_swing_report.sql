-- 024_free_swing_report.sql
-- Does the free swing pay for itself? Two aggregates behind
-- /admin/reports → Free swings, in the same shape as the revenue ones
-- (migration 010): exact counts in SQL, the rates worked out in the route.
--
-- The question they answer: how many free swings are taken, and what share
-- of those golfers stake real money within seven days.
--
-- `matured` is the honest denominator for that rate. A swing taken
-- yesterday has not had its seven days yet, so counting it as "not
-- converted" would drag the rate down every time the free swing gets more
-- popular — the opposite of what the number is for.
--
-- Safe to re-run.

create or replace function public.admin_free_swing_funnel()
returns json
language sql
security definer set search_path = public
stable
as $$
  with free as (
    -- One row per golfer: the unique index from migration 023 guarantees it.
    select user_id, created_at, status
      from public.bets
     where tier = 'tier_free'
  ),
  first_paid as (
    select f.user_id, min(b.created_at) as first_paid_at
      from free f
      join public.bets b
        on b.user_id = f.user_id
       and b.tier <> 'tier_free'
       and b.created_at > f.created_at
     group by f.user_id
  )
  select json_build_object(
    'taken',     (select count(*) from free),
    'taken_7d',  (select count(*) from free where created_at >= now() - interval '7 days'),
    'taken_30d', (select count(*) from free where created_at >= now() - interval '30 days'),
    -- Swings old enough for the seven-day window to have closed.
    'matured',   (select count(*) from free where created_at <= now() - interval '7 days'),
    'converted_7d', (
      select count(*)
        from free f
        join first_paid p on p.user_id = f.user_id
       where f.created_at <= now() - interval '7 days'
         and p.first_paid_at <= f.created_at + interval '7 days'
    ),
    -- No window: everyone who came in free and has since staked anything.
    'converted_ever', (select count(*) from first_paid),
    'paid_bets_after_free', (
      select count(*)
        from public.bets b
        join free f on f.user_id = b.user_id
       where b.tier <> 'tier_free' and b.created_at > f.created_at
    ),
    'revenue_after_free_cents', (
      select coalesce(sum(b.stake_pence), 0)
        from public.bets b
        join free f on f.user_id = b.user_id
       where b.tier <> 'tier_free' and b.created_at > f.created_at
    ),
    -- The liability side: free swings that went in and became a claim.
    'claimed', (select count(*) from free where status in ('claimed', 'verified', 'paid')),
    'median_hours_to_first_paid', (
      select percentile_cont(0.5) within group (
               order by extract(epoch from (p.first_paid_at - f.created_at)) / 3600
             )
        from free f join first_paid p on p.user_id = f.user_id
    )
  );
$$;

-- The same two numbers week by week, so a trend is visible rather than one
-- lifetime average that never moves once there is a bit of history.
create or replace function public.admin_free_swing_by_week()
returns table (week_start date, taken bigint, matured bigint, converted_7d bigint)
language sql
security definer set search_path = public
stable
as $$
  with free as (
    select user_id, created_at
      from public.bets
     where tier = 'tier_free'
       and created_at >= date_trunc('week', now() - interval '12 weeks')
  ),
  first_paid as (
    select f.user_id, min(b.created_at) as first_paid_at
      from free f
      join public.bets b
        on b.user_id = f.user_id
       and b.tier <> 'tier_free'
       and b.created_at > f.created_at
     group by f.user_id
  )
  select date_trunc('week', f.created_at)::date,
         count(*),
         count(*) filter (where f.created_at <= now() - interval '7 days'),
         count(*) filter (
           where f.created_at <= now() - interval '7 days'
             and p.first_paid_at is not null
             and p.first_paid_at <= f.created_at + interval '7 days'
         )
    from free f
    left join first_paid p on p.user_id = f.user_id
   group by 1
   order by 1 desc;
$$;

revoke execute on function public.admin_free_swing_funnel()  from public, anon, authenticated;
revoke execute on function public.admin_free_swing_by_week() from public, anon, authenticated;
grant  execute on function public.admin_free_swing_funnel()  to service_role;
grant  execute on function public.admin_free_swing_by_week() to service_role;

-- Verify
select public.admin_free_swing_funnel();
select * from public.admin_free_swing_by_week();
