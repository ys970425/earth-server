-- 실시간(postgres_changes) 대신 가벼운 확인 요청: 무료(Nano) 서버에서 학생 25명이 동시에 써도 버티게
create or replace function public.poll_state(p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public, priv as $$
declare my int; adm boolean := priv.is_admin(); top bigint;
begin
  select country_id into my from priv.students where uid = auth.uid();
  select coalesce(max(id), 0) into top from public.notices;
  return jsonb_build_object(
    'game', (select ver from public.game where id = 1),
    'ticks', (select coalesce(jsonb_object_agg(country_id::text, ver), '{}') from public.country_ticks),
    'top', top,
    'notices', case when p_after <= 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'country', n.country, 'kind', n.kind, 'message', n.message, 'data', n.data) order by n.id), '[]')
      from (select * from public.notices where id > p_after and (country is null or country = my or adm) order by id limit 30) n) end);
end $$;
do $$ begin execute 'grant execute on function public.poll_state(bigint) to anon, authenticated'; exception when others then null; end $$;
-- 실시간 복제에서 빼기 (서버 부담 줄이기)
do $$ begin
  begin execute 'alter publication supabase_realtime drop table public.game'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime drop table public.notices'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime drop table public.country_ticks'; exception when others then null; end;
end $$;
