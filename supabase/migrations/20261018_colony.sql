-- dubia colony tracker (applied: household_colony, colony_patch_rpc)
alter table public.household_settings add column if not exists colony jsonb not null default '{}'::jsonb;

-- merge a patch into colony so concurrent household members don't overwrite each other
create or replace function public.colony_patch(hh uuid, patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_member(hh) then raise exception 'not a member'; end if;
  if jsonb_typeof(patch) <> 'object' then raise exception 'bad patch'; end if;
  insert into public.household_settings(household_id, colony) values (hh, patch)
  on conflict (household_id) do update set colony = coalesce(household_settings.colony,'{}'::jsonb) || excluded.colony, updated_at = now()
  returning colony into res;
  return res;
end $$;
revoke all on function public.colony_patch(uuid, jsonb) from public, anon;
grant execute on function public.colony_patch(uuid, jsonb) to authenticated;
