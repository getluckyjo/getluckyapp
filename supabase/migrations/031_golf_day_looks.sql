-- ================================================================
-- 031 — Golf day looks, set in the admin
--
--   golf_days.look   the look of a golf day's screen, set in
--                    /admin/golf-days: its picture, host, colours, the
--                    venue as players know it, the line under the prize
--                    and any small print. JSON, checked by the admin API
--                    (src/lib/golf-days/look.ts); what it leaves out comes
--                    from the code theme for that link, then the Get Lucky
--                    look (src/lib/golf-days/themes.ts).
--   golf-day-art     a public storage bucket for the pictures uploaded in
--                    the admin. Public to read (they are shown on an open
--                    link); written only by the service role, through
--                    POST /api/admin/golf-days/art, which resizes each one
--                    to a WebP of at most 1 000 px.
--
-- Also here: the Bomb Squad and SaSwazi looks, as they shipped in code,
-- copied onto their rows so the admin can edit them. Only where no look
-- has been set.
--
-- Money and the rules of 029 are untouched. Additive. Idempotent.
-- ================================================================

alter table public.golf_days
  add column if not exists look jsonb check (look is null or jsonb_typeof(look) = 'object');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('golf-day-art', 'golf-day-art', true, 2097152, array['image/webp'])
on conflict (id) do nothing;

update public.golf_days
   set look = '{
     "hero": { "src": "/golf-days/bombsquad/hero.jpg", "alt": "Two cans of Bomb Squad Lager raised in a toast", "width": 1000, "height": 1244, "kind": "photo" },
     "host": "Bomb Squad Lager",
     "venue": "Royal Johannesburg",
     "tagline": "Quench your thirst. Hole it on the day and it’s yours.",
     "ink": "#1f3a2f", "accent": "#b8914a", "paper": "#ffffff", "page": "#f3f2ed",
     "footnote": "Bomb Squad Lager. Not for sale to persons under the age of 18. Enjoy responsibly."
   }'::jsonb
 where slug = 'bombsquad' and look is null;

update public.golf_days
   set look = '{
     "hero": { "src": "/golf-days/saswazi/logo.webp", "alt": "The SaSwazi Golf Trek logo: the crew on a coastal fairway", "width": 900, "height": 900, "kind": "logo" },
     "host": "SaSwazi",
     "venue": "Umdoni Park",
     "tagline": "One swing each on the 16th. Hole it and it’s yours.",
     "ink": "#0f3322", "accent": "#f0136d", "paper": "#fffaf0", "page": "#f6eed8",
     "footnote": null
   }'::jsonb
 where slug = 'saswazi' and look is null;

-- Verify: every golf day, whether it has a look, and the bucket.
select d.slug, d.name, d.look is not null as has_look, d.look ->> 'host' as host, d.look -> 'hero' ->> 'kind' as picture,
       (select public from storage.buckets where id = 'golf-day-art') as art_bucket_public
  from public.golf_days d
 order by d.plays_on desc, d.slug;
