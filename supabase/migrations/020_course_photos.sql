-- ================================================================
-- 020 — A photo for every listed course
--
-- The original app's seed carried a photo URL per course from
-- satop100courses.com (used with permission). Migration 017 added
-- courses.image_url and 019 listed every course; this fills the column by
-- name so the select-course cards show a picture for all of them. Our own
-- committed photos (public/marketing/courses) still take precedence on the
-- card; the database URL is the fallback (src/lib/course-photo.ts).
--
-- Only rows with no image yet are touched, so a photo set in Admin →
-- Courses is never overwritten. Re-running is a no-op.
-- ================================================================

with seed (name, image_url) as (values
  ('Leopard Creek Country Club', 'https://satop100courses.com/wp-content/uploads/2023/07/LC-01.jpg'),
  ('Fancourt – The Links', 'https://satop100courses.com/wp-content/uploads/2019/10/fancoury-l.jpg'),
  ('St Francis Links', 'https://satop100courses.com/wp-content/uploads/2022/03/St_FrancisLinks.jpg'),
  ('Blair Atholl Golf & Equestrian Estate', 'https://satop100courses.com/wp-content/uploads/2019/08/Blair-Atholl-GCL-5.jpg'),
  ('Arabella Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Arabella.jpg'),
  ('Pearl Valley Golf Club', 'https://satop100courses.com/wp-content/uploads/2022/03/PearlValley.jpg'),
  ('Fancourt – Montagu', 'https://satop100courses.com/wp-content/uploads/2019/10/Montagu-Course-at-Fancourt.jpg'),
  ('Glendower Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Glendower-14th-p3-a.jpg'),
  ('Sishen Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/Sishen-18th-p4-b.jpg'),
  ('East London Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/east-london.jpg'),
  ('Pinnacle Point Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/pinnacle-point.jpg'),
  ('Royal Johannesburg & Kensington – East', 'https://satop100courses.com/wp-content/uploads/2019/10/Royal-East-2018-13th-A.jpg'),
  ('Elements Private Golf Reserve', 'https://satop100courses.com/wp-content/uploads/2019/08/Elements-7th-p5-AER-1.jpg'),
  ('The Club at Steyn City', 'https://satop100courses.com/wp-content/uploads/2019/08/steyn-city.jpg'),
  ('Humewood Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/Humewood-15th-a.jpg'),
  ('Zimbali Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/zimbali14thpar3.jpg'),
  ('Sun City – Gary Player CC', 'https://satop100courses.com/wp-content/uploads/2022/03/DJI_0031_gpcc17thC.jpg'),
  ('Pezula Championship Course', 'https://satop100courses.com/wp-content/uploads/2019/08/Pezula-14th-p4-ax.jpg'),
  ('Highland Gate Golf & Trout Estate', 'https://satop100courses.com/wp-content/uploads/2019/08/highland-gate.jpg'),
  ('Champagne Sports Resort', 'https://satop100courses.com/wp-content/uploads/2019/09/DSC_0695.jpg'),
  ('Simola Golf Estate', 'https://satop100courses.com/wp-content/uploads/2019/08/Simola-10th-A.jpg'),
  ('George Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/2022-George-Golf-Club.jpg'),
  ('Country Club Johannesburg – Woodmead', 'https://satop100courses.com/wp-content/uploads/2019/09/CCJ-Woodmead-18th-A-Dec-2011.jpg'),
  ('Pretoria Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Pretoria-CC.jpg'),
  ('Fancourt – Outeniqua', 'https://satop100courses.com/wp-content/uploads/2019/10/Outeniqua-Course-at-Fancourt.jpg'),
  ('Erinvale Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Erinvale-8th-p3-A.jpg'),
  ('Country Club Johannesburg – Rocklands', 'https://satop100courses.com/wp-content/uploads/2019/09/Rocklands-7th-A.jpg'),
  ('Royal Johannesburg & Kensington – West', 'https://satop100courses.com/wp-content/uploads/2019/10/Royal-West-3rd-p4-X.jpg'),
  ('De Zalze Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/De-Zalze-12-a.jpg'),
  ('Houghton Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/11/Houghton-17th-d.jpg'),
  ('Pecanwood Golf & Country Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Pecanwood-3rd-p3-B.jpg'),
  ('Kyalami Country Club', 'https://satop100courses.com/wp-content/uploads/2019/10/kyalami-02-e1611032596468.jpg'),
  ('Bryanston Country Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Bryanston-CC-9th-D-Mar-2017-.jpg'),
  ('Victoria Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Victoria-17th-p3-a.jpg'),
  ('Parkview Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/PArkview-15th-p3-A.jpg'),
  ('Randpark Golf Club – Firethorn', 'https://satop100courses.com/wp-content/uploads/2019/10/firethorn.jpg'),
  ('Eye of Africa Golf Estate', 'https://satop100courses.com/wp-content/uploads/2019/09/hole-15.jpg'),
  ('Royal Cape Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Royal-Cape-16th-b.jpg'),
  ('Hermanus Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Hermanus-13th-p3-a.jpg'),
  ('Ebotse Golf & Country Estate', 'https://satop100courses.com/wp-content/uploads/2019/09/Ebotse-10th-f.jpg'),
  ('Wild Coast Sun Country Club', 'https://satop100courses.com/wp-content/uploads/2022/03/WCS_Aerial_north.jpg'),
  ('Serengeti Golf & Wildlife Estate', 'https://satop100courses.com/wp-content/uploads/2019/10/Serengeti-Jan-2018-18th-b.jpg'),
  ('Maccauvlei Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Maccauvlei-03.jpg'),
  ('Wingate Park Country Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Wingate-18th-p5-a.jpg'),
  ('Plettenberg Bay Country Club', 'https://satop100courses.com/wp-content/uploads/2022/01/plett.jpg'),
  ('Killarney Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Killarney-18th-p4-A.jpg'),
  ('Clovelly Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Clovelly-Golf-Course-2018-Mark-Sampson-39.jpg'),
  ('Modderfontein Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/11/modderfontein.jpg'),
  ('Cotswold Downs Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Cotswold_HiRes.jpg'),
  ('The Els Club – Copperleaf', 'https://satop100courses.com/wp-content/uploads/2019/11/Copperleaf-11th-A.jpg'),
  ('Steenberg Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/7th-hole.jpg'),
  ('Mount Edgecombe CC – Course One', 'https://satop100courses.com/wp-content/uploads/2019/09/Mt-Edgecombe-16th.jpeg'),
  ('Woodhill Country Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Woodhill-9th-p4-A.jpg'),
  ('Gowrie Farm Golf Course', 'https://satop100courses.com/wp-content/uploads/2022/01/gowrie-farm.jpg'),
  ('Dainfern Golf & Country Club', 'https://satop100courses.com/wp-content/uploads/2019/11/Dainfern.jpg'),
  ('Irene Country Club', 'https://satop100courses.com/wp-content/uploads/2019/11/Irene-14th-p4-a.jpeg'),
  ('Atlantic Beach Golf Estate', 'https://satop100courses.com/wp-content/uploads/2019/09/Atl-beach-18th-p4-a.jpg'),
  ('San Lameer Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/SanLameer9-1.jpg'),
  ('Zebula Country Club & Spa', 'https://satop100courses.com/wp-content/uploads/2019/08/Zebula-18-CH-1.jpg'),
  ('Stellenbosch Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Stellenbosch-p3.jpg'),
  ('Nelspruit Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/mbombela-1.jpg'),
  ('Umhlali Country Club', 'https://satop100courses.com/wp-content/uploads/2019/11/Umhlali-4th-p3-ae.jpg'),
  ('Krugersdorp Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/11/Krugersdorp-6th-b.jpg'),
  ('Wanderers Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Wanderes-15th-p3-A.jpg'),
  ('Reading Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Reading-5th-p3-C.jpg'),
  ('Paarl Golf Club (Boschenmeer)', 'https://satop100courses.com/wp-content/uploads/2019/11/Clubhouse-view.jpg'),
  ('Centurion Country Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Centurion-17th-p3-a.jpg'),
  ('Eagle Canyon Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Eagle-Canyon-12th-p4-A.jpg'),
  ('Sun City – The Lost City', 'https://satop100courses.com/wp-content/uploads/2022/03/LostCity_918_MASTERHRB.jpg'),
  ('Ruimsig Country Club', 'https://satop100courses.com/wp-content/uploads/2019/11/Ruimsig-9th.jpeg'),
  ('Mount Edgecombe CC – Course Two', 'https://satop100courses.com/wp-content/uploads/2020/01/DJI_0917.jpg'),
  ('Goldfields West Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/12/DSC_0142.jpg'),
  ('Knysna Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Knsyna.jpg'),
  ('Glenvista Country Club', 'https://satop100courses.com/wp-content/uploads/2019/11/DSC_0163.jpg'),
  ('Mossel Bay Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/MosselBay.jpg'),
  ('Waterkloof Golf Club', 'https://satop100courses.com/wp-content/uploads/2022/01/waterkloof-02.jpg'),
  ('Umdoni Park Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Umdoni-18th-p5-b.jpeg'),
  ('St Francis Bay Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/st-francis.jpg'),
  ('Goose Valley Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/Goose-Valley-12th-p4-A.jpg'),
  ('Westlake Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Westlake-C1.jpg'),
  ('Randpark Golf Club – Bushwillow', 'https://satop100courses.com/wp-content/uploads/2019/10/Bushwillow-17.jpg'),
  ('King David Mowbray Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Mowbray-11th-p4-85cm.jpg'),
  ('Oubaai Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/OUBAAI17thpar3.jpg'),
  ('Royal Port Alfred Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/08/DSC_0429.jpg'),
  ('Wedgewood Golf & Country Estate', 'https://satop100courses.com/wp-content/uploads/2019/08/Wedgewood-Clubhouse-from-9th.jpg'),
  ('Parys Golf & Country Estate', 'https://satop100courses.com/wp-content/uploads/2019/08/Parys-G_CE-6th-p4-b.jpg'),
  ('Katberg Eco Golf Estate', 'https://satop100courses.com/wp-content/uploads/2019/08/Katberg.jpg'),
  ('Milnerton Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/09/Milnerton12th.jpg'),
  ('Bloemfontein Golf Club', 'https://satop100courses.com/wp-content/uploads/2019/10/Bloem-GC-16th-p3-b.jpg'),
  ('Kingswood Golf Estate', 'https://satop100courses.com/wp-content/uploads/2019/08/Kingswood-Hole-Z.jpg'),
  ('Emfuleni Golf Estate', 'https://satop100courses.com/wp-content/uploads/2020/01/IMG_0306.jpg'),
  ('Olivewood Private Estate & Golf Club', 'https://satop100courses.com/wp-content/uploads/2020/01/OLIVEWOOD-STUART-McLEAN-2.jpg'),
  ('Jackal Creek Golf Estate', 'https://satop100courses.com/wp-content/uploads/2023/05/Jackal-Creek-31-03-2021-211.jpg'),
  ('Southbroom Golf Club', 'https://satop100courses.com/wp-content/uploads/2020/01/Southbroom4thpar3.jpg'),
  ('Port Elizabeth Golf Club', 'https://satop100courses.com/wp-content/uploads/2020/01/FE_2464.jpg')
)
update public.courses c
   set image_url = s.image_url
  from seed s
 where lower(c.name) = lower(s.name)
   and c.image_url is null;

-- Verify: expect 0 courses without a photo.
select count(*) as courses_without_photo from public.courses where image_url is null;
