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

create table if not exists public.votes (
  listing_id  text not null references public.listings(id) on delete cascade,
  who         text not null check (who in ('davit','luis')),
  vote        text not null check (vote in ('yes','no')),
  at          timestamptz not null default now(),
  primary key (listing_id, who)
);

create index if not exists votes_who_idx on public.votes(who);
create index if not exists listings_first_seen_idx on public.listings(first_seen desc);

-- Matches: listings both people liked.
create or replace view public.matches as
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
