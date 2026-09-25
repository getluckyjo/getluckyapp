-- ================================================================
-- 030 — The SaSwazi Golf Trek, and Bomb Squad's tab label
--
--   * The SaSwazi Golf Trek: Umdoni Park Golf Club, Friday 2 October
--     2026, R100 000 covered by Get Lucky (not insured by Indwe), 24
--     players. One hole: the 16th, Umdoni's signature par 3, which drops
--     steeply downhill from an elevated tee. 185 m from the white (back)
--     tees, about 178 m from the blue. Its link is /golf-day/saswazi, its
--     tab "SaSwazi".
--   * Bomb Squad's tab label becomes "BS": "Bomb Squad" is cut to
--     "BOMB SQ…" on a narrow phone. Only while it still carries 029's
--     label; a label set in the admin since is left alone.
--
-- Data only, through the tables and rules of 029. Must run after 029.
-- Idempotent.
-- ================================================================

insert into public.golf_days (slug, name, tab_label, plays_on, prize_pence, max_players, note)
values ('saswazi', 'SaSwazi Golf Trek', 'SaSwazi', date '2026-10-02', 10000000, 24,
        'Umdoni Park, hole 16. Prize covered by Get Lucky.')
on conflict (slug) do nothing;

insert into public.golf_day_holes (golf_day_id, hole_id)
select d.id, h.id
  from public.golf_days d
  join public.courses c on lower(c.name) = lower('Umdoni Park Golf Club')
  join public.holes h on h.course_id = c.id and h.hole_number = 16
 where d.slug = 'saswazi'
on conflict do nothing;

update public.golf_days
   set tab_label = 'BS'
 where slug = 'bombsquad'
   and tab_label = 'Bomb Squad';

-- Verify: both golf days and their holes. Expect SaSwazi with Umdoni Park
-- 16 at 185 m, Bomb Squad (tab BS) with East 16 and West 17; every hole
-- par 3, active, at a partner course.
select d.slug, d.name, d.tab_label, d.plays_on, d.prize_pence / 100 as prize_rand, d.max_players,
       c.name as course, h.hole_number, h.par, h.distance_metres, h.is_active, c.is_partner
  from public.golf_days d
  join public.golf_day_holes gh on gh.golf_day_id = d.id
  join public.holes h on h.id = gh.hole_id
  join public.courses c on c.id = h.course_id
 where d.slug in ('saswazi', 'bombsquad')
 order by d.slug, c.name, h.hole_number;
