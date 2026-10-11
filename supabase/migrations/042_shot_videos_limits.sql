-- 042: limits on the shot-videos bucket
--
-- The bucket took any size and any type, and the only guard was the
-- recorder's own good behaviour. A direct request to storage from a signed
-- session could land anything under the caller's folder. The recorder
-- produces video/mp4 or video/webm of a few megabytes (500 kbit/s, two
-- minutes at most), so 50 MB and those two types cover every real clip.
-- /api/videos/upload-url refuses any other type before a slot is issued,
-- and /api/videos/uploaded refuses to hash an object over the cap.
--
-- Idempotent: an update, re-runnable.

update storage.buckets
   set file_size_limit    = 52428800,
       allowed_mime_types = array['video/mp4', 'video/webm']
 where id = 'shot-videos';
