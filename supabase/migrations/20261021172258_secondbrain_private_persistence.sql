-- Private server-side workspace. Browser roles intentionally have no access.
create table public.secondbrain_records (
  key text primary key check (key ~ '^secondbrain/[a-zA-Z0-9_./-]+$' and position('..' in key) = 0),
  value jsonb not null,
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
alter table public.secondbrain_records enable row level security;
revoke all on public.secondbrain_records from public, anon, authenticated;
grant select, insert, update on public.secondbrain_records to service_role;

create function public.secondbrain_read_record(p_key text)
returns table(key text, value jsonb, etag uuid)
language sql stable security invoker set search_path = '' as $$
  select r.key, r.value, r.version from public.secondbrain_records r where r.key = p_key;
$$;

create function public.secondbrain_list_records(p_prefix text, p_after text default '', p_limit int default 100)
returns table(key text, value jsonb, etag uuid)
language sql stable security invoker set search_path = '' as $$
  select r.key, r.value, r.version from public.secondbrain_records r
  where starts_with(r.key, p_prefix) and r.key > p_after
  order by r.key limit least(greatest(p_limit, 1), 100);
$$;

create function public.secondbrain_write_record(p_key text, p_value jsonb, p_check_version boolean, p_expected_version uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare next_version uuid := gen_random_uuid(); affected int;
begin
  if not p_check_version then
    insert into public.secondbrain_records(key, value, version) values(p_key, p_value, next_version)
    on conflict(key) do update set value = excluded.value, version = excluded.version, updated_at = now();
  elsif p_expected_version is null then
    insert into public.secondbrain_records(key, value, version) values(p_key, p_value, next_version)
    on conflict do nothing;
    get diagnostics affected = row_count;
    if affected = 0 then raise sqlstate 'PT409' using message = 'Save conflict'; end if;
  else
    update public.secondbrain_records set value = p_value, version = next_version, updated_at = now()
    where key = p_key and version = p_expected_version;
    get diagnostics affected = row_count;
    if affected = 0 then raise sqlstate 'PT409' using message = 'Save conflict'; end if;
  end if;
  return next_version;
end;
$$;
revoke all on function public.secondbrain_read_record(text) from public, anon, authenticated;
revoke all on function public.secondbrain_list_records(text, text, int) from public, anon, authenticated;
revoke all on function public.secondbrain_write_record(text, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.secondbrain_read_record(text) to service_role;
grant execute on function public.secondbrain_list_records(text, text, int) to service_role;
grant execute on function public.secondbrain_write_record(text, jsonb, boolean, uuid) to service_role;
