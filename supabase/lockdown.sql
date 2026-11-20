-- Lockdown: only signed-in users with a profile (Davit, Luis) can read or write.
-- NOT applied yet. Apply only after:
--   1. both phones are signed in (guest mode stops working), and
--   2. the SUPABASE_SERVICE_KEY secret is set in GitHub so the scheduled job keeps access.
-- Safe to re-run.

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and person is not null);
$$;

do $$
declare t text; p record;
begin
  foreach t in array array['listings','votes','viewings','viewing_requests','evaluations','viewing_photos','app_events'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t || '_members', t);
  end loop;
end $$;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

-- The view must respect the caller's row level security, not its owner's.
alter view public.matches set (security_invoker = true);

drop policy if exists viewing_photos_upload on storage.objects;
drop policy if exists viewing_photos_read   on storage.objects;
create policy viewing_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'viewing-photos' and public.is_member());
create policy viewing_photos_read   on storage.objects for select to authenticated
  using (bucket_id = 'viewing-photos' and public.is_member());
