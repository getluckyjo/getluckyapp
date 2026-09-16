-- Which migrations has this database had? One row per migration, applied
-- or MISSING, judged by an object each one creates. Read-only; paste into
-- the Supabase SQL editor. Apply anything MISSING in numeric order.
with checks(n, name, applied) as (values
  ('001', 'schema',               to_regclass('public.profiles') is not null),
  ('002', 'leads',                to_regclass('public.leads') is not null),
  ('003', 'age_consent',          exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='date_of_birth')),
  ('004', 'tier_6',               exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='bet_tier' and e.enumlabel='tier_6')),
  ('005', 'payment_verification', to_regclass('public.payfast_payments') is not null),
  ('006', 'rls_lockdown',         to_regprocedure('public.guard_profile_columns()') is not null),
  ('007', 'claim_integrity',      exists (select 1 from information_schema.columns where table_schema='public' and table_name='bets' and column_name='expires_at')),
  ('008', 'payment_hardening',    exists (select 1 from information_schema.columns where table_schema='public' and table_name='bets' and column_name='pf_payment_id')),
  ('009', 'rate_limits',          to_regclass('public.rate_limits') is not null),
  ('010', 'admin_queries',        exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='email')),
  ('011', 'retention',            exists (select 1 from information_schema.columns where table_schema='public' and table_name='bets' and column_name='footage_purged_at')),
  ('012', 'evidence_capture',     to_regclass('public.claim_witnesses') is not null),
  ('013', 'risk_review',          exists (select 1 from information_schema.columns where table_schema='public' and table_name='bets' and column_name='risk_score')),
  ('014', 'confirmation',         to_regclass('public.course_contacts') is not null),
  ('015', 'outbox',               to_regclass('public.outbox') is not null),
  ('016', 'beta',                 to_regclass('public.feedback') is not null),
  ('017', 'course_image_url',     exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='image_url')),
  ('018', 'icons',                to_regclass('public.icon_votes') is not null),
  ('019', 'top100_courses',       exists (select 1 from public.courses where lower(name) = 'st francis links' and is_partner))
)
select n, name, case when applied then 'applied' else 'MISSING' end as status
from checks order by n;

-- Also useful before launch:
-- select id, email, is_admin from public.profiles where is_admin;            -- who can review claims
-- select c.name, count(cc.*) contacts from public.courses c
--   left join public.course_contacts cc on cc.course_id = c.id
--   where c.is_partner group by c.name order by contacts, c.name;             -- courses with no club contact
