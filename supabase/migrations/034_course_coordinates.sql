-- ================================================================
-- 034 — Course coordinates, checked and corrected
--
--   After 033 found Umdoni Park 6 km out, every other course's coordinates
--   from 019 were checked against independent sources: OpenStreetMap's
--   golf course outlines (centre of the course), GolfPass's map pins,
--   Wikidata, 18birdies and clubs' own published GPS. Most corrections
--   rest on two sources agreeing within 500 m.
--
--   71 courses move; 41 of them were more than 2 km from the course,
--   so far_from_course (2 km, risk/thresholds.ts) would have flagged every
--   genuine claim there. The worst: Wedgewood 26 km, Magalies Park 25 km,
--   Elements 13 km, Bosch Hoek 9 km, Emfuleni 8 km. Royal Johannesburg's
--   East and West courses get a point each instead of one shared point.
--
--   Left as they are (within 1 km of an independent source): Arabella,
--   Bryanston, Champagne Sports, Country Club Johannesburg – Rocklands,
--   Dainfern, Erinvale, the three Fancourt courses, Mount Edgecombe One and
--   Two, Oubaai, Pearl Valley, Pecanwood, Pezula, Pinnacle Point, Prince's
--   Grant, both Randpark courses, San Lameer, Serengeti, Simola, St Francis
--   Links, Steyn City, The Els Club – Copperleaf, Zebula, Zimbali; Umdoni
--   Park was corrected by 033. Schoeman Park (1.05 km from Wikidata's
--   point) was not checked further.
--
--   Less certain: Bosch Hoek is the midpoint of the club's published GPS and
--   GolfPass's pin, 1.4 km apart. Bloemfontein Golf Club takes GolfPass and
--   Wikidata's point; an OSM outline 0.6 km south-west may be its neighbour
--   Schoeman Park.
--
--   Only rows still carrying 019's numbers change; coordinates set in the
--   admin since are left alone. Footage already recorded keeps the distance
--   measured at the time.
--
-- Data only. Idempotent.
-- ================================================================

update public.courses c
   set lat = v.new_lat::double precision,
       lng = v.new_lng::double precision
  from (values
    ('Atlantic Beach Golf Estate', -33.743, 18.487, -33.7431, 18.4488),  -- 3.5 km; OSM fairways; Apple Maps, Wikidata
    ('Blair Atholl Golf & Equestrian Estate', -25.93, 27.86, -25.9068, 27.9146),  -- 6.0 km; GolfPass, 18birdies, OSM estate (midpoint)
    ('Bloemfontein Golf Club', -29.105, 26.199, -29.1166, 26.2575),  -- 5.8 km; GolfPass and Wikidata agree; OSM polygon 0.6 km SW may be neighbouring Schoeman Park
    ('Bosch Hoek Golf Estate', -29.393, 30.014, -29.3567, 30.0964),  -- 8.9 km; midpoint of club's own GPS and GolfPass (1.4 km apart)
    ('Centurion Country Club', -25.857, 28.196, -25.8734, 28.2044),  -- 2.0 km; GolfPass; Wikidata 0.22 km
    ('Clovelly Country Club', -34.128, 18.435, -34.1229, 18.4249),  -- 1.1 km; OSM course; GolfPass 0.35 km
    ('Cotswold Downs Golf Club', -29.773, 30.769, -29.7524, 30.7902),  -- 3.1 km; GolfPass; OSM 0.2 km
    ('Country Club Johannesburg – Woodmead', -26.047, 28.096, -26.0515, 28.0777),  -- 1.9 km; OSM course; 18birdies 0.17 km
    ('De Zalze Golf Club', -33.964, 18.841, -33.9766, 18.835),  -- 1.5 km; OSM course; Wikidata 0.6 km
    ('Eagle Canyon Golf Club', -26.082, 27.93, -26.0896, 27.9162),  -- 1.6 km; OSM course; GolfPass, 18birdies 0.8 km
    ('East London Golf Club', -32.973, 27.923, -32.9963, 27.936),  -- 2.9 km; GolfPass; Wikidata 0.1 km
    ('Ebotse Golf & Country Estate', -26.167, 28.334, -26.1478, 28.3518),  -- 2.8 km; GolfPass; Wikidata 0.38 km
    ('Elements Private Golf Reserve', -24.85, 28.25, -24.7955, 28.1332),  -- 13.3 km; OSM estate; GolfPass 0.4 km
    ('Emfuleni Golf Estate', -26.685, 27.79, -26.7454, 27.8408),  -- 8.4 km; GolfPass; Wikidata 0.28 km
    ('Euphoria Golf Estate', -24.58, 28.7, -24.5472, 28.6439),  -- 6.7 km; GolfPass; Wikidata agrees 0.3 km
    ('Eye of Africa Golf Estate', -26.378, 28.014, -26.3632, 28.021),  -- 1.8 km; GolfPass; 18birdies
    ('George Golf Club', -33.958, 22.405, -33.9571, 22.4411),  -- 3.3 km; OSM course; GolfPass 0.3 km
    ('Glendower Golf Club', -26.149, 28.152, -26.1558, 28.1396),  -- 1.4 km; OSM course; GolfPass 0.55 km
    ('Glenvista Country Club', -26.295, 28.095, -26.2803, 28.0586),  -- 4.0 km; OSM course; GolfPass 40 m
    ('Goldfields West Golf Club', -26.39, 27.465, -26.3921, 27.4736),  -- 0.9 km; GolfPass
    ('Goose Valley Golf Club', -34.025, 23.305, -34.0263, 23.3804),  -- 7.0 km; GolfPass; sa-venues 30 m
    ('Gowrie Farm Golf Course', -29.364, 30.003, -29.3636, 30.0097),  -- 0.7 km; OSM course; GolfPass 0.9 km
    ('Hermanus Golf Club', -34.424, 19.233, -34.4059, 19.2576),  -- 3.0 km; OSM course; GolfPass clubhouse 0.9 km
    ('Highland Gate Golf & Trout Estate', -25.448, 30.205, -25.4449, 30.2098),  -- 0.6 km; OSM course; GolfPass 0.6 km
    ('Houghton Golf Club', -26.17, 28.06, -26.1643, 28.07),  -- 1.2 km; GolfPass; 18birdies
    ('Humewood Golf Club', -33.98, 25.656, -33.9996, 25.6786),  -- 3.0 km; OSM course; GolfPass, Wikidata
    ('Irene Country Club', -25.87, 28.218, -25.8837, 28.2184),  -- 1.5 km; OSM course; GolfPass 0.5 km
    ('Jackal Creek Golf Estate', -26.04, 27.9, -26.0567, 27.9205),  -- 2.8 km; OSM course; GolfPass 0.75 km
    ('Katberg Eco Golf Estate', -32.489, 26.667, -32.4938, 26.6801),  -- 1.3 km; OSM course; GolfPass 0.4 km
    ('Killarney Country Club', -26.172, 28.05, -26.1535, 28.0586),  -- 2.2 km; OSM course; GolfPass, Wikidata 0.44 km
    ('King David Mowbray Golf Club', -33.952, 18.471, -33.9487, 18.4935),  -- 2.1 km; OSM course; Wikidata
    ('Kingswood Golf Estate', -33.97, 22.4, -33.9696, 22.4325),  -- 3.0 km; OSM course; GolfPass 0.3 km
    ('Knysna Golf Club', -34.045, 23.046, -34.0583, 23.0789),  -- 3.4 km; GolfPass; mapcarta
    ('Krugersdorp Golf Club', -26.106, 27.782, -26.0821, 27.7853),  -- 2.7 km; OSM course; Wikidata 30 m
    ('Kyalami Country Club', -26.01, 28.077, -25.9759, 28.0593),  -- 4.2 km; OSM course; GolfPass 0.3 km
    ('Leopard Creek Country Club', -25.471, 31.559, -25.4416, 31.5348),  -- 4.1 km; OSM clubhouse; Wikidata 0.35 km
    ('Maccauvlei Golf Club', -26.66, 27.92, -26.6821, 27.9424),  -- 3.3 km; GolfPass; Wikidata 0.15 km
    ('Magalies Park Golf Club', -25.68, 27.55, -25.7543, 27.781),  -- 24.6 km; OSM course; GolfPass 0.3 km
    ('Milnerton Golf Club', -33.858, 18.505, -33.869, 18.4925),  -- 1.7 km; OSM course; Wikidata
    ('Modderfontein Golf Club', -26.096, 28.163, -26.1047, 28.1657),  -- 1.0 km; OSM course; GolfPass 0.3 km
    ('Mossel Bay Golf Club', -34.178, 22.13, -34.1913, 22.1279),  -- 1.5 km; OSM course; GolfPass 0.33 km
    ('Nelspruit Golf Club', -25.476, 30.969, -25.4794, 31.0009),  -- 3.2 km; Matumi Golf Estate; OSM; GolfPass 0.3 km
    ('Olivewood Private Estate & Golf Club', -32.83, 28.07, -32.8393, 28.0882),  -- 2.0 km; GolfPass; maptons
    ('Paarl Golf Club (Boschenmeer)', -33.741, 18.968, -33.7689, 18.9783),  -- 3.2 km; OSM course; GolfPass 0.4 km, Wikidata
    ('Parkview Golf Club', -26.165, 28.034, -26.1591, 28.0188),  -- 1.7 km; OSM course; Wikidata 60 m
    ('Parys Golf & Country Estate', -26.892, 27.465, -26.8877, 27.4682),  -- 0.6 km; OSM Golf Island; GolfPass 0.29 km
    ('Plettenberg Bay Country Club', -34.052, 23.368, -34.0617, 23.349),  -- 2.1 km; GolfPass; West2WildCoast 0.1 km
    ('Port Elizabeth Golf Club', -33.96, 25.612, -33.9588, 25.5811),  -- 2.9 km; OSM course; GolfPass+Wikidata 0.65 km
    ('Pretoria Country Club', -25.792, 28.234, -25.7845, 28.2526),  -- 2.0 km; GolfPass; Wikidata 40 m
    ('Reading Country Club', -26.254, 28.116, -26.2638, 28.1053),  -- 1.5 km; OSM course; GolfPass 0.25 km
    ('Royal Cape Golf Club', -34.004, 18.478, -34.0199, 18.4891),  -- 2.0 km; OSM course; Wikidata
    ('Royal Johannesburg & Kensington – East', -26.182, 28.113, -26.1499, 28.1111),  -- 3.6 km; OSM East course; GolfPass 0.22 km
    ('Royal Johannesburg & Kensington – West', -26.182, 28.113, -26.1563, 28.1035),  -- 3.0 km; OSM West course; GolfPass 0.48 km
    ('Royal Port Alfred Golf Club', -33.592, 26.89, -33.6034, 26.8844),  -- 1.4 km; GolfPass; Wikidata 0.46 km
    ('Ruimsig Country Club', -26.093, 27.862, -26.0816, 27.8684),  -- 1.4 km; OSM course; GolfPass 0.3 km
    ('Sishen Golf Club', -27.71, 23.05, -27.6854, 23.0562),  -- 2.8 km; OSM course; GolfPass, Wikidata
    ('Southbroom Golf Club', -30.913, 30.315, -30.918, 30.3222),  -- 0.9 km; OSM; GolfPass 0.1 km
    ('St Francis Bay Golf Club', -34.17, 24.84, -34.1622, 24.826),  -- 1.6 km; GolfPass; maptons
    ('Steenberg Golf Club', -34.066, 18.437, -34.0681, 18.4275),  -- 0.9 km; OSM course; GolfPass 0.1 km
    ('Stellenbosch Golf Club', -33.935, 18.87, -33.962, 18.8461),  -- 3.7 km; OSM course; Wikidata
    ('Sun City – Gary Player CC', -25.345, 27.093, -25.3396, 27.1067),  -- 1.5 km; OSM course; Wikidata 0.05 km
    ('Sun City – The Lost City', -25.335, 27.1, -25.3341, 27.0894),  -- 1.1 km; OSM course
    ('Umhlali Country Club', -29.465, 31.203, -29.514, 31.194),  -- 5.5 km; OSM course; GolfPass 0.2 km
    ('Victoria Country Club', -29.571, 30.361, -29.5746, 30.3341),  -- 2.6 km; ProVisualizer; GolfPass 0.12 km
    ('Wanderers Golf Club', -26.142, 28.055, -26.1295, 28.0575),  -- 1.4 km; OSM course; Wikidata 30 m
    ('Waterkloof Golf Club', -25.79, 28.23, -25.7912, 28.2192),  -- 1.1 km; OSM course; 18birdies 0.35 km
    ('Wedgewood Golf & Country Estate', -33.87, 25.67, -33.9051, 25.3891),  -- 26.2 km; OSM course; GolfPass 0.55 km
    ('Westlake Golf Club', -34.082, 18.438, -34.0823, 18.4465),  -- 0.8 km; OSM course; GolfPass 0.25 km
    ('Wild Coast Sun Country Club', -31.08, 30.17, -31.0852, 30.1864),  -- 1.7 km; GolfPass; KZN tourism 0.1 km
    ('Wingate Park Country Club', -25.8, 28.32, -25.8308, 28.2804),  -- 5.2 km; OSM course; Wikidata 50 m
    ('Woodhill Country Club', -25.815, 28.34, -25.8206, 28.3127)  -- 2.8 km; OSM course; Wikidata
  ) as v (name, seeded_lat, seeded_lng, new_lat, new_lng)
 where c.name = v.name
   and c.lat = v.seeded_lat::double precision
   and c.lng = v.seeded_lng::double precision;

-- Verify: expect 0 rows. Any row here still carries 019's coordinates for a
-- course this migration corrects (or was renamed since).
select c.name, c.lat, c.lng from public.courses c where (c.name, c.lat, c.lng) in (
  ('Atlantic Beach Golf Estate', -33.743::double precision, 18.487::double precision),
  ('Blair Atholl Golf & Equestrian Estate', -25.93::double precision, 27.86::double precision),
  ('Bloemfontein Golf Club', -29.105::double precision, 26.199::double precision),
  ('Bosch Hoek Golf Estate', -29.393::double precision, 30.014::double precision),
  ('Centurion Country Club', -25.857::double precision, 28.196::double precision),
  ('Clovelly Country Club', -34.128::double precision, 18.435::double precision),
  ('Cotswold Downs Golf Club', -29.773::double precision, 30.769::double precision),
  ('Country Club Johannesburg – Woodmead', -26.047::double precision, 28.096::double precision),
  ('De Zalze Golf Club', -33.964::double precision, 18.841::double precision),
  ('Eagle Canyon Golf Club', -26.082::double precision, 27.93::double precision),
  ('East London Golf Club', -32.973::double precision, 27.923::double precision),
  ('Ebotse Golf & Country Estate', -26.167::double precision, 28.334::double precision),
  ('Elements Private Golf Reserve', -24.85::double precision, 28.25::double precision),
  ('Emfuleni Golf Estate', -26.685::double precision, 27.79::double precision),
  ('Euphoria Golf Estate', -24.58::double precision, 28.7::double precision),
  ('Eye of Africa Golf Estate', -26.378::double precision, 28.014::double precision),
  ('George Golf Club', -33.958::double precision, 22.405::double precision),
  ('Glendower Golf Club', -26.149::double precision, 28.152::double precision),
  ('Glenvista Country Club', -26.295::double precision, 28.095::double precision),
  ('Goldfields West Golf Club', -26.39::double precision, 27.465::double precision),
  ('Goose Valley Golf Club', -34.025::double precision, 23.305::double precision),
  ('Gowrie Farm Golf Course', -29.364::double precision, 30.003::double precision),
  ('Hermanus Golf Club', -34.424::double precision, 19.233::double precision),
  ('Highland Gate Golf & Trout Estate', -25.448::double precision, 30.205::double precision),
  ('Houghton Golf Club', -26.17::double precision, 28.06::double precision),
  ('Humewood Golf Club', -33.98::double precision, 25.656::double precision),
  ('Irene Country Club', -25.87::double precision, 28.218::double precision),
  ('Jackal Creek Golf Estate', -26.04::double precision, 27.9::double precision),
  ('Katberg Eco Golf Estate', -32.489::double precision, 26.667::double precision),
  ('Killarney Country Club', -26.172::double precision, 28.05::double precision),
  ('King David Mowbray Golf Club', -33.952::double precision, 18.471::double precision),
  ('Kingswood Golf Estate', -33.97::double precision, 22.4::double precision),
  ('Knysna Golf Club', -34.045::double precision, 23.046::double precision),
  ('Krugersdorp Golf Club', -26.106::double precision, 27.782::double precision),
  ('Kyalami Country Club', -26.01::double precision, 28.077::double precision),
  ('Leopard Creek Country Club', -25.471::double precision, 31.559::double precision),
  ('Maccauvlei Golf Club', -26.66::double precision, 27.92::double precision),
  ('Magalies Park Golf Club', -25.68::double precision, 27.55::double precision),
  ('Milnerton Golf Club', -33.858::double precision, 18.505::double precision),
  ('Modderfontein Golf Club', -26.096::double precision, 28.163::double precision),
  ('Mossel Bay Golf Club', -34.178::double precision, 22.13::double precision),
  ('Nelspruit Golf Club', -25.476::double precision, 30.969::double precision),
  ('Olivewood Private Estate & Golf Club', -32.83::double precision, 28.07::double precision),
  ('Paarl Golf Club (Boschenmeer)', -33.741::double precision, 18.968::double precision),
  ('Parkview Golf Club', -26.165::double precision, 28.034::double precision),
  ('Parys Golf & Country Estate', -26.892::double precision, 27.465::double precision),
  ('Plettenberg Bay Country Club', -34.052::double precision, 23.368::double precision),
  ('Port Elizabeth Golf Club', -33.96::double precision, 25.612::double precision),
  ('Pretoria Country Club', -25.792::double precision, 28.234::double precision),
  ('Reading Country Club', -26.254::double precision, 28.116::double precision),
  ('Royal Cape Golf Club', -34.004::double precision, 18.478::double precision),
  ('Royal Johannesburg & Kensington – East', -26.182::double precision, 28.113::double precision),
  ('Royal Johannesburg & Kensington – West', -26.182::double precision, 28.113::double precision),
  ('Royal Port Alfred Golf Club', -33.592::double precision, 26.89::double precision),
  ('Ruimsig Country Club', -26.093::double precision, 27.862::double precision),
  ('Sishen Golf Club', -27.71::double precision, 23.05::double precision),
  ('Southbroom Golf Club', -30.913::double precision, 30.315::double precision),
  ('St Francis Bay Golf Club', -34.17::double precision, 24.84::double precision),
  ('Steenberg Golf Club', -34.066::double precision, 18.437::double precision),
  ('Stellenbosch Golf Club', -33.935::double precision, 18.87::double precision),
  ('Sun City – Gary Player CC', -25.345::double precision, 27.093::double precision),
  ('Sun City – The Lost City', -25.335::double precision, 27.1::double precision),
  ('Umhlali Country Club', -29.465::double precision, 31.203::double precision),
  ('Victoria Country Club', -29.571::double precision, 30.361::double precision),
  ('Wanderers Golf Club', -26.142::double precision, 28.055::double precision),
  ('Waterkloof Golf Club', -25.79::double precision, 28.23::double precision),
  ('Wedgewood Golf & Country Estate', -33.87::double precision, 25.67::double precision),
  ('Westlake Golf Club', -34.082::double precision, 18.438::double precision),
  ('Wild Coast Sun Country Club', -31.08::double precision, 30.17::double precision),
  ('Wingate Park Country Club', -25.8::double precision, 28.32::double precision),
  ('Woodhill Country Club', -25.815::double precision, 28.34::double precision)
);
