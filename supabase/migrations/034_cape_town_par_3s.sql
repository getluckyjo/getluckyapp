-- ================================================================
-- 034 — Cape Town par 3s, corrected from the clubs' cards
--
-- Random Golf Club's South Africa trip (14–20 February 2027) plays eight
-- courses around Cape Town. Checked against each club's own scorecard
-- (October 2026), migration 019's par 3s for them were wrong in four ways:
--
--   * Royal Cape: the distances were the white tees in yards, stored as
--     metres. Now the yellow tees in metres (GolfPass's card converted;
--     hole 15 agrees with Golfify's metric card at 148 m).
--   * Steenberg: the wrong holes. Its par 3s are 2, 7, 14 and 17, not 3,
--     6, 11 and 14. Yellow tees (GolfPass's card, converted from yards).
--     The club's own page gives one length per hole (the white tees):
--     2: 157, 7: 140, 14: 166, 17: 139.
--   * Stellenbosch: the wrong holes. Its par 3s are 7, 9, 13 and 15; 4 is
--     a par 4 and 12 a par 5. Yellow tees, from the club's October 2025
--     card.
--   * Arabella (yellow tees, club card dated 1 November 2024; yellow
--     rather than white so its 14th, played for paid entries, stays over
--     140 m: 170 yellow, 130 white), Pearl Valley (white, the club's
--     course layout) and De Zalze (yellow, club card and 18birdies): the
--     right holes, out-of-date distances.
--
-- Clovelly's numbers already match the club's white tees. Metropolitan
-- Golf Club, where the trip starts, was not in the app: it is added with
-- its four par 3s from the club's hole guide (white tees). It is a nine
-- with fourteen greens, played as eighteen.
--
-- The app keeps one distance per hole, from the tee each course's chosen
-- hole is played from (src/lib/holes.ts: a par 3 of 140 m or more). A day
-- played from other tees changes that hole in Admin → Courses.
--
-- Only rows still carrying 019's numbers change: an edit made in the
-- admin since is left alone. A hole that is not a par 3 is switched off,
-- not deleted (a swing may point at it). Data only. Idempotent.
-- ================================================================

-- ----------------------------------------------------------------
-- Distances: hole by hole, only where 019's number is still there
-- ----------------------------------------------------------------
update public.holes h
   set distance_metres = v.corrected
  from (values
          ('Royal Cape Golf Club',    4, 125, 127),
          ('Royal Cape Golf Club',    8, 162, 163),
          ('Royal Cape Golf Club',   13, 166, 165),
          ('Royal Cape Golf Club',   15, 144, 148),
          ('Steenberg Golf Club',    14, 152, 184),
          ('Arabella Golf Club',      5, 161, 153),
          ('Arabella Golf Club',      7, 186, 181),
          ('Arabella Golf Club',     14, 142, 170),
          ('Arabella Golf Club',     17, 174, 167),
          ('Stellenbosch Golf Club',  7, 140, 139),
          ('Stellenbosch Golf Club', 15, 178, 185),
          ('Pearl Valley Golf Club',  3, 175, 145),
          ('Pearl Valley Golf Club',  6, 176, 152),
          ('Pearl Valley Golf Club', 13, 175, 140),
          ('Pearl Valley Golf Club', 17, 211, 183),
          ('De Zalze Golf Club',      3, 133, 159),
          ('De Zalze Golf Club',      9, 118, 146),
          ('De Zalze Golf Club',     12, 140, 171),
          ('De Zalze Golf Club',     16, 156, 201)
       ) as v (course_name, hole_number, seeded, corrected),
       public.courses c
 where c.id = h.course_id
   and lower(c.name) = lower(v.course_name)
   and h.hole_number = v.hole_number
   and h.distance_metres = v.seeded;

-- ----------------------------------------------------------------
-- Holes 019 listed that are not par 3s at the club: switched off
-- ----------------------------------------------------------------
update public.holes h
   set is_active = false
  from (values
          ('Steenberg Golf Club',     3, 155),
          ('Steenberg Golf Club',     6, 167),
          ('Steenberg Golf Club',    11, 140),
          ('Stellenbosch Golf Club',  4, 152),
          ('Stellenbosch Golf Club', 12, 165)
       ) as v (course_name, hole_number, seeded),
       public.courses c
 where c.id = h.course_id
   and lower(c.name) = lower(v.course_name)
   and h.hole_number = v.hole_number
   and h.distance_metres = v.seeded
   and h.is_active;

-- ----------------------------------------------------------------
-- Metropolitan Golf Club, new
-- ----------------------------------------------------------------
insert into public.courses (name, location_text, region, country, lat, lng, is_partner)
select 'Metropolitan Golf Club', 'Mouille Point, Cape Town', 'Western Cape', 'South Africa', -33.903, 18.406, true
 where not exists (select 1 from public.courses where lower(name) = lower('Metropolitan Golf Club'));

-- ----------------------------------------------------------------
-- The par 3s 019 did not have, where that hole number is not there yet
-- ----------------------------------------------------------------
insert into public.holes (course_id, hole_number, par, distance_metres)
select c.id, v.hole_number, 3, v.distance_metres
  from (values
          ('Steenberg Golf Club',     2, 167),
          ('Steenberg Golf Club',     7, 148),
          ('Steenberg Golf Club',    17, 162),
          ('Stellenbosch Golf Club',  9, 148),
          ('Stellenbosch Golf Club', 13, 151),
          ('Metropolitan Golf Club',  6, 152),
          ('Metropolitan Golf Club',  9, 168),
          ('Metropolitan Golf Club', 15, 172),
          ('Metropolitan Golf Club', 18, 148)
       ) as v (course_name, hole_number, distance_metres)
  join public.courses c on lower(c.name) = lower(v.course_name)
on conflict (course_id, hole_number) do nothing;

-- Verify: the eight trip courses' par 3s. Expect Royal Cape 15 at 148,
-- Steenberg 2/7/14/17 active and 3/6/11 off, Stellenbosch 7/9/13/15 active
-- and 4/12 off, Metropolitan with four, every course a partner.
select c.name as course, h.hole_number, h.par, h.distance_metres, h.is_active, c.is_partner
  from public.courses c
  join public.holes h on h.course_id = c.id
 where lower(c.name) in (lower('Metropolitan Golf Club'), lower('Royal Cape Golf Club'), lower('Steenberg Golf Club'),
                         lower('Arabella Golf Club'), lower('Stellenbosch Golf Club'), lower('Clovelly Country Club'),
                         lower('Pearl Valley Golf Club'), lower('De Zalze Golf Club'))
 order by c.name, h.hole_number;
