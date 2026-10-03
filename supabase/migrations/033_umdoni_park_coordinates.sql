-- ================================================================
-- 033 — Umdoni Park's coordinates, corrected
--
--   Migration 019 placed Umdoni Park Golf Club at -30.440, 30.657, about
--   6 km south-west of the course. At the SaSwazi Golf Trek (2 October
--   2026) all four swings on the 16th recorded the same spot, -30.3902,
--   30.6835 (GPS accuracy 3–18 m), which the recorder measured as 6.1 km
--   from the course. far_from_course flags anything past 2 km, so a real
--   hole-in-one at Umdoni would have been flagged.
--
--   The course is at -30.394, 30.690 (GolfPass's map pin for Off Minerva
--   Road, Pennington; the club is at 1 Don Knight Avenue). That is about
--   750 m from the 16th tee readings, and within 2 km of the whole course.
--
--   Only while the row still carries 019's numbers; coordinates set in the
--   admin since are left alone. Footage already recorded keeps the distance
--   measured at the time: a capture report is not rewritten.
--
-- Data only. Idempotent.
-- ================================================================

update public.courses
   set lat = -30.394,
       lng = 30.690
 where lower(name) = lower('Umdoni Park Golf Club')
   and lat = -30.44
   and lng = 30.657;

-- Verify: expect -30.394, 30.690, and about 750 m to the 16th tee readings.
select name, lat, lng,
       round((6371000 * 2 * asin(sqrt(
         power(sin(radians(-30.3902 - lat) / 2), 2) +
         cos(radians(lat)) * cos(radians(-30.3902)) * power(sin(radians(30.6835 - lng) / 2), 2)
       )))::numeric) as metres_to_16th_tee
  from public.courses
 where lower(name) = lower('Umdoni Park Golf Club');
