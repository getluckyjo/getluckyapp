-- ================================================================
-- 010 — Admin correctness and query performance (AUDIT.md D.1, Batch 6)
--
--   profiles.email       admins could not see who a user is. Copied from
--                        auth.users by trigger on signup and on email change;
--                        server-owned (the profile guard rejects client writes).
--   indexes              every admin list sorts on created_at; the player
--                        history reads bets by user; holes by course had no
--                        index; email search needs one.
--   admin_totals() etc.  the dashboard and revenue report used to load every
--                        bet into memory and reduce in JS. These are SQL
--                        aggregates, service role only.
--
-- Idempotent. Apply BEFORE deploying the Batch 6 code (it calls the
-- functions and reads the column). Nothing here breaks the Batch 5 code.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. profiles.email, kept in sync from auth.users
-- ----------------------------------------------------------------
alter table public.profiles add column if not exists email text;

comment on column public.profiles.email is
  'Mirror of auth.users.email, maintained by trigger. Server-owned; read by the admin panel and its search.';

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

create index if not exists profiles_email_lower_idx on public.profiles (lower(email));

-- Signup: create the profile with name and email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.email
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Email change (confirmed through Supabase Auth): keep the mirror current.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- The profile guard (migration 006) now also protects email.
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  privileged boolean :=
    current_user in ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin');
begin
  if privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false)
       or new.suspended_at       is not null
       or new.suspended_reason   is not null
       or coalesce(new.total_attempts, 0) <> 0
       or new.age_verified_at    is not null
       or new.terms_accepted_at  is not null
       or new.date_of_birth      is not null
       or new.email              is not null
    then
      raise exception 'These profile fields are set by the server and cannot be supplied by the client.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.is_admin          is distinct from old.is_admin
     or new.suspended_at      is distinct from old.suspended_at
     or new.suspended_reason  is distinct from old.suspended_reason
     or new.total_attempts    is distinct from old.total_attempts
     or new.age_verified_at   is distinct from old.age_verified_at
     or new.terms_accepted_at is distinct from old.terms_accepted_at
     or new.date_of_birth     is distinct from old.date_of_birth
     or new.email             is distinct from old.email
  then
    raise exception 'These profile fields are managed by the server and cannot be modified by the client.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------
create index if not exists bets_created_at_idx         on public.bets (created_at desc);
create index if not exists bets_user_created_idx       on public.bets (user_id, created_at desc);
create index if not exists bets_status_created_idx     on public.bets (status, created_at desc);
create index if not exists verifications_created_at_idx on public.verifications (created_at);
create index if not exists holes_course_id_idx         on public.holes (course_id);

-- ----------------------------------------------------------------
-- 3. Aggregates for the dashboard and the revenue report
-- ----------------------------------------------------------------
create or replace function public.admin_totals()
returns json
language sql
security definer set search_path = public
stable
as $$
  select json_build_object(
    'total_revenue_cents', coalesce((select sum(stake_pence) from public.bets), 0),
    'total_payout_cents',  coalesce((select sum(potential_win_pence) from public.bets where status = 'paid'), 0),
    'total_bets',          (select count(*) from public.bets),
    'active_bets',         (select count(*) from public.bets where status = 'active'),
    'pending_claims',      (select count(*) from public.verifications where status in ('pending', 'documents_received', 'under_review')),
    'total_users',         (select count(*) from public.profiles)
  );
$$;

create or replace function public.admin_revenue_by_tier()
returns table (tier text, bet_count bigint, revenue_cents bigint, payout_cents bigint)
language sql
security definer set search_path = public
stable
as $$
  select tier::text,
         count(*),
         coalesce(sum(stake_pence), 0),
         coalesce(sum(potential_win_pence) filter (where status = 'paid'), 0)
    from public.bets
   group by tier;
$$;

create or replace function public.admin_revenue_by_course()
returns table (course_id uuid, course_name text, bet_count bigint, revenue_cents bigint)
language sql
security definer set search_path = public
stable
as $$
  select b.course_id,
         coalesce(c.name, 'Unknown'),
         count(*),
         coalesce(sum(b.stake_pence), 0)
    from public.bets b
    left join public.courses c on c.id = b.course_id
   group by b.course_id, c.name
   order by 4 desc;
$$;

revoke execute on function public.admin_totals()            from public, anon, authenticated;
revoke execute on function public.admin_revenue_by_tier()   from public, anon, authenticated;
revoke execute on function public.admin_revenue_by_course() from public, anon, authenticated;
grant  execute on function public.admin_totals()            to service_role;
grant  execute on function public.admin_revenue_by_tier()   to service_role;
grant  execute on function public.admin_revenue_by_course() to service_role;

-- Verify
select public.admin_totals();
select count(*) as profiles_without_email from public.profiles where email is null;
