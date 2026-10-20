-- mealworm sub-colony (applied: colony_kind_patch_rpc, _fix, _nullsafe)
create or replace function public.colony_kind_patch(hh uuid, kind text, patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_member(hh) then raise exception 'not a member'; end if;
  if kind not in ('meal') then raise exception 'bad kind'; end if;
  if jsonb_typeof(patch) <> 'object' then raise exception 'bad patch'; end if;
  insert into public.household_settings(household_id, colony) values (hh, jsonb_build_object(kind, patch))
  on conflict (household_id) do update set colony = jsonb_set(coalesce(household_settings.colony,'{}'::jsonb), array[kind],
      (case when jsonb_typeof(household_settings.colony->kind) = 'object' then household_settings.colony->kind else '{}'::jsonb end) || patch), updated_at = now()
  returning colony into res;
  return res;
end $$;
revoke all on function public.colony_kind_patch(uuid, text, jsonb) from public, anon;
grant execute on function public.colony_kind_patch(uuid, text, jsonb) to authenticated;
