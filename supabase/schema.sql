-- Amsterdam Apartment Swipe: run once in Supabase > SQL editor.
-- Two tables. Both readable and writable with the anon (publishable) key, which the
-- phone app and the 3-hourly job use. Deletes are not allowed from the anon key.

create table if not exists public.listings (
  id            text primary key,              -- numeric move.nl ExchangeObject id
  url           text not null,
  status        text,                          -- available / under offer / sold ...
  address       text,
  street        text,
  postcode      text,
  lat           double precision,
  lng           double precision,
  price         integer,
  m2            integer,
  price_per_m2  integer,
  rooms         integer,
  bedrooms      integer,
  type          text,
  build_year    text,
  energy_label  text,
  ownership     text,                          -- freehold (eigen grond) / leasehold (erfpacht)
  leasehold     jsonb,                         -- e.g. {"Afgekocht tot": "Eeuwigdurend"}
  vve_monthly   integer,
  floor         text,
  outdoor       text,                          -- balcony / roof terrace / garden summary
  photo         text,
  photos        jsonb,
  summary       text,                          -- one-sentence English buyer summary
  description_en text,
  features      jsonb,                         -- all English feature rows label -> value
  first_seen    timestamptz not null default now(),
  email_date    timestamptz,
  enriched_at   timestamptz,
  updated_at    timestamptz not null default now()
);

-- Added later: date the agent first listed the property (safe to re-run).
alter table public.listings add column if not exists listed_since date;

create table if not exists public.votes (
  listing_id  text not null references public.listings(id) on delete cascade,
  who         text not null check (who in ('davit','luis')),
  vote        text not null check (vote in ('yes','no')),
  at          timestamptz not null default now(),
  primary key (listing_id, who)
);

create index if not exists votes_who_idx on public.votes(who);
create index if not exists listings_first_seen_idx on public.listings(first_seen desc);

-- Matches: listings both people liked. Dropped first: a view cannot be replaced once the
-- column list of listings changes (e.g. listed_since was added later).
drop view if exists public.matches;
create view public.matches as
  select l.*, max(v.at) as matched_at
  from public.listings l
  join public.votes v on v.listing_id = l.id and v.vote = 'yes'
  group by l.id
  having count(distinct v.who) = 2;

-- Row level security: open read/insert/update for anon; delete only on votes (Undo). Safe to re-run.
alter table public.listings enable row level security;
alter table public.votes    enable row level security;

drop policy if exists listings_read   on public.listings;
drop policy if exists listings_insert on public.listings;
drop policy if exists listings_update on public.listings;
drop policy if exists votes_read      on public.votes;
drop policy if exists votes_insert    on public.votes;
drop policy if exists votes_update    on public.votes;
drop policy if exists votes_delete    on public.votes;

create policy listings_read   on public.listings for select to anon, authenticated using (true);
create policy listings_insert on public.listings for insert to anon, authenticated with check (true);
create policy listings_update on public.listings for update to anon, authenticated using (true) with check (true);
create policy votes_read      on public.votes    for select to anon, authenticated using (true);
create policy votes_insert    on public.votes    for insert to anon, authenticated with check (true);
create policy votes_update    on public.votes    for update to anon, authenticated using (true) with check (true);
create policy votes_delete    on public.votes    for delete to anon, authenticated using (true);  -- needed for Undo

-- Realtime so both phones see each other's swipes live.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'votes') then
    alter publication supabase_realtime add table public.votes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'listings') then
    alter publication supabase_realtime add table public.listings;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- v2: viewing pipeline, evaluations, weekly email outbox, photos. Safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists public.viewings (
  listing_id   text primary key references public.listings(id) on delete cascade,
  stage        text not null default 'selected'
               check (stage in ('selected','requested','scheduled','viewed','dropped')),
  selected_by  text,
  selected_at  timestamptz not null default now(),
  request_id   text,                         -- viewing_requests.id once emailed
  scheduled_at timestamptz,                  -- agreed viewing slot
  notes        text,
  updated_at   timestamptz not null default now()
);

-- Outbox: the app writes a row when the pair confirms the weekly pick; the job emails it.
create table if not exists public.viewing_requests (
  id           text primary key,
  listing_ids  jsonb not null,
  created_by   text,
  created_at   timestamptz not null default now(),
  availability text,                         -- free text typed in the app, optional
  sent_at      timestamptz,
  sent_via     text,                         -- gmail / phone
  error        text
);

create table if not exists public.evaluations (
  listing_id  text not null references public.listings(id) on delete cascade,
  who         text not null check (who in ('davit','luis')),
  scores      jsonb not null default '{}'::jsonb,   -- category -> 1..5
  checks      jsonb not null default '{}'::jsonb,   -- checklist item -> true
  verdict     text check (verdict in ('yes','maybe','no')),
  notes       text,
  at          timestamptz not null default now(),
  primary key (listing_id, who)
);

create table if not exists public.viewing_photos (
  id          text primary key,
  listing_id  text not null references public.listings(id) on delete cascade,
  who         text,
  path        text not null,                 -- storage object path in bucket viewing-photos
  at          timestamptz not null default now()
);

-- Small key/value log so the job can be idempotent (e.g. weekly nudge sent for ISO week).
create table if not exists public.app_events (
  key  text primary key,
  at   timestamptz not null default now(),
  data jsonb
);

alter table public.viewings         enable row level security;
alter table public.viewing_requests enable row level security;
alter table public.evaluations      enable row level security;
alter table public.viewing_photos   enable row level security;
alter table public.app_events       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['viewings','viewing_requests','evaluations','viewing_photos','app_events'] loop
    execute format('drop policy if exists %I_read   on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_read   on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('create policy %I_insert on public.%I for insert to anon, authenticated with check (true)', t, t);
    execute format('create policy %I_update on public.%I for update to anon, authenticated using (true) with check (true)', t, t);
    execute format('create policy %I_delete on public.%I for delete to anon, authenticated using (true)', t, t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Photos taken during viewings: public bucket, anon may upload and read.
insert into storage.buckets (id, name, public) values ('viewing-photos', 'viewing-photos', true)
  on conflict (id) do nothing;
drop policy if exists viewing_photos_upload on storage.objects;
drop policy if exists viewing_photos_read   on storage.objects;
create policy viewing_photos_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'viewing-photos');
create policy viewing_photos_read   on storage.objects for select to anon, authenticated
  using (bucket_id = 'viewing-photos');

-- ---------------------------------------------------------------------------
-- v3: login (Supabase Auth) and profiles. Safe to re-run.
-- Each signed-in user gets one profile row that says which person they are (davit / luis),
-- their display name, avatar and app preferences (theme etc.).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  person       text check (person in ('davit','luis')),
  display_name text,
  avatar_url   text,
  theme        text default 'system' check (theme in ('system','light','dark')),
  prefs        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select to anon, authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy profiles_update on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
