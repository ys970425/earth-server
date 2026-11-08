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
    ('game', 'map', 'units', 'cities', 'diplomacy', 'country', 'notice', 'markets') then
    perform priv.err('BAD_SECTION', '없는 영역이에요');
  end if;
  insert into war.versions(area, country, ver) values (p_section, p_country, 1)
    on conflict (area, country) do update set ver = war.versions.ver + 1;
end $$;
revoke all on function war.bump(text, int) from public;

-- 병력의 칸을 바꾸는 유일한 길. 이후 이동·생산·점령 함수는 칸을 바꿀 때 반드시 이 함수를 쓴다.
-- 한 칸 한 유닛 유일 조건에 걸리면(동시에 같은 칸으로 들어온 늦은 쪽) 쉬운 말로 알려 준다.
create or replace function war.place_unit(p_unit int, p_tile int) returns void
language plpgsql as $$
begin
  update war.units set tile_id = p_tile where id = p_unit;
  if not found then
    perform priv.err('NO_UNIT', '없는 병력이에요.');
  end if;
exception when unique_violation then
  perform priv.err('TILE_TAKEN', '먼저 온 병력이 있어요. 다른 칸을 골라 주세요.');
end $$;
revoke all on function war.place_unit(int, int) from public;

-- 병력의 남은 이동력 (설계 4-4): 노동자 2, 정찰병 5, 구축함·전투기는 전쟁 규칙, 나머지는 무역 규칙
create or replace function war.moves_left_full(p_kind text, cfg jsonb, wcfg jsonb) returns int
language sql stable as $$
  select case when p_kind = 'worker' then (wcfg->'MOVES'->>'worker')::int
    when p_kind = 'scout' then (wcfg->'MOVES'->>'scout')::int
    else coalesce((wcfg->'EXTRA_UNITS'->p_kind->>'move')::int, (cfg->'UNITS'->p_kind->>'move')::int, 0) end
$$;

-- 이동 (설계 4-4): 경로를 한 칸씩 검사하고 마지막 칸은 war.place_unit으로 놓는다 (한 칸 한 유닛은 DB가 최종 판정)
create or replace function public.war_move(p_unit int, p_path int[]) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  cfg jsonb := priv.cfg();
  wcfg jsonb := war.cfg();
  u war.units;
  t war.tiles;
  my_country int;
  sea boolean; air boolean;
  left_ int;
  i int; step int; prev int;
begin
  select * into u from war.units where id = p_unit;
  if not found then perform priv.err('NO_UNIT', '없는 병력이에요.'); end if;
  select country_id into my_country from priv.students where uid = auth.uid();
  if my_country is null then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요.'); end if;
  if u.country <> my_country then perform priv.err('NOT_MINE', '우리 나라 병력이 아니에요.'); end if;
  -- 역할·결석 대행·일시정지 검사와 나라 잠금 (병력의 조종 역할로)
  perform war.act_start(u.commander);
  select * into u from war.units where id = p_unit for update;
  sea := coalesce((wcfg->'EXTRA_UNITS'->u.kind->>'sea')::boolean, (cfg->'UNITS'->u.kind->>'sea')::boolean, false);
  air := coalesce(wcfg->'BRANCH'->>u.kind, '') = 'air';
  left_ := u.moves_left;
  if coalesce(array_length(p_path, 1), 0) = 0 then perform priv.err('BAD_PATH', '갈 칸을 골라 주세요.'); end if;
  if array_length(p_path, 1) > left_ then
    perform priv.err('NO_MOVES', '이동력이 모자라요 (남은 이동력 ' || left_ || ')');
  end if;
  prev := u.tile_id;
  for i in 1 .. array_length(p_path, 1) loop
    step := p_path[i];
    if step is null or prev is null or priv.tdist(prev, step) <> 1 then
      perform priv.err('BAD_PATH', '이어지지 않는 길이에요.');
    end if;
    select * into t from war.tiles where id = step;
    if not found then perform priv.err('BAD_PATH', '없는 칸이에요.'); end if;
    -- 모든 병력: 다른 나라 도시 칸과 시장 칸에는 들어갈 수 없음
    if exists (select 1 from war.cities c where c.tile_id = step and c.country is distinct from u.country) then
      perform priv.err('NO_ENTRY', '다른 나라 도시에는 들어갈 수 없어요.');
    end if;
    if exists (select 1 from war.markets m where m.tile_id = step) then
      perform priv.err('NO_ENTRY', '시장 섬에는 들어갈 수 없어요.');
    end if;
    if not air then
      if sea then
        -- 배: 바다·해안만 (출발 칸은 검사하지 않는다 — 점령한 도시에서 나갈 수 있게)
        if t.terrain not in ('ocean', 'coast') then perform priv.err('BAD_TILE', '배는 바다로만 다녀요.'); end if;
      else
        -- 땅 유닛: 바다·해안·산 금지
        if t.terrain in ('ocean', 'coast', 'mountain') then perform priv.err('BAD_TILE', '바다와 산은 지나갈 수 없어요.'); end if;
        -- 땅·바다 유닛: 다른 나라 병력(군사·민간)이 있는 칸을 지나갈 수 없음
        if exists (select 1 from war.units o where o.tile_id = step and o.country <> u.country) then
          perform priv.err('BLOCKED', '다른 나라 병력이 있는 칸은 지나갈 수 없어요.');
        end if;
      end if;
    end if;
    prev := step;
  end loop;
  -- 멈추는 칸: 공군은 바다·해안에 멈출 수 없음. 같은 종류 병력 유무는 place_unit의 유일 조건이 최종 판정
  if air and t.terrain in ('ocean', 'coast') then
    perform priv.err('BAD_STOP', '공군은 바다 위에 멈출 수 없어요. 땅으로 가요.');
  end if;
  perform war.place_unit(u.id, prev);
  update war.units set moves_left = left_ - array_length(p_path, 1) where id = u.id;
  perform war.bump('units');
  return jsonb_build_object('ok', true, 'unit', u.id, 'kind', u.kind, 'tile', prev,
    'moves_left', left_ - array_length(p_path, 1));
end $$;
revoke all on function public.war_move(int, int[]) from public;

-- 지휘권 넘기기 (설계 4-3): 병력 종류·이동력은 그대로, 조종하는 참모총장만 바뀜
create or replace function public.war_transfer(p_unit int, p_to text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  u war.units;
  my_country int;
begin
  select * into u from war.units where id = p_unit;
  if not found then perform priv.err('NO_UNIT', '없는 병력이에요.'); end if;
  select country_id into my_country from priv.students where uid = auth.uid();
  if my_country is null then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요.'); end if;
  if u.country <> my_country then perform priv.err('NOT_MINE', '우리 나라 병력이 아니에요.'); end if;
  perform war.act_start(u.commander);
  if u.kind in ('worker', 'scout') then
    perform priv.err('NOT_MILITARY', '노동자와 정찰병은 넘길 수 없어요.');
  end if;
  if p_to not in ('army', 'navy', 'air') then
    perform priv.err('BAD_BRANCH', '육·해·공 참모총장 중에 골라 주세요.');
  end if;
  if p_to = u.commander then
    perform priv.err('SAME_BRANCH', '이미 그 참모총장이 조종하고 있어요.');
  end if;
  update war.units set commander = p_to where id = u.id;
  perform war.bump('units');
  return jsonb_build_object('ok', true, 'unit', u.id, 'kind', u.kind, 'commander', p_to);
end $$;
revoke all on function public.war_transfer(int, text) from public;

-- ---------------------------------------------------------------------
-- E3 ①a: 미션 (완료는 서버에 학생별로 기록. 행동 자체의 성공은 서버가 확인하지 않는다)
-- ---------------------------------------------------------------------
-- 내 역할 + 대행 역할(결석·빈 역할 대행, 4명 모둠 합참의 공병) 목록
create or replace function war.my_roles(p_student int, p_country int) returns text[]
language plpgsql stable as $$
declare
  wcfg jsonb := war.cfg();
  my_role text;
  my_roles text[] := '{}';
begin
  select role into my_role from war.roles where student = p_student;
  if my_role is not null then my_roles := array[my_role]; end if;
  if my_role = 'chief' then
    my_roles := my_roles || coalesce((select array_agg(def.value->>'key' order by ord)
      from jsonb_array_elements(wcfg->'ROLES') with ordinality def(value, ord)
      left join war.roles rr on rr.country = p_country and rr.role = def.value->>'key'
      where def.value->>'key' <> 'chief' and (rr.student is null or rr.absent)), '{}');
  end if;
  return my_roles;
end $$;

-- 미션 완료 기록: 내 미션이고 열려 있는 것만. 이미 했으면 그대로 성공
create or replace function public.war_mission_done(p_mission text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  s priv.students;
  wcfg jsonb := war.cfg();
  mdef jsonb;
  my_roles text[];
begin
  select * into s from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요.'); end if;
  select mi into mdef from jsonb_array_elements(wcfg->'MISSIONS') mi where mi->>'key' = p_mission;
  if not found then perform priv.err('BAD_MISSION', '아직 열리지 않았거나 내 미션이 아니에요.'); end if;
  my_roles := war.my_roles(s.id, s.country_id);
  if not ((mdef->>'role') = any(my_roles))
    or not ((mdef->>'opens') = any(array(select jsonb_array_elements_text(wcfg->'OPEN_STAGES')))) then
    perform priv.err('BAD_MISSION', '아직 열리지 않았거나 내 미션이 아니에요.');
  end if;
  insert into war.mission_done(student, mission) values (s.id, p_mission)
    on conflict (student, mission) do nothing;
  perform war.bump('country', s.country_id);
  return jsonb_build_object('ok', true, 'mission', p_mission, 'done', true);
end $$;
revoke all on function public.war_mission_done(text) from public;

-- 내 미션 목록 (내 역할 + 대행 역할만)
create or replace function public.war_missions() returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  s priv.students;
  wcfg jsonb := war.cfg();
  my_roles text[];
begin
  select * into s from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요.'); end if;
  my_roles := war.my_roles(s.id, s.country_id);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'key', mi->>'key', 'role', mi->>'role', 'order', (mi->>'order')::int,
      'text', mi->>'text', 'opens', mi->>'opens',
      'open', (mi->>'opens') = any(array(select jsonb_array_elements_text(wcfg->'OPEN_STAGES'))),
      'done', exists (select 1 from war.mission_done md where md.student = s.id and md.mission = mi->>'key'))
    order by (mi->>'order')::int)
    from jsonb_array_elements(wcfg->'MISSIONS') mi
    where (mi->>'role') = any(my_roles)), '[]'::jsonb);
end $$;
revoke all on function public.war_missions() from public;

-- 교사용 미션 현황 (닉네임만, 실명 금지)
create or replace function public.war_admin_missions() returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
begin
  perform priv.need_admin();
  return jsonb_build_object('missions', (select coalesce(jsonb_agg(jsonb_build_object(
      'student', s.id, 'country', s.country_id, 'nick', coalesce(s.nickname, '친구' || s.id),
      'role', r.role,
      'done', coalesce((select jsonb_agg(md.mission order by md.mission)
        from war.mission_done md where md.student = s.id), '[]'::jsonb),
      'total_open', (select count(*) from jsonb_array_elements(war.cfg()->'MISSIONS') mi
        where (mi->>'opens') = any(array(select jsonb_array_elements_text(war.cfg()->'OPEN_STAGES')))
          and (mi->>'role') = r.role)
    ) order by s.country_id, s.no, s.id), '[]'::jsonb)
  from priv.students s left join war.roles r on r.student = s.id));
end $$;
revoke all on function public.war_admin_missions() from public;

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
    war.markets, war.market_stock, war.grants, war.versions, war.mission_done;
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
  update war.cities set def = (wcfg->'CAPITAL'->>'def')::int,
    hp = (wcfg->'CAPITAL'->>'hp')::int, max_hp = (wcfg->'CAPITAL'->>'hp')::int where kind = 'capital';
  insert into war.factories select country, kind from priv.factories;
  insert into war.advanced select country, kind from priv.advanced;
  -- 원래 칸의 첫 유닛만 제자리에, 나머지(겹친 것·맞지 않는 지형·다른 나라 도시 칸)는 칸을 비워서 넣는다.
  -- (판정은 예전 「insert 뒤 update ... set tile_id = null」과 같음. 한 칸 한 유닛 유일 조건을 어기지 않게 하려고 순서만 바꿈)
  insert into war.units(id, country, kind, tile_id, hp)
  select s.id, s.country, s.kind,
    case when t.id is null then s.tile_id
         when x.n > 1 then null
         when coalesce((cfg->'UNITS'->s.kind->>'sea')::boolean, false)
           then case when t.terrain in ('ocean', 'coast') then s.tile_id else null end
         when t.terrain in ('ocean', 'coast', 'mountain') then null
         when exists (select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from s.country) then null
         else s.tile_id end,
    100
  from priv.units s
  join (select id, row_number() over (
          partition by tile_id, (kind in ('worker', 'scout')) order by id) as n
        from priv.units) x on x.id = s.id
  left join war.tiles t on t.id = s.tile_id;
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
  -- 모든 병력의 이동력을 채운다 (설계 4-4: 노동자 2, 정찰병 5, 나머지는 무역·전쟁 규칙). 턴마다 채우기는 E5
  update war.units set moves_left = war.moves_left_full(kind, cfg, wcfg);
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
  v_game bigint; v_map bigint; v_units bigint; v_cities bigint; v_dip bigint; v_notice bigint; v_country bigint; v_markets bigint;
begin
  if priv.is_admin() then
    return jsonb_build_object('diplomacy', (select coalesce(jsonb_agg(d order by a,b), '[]'::jsonb) from war.diplomacy d),
      'countries', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id), '[]'::jsonb) from war.countries));
  end if;
  select * into s from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '무역 앱에서 먼저 접속해 주세요'); end if;
  my_country := s.country_id;
  select coalesce(max(ver),0) into v_markets from war.versions where area='markets' and country=0;
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
      'diplomacy', v_dip, 'notice', v_notice, 'markets', v_markets, 'country:' || my_country, v_country);
  out := jsonb_build_object('versions', vers, 'me', jsonb_build_object('country', my_country));
  -- game: 턴·남은 시각·일시정지·전투 켜짐
  k := (known->>'game')::bigint;
  if k is null or k is distinct from v_game then
    out := out || jsonb_build_object('game', (select jsonb_build_object(
      'turn', turn, 'turn_seconds', turn_seconds, 'turn_end', turn_end, 'paused', paused, 'combat_on', combat_on)
      from war.game where id = 1));
  end if;
  -- map: 바뀐 칸만 [id, terrain, res, owner, imp, imp_ruined]. 처음엔 전체. 시장 칸(공개 정보)도 함께
  k := (known->>'map')::bigint;
  if k is null or k = 0 or k is distinct from v_map then
    out := out || jsonb_build_object('map', (select coalesce(jsonb_agg(
      jsonb_build_array(id, terrain, res, owner, imp, imp_ruined) order by id), '[]'::jsonb)
      from war.tiles where k is null or k = 0 or ver > k),
      'markets', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'tile', m.tile_id, 'art', m.art, 'name', m.name) order by m.id), '[]'::jsonb)
      from war.markets m));
  end if;
  k := (known->>'markets')::bigint;
  if k is null or k is distinct from v_markets then
    out := out || jsonb_build_object('market_stock', (
      select coalesce(jsonb_object_agg(market::text || ':' || item, qty), '{}'::jsonb)
      from war.market_stock));
  end if;
  -- units: 전체 목록 (번호·나라·종류·칸·체력·조종 역할)
  k := (known->>'units')::bigint;
  if k is null or k is distinct from v_units then
    out := out || jsonb_build_object('units', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'country', country, 'kind', kind, 'tile', tile_id, 'hp', hp, 'commander', commander, 'moves_left', moves_left) order by id), '[]'::jsonb)
      from war.units));
  end if;
  -- cities: 전체 목록 (번호·칸·주인·이름·체력·최대·포위)
  k := (known->>'cities')::bigint;
  if k is null or k is distinct from v_cities then
    out := out || jsonb_build_object('cities', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'tile', tile_id, 'kind', kind, 'country', country, 'name', name, 'hp', hp, 'max_hp', max_hp, 'besieged', besieged,
      'buildings', buildings, 'sea', sea, 'produced_turn', produced_turn) order by id), '[]'::jsonb)
      from war.cities));
  end if;
  -- diplomacy: 15쌍 전부
  k := (known->>'diplomacy')::bigint;
  if k is null or k is distinct from v_dip then
    out := out || jsonb_build_object('diplomacy', (select coalesce(jsonb_agg(jsonb_build_object(
      'a', a, 'b', b, 'status', status, 'no_war_until', no_war_until) order by a, b), '[]'::jsonb)
      from war.diplomacy));
    out := out || jsonb_build_object('offers', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'kind', kind, 'from_c', from_c, 'to_c', to_c, 'turn', turn) order by id), '[]'::jsonb)
      from war.offers where to_c = my_country and status = 'pending'));
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
      execute format('grant execute on function public.war_move(int, int[]) to %I', role_name);
      execute format('grant execute on function public.war_transfer(int, text) to %I', role_name);
      execute format('grant execute on function public.war_mission_done(text) to %I', role_name);
      execute format('grant execute on function public.war_missions() to %I', role_name);
      execute format('grant execute on function public.war_admin_missions() to %I', role_name);
    end if;
  end loop;
end $$;

-- Pointy-top odd-r, matching priv.hdist: odd rows shift right.
-- Width is explicit so this helper stays immutable; callers join existing tiles
-- to discard candidates beyond the bottom edge or missing from the map.
create or replace function war.neighbors(c int, r int, width int) returns int[]
language sql immutable strict as $$
  select array_agg(nr * width + nc)
  from (values (c-1,r),(c+1,r),
    (c-1+(r & 1),r-1),(c+(r & 1),r-1),
    (c-1+(r & 1),r+1),(c+(r & 1),r+1)) n(nc,nr)
  where nc >= 0 and nc < width and nr >= 0
$$;
revoke all on function war.neighbors(int,int,int) from public;

-- E4: one snapshot/layer; E5 also calls this at turn end.
create or replace function war.merge_empty_tiles() returns int language plpgsql as $$
declare ids int[]; owners int[]; n int; width int := (priv.cfg()->>'W')::int;
begin
  select array_agg(id order by id), array_agg(owner order by id) into ids, owners from (
    select t.id, nb.owner from war.tiles t join war.tiles nb on nb.id = any(war.neighbors(t.c,t.r,width))
    where t.owner is null and t.terrain not in ('ocean','coast') and nb.owner is not null
      and not exists(select 1 from war.cities where tile_id=t.id)
      and not exists(select 1 from war.markets where tile_id=t.id)
    group by t.id, nb.owner having count(*) >= 4
  ) s;
  n := coalesce(cardinality(ids),0);
  if n > 0 then
    perform war.bump('map');
    update war.tiles t set owner=s.owner, ver=(select ver from war.versions where area='map' and country=0)
      from unnest(ids,owners) s(id,owner) where t.id=s.id;
  end if;
  return n;
end $$;
revoke all on function war.merge_empty_tiles() from public;

create or replace function war.combat_calc(a numeric, ah int, d numeric, dh int, terrain text, city boolean, boss boolean, distance int)
returns jsonb language plpgsql stable as $$
declare cb jsonb := priv.cfg()->'COMBAT'; ratio numeric; damage int; counter int;
begin
  ratio := greatest(0.01,a*(0.5+0.5*ah/100.0)) / greatest(1,d * case when city then 1 else
    (0.5+0.5*dh/100.0)*case when terrain in ('hills','forest','jungle') then 1.25 else 1 end end);
  damage := greatest((cb->>'min')::int,least((cb->>'max')::int,round((cb->>'base')::numeric*ratio)::int));
  if boss then damage := least(damage,(war.cfg()->'BOSS'->>'damageMax')::int); end if;
  counter := greatest(1,least((cb->>'max')::int,round((cb->>'base')::numeric*(cb->>'counter')::numeric/ratio)::int));
  if distance > 1 then counter := round(counter*(cb->>'rangedCounter')::numeric); end if;
  return jsonb_build_object('damage',damage,'counter',counter);
end $$;
revoke all on function war.combat_calc(numeric,int,numeric,int,text,boolean,boolean,int) from public;

-- game SHARE -> both countries ascending via act_start -> units ascending -> cities ascending.
-- Preview uses the identical checks/calculation and only reads (including row locks).
create or replace function war.attack_core(p_unit int,p_tile int,p_apply boolean) returns jsonb
language plpgsql as $$
declare u war.units; v war.units; c war.cities; cfg jsonb:=priv.cfg(); w jsonb:=war.cfg();
  ud jsonb; vd jsonb; other int; mine int; turn_ int; shield int; lost int; dist int;
  calc jsonb; damage int; counter int; ah int; dh int; cap boolean:=false; siege boolean:=false; need boolean:=false; ids int[]; neighbor_ids int[];
begin
  select * into u from war.units where id=p_unit;
  if not found then perform priv.err('NO_UNIT','없는 병력이에요'); end if;
  select country_id into mine from priv.students where uid=auth.uid();
  if mine is null then perform priv.err('NO_AUTH','먼저 접속해 주세요'); end if;
  if u.country<>mine then perform priv.err('NOT_MINE','우리 나라 병력이 아니에요'); end if;
  if u.kind in ('worker','scout') then perform priv.err('NOT_MILITARY','군사 병력만 공격할 수 있어요'); end if;
  select * into c from war.cities where tile_id=p_tile;
  select * into v from war.units where tile_id=p_tile and country<>mine and kind not in ('worker','scout');
  if exists(select 1 from war.markets where tile_id=p_tile) or
    (c.id is not null and (c.country is null or c.country=mine)) then
    perform priv.err('NO_TARGET','공격할 수 있는 상대가 없어요');
  end if;
  other := case when c.id is not null then c.country else v.country end;
  if other is null then perform priv.err('NO_TARGET','공격할 수 있는 상대가 없어요'); end if;
  perform war.act_start(u.commander,true,other);
  perform 1 from war.units where id in (u.id,v.id) order by id for update;
  perform 1 from war.cities where id=c.id order by id for update;
  select * into u from war.units where id=p_unit;
  select * into c from war.cities where tile_id=p_tile;
  select * into v from war.units where tile_id=p_tile and country<>mine and kind not in ('worker','scout');
  if u.id is null or u.country<>mine or (c.id is not null and c.country is distinct from other)
    or (c.id is null and v.country is distinct from other) then perform priv.err('NO_TARGET','상대가 바뀌었어요. 다시 골라 주세요'); end if;
  select turn into turn_ from war.game where id=1;
  if not exists(select 1 from war.diplomacy where a=least(mine,other) and b=greatest(mine,other) and status='war') then
    perform priv.err('NOT_AT_WAR','전쟁 중인 나라만 공격할 수 있어요'); end if;
  select shield_until,cities_lost into shield,lost from war.countries where id=other;
  if shield>=turn_ then perform priv.err('SHIELD','보호막이 있어요 ('||(shield-turn_)||'턴 남음)'); end if;
  if u.attacked_turn=turn_ then perform priv.err('ATTACKED','이번 턴에는 이미 공격했어요'); end if;
  ud:=coalesce(w->'EXTRA_UNITS'->u.kind,cfg->'UNITS'->u.kind);
  vd:=coalesce(w->'EXTRA_UNITS'->v.kind,cfg->'UNITS'->v.kind);
  dist:=priv.tdist(u.tile_id,p_tile);
  if dist is null or dist<1 or dist>coalesce((ud->>'range')::int,1) then perform priv.err('TOO_FAR','공격하기에 너무 멀어요'); end if;
  calc:=war.combat_calc(case when (ud ? 'boss') then (w->'BOSS'->>'str')::numeric else (ud->>'str')::numeric end,
    u.hp,case when c.id is not null then c.def when (vd ? 'boss') then (w->'BOSS'->>'str')::numeric else (vd->>'str')::numeric end,
    v.hp,(select terrain from war.tiles where id=p_tile),c.id is not null,(ud ? 'boss'),dist);
  if not p_apply then return calc||jsonb_build_object('can_attack',true,'reason',null); end if;
  damage:=(calc->>'damage')::int; counter:=(calc->>'counter')::int; ah:=greatest(0,u.hp-counter);
  dh:=greatest(case when c.id is not null and lost >= (w->>'MAX_CITY_LOSS')::int then 1 else 0 end,coalesce(c.hp,v.hp)-damage);
  if ah=0 then delete from war.units where id=u.id;
  else update war.units set hp=ah,moves_left=0,attacked_turn=turn_ where id=u.id; end if;
  if c.id is null then
    if dh=0 then delete from war.units where id=v.id; else update war.units set hp=dh where id=v.id; end if;
  else
    siege:=dh=0 and c.kind='capital';
    if dh=0 and c.kind<>'capital' then
      neighbor_ids:=war.neighbors(p_tile % (cfg->>'W')::int,p_tile / (cfg->>'W')::int,(cfg->>'W')::int);
      cap:=ah>0 and dist=1 and coalesce((ud->>'range')::int,1)=1 and coalesce(w->'BRANCH'->>u.kind,'')<>'air'
        and (not coalesce((ud->>'sea')::boolean,false) or exists(select 1 from war.tiles where id=any(neighbor_ids) and terrain in ('ocean','coast')))
        and v.id is null;
      need:=not cap;
    end if;
    update war.cities set hp=dh,besieged=siege where id=c.id;
    if cap then
      perform war.place_unit(u.id,p_tile);
      update war.cities set country=mine,hp=max_hp/2,besieged=false where id=c.id;
      update war.city_facilities set ruined=true where city=c.id;
      select array_agg(id) into ids from war.tiles t where id=p_tile or
        (id=any(neighbor_ids) and terrain not in ('ocean','coast')
        and not exists(select 1 from war.cities where tile_id=t.id) and not exists(select 1 from war.markets where tile_id=t.id));
      perform war.bump('map');
      update war.tiles set owner=mine,imp_ruined=imp_ruined or coalesce(w->'TILE_IMP'->'destroy' ? imp,false),
        ver=(select ver from war.versions where area='map' and country=0) where id=any(ids);
      update war.countries set cities_lost=cities_lost+1,shield_until=turn_+(w->>'SHIELD_TURNS')::int where id=other;
      perform war.merge_empty_tiles();
    end if;
    perform war.bump('cities');
  end if;
  perform war.bump('units'); perform war.bump('country',mine); perform war.bump('country',other);
  return calc||jsonb_build_object('attacker_hp',ah,'defender_hp',dh,'killed',c.id is null and dh=0,
    'attacker_killed',ah=0,'besieged',siege,'captured',cap,'need_melee',need);
end $$;
revoke all on function war.attack_core(int,int,boolean) from public;
create or replace function public.war_attack(p_unit int,p_tile int) returns jsonb
language sql security definer set search_path=war,priv,public as $$ select war.attack_core(p_unit,p_tile,true) $$;
create or replace function public.war_attack_preview(p_unit int,p_tile int) returns jsonb
language plpgsql security definer set search_path=war,priv,public as $$
begin return war.attack_core(p_unit,p_tile,false);
exception when raise_exception then return jsonb_build_object('damage',0,'counter',0,'can_attack',false,'reason',regexp_replace(sqlerrm,'^[A-Z_]+: ', '')); end $$;
revoke all on function public.war_attack(int,int), public.war_attack_preview(int,int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('grant execute on function public.war_attack(int,int), public.war_attack_preview(int,int) to %I',r); end if;
end loop; end $$;

create or replace function public.war_declare(p_other int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; pair_a int; pair_b int;
begin
  perform war.act_start('chief', false, p_other);
  select country_id into me from priv.students where uid = auth.uid();
  select turn into turn_ from war.game where id = 1;
  if me = p_other then perform priv.err('BAD_TARGET', '자기 나라에는 선전포고할 수 없어요'); end if;
  if not exists (select 1 from war.countries where id = p_other) then
    perform priv.err('NO_COUNTRY', '없는 나라예요'); end if;
  pair_a := least(me, p_other); pair_b := greatest(me, p_other);
  if not exists (select 1 from war.diplomacy where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b) then
    perform priv.err('NO_DIPLO', '외교 관계가 없어요'); end if;
  if exists (select 1 from war.diplomacy where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and status = 'war') then
    perform priv.err('ALREADY_AT_WAR', '이미 전쟁 중이에요'); end if;
  if exists (select 1 from war.diplomacy where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and no_war_until > turn_) then
    perform priv.err('NO_WAR_BAN', '평화 조약 뒤 3턴이 지나지 않았어요'); end if;
  -- 동맹이면 바로 깨고 전쟁
  update war.diplomacy set status = 'war', changed_turn = turn_ where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b;
  -- 기존 pending 평화 제안 취소
  update war.offers set status = 'cancelled' where kind = 'peace' and status = 'pending'
    and ((from_c = me and to_c = p_other) or (from_c = p_other and to_c = me));
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'status', 'war');
end $$;
revoke all on function public.war_declare(int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_declare(int) to %I', r);
  end if; end loop; end $$;


create or replace function public.war_propose(p_other int, p_kind text default 'peace') returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; pair_a int; pair_b int; oid bigint;
begin
  if p_kind is null or p_kind not in ('peace') then perform priv.err('BAD_KIND', '지원하지 않는 제안 종류예요'); end if;
  perform war.act_start('chief', false, p_other);
  select country_id into me from priv.students where uid = auth.uid();
  select turn into turn_ from war.game where id = 1;
  if me = p_other then perform priv.err('BAD_TARGET', '자기 나라에 제안할 수 없어요'); end if;
  if not exists (select 1 from war.countries where id = p_other) then
    perform priv.err('NO_COUNTRY', '없는 나라예요'); end if;
  pair_a := least(me, p_other); pair_b := greatest(me, p_other);
  -- 평화 제안: 전쟁 중이어야 함
  if p_kind = 'peace' and not exists (
    select 1 from war.diplomacy where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and status = 'war') then
    perform priv.err('NOT_AT_WAR', '전쟁 중인 나라에만 평화를 제안할 수 있어요'); end if;
  -- 이미 같은 종류의 pending 제안이 있으면 취소
  update war.offers set status = 'cancelled'
    where kind = p_kind and status = 'pending'
      and ((from_c = me and to_c = p_other) or (from_c = p_other and to_c = me));
  insert into war.offers(kind, from_c, to_c, turn) values (p_kind, me, p_other, turn_) returning id into oid;
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'offer_id', oid);
end $$;
revoke all on function public.war_propose(int, text) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_propose(int, text) to %I', r);
  end if; end loop; end $$;


create or replace function public.war_accept_offer(p_offer bigint) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; o war.offers; pair_a int; pair_b int;
begin
  select * into o from war.offers where id = p_offer;
  perform war.act_start('chief', false, o.from_c);
  select country_id into me from priv.students where uid = auth.uid();
  select * into o from war.offers where id = p_offer for update;
  if not found then perform priv.err('NO_OFFER', '없는 제안이에요'); end if;
  if o.to_c <> me then perform priv.err('NOT_FOR_ME', '이 제안은 우리 나라에 온 게 아니에요'); end if;
  if o.status <> 'pending' then perform priv.err('OFFER_DONE', '이미 처리된 제안이에요'); end if;
  select turn into turn_ from war.game where id = 1;
  pair_a := least(me, o.from_c); pair_b := greatest(me, o.from_c);
  if o.kind = 'peace' then
    if not exists (select 1 from war.diplomacy where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and status = 'war') then
      perform priv.err('NOT_AT_WAR', '전쟁 중이 아니에요'); end if;
    update war.diplomacy set status = 'peace', no_war_until = turn_ + 3, changed_turn = turn_
      where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b;
    -- 관련 pending 제안 모두 취소
    update war.offers set status = 'cancelled'
      where kind = 'peace' and status = 'pending'
        and ((from_c = me and to_c = o.from_c) or (from_c = o.from_c and to_c = me));
  end if;
  update war.offers set status = 'accepted' where id = p_offer;
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'status', 'peace', 'no_war_until', turn_ + 3);
end $$;
revoke all on function public.war_accept_offer(bigint) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_accept_offer(bigint) to %I', r);
  end if; end loop; end $$;


create or replace function public.war_admin_ceasefire(p_a int, p_b int default null) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  turn_ int; cnt int; cancelled int;
begin
  perform priv.need_admin();
  select turn into turn_ from war.game where id = 1 for share;
  perform 1 from war.countries
    where p_b is null or id in (p_a, p_b) order by id for update;
  if p_b is null then
    -- 그 나라가 포함된 전쟁 모두 휴전
    update war.diplomacy set status = 'peace', no_war_until = turn_ + 3, changed_turn = turn_
      where status = 'war' and (a = p_a or b = p_a);
  else
    -- 특정 쌍 휴전
    update war.diplomacy set status = 'peace', no_war_until = turn_ + 3, changed_turn = turn_
      where status = 'war' and a = least(p_a, p_b) and b = greatest(p_a, p_b);
  end if;
  get diagnostics cnt = row_count;
  update war.offers set status = 'cancelled'
    where kind in ('peace') and status = 'pending'
      and ((p_b is null and (from_c = p_a or to_c = p_a))
        or (least(from_c, to_c) = least(p_a, p_b) and greatest(from_c, to_c) = greatest(p_a, p_b)));
  get diagnostics cancelled = row_count;
  if cnt > 0 or cancelled > 0 then perform war.bump('diplomacy'); end if;
  return jsonb_build_object('ok', true, 'ceasefire_count', cnt);
end $$;
revoke all on function public.war_admin_ceasefire(int, int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_admin_ceasefire(int, int) to %I', r);
  end if; end loop; end $$;


create or replace function public.war_next_turn(p_turn int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  g war.game;
  cfg jsonb; wcfg jsonb;
begin
  perform priv.need_admin();
  select * into g from war.game where id = 1 for update;
  if g.turn <> p_turn then
    return jsonb_build_object('ok', false, 'reason', '이미 다음 턴으로 넘어갔어요');
  end if;
  cfg := priv.cfg(); wcfg := war.cfg();
  update war.units set
    moves_left = war.moves_left_full(kind, cfg, wcfg),
    attacked_turn = -1;
  update war.cities set hp = 20, besieged = false where kind = 'capital' and besieged = true;
  perform war.merge_empty_tiles();
  update war.game set
    turn = turn + 1,
    turn_end = case when turn_seconds > 0 then now() + (turn_seconds || ' seconds')::interval else null end
  where id = 1;
  perform war.bump('game');
  perform war.bump('map');
  perform war.bump('units');
  perform war.bump('cities');
  return jsonb_build_object('ok', true, 'turn', g.turn + 1);
end $$;
revoke all on function public.war_next_turn(int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_next_turn(int) to %I', r);
  end if; end loop; end $$;

create or replace function public.war_pause(p_pause boolean) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
begin
  perform priv.need_admin();
  update war.game set paused = p_pause where id = 1;
  perform war.bump('game');
  return jsonb_build_object('ok', true, 'paused', p_pause);
end $$;
revoke all on function public.war_pause(boolean) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_pause(boolean) to %I', r);
  end if; end loop; end $$;

create or replace function public.war_set_turn_time(p_seconds int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
begin
  perform priv.need_admin();
  if p_seconds < 60 or p_seconds > 600 then
    perform priv.err('BAD_TIME', '턴 시간은 60~600초 사이여야 해요');
  end if;
  update war.game set turn_seconds = p_seconds where id = 1;
  perform war.bump('game');
  return jsonb_build_object('ok', true, 'turn_seconds', p_seconds);
end $$;
revoke all on function public.war_set_turn_time(int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_set_turn_time(int) to %I', r);
  end if; end loop; end $$;

-- E6
create or replace function public.war_budget_give(p_to_role text, p_item text, p_qty int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare me priv.students; my_country int; my_roles text[]; stock int;
begin
  select * into me from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '접속해 주세요'); end if;
  my_country := me.country_id;
  my_roles := war.my_roles(me.id, my_country);
  perform 1 from war.countries where id=my_country for update;
  if not ('chief'=any(my_roles)) then perform priv.err('ROLE_ONLY', '이 역할로는 할 수 없어요'); end if;
  if p_to_role is null or p_to_role not in ('engineer','army','navy','air') then perform priv.err('BAD_ROLE', '역할이 올바르지 않아요'); end if;
  if p_qty is null or p_qty<=0 then perform priv.err('BAD_QTY', '양이 0보다 커야 해요'); end if;
  if p_item is null or (p_item <> 'coin' and not (priv.cfg()->'ITEMS' ? p_item)) then perform priv.err('BAD_ITEM', '알 수 없는 항목이에요'); end if;
  if p_item='coin' then select coin into stock from war.countries where id=my_country;
  else perform 1 from war.inventory where country=my_country and item=p_item for update;
    select coalesce((select qty from war.inventory where country=my_country and item=p_item),0) into stock; end if;
  if stock<p_qty then perform priv.err('NOT_ENOUGH','국고가 부족해요'); end if;
  if p_item='coin' then update war.countries set coin=coin-p_qty where id=my_country;
  else update war.inventory set qty=qty-p_qty where country=my_country and item=p_item; end if;
  insert into war.wallets(country,role,item,qty) values(my_country,p_to_role,p_item,p_qty)
    on conflict(country,role,item) do update set qty=war.wallets.qty+p_qty;
  perform war.bump('country',my_country); return jsonb_build_object('ok',true);
end $$;
create or replace function public.war_budget_take(p_from_role text, p_item text, p_qty int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare me priv.students; my_country int; my_roles text[]; stock int;
begin
  select * into me from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '접속해 주세요'); end if;
  my_country := me.country_id;
  my_roles := war.my_roles(me.id, my_country);
  perform 1 from war.countries where id=my_country for update;
  if not ('chief'=any(my_roles)) then perform priv.err('ROLE_ONLY', '이 역할로는 할 수 없어요'); end if;
  if p_from_role is null or p_from_role not in ('engineer','army','navy','air') then perform priv.err('BAD_ROLE', '역할이 올바르지 않아요'); end if;
  if p_qty is null or p_qty<=0 then perform priv.err('BAD_QTY', '양이 0보다 커야 해요'); end if;
  if p_item is null or (p_item <> 'coin' and not (priv.cfg()->'ITEMS' ? p_item)) then perform priv.err('BAD_ITEM', '알 수 없는 항목이에요'); end if;
  perform 1 from war.wallets where country=my_country and role=p_from_role and item=p_item for update;
  select coalesce((select qty from war.wallets where country=my_country and role=p_from_role and item=p_item),0) into stock;
  if stock<p_qty then perform priv.err('NOT_ENOUGH', '예산이 부족해요'); end if;
  update war.wallets set qty=qty-p_qty where country=my_country and role=p_from_role and item=p_item;
  if p_item='coin' then update war.countries set coin=coin+p_qty where id=my_country;
  else insert into war.inventory(country,item,qty) values(my_country,p_item,p_qty)
    on conflict(country,item) do update set qty=war.inventory.qty+p_qty; end if;
  perform war.bump('country',my_country); return jsonb_build_object('ok',true);
end $$;
create or replace function public.war_city_build(p_city text, p_kind text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare me priv.students; my_country int; my_roles text[]; wallet_role text; cfg jsonb;
  city_rec war.cities; def jsonb; cost jsonb; category text; item_key text; item_qty int; stock int; country_type text;
begin
  select * into me from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '접속해 주세요'); end if;
  my_country := me.country_id;
  my_roles := war.my_roles(me.id, my_country);
  perform 1 from war.countries where id=my_country for update;
  if not ('engineer'=any(my_roles)) then perform priv.err('ROLE_ONLY', '이 역할로는 할 수 없어요'); end if;
  wallet_role := case when exists(select 1 from war.roles where student=me.id and role='chief') then null else 'engineer' end;
  if (select paused from war.game where id=1) then perform priv.err('PAUSED', '지금은 일시정지 중이에요'); end if;
  -- 전쟁 SPECIALTY는 문자열, 무역 SPECIALTY는 객체이므로 비용 계산에는 무역 정의를 우선한다.
  cfg := war.cfg() || priv.cfg();
  select * into city_rec from war.cities where id=p_city for update;
  if not found then perform priv.err('BAD_CITY', '도시를 찾을 수 없어요'); end if;
  if city_rec.country is distinct from my_country then perform priv.err('NOT_OWNER', '우리 나라 소유가 아니에요'); end if;
  if cfg->'BUILDINGS' ? p_kind then category:='basic'; def:=cfg->'BUILDINGS'->p_kind;
  elsif cfg->'FACTORIES' ? p_kind then category:='factory'; def:=cfg->'FACTORIES'->p_kind;
  elsif cfg->'ADVANCED' ? p_kind then category:='advanced'; def:=cfg->'ADVANCED'->p_kind;
  else perform priv.err('BAD_ITEM', '알 수 없는 항목이에요'); end if;
  if p_kind=any(city_rec.buildings) or exists(select 1 from war.city_facilities where city=p_city and kind=p_kind) then
    perform priv.err('ALREADY_BUILT', '이미 있는 건물이에요'); end if;
  if p_kind='harbor' and not city_rec.sea then perform priv.err('NOT_COASTAL', '항구는 해안 도시에만 지을 수 있어요'); end if;
  if def->>'tech' is not null and not coalesce(priv.has_tech(my_country,def->>'tech'),false) then
    perform priv.err('NEED_TECH', '먼저 기술을 배워야 해요'); end if;
  select type into country_type from war.countries where id=my_country;
  cost:=case when category='factory' then def->'build' else def->'cost' end;
  if category='factory' and cfg->'SPECIALTY'->country_type->>'factory'=p_kind then cost:=cfg->'SPECIALTY_BUILD'; end if;
  for item_key, item_qty in select key, value::int from jsonb_each_text(cost) order by key loop
    if wallet_role is not null then
      perform 1 from war.wallets w where w.country=my_country and w.role=wallet_role and w.item=item_key for update;
      select coalesce((select w.qty from war.wallets w where w.country=my_country and w.role=wallet_role and w.item=item_key),0) into stock;
    elsif item_key='coin' then
      select c.coin into stock from war.countries c where c.id=my_country;
    else
      perform 1 from war.inventory i where i.country=my_country and i.item=item_key for update;
      select coalesce((select i.qty from war.inventory i where i.country=my_country and i.item=item_key),0) into stock;
    end if;
    if stock < item_qty then perform priv.err('NOT_ENOUGH', '예산이 부족해요' || item_key); end if;
  end loop;
  for item_key, item_qty in select key, value::int from jsonb_each_text(cost) loop
    if wallet_role is not null then
      update war.wallets w set qty=w.qty-item_qty where w.country=my_country and w.role=wallet_role and w.item=item_key;
    elsif item_key='coin' then
      update war.countries c set coin=c.coin-item_qty where c.id=my_country;
    else
      update war.inventory i set qty=i.qty-item_qty where i.country=my_country and i.item=item_key;
    end if;
  end loop;
  if category='basic' then update war.cities set buildings=array_append(buildings,p_kind) where id=p_city;
  else insert into war.city_facilities(city,kind,class,ruined,origin_country) values(p_city,p_kind,category,false,my_country); end if;
  perform war.bump('cities'); perform war.bump('country',my_country);
  return jsonb_build_object('ok',true,'city',p_city,'kind',p_kind);
end $$;
create or replace function public.war_repair(p_unit int, p_target text, p_target_tile int default null) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare me priv.students; my_country int; my_roles text[]; wallet_role text; cfg jsonb;
  u war.units; t war.tiles; c war.cities; f war.city_facilities; parts text[];
  cost jsonb; item_key text; item_qty int; stock int; specialty_type text; extra text;
begin
  select * into me from priv.students where uid = auth.uid();
  if not found then perform priv.err('NO_AUTH', '접속해 주세요'); end if;
  my_country := me.country_id;
  my_roles := war.my_roles(me.id, my_country);
  perform 1 from war.countries where id=my_country for update;
  if not ('engineer'=any(my_roles)) then perform priv.err('ROLE_ONLY', '이 역할로는 할 수 없어요'); end if;
  wallet_role := case when exists(select 1 from war.roles where student=me.id and role='chief') then null else 'engineer' end;
  if (select paused from war.game where id=1) then perform priv.err('PAUSED', '지금은 일시정지 중이에요'); end if;
  -- 전쟁 SPECIALTY는 문자열, 무역 SPECIALTY는 객체이므로 비용 계산에는 무역 정의를 우선한다.
  cfg := war.cfg() || priv.cfg();
  select * into u from war.units where id=p_unit and country=my_country for update;
  if not found then perform priv.err('NO_UNIT', '병력을 찾을 수 없어요'); end if;
  if u.kind<>'worker' then perform priv.err('NOT_WORKER', '노동자만 수리할 수 있어요'); end if;
  if u.commander is distinct from 'engineer' then perform priv.err('ROLE_ONLY', '이 역할로는 할 수 없어요'); end if;
  if u.moves_left<=0 then perform priv.err('NO_MOVES', '이번 턴에 이미 행동했어요'); end if;
  parts:=string_to_array(p_target,':');
  if parts[1]='tile' and array_length(parts,1)=2 and parts[2] ~ '^[0-9]{1,9}$' then
    select * into t from war.tiles where id=parts[2]::int for update;
    if not found or t.imp is null then perform priv.err('NO_IMP', '시설이 없어요'); end if;
    if t.owner is distinct from my_country then perform priv.err('NOT_OWNER', '우리 나라 소유가 아니에요'); end if;
    if u.tile_id is distinct from t.id then perform priv.err('NOT_ON_TILE', '노동자가 그 칸에 없어요'); end if;
    if not t.imp_ruined then perform priv.err('NOT_RUINED', '파괴되지 않은 시설이에요'); end if;
    cost:=case t.imp when 'farm' then '{"coin":5}'::jsonb when 'quarry' then '{"coin":5}'::jsonb
      when 'lumber' then '{"coin":5}'::jsonb when 'mine' then '{"coin":8}'::jsonb
      when 'oilwell' then '{"coin":8}'::jsonb when 'plantation' then '{"coin":10}'::jsonb else null end;
    if cost is null then perform priv.err('BAD_ITEM', '알 수 없는 항목이에요'); end if;
  elsif parts[1]='city' and array_length(parts,1)=3 then
    select * into c from war.cities where id=parts[2] for update;
    if not found then perform priv.err('BAD_CITY', '도시를 찾을 수 없어요'); end if;
    if c.country is distinct from my_country then perform priv.err('NOT_OWNER', '우리 나라 소유가 아니에요'); end if;
    if u.tile_id is distinct from c.tile_id then perform priv.err('NOT_ON_TILE', '노동자가 그 칸에 없어요'); end if;
    select * into f from war.city_facilities where city=c.id and kind=parts[3] for update;
    if not found then perform priv.err('NO_FACILITY', '시설을 찾을 수 없어요'); end if;
    if not f.ruined then perform priv.err('NOT_RUINED', '파괴되지 않은 시설이에요'); end if;
    select type into specialty_type from war.countries where id=f.origin_country;
    if f.class='factory' and cfg->'SPECIALTY'->specialty_type->>'factory'=f.kind then
      cost:=cfg->'SPECIALTY_BUILD'; extra:=cfg->'STRAT_OF'->>specialty_type;
    elsif f.class='factory' then cost:=cfg->'FACTORIES'->f.kind->'build';
    else cost:=cfg->'ADVANCED'->f.kind->'cost'; end if;
    if cost is null then perform priv.err('BAD_ITEM', '알 수 없는 항목이에요'); end if;
    select jsonb_object_agg(key,floor(value::numeric/2)::int) into cost from jsonb_each_text(cost);
    if extra is not null then cost:=cost || jsonb_build_object(extra,coalesce((cost->>extra)::int,0)+1); end if;
  else perform priv.err('BAD_TARGET', '수리 대상 형식이 올바르지 않아요'); end if;
  for item_key, item_qty in select key, value::int from jsonb_each_text(cost) order by key loop
    if wallet_role is not null then
      perform 1 from war.wallets w where w.country=my_country and w.role=wallet_role and w.item=item_key for update;
      select coalesce((select w.qty from war.wallets w where w.country=my_country and w.role=wallet_role and w.item=item_key),0) into stock;
    elsif item_key='coin' then
      select c.coin into stock from war.countries c where c.id=my_country;
    else
      perform 1 from war.inventory i where i.country=my_country and i.item=item_key for update;
      select coalesce((select i.qty from war.inventory i where i.country=my_country and i.item=item_key),0) into stock;
    end if;
    if stock < item_qty then perform priv.err('NOT_ENOUGH', '예산이 부족해요' || item_key); end if;
  end loop;
  for item_key, item_qty in select key, value::int from jsonb_each_text(cost) loop
    if wallet_role is not null then
      update war.wallets w set qty=w.qty-item_qty where w.country=my_country and w.role=wallet_role and w.item=item_key;
    elsif item_key='coin' then
      update war.countries c set coin=c.coin-item_qty where c.id=my_country;
    else
      update war.inventory i set qty=i.qty-item_qty where i.country=my_country and i.item=item_key;
    end if;
  end loop;
  update war.units set moves_left=0 where id=p_unit;
  if parts[1]='tile' then
    perform war.bump('map');
    update war.tiles set imp_ruined=false, ver=(select ver from war.versions where area='map' and country=0) where id=t.id;
  else update war.city_facilities set ruined=false where city=f.city and kind=f.kind; perform war.bump('cities'); end if;
  perform war.bump('units'); perform war.bump('country',my_country);
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.war_budget_give(text,text,int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('grant execute on function public.war_budget_give(text,text,int) to %I',r); end if;
end loop; end $$;
revoke all on function public.war_budget_take(text,text,int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('grant execute on function public.war_budget_take(text,text,int) to %I',r); end if;
end loop; end $$;
revoke all on function public.war_city_build(text,text) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('grant execute on function public.war_city_build(text,text) to %I',r); end if;
end loop; end $$;
revoke all on function public.war_repair(int,text,int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('grant execute on function public.war_repair(int,text,int) to %I',r); end if;
end loop; end $$;

-- E6
update war.config set data=jsonb_set(data,'{OPEN_STAGES}',coalesce(data->'OPEN_STAGES','[]'::jsonb) || '["E6"]'::jsonb) where not coalesce(data->'OPEN_STAGES' ? 'E6',false);

-- E7: 참모총장·공병사령관의 병력 생산.
create or replace function public.war_produce(p_city text, p_kind text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me priv.students; my_country int; city_rec war.cities;
  cfg jsonb := priv.cfg(); wcfg jsonb := war.cfg(); def jsonb;
  branch text; required_role text; wallet_role text; own_role text;
  cost jsonb; item_key text; item_qty int; stock int; current_turn int;
  nation_tag text; tech_needed text; tile_id_out int; new_unit_id int;
begin
  select * into me from priv.students where uid=auth.uid();
  if not found then perform priv.err('NO_AUTH', '접속해 주세요'); end if;
  my_country := me.country_id;
  def := coalesce(wcfg->'UNITS'->p_kind, cfg->'UNITS'->p_kind, wcfg->'EXTRA_UNITS'->p_kind);
  if p_kind='worker' then def := '{}'::jsonb; end if;
  branch := wcfg->'BRANCH'->>p_kind;
  if def is null or branch is null or (branch='civil' and p_kind<>'worker') then
    perform priv.err('BAD_KIND', '이 병력은 만들 수 없어요'); end if;
  required_role := case when branch='civil' then 'engineer' else branch end;
  perform war.act_start(required_role);
  select turn into current_turn from war.game where id=1;
  select role into own_role from war.roles where student=me.id and country=my_country;
  wallet_role := case when branch='civil' and own_role='chief' then null else required_role end;
  select * into city_rec from war.cities where id=p_city for update;
  if not found then perform priv.err('BAD_CITY', '도시를 찾을 수 없어요'); end if;
  if city_rec.country is distinct from my_country then perform priv.err('NOT_OWNER', '우리 도시가 아니에요'); end if;
  if city_rec.produced_turn=current_turn then perform priv.err('CITY_BUSY', '이 도시에서 이번 턴에 이미 병력을 만들었어요'); end if;
  if branch='army' and not ('barracks'=any(city_rec.buildings)) then
    perform priv.err('NO_BARRACKS', '병영이 없는 도시에서는 육군을 만들 수 없어요'); end if;
  if branch='navy' and not ('harbor'=any(city_rec.buildings)) then
    perform priv.err('NO_HARBOR', '항구가 없는 도시에서는 해군을 만들 수 없어요'); end if;
  if branch='air' and city_rec.kind<>'capital' then
    perform priv.err('NOT_CAPITAL', '공군은 수도에서만 만들 수 있어요'); end if;
  -- 실제 무역 스키마는 priv.countries.techs와 priv.has_tech를 사용한다.
  tech_needed := def->>'tech';
  if tech_needed is not null and not coalesce(priv.has_tech(my_country,tech_needed),false) then
    perform priv.err('NEED_TECH', '기술이 부족해요: ' || tech_needed); end if;
  if def->>'boss' is not null then
    select type into nation_tag from priv.countries where id=my_country;
    if (cfg->'BOSS_UNIT'->nation_tag->>'unit') is distinct from p_kind then
      perform priv.err('NO_BOSS', '이 나라는 이 특수 부대를 만들 수 없어요'); end if;
    for item_key in select jsonb_array_elements_text(cfg->'BOSS_UNIT'->nation_tag->'needs') loop
      if coalesce((select qty from war.inventory where country=my_country and item=item_key),0)<1 then
        perform priv.err('NEED_RESOURCE', '자원이 부족해요: ' || item_key); end if;
    end loop;
  end if;
  cost := case when p_kind='worker' then cfg->'HIRE_WORKER' else def->'cost' end;
  for item_key, item_qty in select key,value::int from jsonb_each_text(cost) order by key loop
    if wallet_role is not null then
      perform 1 from war.wallets where country=my_country and role=wallet_role and item=item_key for update;
      stock := coalesce((select qty from war.wallets where country=my_country and role=wallet_role and item=item_key),0);
    elsif item_key='coin' then
      select coin into stock from war.countries where id=my_country;
    else
      perform 1 from war.inventory where country=my_country and item=item_key for update;
      stock := coalesce((select qty from war.inventory where country=my_country and item=item_key),0);
    end if;
    if stock<item_qty then perform priv.err('NOT_ENOUGH', '예산이 부족해요: ' || item_key); end if;
  end loop;
  -- 도시 칸 우선. 민간·군사 슬롯을 각각 검사하고 인접 칸은 병과 지형을 따른다.
  select t.id into tile_id_out from war.tiles t
  where (t.id=city_rec.tile_id or t.id=any(war.neighbors(
    (select c from war.tiles where id=city_rec.tile_id),
    (select r from war.tiles where id=city_rec.tile_id), (select max(c)+1 from war.tiles))))
    and not exists(select 1 from war.units u where u.tile_id=t.id
      and ((u.kind in ('worker','scout'))=(branch='civil')))
    and (t.id=city_rec.tile_id or (
      not exists(select 1 from war.markets m where m.tile_id=t.id)
      and case when branch='navy' then t.terrain in ('ocean','coast')
        when branch='air' then t.terrain not in ('ocean','coast')
        else t.terrain not in ('ocean','coast','mountain') end))
  order by (t.id=city_rec.tile_id) desc,t.id limit 1;
  if tile_id_out is null then perform priv.err('NO_SPACE', '병력을 놓을 빈 칸이 없어요'); end if;
  for item_key,item_qty in select key,value::int from jsonb_each_text(cost) loop
    if wallet_role is not null then
      update war.wallets set qty=qty-item_qty where country=my_country and role=wallet_role and item=item_key;
    elsif item_key='coin' then
      update war.countries set coin=coin-item_qty where id=my_country;
    else
      update war.inventory set qty=qty-item_qty where country=my_country and item=item_key;
    end if;
  end loop;
  -- 서로 다른 나라의 동시 생산에서도 max(id)+1 충돌을 막는다.
  perform pg_advisory_xact_lock(707,7);
  select coalesce(max(id),0)+1 into new_unit_id from war.units;
  insert into war.units(id,country,kind,hp,moves_left,commander,moves_turn)
    values(new_unit_id,my_country,p_kind,100,war.moves_left_full(p_kind,cfg,wcfg)/2,required_role,current_turn);
  perform war.place_unit(new_unit_id,tile_id_out);
  update war.cities set produced_turn=current_turn where id=p_city;
  perform war.bump('units'); perform war.bump('cities'); perform war.bump('country',my_country);
  return jsonb_build_object('ok',true,'unit_id',new_unit_id,'tile',tile_id_out);
end $$;
revoke all on function public.war_produce(text,text) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=r) then
    execute format('grant execute on function public.war_produce(text,text) to %I',r);
  end if; end loop; end $$;

-- 이미 설치된 config에서도 E7 미션을 연다.
update war.config set data=jsonb_set(data,'{OPEN_STAGES}',coalesce(data->'OPEN_STAGES','[]'::jsonb) || '["E7"]'::jsonb)
where not coalesce(data->'OPEN_STAGES' ? 'E7',false);

-- E9 시장: 나라 잠금 후 시장 잠금으로 구매를 직렬화한다.
create or replace function public.war_market_buy(p_market int, p_item text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  wcfg jsonb := war.cfg();
  s priv.students;
  my_country int;
  my_specialty text;
  has_specialty boolean;
  ref_price int;
  tariff int;
  cost int;
  coins int;
begin
  select * into s from priv.students where uid=auth.uid();
  if not found then perform priv.err('NO_AUTH', '먼저 접속해 주세요'); end if;
  my_country := s.country_id;
  if not ('chief'=any(war.my_roles(s.id,my_country))) then
    perform priv.err('ROLE_ONLY', '합동참모의장만 구매할 수 있어요');
  end if;
  perform 1 from war.game where id=1 for share;
  select coin into coins from war.countries where id=my_country for update;
  perform 1 from war.markets where id=p_market for update;
  if not found then perform priv.err('NO_MARKET', '없는 시장이에요'); end if;
  perform 1 from war.market_stock where market=p_market and item=p_item and qty>0 for update;
  if not found then perform priv.err('OUT_OF_STOCK', '시장 재고가 없어요'); end if;
  my_specialty := wcfg->'SPECIALTY_ITEM'->>(my_country::text);
  perform 1 from war.inventory where country=my_country and item=my_specialty and qty>=1 for update;
  has_specialty := found;
  ref_price := (wcfg->'ITEMS'->p_item->>'ref')::int;
  if ref_price is null or ref_price<0 then perform priv.err('BAD_ITEM', '가격이 없는 품목이에요'); end if;
  tariff := floor(ref_price * 0.5)::int;
  cost := tariff * case when has_specialty then 1 else 2 end;
  if coins is null or coins<cost then perform priv.err('NOT_ENOUGH', '코인이 부족해요'); end if;
  if has_specialty then
    update war.inventory set qty=qty-1 where country=my_country and item=my_specialty;
    insert into war.market_stock(market,item,qty) values(p_market,my_specialty,1)
      on conflict(market,item) do update set qty=war.market_stock.qty+1;
  end if;
  update war.countries set coin=coin-cost where id=my_country;
  update war.market_stock set qty=qty-1 where market=p_market and item=p_item;
  insert into war.inventory(country,item,qty) values(my_country,p_item,1)
    on conflict(country,item) do update set qty=war.inventory.qty+1;
  perform war.bump('country',my_country);
  perform war.bump('markets',0);
  return jsonb_build_object('ok',true,'item',p_item,'spent_specialty',has_specialty,'tariff',tariff);
end $$;
revoke all on function public.war_market_buy(int,text) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=r) then
    execute format('grant execute on function public.war_market_buy(int,text) to %I',r);
  end if;
end loop; end $$;

-- 기존 설치에도 E9와 품목 가격을 반영한다.
update war.config set data=jsonb_set(data,'{ITEMS}',priv.cfg()->'ITEMS');
update war.config set data=jsonb_set(data,'{SPECIALTY_ITEM}',
  (select jsonb_object_agg(id::text, priv.cfg()->'STRAT_OF'->type) from priv.countries));
update war.config set data=jsonb_set(data,'{OPEN_STAGES}',coalesce(data->'OPEN_STAGES','[]'::jsonb) || '["E9"]'::jsonb)
where not coalesce(data->'OPEN_STAGES' ? 'E9',false);
