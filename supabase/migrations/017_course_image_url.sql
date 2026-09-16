-- 017_course_image_url.sql
-- Admin → Courses has always written courses.image_url (src/app/api/admin/
-- courses/route.ts) and the card on /select-course reads it as its last
-- fallback, but the column was never created: 001 defined courses without
-- it and the old seed file carried the URLs instead. Creating a course from
-- the admin therefore failed on production. Idempotent.
alter table public.courses add column if not exists image_url text;

comment on column public.courses.image_url is
  'Optional photo URL for the select-course card. Our committed photos in public/marketing/courses take precedence (src/lib/course-photo.ts).';

-- Verify
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'courses' and column_name = 'image_url';
