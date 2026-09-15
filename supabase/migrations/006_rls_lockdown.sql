-- ================================================================
-- 006 — Row Level Security lockdown (AUDIT.md B.1, Batch 1)
--
-- Before this migration a signed-in user could, with the public anon key and
-- their own JWT, talk to PostgREST directly and:
--   * set is_admin = true on their own profile            (full admin)
--   * insert bets with any tier/prize and no payment       (free bets)
--   * set their own bet to 'verified' or 'paid'
--   * insert or update their own verification to 'approved'
--   * read and overwrite every claimant's certificate/affidavit
--   * bump anyone's total_attempts via increment_attempts()
--
-- After it:
--   profiles       users read + update their own row, but a BEFORE trigger
--                  rejects client changes to the columns the server owns.
--   bets           users read their own. All writes go through API routes
--                  using the service role after an ownership check.
--   verifications  users read their own. No client writes.
--   verification-docs bucket   owner-folder scoped (<uid>/...), insert + read
--                  only; no update (submit once). Old objects under the
--                  previous <bet_id>/... scheme stay readable to the admin
--                  (service role) and become invisible to users, which is
--                  the intended outcome.
--   increment_attempts()       callable by the service role only.
--
-- Idempotent: safe to re-run. Apply BEFORE deploying the accompanying code?
-- No — the reverse. The code in this batch works against both the old and
-- the new policies (it already uses the service role for every write), so
-- deploy the code first, then apply this migration, then run
-- `npm run test:staging`. Applying this first against the old code breaks
-- bet creation, result declaration and claims until the deploy lands.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. PROFILES
-- ----------------------------------------------------------------
drop policy if exists "Users can manage their own profile" on public.profiles;
drop policy if exists "Users can view their own profile"   on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- The signup trigger creates the row; this exists so an account page upsert
-- on a legacy user with no row still works. The guard trigger below stops a
-- client insert from carrying privileged values.
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Columns the server owns. A client (anon / authenticated role) may not set
-- them on insert or change them on update. The service role, the dashboard
-- (postgres) and Supabase's own auth role are trusted.
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
  then
    raise exception 'These profile fields are managed by the server and cannot be modified by the client.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_columns on public.profiles;
create trigger trg_guard_profile_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ----------------------------------------------------------------
-- 2. BETS — read own; no client writes
-- ----------------------------------------------------------------
drop policy if exists "Users can create bets"           on public.bets;
drop policy if exists "Users can update their own bets" on public.bets;
-- "Users can view their own bets" (select) stays.

-- ----------------------------------------------------------------
-- 3. VERIFICATIONS — read own; no client writes
-- ----------------------------------------------------------------
drop policy if exists "Users can create verifications for their own bets" on public.verifications;
drop policy if exists "Users can update verifications for their own bets" on public.verifications;
-- "Users can view verifications for their own bets" (select) stays.

-- ----------------------------------------------------------------
-- 4. STORAGE: verification-docs — owner folder only, write once
-- ----------------------------------------------------------------
drop policy if exists "Users can upload verification docs" on storage.objects;
drop policy if exists "Users can update verification docs" on storage.objects;
drop policy if exists "Users can view verification docs"   on storage.objects;
drop policy if exists "Users can upload own verification docs" on storage.objects;
drop policy if exists "Users can view own verification docs"   on storage.objects;

create policy "Users can upload own verification docs"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view own verification docs"
  on storage.objects for select
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------
-- 5. increment_attempts — server only
-- ----------------------------------------------------------------
revoke execute on function public.increment_attempts(uuid) from public, anon, authenticated;
grant  execute on function public.increment_attempts(uuid) to service_role;

-- ----------------------------------------------------------------
-- 6. Verify (prints the policy set; compare with the expected list below)
-- ----------------------------------------------------------------
-- Expected after apply:
--   profiles:      Users can view / insert / update their own profile
--   bets:          Users can view their own bets
--   verifications: Users can view verifications for their own bets
--   payfast_payments: Users can view their own payfast payments
--   storage.objects (verification-docs): upload own / view own
select tablename, policyname, cmd
  from pg_policies
 where schemaname in ('public', 'storage')
   and (tablename in ('profiles', 'bets', 'verifications', 'payfast_payments') or policyname ilike '%verification docs%')
 order by tablename, policyname;
