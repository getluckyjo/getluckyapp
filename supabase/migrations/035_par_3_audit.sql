-- ================================================================
-- 035 — Every course's par 3s checked against the clubs' cards
--
-- Johannes played Atlantic Beach on 9 October 2026 and found the app
-- offering hole 12 as a par 3: the course's nines were swapped years ago,
-- and the par 3s are now 3, 8, 14 and 16. Every course in the app was
-- then checked against its club's own scorecard, hole guide or course
-- page (October 2026), with GolfPass, 18Birdies, Golfify and Hole19
-- cards and SA Top 100's reviews as cross-checks. docs/course-par-3s.md
-- lists the par 3s, the tee and the sources for every course.
--
-- Two things were wrong with migration 019's seed:
--
--   * Twenty-seven courses had at least one wrong hole number: a par 4 or
--     par 5 listed as a par 3, usually from an old routing (Atlantic
--     Beach, Gowrie Farm's nine-hole days) or a numbering slip (Irene and
--     Krugersdorp were off by one on every hole). Those holes are
--     switched off, not deleted (swings may point at them), and the real
--     par 3s are added.
--   * Most of the rest carried GolfPass's yardages as metres, so nearly
--     every distance was 9 to 10 per cent too long; a few carried a
--     forward tee. Distances more than 10 m out from the club's men's
--     tee are corrected; smaller differences are left alone.
--
-- The tee is the club's standard men's tee (white at most clubs, yellow
-- where that is the members' tee); docs/course-par-3s.md names it for
-- each course. The eight Cape Town courses migration 034 settled from
-- the clubs' cards are untouched, as are a few whose distance evidence
-- is weak (named in the doc).
--
-- Only rows still carrying their seeded value change, so an edit made in
-- Admin → Courses since is left alone. Data only. Idempotent.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Distances: hole numbers right, length more than 10 m out
-- ----------------------------------------------------------------
update public.holes h
   set distance_metres = v.corrected
  from (values
          ('Atlantic Beach Golf Estate', 8, 168, 143),
          ('Bloemfontein Golf Club', 4, 171, 187),
          ('Bloemfontein Golf Club', 8, 134, 147),
          ('Bloemfontein Golf Club', 11, 134, 146),
          ('Bloemfontein Golf Club', 16, 131, 143),
          ('Bosch Hoek Golf Estate', 16, 130, 115),
          ('Centurion Country Club', 8, 148, 163),
          ('Champagne Sports Resort', 4, 162, 148),
          ('Champagne Sports Resort', 7, 160, 146),
          ('Champagne Sports Resort', 12, 157, 144),
          ('Country Club Johannesburg – Woodmead', 15, 175, 160),
          ('East London Golf Club', 2, 180, 161),
          ('Ebotse Golf & Country Estate', 2, 202, 185),
          ('Ebotse Golf & Country Estate', 8, 150, 137),
          ('Ebotse Golf & Country Estate', 11, 164, 150),
          ('Ebotse Golf & Country Estate', 15, 149, 136),
          ('Elements Private Golf Reserve', 2, 202, 185),
          ('Elements Private Golf Reserve', 9, 172, 157),
          ('Elements Private Golf Reserve', 11, 188, 172),
          ('Elements Private Golf Reserve', 15, 175, 160),
          ('Erinvale Golf Club', 2, 154, 141),
          ('Erinvale Golf Club', 8, 155, 142),
          ('Erinvale Golf Club', 12, 166, 152),
          ('Erinvale Golf Club', 14, 170, 155),
          ('Euphoria Golf Estate', 8, 162, 195),
          ('Euphoria Golf Estate', 17, 152, 185),
          ('Fancourt – Montagu', 2, 192, 174),
          ('Fancourt – Montagu', 8, 186, 163),
          ('Fancourt – Montagu', 12, 189, 171),
          ('Fancourt – Montagu', 17, 175, 155),
          ('Fancourt – Outeniqua', 4, 197, 182),
          ('Fancourt – Outeniqua', 7, 175, 160),
          ('Fancourt – Outeniqua', 12, 175, 158),
          ('Fancourt – Outeniqua', 15, 156, 138),
          ('Fancourt – The Links', 2, 214, 196),
          ('Fancourt – The Links', 8, 156, 143),
          ('Fancourt – The Links', 11, 148, 135),
          ('Fancourt – The Links', 17, 163, 149),
          ('George Golf Club', 6, 153, 140),
          ('George Golf Club', 13, 150, 137),
          ('George Golf Club', 15, 170, 155),
          ('George Golf Club', 17, 189, 173),
          ('Glendower Golf Club', 3, 208, 190),
          ('Glendower Golf Club', 6, 184, 168),
          ('Glendower Golf Club', 14, 153, 140),
          ('Glendower Golf Club', 17, 217, 198),
          ('Goose Valley Golf Club', 2, 140, 172),
          ('Goose Valley Golf Club', 13, 145, 163),
          ('Hermanus Golf Club', 4, 180, 169),
          ('Hermanus Golf Club', 9, 155, 144),
          ('Hermanus Golf Club', 13, 171, 158),
          ('Highland Gate Golf & Trout Estate', 3, 167, 153),
          ('Highland Gate Golf & Trout Estate', 13, 148, 135),
          ('Highland Gate Golf & Trout Estate', 15, 192, 180),
          ('Highland Gate Golf & Trout Estate', 17, 163, 149),
          ('Houghton Golf Club', 7, 177, 162),
          ('Houghton Golf Club', 9, 178, 163),
          ('Houghton Golf Club', 14, 196, 179),
          ('Houghton Golf Club', 16, 230, 210),
          ('Humewood Golf Club', 3, 210, 192),
          ('Humewood Golf Club', 6, 131, 120),
          ('Humewood Golf Club', 12, 160, 146),
          ('Jackal Creek Golf Estate', 12, 150, 163),
          ('Kingswood Golf Estate', 17, 145, 159),
          ('Knysna Golf Club', 12, 138, 175),
          ('Kyalami Country Club', 3, 178, 166),
          ('Leopard Creek Country Club', 5, 156, 143),
          ('Leopard Creek Country Club', 7, 172, 157),
          ('Leopard Creek Country Club', 12, 136, 124),
          ('Leopard Creek Country Club', 16, 183, 167),
          ('Milnerton Golf Club', 5, 137, 150),
          ('Milnerton Golf Club', 11, 147, 160),
          ('Modderfontein Golf Club', 3, 178, 163),
          ('Modderfontein Golf Club', 9, 185, 169),
          ('Modderfontein Golf Club', 11, 178, 163),
          ('Modderfontein Golf Club', 14, 159, 145),
          ('Mossel Bay Golf Club', 4, 112, 141),
          ('Mossel Bay Golf Club', 8, 122, 152),
          ('Mossel Bay Golf Club', 12, 156, 192),
          ('Mossel Bay Golf Club', 15, 108, 134),
          ('Mount Edgecombe CC – Course Two', 12, 175, 149),
          ('Olivewood Private Estate & Golf Club', 7, 150, 138),
          ('Olivewood Private Estate & Golf Club', 11, 130, 142),
          ('Oubaai Golf Club', 6, 160, 181),
          ('Oubaai Golf Club', 11, 155, 175),
          ('Parys Golf & Country Estate', 8, 173, 191),
          ('Parys Golf & Country Estate', 12, 200, 215),
          ('Parys Golf & Country Estate', 16, 167, 153),
          ('Pecanwood Golf & Country Club', 3, 150, 137),
          ('Pecanwood Golf & Country Club', 8, 191, 175),
          ('Pecanwood Golf & Country Club', 13, 171, 156),
          ('Pecanwood Golf & Country Club', 17, 178, 163),
          ('Pezula Championship Course', 3, 167, 153),
          ('Pezula Championship Course', 5, 191, 175),
          ('Pezula Championship Course', 11, 156, 143),
          ('Pezula Championship Course', 15, 152, 139),
          ('Plettenberg Bay Country Club', 8, 191, 180),
          ('Plettenberg Bay Country Club', 11, 128, 117),
          ('Plettenberg Bay Country Club', 13, 174, 160),
          ('Port Elizabeth Golf Club', 2, 119, 130),
          ('Pretoria Country Club', 5, 162, 178),
          ('Pretoria Country Club', 8, 116, 128),
          ('Pretoria Country Club', 16, 173, 202),
          ('Prince''s Grant Coastal Golf Estate', 3, 166, 152),
          ('Prince''s Grant Coastal Golf Estate', 8, 161, 147),
          ('Prince''s Grant Coastal Golf Estate', 11, 175, 160),
          ('Prince''s Grant Coastal Golf Estate', 17, 198, 181),
          ('Ruimsig Country Club', 7, 168, 195),
          ('San Lameer Country Club', 16, 142, 172),
          ('Serengeti Golf & Wildlife Estate', 5, 122, 150),
          ('Serengeti Golf & Wildlife Estate', 9, 133, 176),
          ('Serengeti Golf & Wildlife Estate', 12, 161, 175),
          ('Serengeti Golf & Wildlife Estate', 15, 122, 135),
          ('Simola Golf Estate', 6, 200, 183),
          ('Simola Golf Estate', 9, 171, 156),
          ('Simola Golf Estate', 11, 191, 175),
          ('Simola Golf Estate', 14, 166, 152),
          ('Simola Golf Estate', 17, 160, 146),
          ('St Francis Bay Golf Club', 3, 185, 170),
          ('St Francis Links', 7, 164, 138),
          ('Sun City – Gary Player CC', 4, 199, 182),
          ('Sun City – Gary Player CC', 7, 210, 192),
          ('Sun City – Gary Player CC', 12, 205, 187),
          ('Sun City – Gary Player CC', 16, 178, 163),
          ('The Club at Steyn City', 5, 203, 186),
          ('The Club at Steyn City', 9, 184, 168),
          ('The Club at Steyn City', 12, 174, 159),
          ('The Club at Steyn City', 14, 201, 184),
          ('The Els Club – Copperleaf', 3, 210, 239),
          ('Victoria Country Club', 6, 164, 150),
          ('Victoria Country Club', 8, 148, 135),
          ('Victoria Country Club', 13, 137, 125),
          ('Victoria Country Club', 17, 157, 144),
          ('Waterkloof Golf Club', 6, 155, 182),
          ('Waterkloof Golf Club', 8, 119, 130),
          ('Waterkloof Golf Club', 15, 141, 168),
          ('Waterkloof Golf Club', 17, 167, 184),
          ('Wild Coast Sun Country Club', 6, 171, 156),
          ('Wild Coast Sun Country Club', 8, 151, 138),
          ('Wild Coast Sun Country Club', 11, 176, 161),
          ('Wild Coast Sun Country Club', 13, 160, 146),
          ('Wild Coast Sun Country Club', 17, 159, 145),
          ('Woodhill Country Club', 12, 188, 154),
          ('Woodhill Country Club', 16, 150, 169),
          ('Zebula Country Club & Spa', 8, 145, 124)
       ) as v (course_name, hole_number, seeded, corrected),
       public.courses c
 where c.id = h.course_id
   and lower(c.name) = lower(v.course_name)
   and h.hole_number = v.hole_number
   and h.distance_metres = v.seeded;

-- ----------------------------------------------------------------
-- 2. Holes the seed listed that are not par 3s at the club: switched off
-- ----------------------------------------------------------------
update public.holes h
   set is_active = false
  from (values
          ('Atlantic Beach Golf Estate', 5, 143),
          ('Atlantic Beach Golf Estate', 12, 187),
          ('Centurion Country Club', 4, 160),
          ('Centurion Country Club', 13, 175),
          ('Centurion Country Club', 16, 164),
          ('Champagne Sports Resort', 17, 195),
          ('Dainfern Golf & Country Club', 8, 155),
          ('Dainfern Golf & Country Club', 13, 183),
          ('Dainfern Golf & Country Club', 17, 145),
          ('Eagle Canyon Golf Club', 3, 185),
          ('Eagle Canyon Golf Club', 7, 160),
          ('Eagle Canyon Golf Club', 12, 173),
          ('Eagle Canyon Golf Club', 15, 148),
          ('Euphoria Golf Estate', 4, 188),
          ('Euphoria Golf Estate', 13, 173),
          ('Goldfields West Golf Club', 5, 162),
          ('Goldfields West Golf Club', 9, 147),
          ('Goldfields West Golf Club', 14, 175),
          ('Gowrie Farm Golf Course', 4, 148),
          ('Gowrie Farm Golf Course', 11, 139),
          ('Gowrie Farm Golf Course', 15, 164),
          ('Humewood Golf Club', 13, 153),
          ('Irene Country Club', 5, 158),
          ('Irene Country Club', 8, 142),
          ('Irene Country Club', 14, 172),
          ('Irene Country Club', 17, 163),
          ('Jackal Creek Golf Estate', 4, 160),
          ('Kingswood Golf Estate', 3, 130),
          ('Kingswood Golf Estate', 8, 150),
          ('Knysna Golf Club', 3, 145),
          ('Knysna Golf Club', 7, 162),
          ('Knysna Golf Club', 16, 170),
          ('Krugersdorp Golf Club', 3, 163),
          ('Krugersdorp Golf Club', 7, 149),
          ('Krugersdorp Golf Club', 12, 172),
          ('Krugersdorp Golf Club', 15, 155),
          ('Mount Edgecombe CC – Course One', 4, 165),
          ('Mount Edgecombe CC – Course One', 7, 153),
          ('Mount Edgecombe CC – Course One', 13, 171),
          ('Mount Edgecombe CC – Course One', 16, 145),
          ('Mount Edgecombe CC – Course Two', 8, 148),
          ('Mount Edgecombe CC – Course Two', 15, 153),
          ('Nelspruit Golf Club', 7, 144),
          ('Nelspruit Golf Club', 12, 159),
          ('Nelspruit Golf Club', 16, 176),
          ('Paarl Golf Club (Boschenmeer)', 2, 159),
          ('Paarl Golf Club (Boschenmeer)', 5, 172),
          ('Paarl Golf Club (Boschenmeer)', 12, 148),
          ('Paarl Golf Club (Boschenmeer)', 15, 165),
          ('Parys Golf & Country Estate', 4, 165),
          ('Reading Country Club', 9, 163),
          ('Reading Country Club', 14, 178),
          ('Reading Country Club', 17, 152),
          ('Ruimsig Country Club', 4, 155),
          ('Ruimsig Country Club', 13, 145),
          ('Ruimsig Country Club', 16, 178),
          ('San Lameer Country Club', 7, 165),
          ('San Lameer Country Club', 12, 158),
          ('Sun City – The Lost City', 5, 168),
          ('Sun City – The Lost City', 12, 182),
          ('Sun City – The Lost City', 16, 195),
          ('Umhlali Country Club', 5, 155),
          ('Umhlali Country Club', 9, 170),
          ('Umhlali Country Club', 14, 148),
          ('Umhlali Country Club', 17, 162),
          ('Wanderers Golf Club', 4, 179),
          ('Wanderers Golf Club', 8, 157),
          ('Wanderers Golf Club', 13, 168),
          ('Wanderers Golf Club', 16, 142),
          ('Woodhill Country Club', 3, 175),
          ('Woodhill Country Club', 8, 162),
          ('Zebula Country Club & Spa', 3, 172)
       ) as v (course_name, hole_number, seeded),
       public.courses c
 where c.id = h.course_id
   and lower(c.name) = lower(v.course_name)
   and h.hole_number = v.hole_number
   and h.distance_metres = v.seeded
   and h.is_active;

-- ----------------------------------------------------------------
-- 3. The par 3s the seed did not have, where that hole number is not there yet
-- ----------------------------------------------------------------
insert into public.holes (course_id, hole_number, par, distance_metres)
select c.id, v.hole_number, 3, v.distance_metres
  from (values
          ('Atlantic Beach Golf Estate', 3, 156),
          ('Atlantic Beach Golf Estate', 14, 162),
          ('Centurion Country Club', 3, 175),
          ('Centurion Country Club', 11, 211),
          ('Centurion Country Club', 17, 153),
          ('Champagne Sports Resort', 16, 178),
          ('Dainfern Golf & Country Club', 6, 159),
          ('Dainfern Golf & Country Club', 11, 167),
          ('Dainfern Golf & Country Club', 16, 182),
          ('Eagle Canyon Golf Club', 4, 152),
          ('Eagle Canyon Golf Club', 8, 165),
          ('Eagle Canyon Golf Club', 11, 162),
          ('Eagle Canyon Golf Club', 17, 144),
          ('Euphoria Golf Estate', 6, 170),
          ('Euphoria Golf Estate', 15, 140),
          ('Goldfields West Golf Club', 4, 187),
          ('Goldfields West Golf Club', 6, 141),
          ('Goldfields West Golf Club', 13, 169),
          ('Gowrie Farm Golf Course', 2, 181),
          ('Gowrie Farm Golf Course', 12, 120),
          ('Gowrie Farm Golf Course', 14, 164),
          ('Gowrie Farm Golf Course', 17, 171),
          ('Humewood Golf Club', 14, 140),
          ('Irene Country Club', 4, 208),
          ('Irene Country Club', 7, 138),
          ('Irene Country Club', 13, 171),
          ('Irene Country Club', 16, 133),
          ('Jackal Creek Golf Estate', 3, 162),
          ('Kingswood Golf Estate', 1, 164),
          ('Kingswood Golf Estate', 11, 163),
          ('Knysna Golf Club', 2, 161),
          ('Knysna Golf Club', 8, 148),
          ('Knysna Golf Club', 14, 130),
          ('Krugersdorp Golf Club', 4, 159),
          ('Krugersdorp Golf Club', 6, 167),
          ('Krugersdorp Golf Club', 11, 154),
          ('Krugersdorp Golf Club', 14, 153),
          ('Mount Edgecombe CC – Course One', 3, 155),
          ('Mount Edgecombe CC – Course One', 5, 176),
          ('Mount Edgecombe CC – Course One', 9, 190),
          ('Mount Edgecombe CC – Course One', 11, 193),
          ('Mount Edgecombe CC – Course One', 15, 165),
          ('Mount Edgecombe CC – Course Two', 7, 170),
          ('Mount Edgecombe CC – Course Two', 17, 177),
          ('Nelspruit Golf Club', 5, 130),
          ('Nelspruit Golf Club', 13, 150),
          ('Nelspruit Golf Club', 17, 120),
          ('Paarl Golf Club (Boschenmeer)', 4, 190),
          ('Paarl Golf Club (Boschenmeer)', 7, 163),
          ('Paarl Golf Club (Boschenmeer)', 14, 118),
          ('Paarl Golf Club (Boschenmeer)', 17, 155),
          ('Parys Golf & Country Estate', 5, 194),
          ('Reading Country Club', 7, 157),
          ('Reading Country Club', 11, 177),
          ('Reading Country Club', 15, 135),
          ('Ruimsig Country Club', 5, 151),
          ('Ruimsig Country Club', 11, 169),
          ('Ruimsig Country Club', 17, 198),
          ('San Lameer Country Club', 9, 182),
          ('San Lameer Country Club', 14, 148),
          ('Sun City – The Lost City', 3, 161),
          ('Sun City – The Lost City', 13, 157),
          ('Sun City – The Lost City', 15, 142),
          ('Umhlali Country Club', 4, 170),
          ('Umhlali Country Club', 6, 132),
          ('Umhlali Country Club', 11, 162),
          ('Umhlali Country Club', 18, 161),
          ('Wanderers Golf Club', 6, 145),
          ('Wanderers Golf Club', 12, 150),
          ('Wanderers Golf Club', 15, 175),
          ('Wanderers Golf Club', 17, 145),
          ('Woodhill Country Club', 2, 192),
          ('Woodhill Country Club', 7, 184),
          ('Zebula Country Club & Spa', 4, 199)
       ) as v (course_name, hole_number, distance_metres)
  join public.courses c on lower(c.name) = lower(v.course_name)
on conflict (course_id, hole_number) do nothing;

-- Verify: the courses whose hole numbers changed. Expect Atlantic Beach
-- 3/8/14/16 active and 5/12 off, Irene 4/7/13/16 active and 5/8/14/17 off,
-- and no active hole that is not a par 3.
select c.name as course, h.hole_number, h.par, h.distance_metres, h.is_active
  from public.courses c
  join public.holes h on h.course_id = c.id
 where lower(c.name) in (
         lower('Atlantic Beach Golf Estate'),
         lower('Centurion Country Club'),
         lower('Champagne Sports Resort'),
         lower('Dainfern Golf & Country Club'),
         lower('Eagle Canyon Golf Club'),
         lower('Euphoria Golf Estate'),
         lower('Goldfields West Golf Club'),
         lower('Gowrie Farm Golf Course'),
         lower('Humewood Golf Club'),
         lower('Irene Country Club'),
         lower('Jackal Creek Golf Estate'),
         lower('Kingswood Golf Estate'),
         lower('Knysna Golf Club'),
         lower('Krugersdorp Golf Club'),
         lower('Mount Edgecombe CC – Course One'),
         lower('Mount Edgecombe CC – Course Two'),
         lower('Nelspruit Golf Club'),
         lower('Paarl Golf Club (Boschenmeer)'),
         lower('Parys Golf & Country Estate'),
         lower('Reading Country Club'),
         lower('Ruimsig Country Club'),
         lower('San Lameer Country Club'),
         lower('Sun City – The Lost City'),
         lower('Umhlali Country Club'),
         lower('Wanderers Golf Club'),
         lower('Woodhill Country Club'),
         lower('Zebula Country Club & Spa'))
 order by c.name, h.hole_number;
