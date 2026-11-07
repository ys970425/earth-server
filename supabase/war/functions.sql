-- Lock war.game FOR SHARE, then countries FOR UPDATE in ascending id order.
-- Actions involving two countries must lock both only through act_start p_other.
drop function if exists war.act_start(text, boolean);
drop function if exists war.lock_countries(int, int);
create or replace function war.act_start(p_role text, p_combat boolean default false, p_other int default null) returns jsonb
language plpgsql as $$
declare
  student priv.students;
  own_role text;
  role_name text;
  g war.game;
begin
  select * into student from priv.students where uid = auth.uid();
  if not found then
    perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.');
  end if;

  select * into g from war.game where id = 1 for share;
  perform 1 from war.countries
    where id = student.country_id or id = p_other order by id for update;

  select role into own_role from war.roles
    where war.roles.student = student.id and country = student.country_id;
  select r->>'name' into role_name
    from jsonb_array_elements(war.cfg()->'ROLES') r where r->>'key' = p_role;
  if role_name is null or not coalesce(
    own_role = p_role or (own_role = 'chief' and (
      not exists (select 1 from war.roles where country = student.country_id
        and role = p_role and not absent)
      or (p_role = 'engineer' and
        (select count(*) from priv.students where country_id = student.country_id) <= 4)
    )), false) then
    perform priv.err('ROLE_ONLY', '이 일은 ' || coalesce(role_name, p_role, '담당 역할') || '이(가) 해요');
  end if;
  if g.paused then
    perform priv.err('PAUSED', '지금은 잠깐 멈춘 시간이에요');
  end if;
  if p_combat and not g.combat_on then
    perform priv.err('NO_COMBAT', '지금은 싸울 수 없는 시간이에요');
  end if;
  return jsonb_build_object('student', student.id, 'country', student.country_id,
    'role', own_role, 'acting_as', case when own_role <> p_role then p_role end);
end $$;
revoke all on function war.act_start(text, boolean, int) from public;

-- schema의 war.versions에 설계 1-3의 영역만 기록한다. 호출한 행동과 같은 트랜잭션이다.
create or replace function war.bump(p_section text, p_country int default 0) returns void
language plpgsql as $$
begin
  if p_section is null or p_section not in
    ('game', 'map', 'units', 'cities', 'diplomacy', 'country', 'notice') then
    perform priv.err('BAD_SECTION', '없는 영역이에요');
  end if;
  insert into war.versions(area, country, ver) values (p_section, p_country, 1)
    on conflict (area, country) do update set ver = war.versions.ver + 1;
end $$;
revoke all on function war.bump(text, int) from public;

create or replace function war.admin_import(p_confirm text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  cfg jsonb;          -- 무역 규칙 (UNITS, CS_TIERS, W)
  wcfg jsonb;         -- 전쟁 규칙 (BRANCH, BUILDING_CLASS, MARKET, SPECIALTY_ITEM, TURN)
  u record; cr record; co record; mrow record;
  destination int;
  moved int := 0;
  converted int;
  cities_list text[];
  facs text[];
  i int; n int;
  br text;            -- 지급할 병과
  k text;             -- 지급할 병력 종류
  cap_tile int;
  dest_tile int; cand int;
  new_id int;
  reason text;
  granted int := 0;
begin
  perform priv.need_admin();
  if p_confirm is distinct from '초기화' then
    raise exception '「초기화」라고 입력해야 가져와요';
  end if;
  -- 같은 표를 동시에 초기화하는 요청도 순서대로 처리한다.
  lock table war.game in exclusive mode;
  cfg := priv.cfg();
  wcfg := war.cfg();
  if wcfg is null then raise exception 'war.config가 비어 있어요. config.sql을 먼저 실행해 주세요'; end if;
  truncate war.game, war.countries, war.inventory, war.tiles, war.cities,
    war.units, war.factories, war.advanced,
    war.roles, war.wallets, war.city_facilities, war.diplomacy, war.offers,
    war.markets, war.market_stock, war.grants, war.versions;
  insert into war.game(id, turn, imported_at)
    select id, turn, now() from public.game;
  insert into war.countries
    select id, type, name, flag_url, emblem_url, coin, happy, techs, discovered, explored
    from priv.countries;
  insert into war.inventory select country, item, qty from priv.inventory;
  insert into war.tiles select id, c, r, zone, terrain, res, owner, imp from priv.tiles;
  insert into war.cities
    select id, tile_id, kind, type, name, def, sea, tech, country, buildings,
      tier, hp, max_hp, boss, final, rebel
    from priv.cities where not rebel and (not (boss or final) or country is not null);
  update war.cities set tier = least(tier, 4), boss = false, final = false,
    def = (cfg->'CS_TIERS'->least(tier, 4)->>'def')::int,
    max_hp = (cfg->'CS_TIERS'->least(tier, 4)->>'hp')::int,
    hp = (cfg->'CS_TIERS'->least(tier, 4)->>'hp')::int
    where boss or final;
  get diagnostics converted = row_count;
  insert into war.factories select country, kind from priv.factories;
  insert into war.advanced select country, kind from priv.advanced;
  insert into war.units(id, country, kind, tile_id, hp)
    select id, country, kind, tile_id, 100 from priv.units;

  -- 원래 칸의 첫 유닛을 먼저 예약하고, 이동할 유닛의 자리를 모두 비운다.
  with ranked as (
    select id, row_number() over (
      partition by tile_id, (kind in ('worker', 'scout')) order by id) as n
    from war.units
  )
  update war.units w set tile_id = null
  from ranked x, war.tiles t
  where w.id = x.id and t.id = w.tile_id and (
    x.n > 1 or
    case when coalesce((cfg->'UNITS'->w.kind->>'sea')::boolean, false)
      then t.terrain not in ('ocean', 'coast')
      else t.terrain in ('ocean', 'coast', 'mountain') or exists (
        select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from w.country)
    end);
  for u in select w.*, s.tile_id as origin from war.units w
    join priv.units s on s.id = w.id where w.tile_id is null order by w.id loop
    select t.id into destination from war.tiles t
    where case when coalesce((cfg->'UNITS'->u.kind->>'sea')::boolean, false)
      then t.terrain in ('ocean', 'coast')
      else t.terrain not in ('ocean', 'coast', 'mountain') and not exists (
        select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from u.country)
      end
      and not exists (select 1 from war.units occupied where occupied.tile_id = t.id
        and (occupied.kind in ('worker', 'scout')) = (u.kind in ('worker', 'scout')))
    order by priv.tdist(u.origin, t.id),
      case when t.owner = u.country then 0 else 1 end, t.id limit 1;
    if destination is null then
      raise exception '병력을 놓을 빈 칸이 없어요 (유닛 %)', u.id;
    end if;
    update war.units set tile_id = destination where id = u.id;
    moved := moved + 1;
  end loop;

  -- 병력 조종 역할: 군사 유닛은 병과, 노동자·정찰병은 공병사령관 (설계 2장, H3-3)
  update war.units set commander = case
    when kind in ('worker', 'scout') then 'engineer'
    else wcfg->'BRANCH'->>kind end
   where commander is null;

  -- 공장·고등 건물을 도시에 배치 (설계 3-2): 수도가 아닌 도시들에 골고루, 결정적 순서로
  for co in select id from war.countries order by id loop
    cities_list := (select array_agg(id order by id) from war.cities where country = co.id and kind <> 'capital');
    if cities_list is null then
      cities_list := (select array_agg(id order by id) from war.cities where country = co.id and kind = 'capital');
    end if;
    facs := coalesce((select array_agg('factory|' || kind order by kind) from priv.factories where country = co.id), '{}')
         || coalesce((select array_agg('advanced|' || kind order by kind) from priv.advanced where country = co.id), '{}');
    for i in 1 .. coalesce(array_length(facs, 1), 0) loop
      insert into war.city_facilities(city, kind, class, ruined, origin_country)
      values (cities_list[1 + (i - 1) % coalesce(array_length(cities_list, 1), 1)],
        split_part(facs[i], '|', 2), split_part(facs[i], '|', 1), false, co.id);
    end loop;
  end loop;

  -- 병과 최소 지급 (설계 3-3): 육군→창병, 해군→삼단노선, 공군→전투기. 빈 칸 = 군사 유닛이 없는 칸
  for co in select id from war.countries order by id loop
    foreach br in array array['army', 'navy', 'air'] loop
      continue when exists (
        select 1 from war.units where country = co.id and coalesce(wcfg->'BRANCH'->>kind, '') = br);
      dest_tile := null; reason := null; k := null;
      if br = 'army' then
        k := 'spear';
        cap_tile := (select c.tile_id from war.cities c where c.country = co.id and c.kind = 'capital');
        -- 수도 칸이 비었으면 수도 칸, 아니면 수도에서 가장 가까운 빈 땅 칸 (우리 땅 우선, 바다·산·다른 나라 도시 제외)
        select t.id into dest_tile from war.tiles t
        where t.terrain not in ('ocean', 'coast', 'mountain')
          and not exists (select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from co.id)
          and not exists (select 1 from war.units m where m.tile_id = t.id and m.kind not in ('worker', 'scout'))
        order by priv.tdist(cap_tile, t.id),
          case when t.owner = co.id then 0 else 1 end, t.id limit 1;
        if dest_tile is null then reason := '빈 땅 칸이 없어요'; end if;
      elsif br = 'navy' then
        k := 'trireme';
        select count(*) into n from war.cities c where c.country = co.id and exists (
          select 1 from war.tiles t where t.terrain in ('ocean', 'coast') and priv.tdist(t.id, c.tile_id) = 1);
        if n = 0 then
          reason := '해안 도시가 없어 해군을 줄 수 없어요';
        else
          -- 해안 도시(수도 먼저, 그다음 도시 번호순) 옆의 빈 바다·해안 칸
          for cr in select c.id, c.tile_id from war.cities c
            where c.country = co.id and exists (
              select 1 from war.tiles t where t.terrain in ('ocean', 'coast') and priv.tdist(t.id, c.tile_id) = 1)
            order by (c.kind = 'capital') desc, c.id loop
            select t.id into dest_tile from war.tiles t
            where t.terrain in ('ocean', 'coast')
              and priv.tdist(t.id, cr.tile_id) = 1
              and not exists (select 1 from war.units m where m.tile_id = t.id and m.kind not in ('worker', 'scout'))
            order by t.id limit 1;
            exit when dest_tile is not null;
          end loop;
          if dest_tile is null then reason := '해안 도시 옆에 빈 바다 칸이 없어요'; end if;
        end if;
      else
        k := 'fighter';
        cap_tile := (select c.tile_id from war.cities c where c.country = co.id and c.kind = 'capital');
        -- 수도 옆 빈 땅 칸 (바다·산·다른 나라 도시 제외)
        select t.id into dest_tile from war.tiles t
        where t.terrain not in ('ocean', 'coast', 'mountain')
          and priv.tdist(t.id, cap_tile) = 1
          and not exists (select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from co.id)
          and not exists (select 1 from war.units m where m.tile_id = t.id and m.kind not in ('worker', 'scout'))
        order by case when t.owner = co.id then 0 else 1 end, t.id limit 1;
        if dest_tile is null then reason := '수도 옆에 빈 땅 칸이 없어요'; end if;
      end if;
      if dest_tile is not null then
        select coalesce(max(id), 0) + 1 into new_id from war.units;
        insert into war.units(id, country, kind, tile_id, hp, commander)
          values (new_id, co.id, k, dest_tile, 100, br);
        insert into war.grants(country, branch, kind, unit_id, result)
          values (co.id, br, k, new_id, 'given');
        granted := granted + 1;
      else
        insert into war.grants(country, branch, kind, result, reason)
          values (co.id, br, k, 'skipped', reason);
      end if;
    end loop;
  end loop;

  -- 도시국가 물물교환 시장 3곳 (설계 7장): 후보 칸이 쓰이고 있으면 가장 가까운 빈 바다 칸으로 옮긴다
  i := 0;
  for mrow in select * from jsonb_to_recordset(wcfg->'MARKET'->'cities') as x(name text, c int, r int, art text) loop
    i := i + 1;
    cand := mrow.r * (cfg->>'W')::int + mrow.c;
    if exists (select 1 from war.cities c where c.tile_id = cand)
      or exists (select 1 from war.units uu where uu.tile_id = cand)
      or exists (select 1 from war.tiles t where t.id = cand and t.owner is not null) then
      select t.id into dest_tile from war.tiles t
      where t.terrain in ('ocean', 'coast') and t.owner is null
        and not exists (select 1 from war.cities c where c.tile_id = t.id)
        and not exists (select 1 from war.units uu where uu.tile_id = t.id)
      order by priv.tdist(cand, t.id), t.id limit 1;
      if dest_tile is null then raise exception '시장을 놓을 빈 바다 칸이 없어요'; end if;
    else
      dest_tile := cand;
    end if;
    update war.tiles set terrain = 'plains', owner = null where id = dest_tile;
    insert into war.markets(id, tile_id, art, name) values (i, dest_tile, mrow.art, mrow.name);
  end loop;
  -- 시장 창고: 여섯 나라 특산 4개씩
  insert into war.market_stock(market, item, qty)
    select m.id, s.value, (wcfg->'MARKET'->>'stock')::int
    from war.markets m, jsonb_each_text(wcfg->'SPECIALTY_ITEM') s;

  -- 외교: 여섯 나라 모든 쌍이 평화에서 시작 (설계 6장)
  insert into war.diplomacy(a, b, status)
    select a.id, b.id, 'peace' from war.countries a, war.countries b where a.id < b.id;

  -- 게임 기본값 (설계 1-2, 6장, 11장)
  update war.game set turn_seconds = (wcfg->'TURN'->>'seconds')::int,
    paused = false, combat_on = true, turn_end = null where id = 1;

  return jsonb_build_object(
    'countries', (select count(*) from war.countries),
    'tiles', (select count(*) from war.tiles),
    'cities', (select count(*) from war.cities),
    'units', (select count(*) from war.units),
    'moved_units', moved, 'converted_cities', converted,
    'grants', granted,
    'facilities', (select count(*) from war.city_facilities),
    'markets', (select count(*) from war.markets));
end $$;
revoke all on function war.admin_import(text) from public;

-- 지급 결과 표 (설계 3-3): 교사만
create or replace function war.admin_grants() returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
begin
  perform priv.need_admin();
  return jsonb_build_object('grants', (select coalesce(jsonb_agg(to_jsonb(g) order by g.country, g.branch), '[]')
    from war.grants g));
end $$;
revoke all on function war.admin_grants() from public;

create or replace function public.war_admin_import(p_confirm text) returns jsonb
language sql security definer set search_path = war, priv, public as $$
  select war.admin_import(p_confirm)
$$;
create or replace function public.war_admin_grants() returns jsonb
language sql security definer set search_path = war, priv, public as $$
  select war.admin_grants()
$$;
revoke all on function public.war_admin_import(text) from public;
revoke all on function public.war_admin_grants() from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function public.war_admin_import(text) to %I', role_name);
      execute format('grant execute on function public.war_admin_grants() to %I', role_name);
    end if;
  end loop;
end $$;
