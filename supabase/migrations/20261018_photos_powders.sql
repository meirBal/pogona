-- photo timeline + opened supplement powders (applied: photos_timeline_powders)
create table if not exists public.dragon_photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  dragon_id uuid not null references public.dragons(id) on delete cascade,
  path text not null,
  taken date not null default current_date,
  note text not null default '' check (char_length(note) <= 300),
  owner uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint photo_path_in_household check (split_part(path,'/',1) = household_id::text)
);
create index if not exists dragon_photos_hh_idx on public.dragon_photos(household_id, dragon_id, taken desc);
alter table public.dragon_photos enable row level security;
create policy "members read photos" on public.dragon_photos for select to authenticated using (public.is_member(household_id));
create policy "members add photos" on public.dragon_photos for insert to authenticated with check (public.is_member(household_id) and exists (select 1 from public.dragons d where d.id = dragon_id and d.household_id = dragon_photos.household_id));
create policy "members delete photos" on public.dragon_photos for delete to authenticated using (public.is_member(household_id));
alter publication supabase_realtime add table public.dragon_photos;
alter table public.household_settings add column if not exists powders jsonb not null default '[]'::jsonb;
