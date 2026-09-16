-- ================================================================
-- 018 — Back an Icon: the fan pick for Icons Cup South Africa
--
--   icons        the field: name, one-line tagline, optional photo, order,
--                active flag. Edited from /admin/icons; no deploy needed.
--   icon_votes   one row per golfer: the Icon they back. Changing your mind
--                overwrites the row (primary key is the user).
--
-- Reads: icons are public (active ones are what the app shows; the admin
-- reads all through the service role). A golfer reads only their own vote;
-- totals are computed server-side by /api/icons with the service role.
-- Writes: service role only, through /api/icons/vote and /api/admin/icons.
-- Additive. Idempotent.
-- ================================================================

create table if not exists public.icons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  tagline     text check (tagline is null or char_length(tagline) <= 120),
  photo_url   text check (photo_url is null or char_length(photo_url) <= 500),
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.icons is
  'The Icons golfers can back for Icons Cup South Africa. Managed at /admin/icons.';

alter table public.icons enable row level security;

drop policy if exists "Icons are publicly readable" on public.icons;
create policy "Icons are publicly readable"
  on public.icons for select
  using (true);

create table if not exists public.icon_votes (
  user_id     uuid primary key references auth.users on delete cascade,
  icon_id     uuid not null references public.icons on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.icon_votes is
  'One pick per golfer. Re-picking overwrites the row. Written only by /api/icons/vote through the service role.';

create index if not exists icon_votes_icon_id_idx on public.icon_votes (icon_id);

alter table public.icon_votes enable row level security;

drop policy if exists "Users can view their own icon vote" on public.icon_votes;
create policy "Users can view their own icon vote"
  on public.icon_votes for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies: the anon and authenticated roles cannot
-- write either table. The service role bypasses RLS.

-- Verify
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('icons', 'icon_votes') order by 1;
