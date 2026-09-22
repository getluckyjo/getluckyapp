-- 025_icons_new_announcements.sql
-- Two Icons announced after the field was seeded in migration 018:
-- Christian Cullen for Team World and Roland Schoeman for Team South
-- Africa. Their portraits are committed with the rest
-- (public/marketing/icons/headshots), keyed on these names — so the name
-- here has to match src/lib/icons.ts exactly or the card falls back to
-- initials.
--
-- Sort order puts them after the eight already on each side.
-- Re-running is a no-op (unique name), same as 018.

insert into public.icons (name, team, is_captain, tagline, sort_order) values
  ('Roland Schoeman',  'rsa',   false, 'Olympic gold-medallist swimmer', 80),
  ('Christian Cullen', 'world', false, 'All Blacks fullback',            80)
on conflict (name) do nothing;

-- Verify: nine a side, and every name that should have a photo has one.
select team, count(*) from public.icons where is_active group by team order by team;
select name from public.icons where name in ('Roland Schoeman', 'Christian Cullen');
