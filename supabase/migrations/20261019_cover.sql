-- personal cover photo (applied: household_cover_photo)
alter table public.household_settings add column if not exists cover text check (cover is null or cover ~ ('^' || household_id::text || '/cover-[0-9]+\.jpg$'));
