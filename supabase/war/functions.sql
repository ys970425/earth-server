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
        cap_tile := (select c.tile_id from war.cities c where c.country = co.id and c.kind = 'capital');
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
        -- 해군 지급 A (E2 결정): 해안 도시가 없거나 옆이 다 차 있으면
        -- 수도에서 가장 가까운 빈 바다·해안 칸(군사 유닛 없음, 칸 번호순 동점)에 지급
        if dest_tile is null then
          select t.id into dest_tile from war.tiles t
          where t.terrain in ('ocean', 'coast')
            and not exists (select 1 from war.units m where m.tile_id = t.id and m.kind not in ('worker', 'scout'))
          order by priv.tdist(cap_tile, t.id), t.id limit 1;
        end if;
        if dest_tile is null then reason := '빈 바다 칸이 없어요'; end if;
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
  -- 지도 영역 번호를 1로 시작 (칸 ver은 전부 0. 칸을 바꾸는 함수는 bump('map') 뒤 그 칸 ver을 새 번호로)
  perform war.bump('map');

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

-- ---------------------------------------------------------------------
-- E2 (H1): 접속·역할 고르기·바뀐 것만 받기
-- ---------------------------------------------------------------------

-- 로그인한 학생: 나라(번호·이름·유형·색), 내 역할, 대행 역할 목록, 내가 볼 메뉴, 우리 나라 역할 현황
-- 역할 현황에는 닉네임만 넣는다 (실명 금지, 설계 2장·8장)
create or replace function public.war_me() returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  s priv.students;
  wcfg jsonb := war.cfg();
  co war.countries;
  size int;
  my_role text;
  roles jsonb;
  deputies jsonb;
  menus jsonb;
begin
  select * into s from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요'); end if;
  select * into co from war.countries where id = s.country_id;
  select count(*) into size from priv.students where country_id = co.id;
  select role into my_role from war.roles where student = s.id;
  -- 우리 나라 역할 현황 (역할별 닉네임만)
  roles := coalesce((select jsonb_agg(jsonb_build_object(
      'key', def.value->>'key', 'name', def.value->>'name',
      'nick', (select coalesce(s2.nickname, '학생') from war.roles rr
        join priv.students s2 on s2.id = rr.student
        where rr.country = co.id and rr.role = def.value->>'key'),
      'absent', coalesce((select rr.absent from war.roles rr where rr.country = co.id and rr.role = def.value->>'key'), false))
    order by ord)
    from jsonb_array_elements(wcfg->'ROLES') with ordinality def(value, ord)), '[]'::jsonb);
  -- 내 메뉴: 내 역할 메뉴. 4명 모둠 합동참모의장은 공병 메뉴까지 (menus4)
  if my_role is not null then
    select value->(case when my_role = 'chief' and size <= 4 then 'menus4' else 'menus' end) into menus
      from jsonb_array_elements(wcfg->'ROLES') value where value->>'key' = my_role;
  end if;
  -- 대행 역할 목록 (합동참모의장만): 아무도 안 고른 역할 또는 결석한 역할 (설계 2장 결석 대행)
  if my_role = 'chief' then
    deputies := coalesce((select jsonb_agg(jsonb_build_object(
        'key', def.value->>'key', 'name', def.value->>'name', 'menus', def.value->'menus',
        'absent', coalesce(rr.absent, false)) order by ord)
      from jsonb_array_elements(wcfg->'ROLES') with ordinality def(value, ord)
      left join war.roles rr on rr.country = co.id and rr.role = def.value->>'key'
      where def.value->>'key' <> 'chief' and (rr.student is null or rr.absent)), '[]'::jsonb);
  else
    deputies := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'country', jsonb_build_object('id', co.id,
      'name', coalesce(co.name, (priv.cfg()->'TYPES'->co.type->>'name')),
      'type', co.type, 'color', (priv.cfg()->'TYPES'->co.type->>'color'), 'size', size),
    -- 여섯 나라의 공개 정보만 (번호·이름·유형). 창고·코인·지갑·시설은 넣지 않는다
    'countries', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', coalesce(c.name, (priv.cfg()->'TYPES'->c.type->>'name')), 'type', c.type)
      order by c.id), '[]'::jsonb) from war.countries c),
    'role', my_role, 'menus', coalesce(menus, '[]'::jsonb),
    'deputy_roles', deputies, 'roles', roles);
end $$;
revoke all on function public.war_me() from public;

-- 역할 고르기: 아직 역할이 없는 학생만. 4명 모둠은 engineer를 고를 수 없음. 바꾸기는 교사만
create or replace function public.war_choose_role(p_role text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  s priv.students;
  size int;
begin
  select * into s from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요'); end if;
  if exists (select 1 from war.roles where student = s.id) then
    perform priv.err('HAS_ROLE', '이미 고른 역할이 있어요. 바꾸는 것은 선생님만 할 수 있어요.');
  end if;
  if not exists (select 1 from jsonb_array_elements(war.cfg()->'ROLES') r where r->>'key' = p_role) then
    perform priv.err('BAD_ROLE', '없는 역할이에요');
  end if;
  select count(*) into size from priv.students where country_id = s.country_id;
  if p_role = 'engineer' and size <= 4 then
    perform priv.err('FOUR_GROUP', '4명 모둠은 공병사령관이 없어요. 합동참모의장이 함께 해요.');
  end if;
  begin
    insert into war.roles(student, country, role) values (s.id, s.country_id, p_role);
  exception when unique_violation then
    perform priv.err('ROLE_TAKEN', '이미 다른 친구가 고른 역할이에요');
  end;
  perform war.bump('country', s.country_id);
  return jsonb_build_object('ok', true, 'role', p_role);
end $$;
revoke all on function public.war_choose_role(text) from public;

-- 바뀐 것만 받기 (설계 1-3): p_known 예 {"game":3,"map":5,"units":2,"cities":1,"diplomacy":1,"country":4,"notice":0}
-- country는 우리 나라의 바뀜 번호. 값이 없거나 0이면 그 영역 전체를 돌려준다
create or replace function public.war_poll(p_known jsonb default null) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  s priv.students;
  known jsonb := coalesce(p_known, '{}'::jsonb);
  my_country int;
  out jsonb;
  vers jsonb;
  k bigint;
  v_game bigint; v_map bigint; v_units bigint; v_cities bigint; v_dip bigint; v_notice bigint; v_country bigint;
begin
  select * into s from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요'); end if;
  my_country := s.country_id;
  select coalesce(max(ver), 0) into v_game from war.versions where area = 'game' and country = 0;
  select coalesce(max(ver), 0) into v_map from war.versions where area = 'map' and country = 0;
  select coalesce(max(ver), 0) into v_units from war.versions where area = 'units' and country = 0;
  select coalesce(max(ver), 0) into v_cities from war.versions where area = 'cities' and country = 0;
  select coalesce(max(ver), 0) into v_dip from war.versions where area = 'diplomacy' and country = 0;
  select coalesce(max(ver), 0) into v_notice from war.versions where area = 'notice' and country = 0;
  select coalesce(max(ver), 0) into v_country from war.versions where area = 'country' and country = my_country;
  -- 지금 번호 전부 (아직 바뀐 적이 없는 영역도 0으로 넣어 화면이 기준 번호를 알게 한다. 다른 나라 country 번호는 빼고)
  vers := coalesce((select jsonb_object_agg(area || case when country = 0 then '' else ':' || country end, ver)
    from war.versions where area <> 'country' or country = my_country), '{}'::jsonb)
    || jsonb_build_object('game', v_game, 'map', v_map, 'units', v_units, 'cities', v_cities,
      'diplomacy', v_dip, 'notice', v_notice, 'country:' || my_country, v_country);
  out := jsonb_build_object('versions', vers, 'me', jsonb_build_object('country', my_country));
  -- game: 턴·남은 시각·일시정지·전투 켜짐
  k := (known->>'game')::bigint;
  if k is null or k is distinct from v_game then
    out := out || jsonb_build_object('game', (select jsonb_build_object(
      'turn', turn, 'turn_seconds', turn_seconds, 'turn_end', turn_end, 'paused', paused, 'combat_on', combat_on)
      from war.game where id = 1));
  end if;
  -- map: 바뀐 칸만 [id, terrain, res, owner, imp, imp_ruined]. 처음엔 전체
  k := (known->>'map')::bigint;
  if k is null or k = 0 or k is distinct from v_map then
    out := out || jsonb_build_object('map', (select coalesce(jsonb_agg(
      jsonb_build_array(id, terrain, res, owner, imp, imp_ruined) order by id), '[]'::jsonb)
      from war.tiles where k is null or k = 0 or ver > k));
  end if;
  -- units: 전체 목록 (번호·나라·종류·칸·체력·조종 역할)
  k := (known->>'units')::bigint;
  if k is null or k is distinct from v_units then
    out := out || jsonb_build_object('units', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'country', country, 'kind', kind, 'tile', tile_id, 'hp', hp, 'commander', commander) order by id), '[]'::jsonb)
      from war.units));
  end if;
  -- cities: 전체 목록 (번호·칸·주인·이름·체력·최대·포위)
  k := (known->>'cities')::bigint;
  if k is null or k is distinct from v_cities then
    out := out || jsonb_build_object('cities', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'tile', tile_id, 'country', country, 'name', name, 'hp', hp, 'max_hp', max_hp, 'besieged', besieged) order by id), '[]'::jsonb)
      from war.cities));
  end if;
  -- diplomacy: 15쌍 전부
  k := (known->>'diplomacy')::bigint;
  if k is null or k is distinct from v_dip then
    out := out || jsonb_build_object('diplomacy', (select coalesce(jsonb_agg(jsonb_build_object(
      'a', a, 'b', b, 'status', status, 'no_war_until', no_war_until) order by a, b), '[]'::jsonb)
      from war.diplomacy));
  end if;
  -- country: 우리 나라만 (국고·창고·역할별 지갑·우리 도시의 시설·역할 현황). 다른 나라 데이터는 절대 넣지 않는다
  k := (known->>'country')::bigint;
  if k is null or k is distinct from v_country then
    out := out || jsonb_build_object('country', jsonb_build_object(
      'country', my_country, 'coin', (select coin from war.countries where id = my_country),
      'inventory', (select coalesce(jsonb_object_agg(item, qty), '{}'::jsonb)
        from war.inventory where country = my_country and qty <> 0),
      'wallets', (select coalesce(jsonb_object_agg(role, w), '{}'::jsonb)
        from (select role, jsonb_object_agg(item, qty) w from war.wallets where country = my_country group by role) x),
      'facilities', (select coalesce(jsonb_agg(jsonb_build_object(
        'city', f.city, 'kind', f.kind, 'class', f.class, 'ruined', f.ruined, 'origin_country', f.origin_country)
        order by f.city, f.kind), '[]'::jsonb)
      from war.city_facilities f join war.cities c on c.id = f.city where c.country = my_country),
      'roles', coalesce((select jsonb_agg(jsonb_build_object(
        'key', def.value->>'key', 'name', def.value->>'name',
        'nick', (select coalesce(s2.nickname, '학생') from war.roles rr
          join priv.students s2 on s2.id = rr.student
          where rr.country = my_country and rr.role = def.value->>'key'),
        'absent', coalesce((select rr.absent from war.roles rr where rr.country = my_country and rr.role = def.value->>'key'), false))
        order by ord)
      from jsonb_array_elements(war.cfg()->'ROLES') with ordinality def(value, ord)), '[]'::jsonb)));
  end if;
  -- notice: 이번 단계는 빈 목록
  k := (known->>'notice')::bigint;
  if k is null or k is distinct from v_notice then
    out := out || jsonb_build_object('notice', '[]'::jsonb);
  end if;
  return out;
end $$;
revoke all on function public.war_poll(jsonb) from public;

-- 교사용: 나라별 학생 닉네임·역할·결석 (실명 금지)
create or replace function public.war_admin_roles() returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
begin
  perform priv.need_admin();
  return jsonb_build_object('roles', (select coalesce(jsonb_agg(jsonb_build_object(
    'student', s.id, 'country', s.country_id, 'nick', coalesce(s.nickname, '학생'),
    'role', r.role, 'absent', coalesce(r.absent, false)) order by s.country_id, s.no, s.id), '[]'::jsonb)
  from priv.students s left join war.roles r on r.student = s.id));
end $$;
revoke all on function public.war_admin_roles() from public;

create or replace function public.war_admin_set_absent(p_student int, p_absent boolean) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare c int;
begin
  perform priv.need_admin();
  update war.roles set absent = coalesce(p_absent, false) where student = p_student returning country into c;
  if c is not null then perform war.bump('country', c); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.war_admin_set_absent(int, boolean) from public;

-- 역할 지정: p_role이 null이면 역할 비우기. chief 지정도 가능. 4명 모둠은 engineer 지정 불가
create or replace function public.war_admin_set_role(p_student int, p_role text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare c int; n int;
begin
  perform priv.need_admin();
  if p_role is null then
    delete from war.roles where student = p_student returning country into c;
  else
    if not exists (select 1 from jsonb_array_elements(war.cfg()->'ROLES') r where r->>'key' = p_role) then
      perform priv.err('BAD_ROLE', '없는 역할이에요');
    end if;
    select country_id into c from priv.students where id = p_student;
    if c is null then perform priv.err('NO_STUDENT', '학생을 찾을 수 없어요'); end if;
    select count(*) into n from priv.students where country_id = c;
    if p_role = 'engineer' and n <= 4 then
      perform priv.err('FOUR_GROUP', '4명 모둠은 공병사령관이 없어요. 합동참모의장이 함께 해요.');
    end if;
    begin
      insert into war.roles(student, country, role) values (p_student, c, p_role)
        on conflict (student) do update set country = excluded.country, role = excluded.role;
    exception when unique_violation then
      perform priv.err('ROLE_TAKEN', '이미 다른 친구가 고른 역할이에요');
    end;
  end if;
  if c is not null then perform war.bump('country', c); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.war_admin_set_role(int, text) from public;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function public.war_me() to %I', role_name);
      execute format('grant execute on function public.war_choose_role(text) to %I', role_name);
      execute format('grant execute on function public.war_poll(jsonb) to %I', role_name);
      execute format('grant execute on function public.war_admin_roles() to %I', role_name);
      execute format('grant execute on function public.war_admin_set_absent(int, boolean) to %I', role_name);
      execute format('grant execute on function public.war_admin_set_role(int, text) to %I', role_name);
    end if;
  end loop;
end $$;
