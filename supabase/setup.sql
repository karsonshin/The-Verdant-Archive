-- Verdant Archive: ratings + comments backend (free Supabase project).
-- Run this once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.

-- ---------- comments ----------
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  media_id   text not null check (char_length(media_id) between 1 and 64),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()      -- set by the server; visitors cannot choose it
);
create index if not exists comments_media_idx on public.comments (media_id, created_at desc);
alter table public.comments enable row level security;

drop policy if exists "anyone can read comments" on public.comments;
create policy "anyone can read comments" on public.comments for select to anon using (true);
drop policy if exists "anyone can add comments" on public.comments;
create policy "anyone can add comments" on public.comments for insert to anon with check (true);

revoke all on public.comments from anon;
grant select on public.comments to anon;
grant insert (media_id, name, body) on public.comments to anon;   -- only these columns; no edits, no deletes

-- ---------- ratings ----------
create table if not exists public.ratings (
  media_id   text not null check (char_length(media_id) between 1 and 64),
  voter_id   text not null check (char_length(voter_id) between 8 and 64),
  stars      smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (media_id, voter_id)
);
alter table public.ratings enable row level security;
revoke all on public.ratings from anon;                            -- visitors never touch the table directly

-- one vote per visitor per item; voting again changes it
create or replace function public.rate_media(p_media text, p_voter text, p_stars int)
returns void language sql security definer set search_path = public as $$
  insert into public.ratings (media_id, voter_id, stars) values (p_media, p_voter, p_stars)
  on conflict (media_id, voter_id) do update set stars = excluded.stars, updated_at = now();
$$;
revoke all on function public.rate_media(text, text, int) from public;
grant execute on function public.rate_media(text, text, int) to anon;

-- public averages (no voter ids exposed)
create or replace view public.rating_summary as
  select media_id, round(avg(stars)::numeric, 2) as avg, count(*)::int as n from public.ratings group by media_id;
grant select on public.rating_summary to anon;
