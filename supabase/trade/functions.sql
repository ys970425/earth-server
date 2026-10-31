-- ---------------------------------------------------------------------
-- 내부 도우미 (priv: 화면에서 직접 호출 불가)
-- ---------------------------------------------------------------------
create or replace function priv.cfg() returns jsonb
language sql stable as $$ select data from priv.config where id = 1 $$;

create or replace function priv.err(code text, msg text) returns void
language plpgsql as $$ begin raise exception '%: %', code, msg; end $$;

create or replace function priv.turn() returns int
language sql stable as $$ select turn from public.game where id = 1 $$;

create or replace function priv.phase() returns int
language sql stable as $$ select phase from public.game where id = 1 $$;

create or replace function priv.me() returns priv.students
language plpgsql stable as $$
declare r priv.students;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  select * into r from priv.students where uid = auth.uid();
  if not found then perform priv.err('NOT_JOINED', '아직 나라에 입장하지 않았어요.'); end if;
  return r;
end $$;

create or replace function priv.is_admin() returns boolean
language sql stable as $$ select exists(select 1 from priv.admins where uid = auth.uid()) $$;

create or replace function priv.need_admin() returns void
language plpgsql stable as $$
begin
  if not priv.is_admin() then perform priv.err('NOT_ADMIN', '교사 로그인이 필요해요.'); end if;
end $$;

create or replace function priv.bump(c int) returns void
language sql as $$ update public.country_ticks set ver = ver + 1 where country_id = c $$;

create or replace function priv.bump_all() returns void
language sql as $$ update public.country_ticks set ver = ver + 1 where true $$;

create or replace function priv.bump_game() returns void
language sql as $$ update public.game set ver = ver + 1, updated_at = now() where id = 1 $$;

create or replace function priv.notice(msg text, k text default 'info', c int default null) returns void
language sql as $$ insert into public.notices(country, kind, message) values (c, k, msg) $$;

create or replace function priv.event(k text, msg text, d jsonb default null) returns void
language sql as $$ insert into priv.events(turn, kind, message, data) values (priv.turn(), k, msg, d) $$;

create or replace function priv.ctype(c int) returns text
language sql stable as $$ select type from priv.countries where id = c $$;

create or replace function priv.cname(c int) returns text
language sql stable as $$
  select coalesce(nullif(trim(name), ''), priv.cfg()->'TYPES'->type->>'name') from priv.countries where id = c
$$;

create or replace function priv.iname(item text) returns text
language sql stable as $$ select case when item = 'coin' then '코인' else coalesce(priv.cfg()->'ITEMS'->item->>'name', item) end $$;

-- 육각 거리 (odd-r 오프셋 → 큐브)
create or replace function priv.hdist(c1 int, r1 int, c2 int, r2 int) returns int
language sql immutable as $$
  select greatest(abs(q1 - q2), abs(r1 - r2), abs((-q1 - r1) - (-q2 - r2)))
  from (select c1 - (r1 - (r1 & 1)) / 2 as q1, c2 - (r2 - (r2 & 1)) / 2 as q2) x
$$;

create or replace function priv.within(center int, rad int) returns int[]
language sql stable as $$
  select coalesce(array_agg(t.id), '{}') from priv.tiles t, priv.tiles o
  where o.id = center and t.r between o.r - rad and o.r + rad and priv.hdist(t.c, t.r, o.c, o.r) <= rad
$$;

create or replace function priv.tdist(a int, b int) returns int
language sql stable as $$ select priv.hdist(x.c, x.r, y.c, y.r) from priv.tiles x, priv.tiles y where x.id = a and y.id = b $$;

create or replace function priv.inv(c int, it text) returns int
language sql stable as $$ select coalesce((select qty from priv.inventory where country = c and item = it), 0) $$;

create or replace function priv.add(c int, it text, n int) returns void
language plpgsql as $$
begin
  if it = 'coin' then update priv.countries set coin = coin + n where id = c; return; end if;
  insert into priv.inventory(country, item, qty) values (c, it, n)
    on conflict (country, item) do update set qty = priv.inventory.qty + excluded.qty;
end $$;

-- 비용이 모자라면 무엇이 모자란지 문장으로 (충분하면 null)
create or replace function priv.cost_short(c int, cost jsonb, mult numeric default 1) returns text
language plpgsql stable as $$
declare k text; v numeric; have int; msg text := '';
begin
  for k, v in select key, value::numeric from jsonb_each_text(coalesce(cost, '{}'::jsonb)) loop
    v := ceil(v * mult);
    if k = 'coin' then select coin into have from priv.countries where id = c; else have := priv.inv(c, k); end if;
    if have < v then msg := msg || case when msg = '' then '' else ', ' end || priv.iname(k) || ' ' || (v - have)::int; end if;
  end loop;
  return case when msg = '' then null else msg || '이(가) 모자라요.' end;
end $$;

create or replace function priv.pay(c int, cost jsonb, mult numeric default 1) returns void
language plpgsql as $$
declare k text; v numeric; s text;
begin
  s := priv.cost_short(c, cost, mult);
  if s is not null then perform priv.err('NO_MONEY', s); end if;
  for k, v in select key, value::numeric from jsonb_each_text(coalesce(cost, '{}'::jsonb)) loop
    perform priv.add(c, k, -ceil(v * mult)::int);
  end loop;
end $$;

create or replace function priv.has_tech(c int, t text) returns boolean
language sql stable as $$ select t = any(techs) from priv.countries where id = c $$;

create or replace function priv.military(c int) returns int
language sql stable as $$ select count(*)::int from priv.units where country = c and kind in ('spear', 'catapult', 'ballista', 'cannon') $$;

create or replace function priv.strength(c int, t int) returns int
language sql stable as $$
  select coalesce(sum((priv.cfg()->'UNITS'->kind->>'str')::int), 0)::int
  from priv.units where country = c and kind in ('spear', 'catapult', 'ballista', 'cannon') and acted_turn < t
$$;

-- 시야 넓히기 + 발견 확인
create or replace function priv.reveal(c int, ids int[]) returns void
language sql as $$
  update priv.countries set explored = (select array_agg(distinct x) from unnest(explored || ids) x) where id = c
$$;

create or replace function priv.check_discovery() returns void
language plpgsql as $$
declare me record; x record; g public.game; cnt int;
begin
  for me in select * from priv.countries order by id loop
    for x in select * from priv.countries where id <> me.id and not (id = any(me.discovered)) loop
      if exists(select 1 from priv.tiles t where t.owner = x.id and t.id = any(me.explored)) then
        update priv.countries set discovered = discovered || x.id where id = me.id;
        perform priv.notice(priv.cname(x.id) || '을(를) 발견했어요! 국경 너머에 다른 나라가 있어요.', 'discover', me.id);
        perform priv.bump(me.id);
      end if;
    end loop;
  end loop;
  select * into g from public.game where id = 1;
  if g.world_first is null then
    for me in select * from priv.countries where coalesce(array_length(discovered, 1), 0) >= 5 order by id limit 1 loop
      update public.game set world_first = me.id, diplomacy_open = true where id = 1;
      update priv.countries set title = '세계 탐험가', coin = coin + 30 where id = me.id;
      perform priv.notice(priv.cname(me.id) || '의 정찰대가 세계의 모든 나라를 발견했습니다! 세계 외교의 시대가 열립니다.', 'world');
      perform priv.event('world_first', priv.cname(me.id) || ' 세계 발견', jsonb_build_object('country', me.id));
      perform priv.bump_game(); perform priv.bump_all();
    end loop;
  end if;
end $$;

-- 영토 넓히기 (같은 유형 땅, 주인 없는 육지)
create or replace function priv.claim(p_country int, p_center int, p_rad int) returns void
language plpgsql as $$
declare tp text := priv.ctype(p_country); sight int := (priv.cfg()->>'CITY_SIGHT')::int;
begin
  update priv.tiles set owner = p_country
   where id = any(priv.within(p_center, p_rad)) and zone = tp and owner is null and terrain not in ('ocean', 'coast');
  perform priv.reveal(p_country, priv.within(p_center, greatest(p_rad, sight)));
end $$;

-- 게임판 처음 상태로 (명단·기기 연결·나라 이름과 국기는 그대로)
create or replace function priv.init_world() returns void
language plpgsql as $$
declare cfg jsonb := priv.cfg(); co record; cap priv.cities; k text; v text;
begin
  update priv.tiles set owner = null, imp = null where true;
  update priv.cities set country = null, buildings = '{}', built_turn = -1, trained_turn = -1, unrest = false, taken_turn = null, def_help = 0 where true;
  delete from priv.units where true;
  delete from priv.inventory where true;
  delete from priv.factories where true;
  delete from priv.advanced where true;
  delete from priv.offers where true;
  delete from priv.trades where true;
  delete from priv.events where true;
  delete from priv.treaties where true;
  delete from priv.reflections where true;
  delete from priv.snapshots where true;
  delete from public.notices where true;
  update public.game set phase = 0, turn = 0, turn_end = null, market_open = false, diplomacy_open = false, crisis = false,
    fair_cap = true, tariff = 0, banned = '{}'::jsonb, cold_snap = null, world_first = null, locked = false, timer_end = null where id = 1;
  for co in select * from priv.countries order by id loop
    update priv.countries set coin = (cfg->'START'->>'coin')::int, happy = (cfg->'HAPPY'->>'base')::int, glory = '{}',
      techs = array(select jsonb_array_elements_text(cfg->'TYPES'->co.type->'techs')),
      discovered = '{}', explored = '{}', title = null, lux_types = 0, income = 0, short = '{}', tariff_turn = 0, attacked_turn = -1
     where id = co.id;
    for k, v in select key, value from jsonb_each_text(cfg->'START') loop
      if k <> 'coin' then perform priv.add(co.id, k, v::int); end if;
    end loop;
    select * into cap from priv.cities where kind = 'capital' and type = co.type;
    update priv.cities set country = co.id, taken_turn = 0 where id = cap.id;
    perform priv.claim(co.id, cap.tile_id, 2);
    insert into priv.units(country, kind, tile_id) values (co.id, 'worker', cap.tile_id), (co.id, 'scout', cap.tile_id), (co.id, 'spear', cap.tile_id);
  end loop;
  perform priv.check_discovery();
  perform priv.bump_game(); perform priv.bump_all();
end $$;

-- 행복도 계산에 쓰는 이번 턴 사치품 종류 (소비 전)
create or replace function priv.lux_types_now(c int) returns int
language sql stable as $$
  select count(*)::int from priv.inventory i
  where i.country = c and i.qty >= 1 and i.item in (select jsonb_array_elements_text(priv.cfg()->'LUX'))
$$;

-- 지구 서버 안정도: 0.4 평균 행복도 + 0.2 경제력 + 0.2 문화력 + 0.2 거래량
create or replace function priv.world_power() returns jsonb
language sql stable as $$
  with cfg as (select priv.cfg() d),
  e as (select coalesce(sum(c.income), 0) + coalesce((select sum((cfg.d->'ADVANCED'->a.kind->>'econ')::int) from priv.advanced a, cfg), 0) econ,
               coalesce(sum(c.lux_types * 5), 0) + coalesce((select sum(coalesce((cfg.d->'ADVANCED'->a.kind->>'culture')::int, 0)) from priv.advanced a, cfg), 0) culture,
               coalesce(avg(c.happy), 0) happy
        from priv.countries c)
  select jsonb_build_object('econ', econ, 'culture', culture, 'happy', round(happy)) from e
$$;

create or replace function priv.trade_volume(t int) returns int
language sql stable as $$ select coalesce(sum(qty), 0)::int from priv.trades where turn = t and not broker $$;

create or replace function priv.gauge() returns int
language sql stable as $$
  with w as (select priv.world_power() p), g as (select turn, base_vol from public.game where id = 1)
  select round(0.4 * (w.p->>'happy')::numeric
             + 0.2 * least(100, (w.p->>'econ')::numeric / 4.2)
             + 0.2 * least(100, (w.p->>'culture')::numeric / 1.5)
             + 0.2 * least(100, priv.trade_volume(g.turn - 1) * 100.0 / greatest(1, g.base_vol)))::int
  from w, g
$$;

-- ---------------------------------------------------------------------
-- 턴 끝 처리: 생산 → 공장 → 사치품 → 행복도 → 불안 → 기록
-- ---------------------------------------------------------------------
create or replace function priv.end_turn() returns void
language plpgsql as $$
declare
  cfg jsonb := priv.cfg(); g public.game; co record; ci record; t record; f record;
  inc jsonb; gross int; upkeep int; ncity int; food int; v int; types int; h jsonb; cr jsonb;
  n int; cost int; it text; y int; shortl text[]; recent record; mil int;
begin
  select * into g from public.game where id = 1;
  h := cfg->'HAPPY'; cr := h->'crisis';
  for co in select * from priv.countries order by id loop
    inc := (cfg->'INCOME') || coalesce(cfg->'PRODUCTIVITY'->co.type, '{}'::jsonb);
    select count(*) into ncity from priv.cities where country = co.id;
    -- 코인
    gross := (inc->>'capital')::int + (ncity - 1) * (inc->>'city')::int;
    for ci in select * from priv.cities where country = co.id loop
      if ci.unrest then
        if ci.kind <> 'capital' then gross := gross - (inc->>'city')::int; end if;
        continue;
      end if;
      if 'market' = any(ci.buildings) then gross := gross + (inc->>'market')::int; end if;
      if 'harbor' = any(ci.buildings) then gross := gross + (inc->>'harbor')::int; end if;
    end loop;
    gross := gross + coalesce((select sum(coalesce((cfg->'ADVANCED'->kind->>'coinPerTurn')::int, 0)) from priv.advanced where country = co.id), 0);
    if co.happy >= (h->>'golden')::int then gross := round(gross * 1.25);
    elsif co.happy < (h->>'unhappy')::int then gross := round(gross * 0.8); end if;
    mil := priv.military(co.id);
    upkeep := mil * (cfg->>'UNIT_UPKEEP')::int;
    update priv.countries set coin = coin + gross - upkeep, income = gross - upkeep where id = co.id;
    -- 식량
    food := (inc->>'capitalFood')::int - ncity * (inc->>'cityFood')::int
          - (select count(*) from priv.units where country = co.id and kind = 'worker')::int * (inc->>'workerFood')::int
          + (select count(*) from priv.cities where country = co.id and 'granary' = any(buildings) and not unrest)::int * 2;
    -- 개발한 칸 생산 (불안한 도시 옆 칸은 멈춤)
    for t in select tl.* from priv.tiles tl where tl.owner = co.id and tl.imp is not null
             and not exists(select 1 from priv.cities c2, priv.tiles ct where c2.country = co.id and c2.unrest and ct.id = c2.tile_id
                            and priv.hdist(ct.c, ct.r, tl.c, tl.r) <= 1) loop
      if t.imp = 'farm' then food := food + case when t.terrain = 'tundra' then (cfg->>'TUNDRA_FOOD')::int else 2 end;
      elsif t.imp = 'lumber' then perform priv.add(co.id, 'wood', 2);
      elsif t.res is not null then
        y := (cfg->'IMPROVE'->t.imp->>'yield')::int;
        if t.res = 'oil' and g.cold_snap = co.id then y := y / 2; end if;
        perform priv.add(co.id, t.res, y);
      end if;
    end loop;
    perform priv.add(co.id, 'food', food);
    shortl := '{}';
    if priv.inv(co.id, 'food') < 0 then
      update priv.inventory set qty = 0 where country = co.id and item = 'food';
      shortl := shortl || '식량'::text;
    end if;
    -- 가공 공장 (원료 1 → 제품 1, 가공비)
    if g.phase >= 2 then
      for f in select * from priv.factories where country = co.id loop
        it := cfg->'FACTORIES'->f.kind->>'input';
        cost := (cfg->'PROC_COST'->co.type->>(cfg->'FACTORIES'->f.kind->>'output'))::int;
        select coin into v from priv.countries where id = co.id;
        n := least((cfg->'FACTORIES'->f.kind->>'perTurn')::int, priv.inv(co.id, it), case when cost > 0 then v / cost else 99 end);
        if n > 0 then
          perform priv.add(co.id, it, -n);
          perform priv.add(co.id, 'coin', -n * cost);
          perform priv.add(co.id, cfg->'FACTORIES'->f.kind->>'output', n);
        end if;
      end loop;
    end if;
    -- 사치품: 종류마다 1개 소비
    types := 0;
    for it in select jsonb_array_elements_text(cfg->'LUX') loop
      if priv.inv(co.id, it) >= 1 then perform priv.add(co.id, it, -1); types := types + 1; end if;
    end loop;
    -- 행복도
    v := (h->>'base')::int + types * (h->>'perLuxType')::int
       + (select count(*) from priv.cities where country = co.id and 'plaza' = any(buildings))::int * (h->>'perPlaza')::int
       + case when exists(select 1 from priv.advanced where country = co.id and kind = 'theater') then (cfg->'ADVANCED'->'theater'->>'happy')::int else 0 end
       + (ncity - 1) * (h->>'perCity')::int
       + coalesce((select sum(x) from unnest(co.glory) x), 0)::int
       - ceil(co.tariff_turn::numeric / (h->>'tariffPer')::int)::int;
    if '식량' = any(shortl) then v := v + (h->>'hunger')::int; end if;
    if g.crisis then
      v := v + (ncity - 1) * (cr->>'perCity')::int;
      if types < (cr->>'fewLuxUnder')::int then v := v + (cr->>'fewLux')::int; shortl := shortl || '사치품'::text; end if;
      if mil >= (cr->>'armyNeedsSteel')::int then
        if priv.inv(co.id, 'steel') >= 1 then perform priv.add(co.id, 'steel', -1);
        else v := v + (cr->>'noSteel')::int; shortl := shortl || '강철'::text; end if;
      end if;
      if ncity >= (cr->>'fuelCities')::int then
        if priv.inv(co.id, 'fuel') >= 1 then perform priv.add(co.id, 'fuel', -1);
        else v := v + (cr->>'noFuel')::int; shortl := shortl || '연료'::text; end if;
      end if;
    end if;
    v := greatest(0, least(100, v));
    update priv.countries set happy = v, lux_types = types, short = shortl, tariff_turn = 0,
      glory = array(select x - (h->>'gloryDecay')::int from unnest(glory) x where x - (h->>'gloryDecay')::int > 0)
     where id = co.id;
    -- 불안: 25 미만이면 가장 최근에 얻은 도시 하나가 불안 (영구 손실 없음)
    update priv.cities set unrest = false where country = co.id;
    if v < (h->>'unrest')::int then
      select * into recent from priv.cities where country = co.id and kind = 'cs' order by taken_turn desc, id desc limit 1;
      if found then
        update priv.cities set unrest = true where id = recent.id;
        perform priv.notice(recent.name || '에서 시민들이 불안해하고 있어요. 이 도시의 생산이 멈췄어요.', 'unrest', co.id);
      end if;
    end if;
    if v < (h->>'revolt')::int then
      perform priv.notice('수도에 반란군이 나타났어요! 병사들이 진압했지만 시민들의 요구를 들어줘야 해요.', 'revolt', co.id);
      perform priv.event('revolt', priv.cname(co.id) || ' 수도 반란군', jsonb_build_object('country', co.id));
    end if;
    if array_length(shortl, 1) > 0 then
      perform priv.notice('부족해요: ' || array_to_string(shortl, ', ') || ' → 행복도가 떨어졌어요.', 'short', co.id);
    end if;
    insert into priv.snapshots(turn, country, data)
      select g.turn, co.id, jsonb_build_object('coin', c.coin, 'happy', c.happy, 'income', c.income, 'lux', c.lux_types,
        'cities', ncity, 'short', c.short,
        'inv', (select coalesce(jsonb_object_agg(item, qty), '{}') from priv.inventory where country = co.id))
      from priv.countries c where c.id = co.id
      on conflict (turn, country) do update set data = excluded.data;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 학생: 입장
-- ---------------------------------------------------------------------
create or replace function public.get_public() returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object(
    'phase', g.phase, 'turn', g.turn, 'require_approval', g.require_approval,
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'name', priv.cname(c.id),
        'flag_url', c.flag_url) order by c.id), '[]') from priv.countries c))
  from public.game g where g.id = 1
$$;

create or replace function public.get_roster(p_country int) returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'no', s.no, 'name', s.name, 'taken', s.uid is not null) order by s.no, s.id), '[]')
  from priv.students s where s.country_id = p_country
$$;

create or replace function public.join_student(p_student int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students; mine priv.students; appr boolean;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  select * into mine from priv.students where uid = auth.uid();
  if found then
    if mine.id = p_student then return jsonb_build_object('status', 'joined'); end if;
    perform priv.err('DEVICE_TAKEN', '이 기기는 이미 ' || mine.name || ' 학생으로 연결되어 있어요. 선생님께 말해 주세요.');
  end if;
  select * into s from priv.students where id = p_student for update;
  if not found then perform priv.err('NO_STUDENT', '학생을 찾을 수 없어요.'); end if;
  select require_approval into appr from public.game where id = 1;
  if s.uid is null and not appr then
    update priv.students set uid = auth.uid(), bound_at = now(), last_seen = now() where id = s.id;
    perform priv.bump(s.country_id);
    return jsonb_build_object('status', 'joined');
  end if;
  if s.uid is not null and not appr then
    perform priv.err('NAME_TAKEN', s.name || ' 학생은 이미 다른 기기로 들어와 있어요. 선생님께 말해 주세요.');
  end if;
  delete from priv.pairing_requests where uid = auth.uid() and status = 'pending';
  insert into priv.pairing_requests(student_id, uid) values (s.id, auth.uid());
  perform priv.bump_game();
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.leave_student() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students;
begin
  if auth.uid() is null then return jsonb_build_object('ok', true); end if;
  select * into s from priv.students where uid = auth.uid();
  if found then update priv.students set uid = null where id = s.id; perform priv.bump(s.country_id); end if;
  delete from priv.pairing_requests where uid = auth.uid() and status = 'pending';
  perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_me() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students; pend boolean;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'none'); end if;
  select * into s from priv.students where uid = auth.uid();
  if found then
    update priv.students set last_seen = now() where id = s.id;
    return jsonb_build_object('status', 'joined', 'student_id', s.id, 'country_id', s.country_id, 'name', s.name,
      'role', s.role, 'is_leader', s.is_leader);
  end if;
  select exists(select 1 from priv.pairing_requests where uid = auth.uid() and status = 'pending') into pend;
  return jsonb_build_object('status', case when pend then 'pending' else 'none' end);
end $$;

create or replace function public.set_role(p_role text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if not (p_role = any(array(select jsonb_array_elements_text(priv.cfg()->'ROLES')))) then perform priv.err('BAD_ROLE', '없는 역할이에요.'); end if;
  update priv.students set role = p_role where id = me.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 나라 이름·국기·문장 (국가 대표만)
create or replace function public.country_update(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if not me.is_leader then perform priv.err('LEADER_ONLY', '나라 이름과 국기는 국가 대표만 바꿀 수 있어요.'); end if;
  update priv.countries set
    name = case when p ? 'name' then left(nullif(trim(p->>'name'), ''), 16) else name end,
    flag_url = case when p ? 'flag_url' then p->>'flag_url' else flag_url end,
    emblem_url = case when p ? 'emblem_url' then p->>'emblem_url' else emblem_url end,
    updated_at = now()
   where id = me.country_id;
  perform priv.bump_all(); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 학생: 화면 데이터
-- ---------------------------------------------------------------------
create or replace function public.my_state() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); co priv.countries; g public.game; known int[];
begin
  update priv.students set last_seen = now() where id = me.id;
  select * into co from priv.countries where id = me.country_id;
  select * into g from public.game where id = 1;
  known := case when g.diplomacy_open then array(select id from priv.countries) else co.discovered || co.id end;
  return jsonb_build_object(
    'now', now(),
    'game', jsonb_build_object('phase', g.phase, 'turn', g.turn, 'turn_end', g.turn_end, 'market_open', g.market_open,
      'diplomacy_open', g.diplomacy_open, 'crisis', g.crisis, 'fair_cap', g.fair_cap, 'tariff', g.tariff, 'banned', g.banned,
      'world_first', g.world_first, 'locked', g.locked, 'timer_end', g.timer_end, 'timer_label', g.timer_label),
    'me', jsonb_build_object('id', me.id, 'name', me.name, 'role', me.role, 'is_leader', me.is_leader),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'role', s.role, 'is_leader', s.is_leader,
        'online', s.last_seen > now() - interval '60 seconds') order by s.no, s.id), '[]') from priv.students s where s.country_id = co.id),
    'country', jsonb_build_object('id', co.id, 'type', co.type, 'name', priv.cname(co.id), 'flag_url', co.flag_url, 'emblem_url', co.emblem_url,
      'coin', co.coin, 'happy', co.happy, 'income', co.income, 'lux_types', co.lux_types, 'short', co.short, 'techs', co.techs,
      'title', co.title, 'glory', coalesce((select sum(x) from unnest(co.glory) x), 0), 'attacked', co.attacked_turn >= g.turn,
      'discovered', co.discovered, 'explored_count', coalesce(array_length(co.explored, 1), 0)),
    'inventory', (select coalesce(jsonb_object_agg(item, qty), '{}') from priv.inventory where country = co.id and qty <> 0),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name,
        'buildings', c.buildings, 'built', c.built_turn >= g.turn, 'trained', c.trained_turn >= g.turn, 'unrest', c.unrest,
        'coastal', exists(select 1 from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.terrain in ('ocean', 'coast') and priv.hdist(t.c, t.r, ct.c, ct.r) = 1))
        order by c.kind, c.taken_turn), '[]') from priv.cities c where c.country = co.id),
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'name', c.name, 'def', greatest(1, c.def - c.def_help),
        'sea', c.sea, 'tech', c.tech, 'taken', c.country is not null,
        'res', (select coalesce(jsonb_agg(t.res), '[]') from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.res is not null and t.zone = c.type and priv.hdist(t.c, t.r, ct.c, ct.r) <= 1))
        order by c.def), '[]') from priv.cities c where c.kind = 'cs' and c.type = co.type),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'tile', u.tile_id, 'acted', u.acted_turn >= g.turn,
        'moves', case when u.moves_turn >= g.turn then u.moves_left else (priv.cfg()->>'SCOUT_MOVE')::int end) order by u.id), '[]')
        from priv.units u where u.country = co.id),
    'strength', priv.strength(co.id, g.turn),
    'factories', (select coalesce(jsonb_agg(kind), '[]') from priv.factories where country = co.id),
    'advanced', (select coalesce(jsonb_agg(kind), '[]') from priv.advanced where country = co.id),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'emblem_url', c.emblem_url, 'title', c.title,
        'known', c.id = any(known), 'happy', case when c.id = any(known) then c.happy end) order by c.id), '[]') from priv.countries c),
    'offers', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id desc), '[]') from priv.offers o
        where (o.from_c = co.id or o.to_c = co.id) and (o.status = 'pending' or o.turn >= g.turn - 1)),
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc), '[]') from (select * from priv.trades
        where from_c = co.id or to_c = co.id order by id desc limit 60) t),
    'notices', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id desc), '[]') from (select * from public.notices
        where country is null or country = co.id order by id desc limit 30) n),
    'treaty', (select to_jsonb(t) from priv.treaties t where t.country = co.id),
    'gauge', priv.gauge()
  );
end $$;

-- 지도: 우리 나라가 본 칸만. 다른 나라 땅은 국경(주인)만 보임
create or replace function public.map_view() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); co priv.countries;
begin
  select * into co from priv.countries where id = me.country_id;
  return jsonb_build_object(
    'tiles', (select coalesce(jsonb_agg(jsonb_build_array(t.id, t.terrain,
        case when t.owner is null or t.owner = co.id then t.res end, t.owner,
        case when t.owner = co.id then t.imp end) order by t.id), '[]')
      from priv.tiles t where t.id = any(co.explored)),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name,
        'country', c.country, 'mine', c.type = co.type, 'buildings', case when c.country = co.id then c.buildings end,
        'unrest', case when c.country = co.id then c.unrest end,
        'def', case when c.kind = 'cs' and c.country is null then greatest(1, c.def - c.def_help) end)), '[]')
      from priv.cities c where c.tile_id = any(co.explored) and (c.country is null or c.country = co.id or c.kind = 'capital'))
  );
end $$;

-- ---------------------------------------------------------------------
-- 학생: 행동 (모두 나라 단위로 잠그고 검사)
-- ---------------------------------------------------------------------
create or replace function priv.act_start(need_phase int default 1) returns priv.students
language plpgsql as $$
declare me priv.students := priv.me(); g public.game;
begin
  select * into g from public.game where id = 1;
  if g.phase < need_phase or g.turn < 1 then perform priv.err('PHASE', '아직 시작 전이에요. 선생님 신호를 기다려 주세요.'); end if;
  if g.locked then perform priv.err('LOCKED', '지금은 회의 시간이라 게임 조작이 멈춰 있어요.'); end if;
  perform 1 from priv.countries where id = me.country_id for update;
  return me;
end $$;

create or replace function public.worker_build(p_tile int, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(); cfg jsonb := priv.cfg(); t priv.tiles; imp jsonb; u priv.units; mult numeric := 1; tn int := priv.turn();
begin
  select * into t from priv.tiles where id = p_tile;
  if not found or t.owner is distinct from me.country_id then perform priv.err('NOT_MINE', '우리 나라 땅에만 개발할 수 있어요.'); end if;
  if t.imp is not null then perform priv.err('DONE', '이미 개발한 칸이에요.'); end if;
  if exists(select 1 from priv.cities where tile_id = p_tile) then perform priv.err('CITY', '도시가 있는 칸이에요. 도시를 눌러 건물을 지어 보세요.'); end if;
  imp := cfg->'IMPROVE'->p_kind;
  if imp is null then perform priv.err('BAD_KIND', '없는 시설이에요.'); end if;
  if imp ? 'res' then
    if t.res is null or not (imp->'res' ? t.res) then perform priv.err('NO_RES', imp->>'name' || '은(는) 알맞은 자원이 있는 칸에만 지을 수 있어요.'); end if;
  elsif not (imp->'on' ? t.terrain) then perform priv.err('BAD_TERRAIN', imp->>'name' || '은(는) 이 지형에 지을 수 없어요.'); end if;
  if imp ? 'tech' and not priv.has_tech(me.country_id, imp->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(imp->>'tech')) || '」 기술이 있어야 해요.'); end if;
  select * into u from priv.units where country = me.country_id and kind = 'worker' and acted_turn < tn order by priv.tdist(tile_id, p_tile), id limit 1;
  if not found then perform priv.err('NO_WORKER', '이번 턴에 일할 수 있는 노동자가 없어요. 노동자를 더 고용하거나 다음 턴을 기다려요.'); end if;
  if t.terrain = 'jungle' and not priv.has_tech(me.country_id, 'jungle') then mult := (cfg->>'JUNGLE_MULT')::numeric; end if;
  perform priv.pay(me.country_id, imp->'cost', mult);
  update priv.tiles set imp = p_kind where id = p_tile;
  update priv.units set acted_turn = tn, tile_id = p_tile where id = u.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'unit', u.id, 'from', u.tile_id, 'to', p_tile);
end $$;

create or replace function public.hire_worker(p_city text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(); c priv.cities;
begin
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시에서만 고용할 수 있어요.'); end if;
  perform priv.pay(me.country_id, priv.cfg()->'HIRE_WORKER');
  insert into priv.units(country, kind, tile_id) values (me.country_id, 'worker', c.tile_id);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.city_build(p_city text, p_building text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(); cfg jsonb := priv.cfg(); c priv.cities; b jsonb; tn int := priv.turn();
begin
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시가 아니에요.'); end if;
  b := cfg->'BUILDINGS'->p_building;
  if b is null then perform priv.err('BAD_KIND', '없는 건물이에요.'); end if;
  if p_building = any(c.buildings) then perform priv.err('DONE', '이미 지은 건물이에요.'); end if;
  if c.built_turn >= tn then perform priv.err('BUSY', '이 도시는 이번 턴에 이미 건물을 지었어요. 다음 턴에 지어요.'); end if;
  if b ? 'tech' and not priv.has_tech(me.country_id, b->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(b->>'tech')) || '」 기술이 있어야 해요.'); end if;
  if (b->>'coastal')::boolean and not exists(select 1 from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.terrain in ('ocean', 'coast') and priv.hdist(t.c, t.r, ct.c, ct.r) = 1) then
    perform priv.err('NOT_COAST', '바닷가 도시에만 지을 수 있어요.'); end if;
  perform priv.pay(me.country_id, b->'cost');
  update priv.cities set buildings = buildings || p_building, built_turn = tn where id = c.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.train_unit(p_city text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(); cfg jsonb := priv.cfg(); c priv.cities; u jsonb; tn int := priv.turn();
begin
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시가 아니에요.'); end if;
  if not ('barracks' = any(c.buildings)) then perform priv.err('NO_BARRACKS', '병영이 있는 도시에서만 훈련할 수 있어요.'); end if;
  if c.trained_turn >= tn then perform priv.err('BUSY', '이 도시는 이번 턴에 이미 훈련했어요.'); end if;
  u := cfg->'UNITS'->p_kind;
  if u is null then perform priv.err('BAD_KIND', '없는 병력이에요.'); end if;
  if u ? 'needs' and not exists(select 1 from priv.advanced where country = me.country_id and kind = u->>'needs') then
    perform priv.err('LOCKED', '「' || (cfg->'ADVANCED'->(u->>'needs')->>'name') || '」을(를) 먼저 지어야 해요.'); end if;
  perform priv.pay(me.country_id, u->'cost');
  insert into priv.units(country, kind, tile_id) values (me.country_id, p_kind, c.tile_id);
  update priv.cities set trained_turn = tn where id = c.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.attack_city(p_city text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(); cfg jsonb := priv.cfg(); c priv.cities; co priv.countries; tn int := priv.turn();
  str int; need int; techmsg text := null; res jsonb; units jsonb;
begin
  select * into co from priv.countries where id = me.country_id;
  select * into c from priv.cities where id = p_city for update;
  if not found or c.kind <> 'cs' then perform priv.err('BAD_CITY', '공격할 수 있는 도시국가가 아니에요.'); end if;
  if c.type <> co.type then perform priv.err('NOT_TARGET', '이 도시국가는 다른 나라 쪽에 있어요. 우리 나라 주변 도시국가만 차지할 수 있어요.'); end if;
  if c.country is not null then perform priv.err('TAKEN', '이미 우리 나라 도시예요.'); end if;
  if co.attacked_turn >= tn then perform priv.err('BUSY', '이번 턴에는 이미 공격했어요. 다음 턴에 다시 공격해요.'); end if;
  if c.sea and not exists(select 1 from priv.cities where country = co.id and 'harbor' = any(buildings)) then
    perform priv.err('NEED_HARBOR', '바다 건너 도시국가예요. 항구를 먼저 지어야 해요.'); end if;
  str := priv.strength(co.id, tn);
  need := greatest(1, c.def - c.def_help);
  if str < need then perform priv.err('WEAK', '힘이 모자라요. (지금 ' || str || ' / 필요 ' || need || ')'); end if;
  select coalesce(jsonb_agg(kind), '[]') into units from priv.units where country = co.id and kind in ('spear', 'catapult', 'ballista', 'cannon') and acted_turn < tn;
  update priv.units set acted_turn = tn where country = co.id and kind in ('spear', 'catapult', 'ballista', 'cannon') and acted_turn < tn;
  update priv.cities set country = co.id, taken_turn = tn where id = c.id;
  update priv.countries set attacked_turn = tn, glory = glory || ((cfg->'HAPPY'->>'glory')::int) where id = co.id;
  perform priv.claim(co.id, c.tile_id, 1);
  if c.tech is not null and not priv.has_tech(co.id, c.tech) then
    update priv.countries set techs = techs || c.tech where id = co.id;
    techmsg := cfg->'TECHS'->>c.tech;
  end if;
  select coalesce(jsonb_agg(t.res), '[]') into res from priv.tiles t, priv.tiles ct
    where ct.id = c.tile_id and t.owner = co.id and t.res is not null and priv.hdist(t.c, t.r, ct.c, ct.r) <= 1;
  perform priv.check_discovery();
  perform priv.notice(c.name || '을(를) 차지했어요! 주변을 굴복시키고 부국강병을 이룬 지도자에게 시민들이 환호합니다.', 'capture', co.id);
  if techmsg is not null then
    perform priv.notice(c.name || '의 기술자들이 우리 나라에 합류해 「' || techmsg || '」 기술을 쓸 수 있게 되었어요.', 'tech', co.id);
  end if;
  perform priv.event('capture', priv.cname(co.id) || ' → ' || c.name, jsonb_build_object('country', co.id, 'city', c.id));
  perform priv.bump(co.id); perform priv.bump_game();
  return jsonb_build_object('ok', true, 'city', c.id, 'name', c.name, 'tile', c.tile_id, 'strength', str, 'def', need,
    'units', units, 'res', res, 'tech', techmsg);
end $$;

-- 정찰: 화면에서 계산한 길(칸 번호 목록)을 받아 한 칸씩 검사
create or replace function public.scout_move(p_unit int, p_path int[]) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(); cfg jsonb := priv.cfg(); u priv.units; tn int := priv.turn();
  left_ int; prev int; step int; t priv.tiles; before int; seen int[] := '{}'; disc_before int[]; disc_after int[];
begin
  select * into u from priv.units where id = p_unit and country = me.country_id and kind = 'scout' for update;
  if not found then perform priv.err('NO_UNIT', '우리 정찰병이 아니에요.'); end if;
  left_ := case when u.moves_turn >= tn then u.moves_left else (cfg->>'SCOUT_MOVE')::int end;
  if coalesce(array_length(p_path, 1), 0) = 0 then perform priv.err('NO_PATH', '갈 곳을 골라 주세요.'); end if;
  if array_length(p_path, 1) > left_ then perform priv.err('TOO_FAR', '이번 턴에는 ' || left_ || '칸까지만 갈 수 있어요.'); end if;
  prev := u.tile_id;
  foreach step in array p_path loop
    select * into t from priv.tiles where id = step;
    if not found or priv.tdist(prev, step) <> 1 then perform priv.err('BAD_PATH', '이어지지 않는 길이에요.'); end if;
    if not (t.terrain in ('ocean', 'coast') or t.owner is null or t.owner = me.country_id) then
      perform priv.err('BORDER', '다른 나라 국경 안으로는 들어갈 수 없어요.'); end if;
    seen := seen || priv.within(step, (cfg->>'SCOUT_SIGHT')::int);
    prev := step;
  end loop;
  select coalesce(array_length(explored, 1), 0), discovered into before, disc_before from priv.countries where id = me.country_id;
  perform priv.reveal(me.country_id, seen);
  update priv.units set tile_id = prev, moves_turn = tn, moves_left = left_ - array_length(p_path, 1) where id = u.id;
  perform priv.check_discovery();
  select discovered into disc_after from priv.countries where id = me.country_id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'to', prev,
    'new_tiles', (select coalesce(array_length(explored, 1), 0) from priv.countries where id = me.country_id) - before,
    'discovered', (select coalesce(jsonb_agg(x), '[]') from unnest(disc_after) x where not (x = any(disc_before))));
end $$;

create or replace function public.factory_build(p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(2); cfg jsonb := priv.cfg(); f jsonb; tp text;
begin
  tp := priv.ctype(me.country_id);
  f := cfg->'FACTORIES'->p_kind;
  if f is null then perform priv.err('BAD_KIND', '없는 공장이에요.'); end if;
  if exists(select 1 from priv.factories where country = me.country_id and kind = p_kind) then perform priv.err('DONE', '이미 지은 공장이에요.'); end if;
  if not priv.has_tech(me.country_id, f->>'tech') or (cfg->'PROC_COST'->tp->(f->>'output')) is null then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(f->>'tech')) || '」 기술이 있어야 지을 수 있어요.'); end if;
  perform priv.pay(me.country_id, f->'build');
  insert into priv.factories(country, kind) values (me.country_id, p_kind);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.advanced_build(p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(2); cfg jsonb := priv.cfg(); a jsonb;
begin
  a := cfg->'ADVANCED'->p_kind;
  if a is null then perform priv.err('BAD_KIND', '없는 건물이에요.'); end if;
  if exists(select 1 from priv.advanced where country = me.country_id and kind = p_kind) then perform priv.err('DONE', '이미 지은 건물이에요.'); end if;
  if a ? 'tech' and not priv.has_tech(me.country_id, a->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(a->>'tech')) || '」 기술이 있어야 해요.'); end if;
  perform priv.pay(me.country_id, a->'cost');
  insert into priv.advanced(country, kind) values (me.country_id, p_kind);
  perform priv.notice((a->>'name') || '을(를) 지었어요!', 'build', me.country_id);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 무역: 제안 → 수락 (세계 시장 개방 후)
-- 한쪽은 물건, 다른 쪽은 물건 또는 코인
-- ---------------------------------------------------------------------
create or replace function priv.trade_check(seller int, item text, qty int, coin int) returns void
language plpgsql as $$
declare g public.game; cfg jsonb := priv.cfg(); cap int;
begin
  select * into g from public.game where id = 1;
  if item = 'coin' then return; end if;
  if g.banned ? seller::text and (g.banned->seller::text) ? item then
    perform priv.err('BANNED', priv.cname(seller) || '은(는) 지금 ' || priv.iname(item) || ' 수출을 멈췄어요.'); end if;
  if coin is not null and g.fair_cap then
    cap := (cfg->'ITEMS'->item->>'ref')::int * (cfg->>'FAIR_CAP')::int * qty;
    if coin > cap then perform priv.err('FAIR', '지구 서버 공정 거래 규칙: ' || priv.iname(item) || ' ' || qty || '개는 ' || cap || '코인까지만 받을 수 있어요.'); end if;
  end if;
end $$;

create or replace function public.offer_create(p_to int, p_give_item text, p_give_qty int, p_get_item text, p_get_qty int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(3); g public.game; cfg jsonb := priv.cfg(); co priv.countries; id_ int;
begin
  select * into g from public.game where id = 1;
  select * into co from priv.countries where id = me.country_id;
  if not g.market_open then perform priv.err('CLOSED', '세계 시장이 아직 열리지 않았어요.'); end if;
  if p_to = me.country_id or not exists(select 1 from priv.countries where id = p_to) then perform priv.err('BAD_TO', '거래할 나라를 골라 주세요.'); end if;
  if not g.diplomacy_open and not (p_to = any(co.discovered)) then perform priv.err('UNKNOWN', '아직 발견하지 못한 나라예요.'); end if;
  if coalesce(p_give_qty, 0) <= 0 or coalesce(p_get_qty, 0) <= 0 then perform priv.err('BAD_QTY', '개수를 1 이상으로 정해 주세요.'); end if;
  if p_give_item = p_get_item then perform priv.err('SAME', '같은 물건끼리는 바꿀 수 없어요.'); end if;
  if p_give_item <> 'coin' and cfg->'ITEMS'->p_give_item is null or p_get_item <> 'coin' and cfg->'ITEMS'->p_get_item is null then
    perform priv.err('BAD_ITEM', '없는 물건이에요.'); end if;
  if p_give_item = 'coin' and p_get_item = 'coin' then perform priv.err('BAD_ITEM', '코인끼리는 바꿀 수 없어요.'); end if;
  if priv.cost_short(me.country_id, jsonb_build_object(p_give_item, p_give_qty)) is not null then
    perform priv.err('NO_MONEY', '줄 물건이 모자라요: ' || priv.cost_short(me.country_id, jsonb_build_object(p_give_item, p_give_qty))); end if;
  perform priv.trade_check(me.country_id, p_give_item, p_give_qty, case when p_get_item = 'coin' then p_get_qty end);
  perform priv.trade_check(p_to, p_get_item, p_get_qty, case when p_give_item = 'coin' then p_give_qty end);
  insert into priv.offers(turn, from_c, to_c, give_item, give_qty, get_item, get_qty, by_student)
    values (g.turn, me.country_id, p_to, p_give_item, p_give_qty, p_get_item, p_get_qty, me.id) returning id into id_;
  perform priv.notice(priv.cname(me.country_id) || '이(가) 거래를 제안했어요: ' || priv.iname(p_give_item) || ' ' || p_give_qty
    || ' ↔ ' || priv.iname(p_get_item) || ' ' || p_get_qty, 'offer', p_to);
  perform priv.bump(me.country_id); perform priv.bump(p_to);
  return jsonb_build_object('ok', true, 'id', id_);
end $$;

create or replace function public.offer_cancel(p_offer int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); o priv.offers;
begin
  update priv.offers set status = 'cancelled', decided_at = now() where id = p_offer and from_c = me.country_id and status = 'pending' returning * into o;
  if found then perform priv.bump(o.from_c); perform priv.bump(o.to_c); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 한 방향 기록 (판 나라 → 산 나라)
create or replace function priv.record_trade(seller int, buyer int, item text, qty int, coin int, broker boolean default false) returns int
language plpgsql as $$
declare g public.game; cfg jsonb := priv.cfg(); val int; tar int := 0;
begin
  select * into g from public.game where id = 1;
  val := coalesce(coin, (cfg->'ITEMS'->item->>'ref')::int * qty);
  if g.tariff > 0 and buyer is not null and seller is not null then
    tar := round(val * g.tariff);
    update priv.countries set tariff_turn = tariff_turn + tar where id = buyer;
  end if;
  insert into priv.trades(turn, phase, from_c, to_c, item, qty, price, value, tariff, broker)
    values (g.turn, g.phase, seller, buyer, item, qty, case when coin is not null then round(coin::numeric / qty) end, val, tar, broker);
  return tar;
end $$;

create or replace function public.offer_respond(p_offer int, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(3); o priv.offers; g public.game; s text; tar int := 0;
begin
  select * into g from public.game where id = 1;
  select * into o from priv.offers where id = p_offer and to_c = me.country_id for update;
  if not found then perform priv.err('NO_OFFER', '제안을 찾을 수 없어요.'); end if;
  if o.status <> 'pending' then perform priv.err('DONE', '이미 끝난 제안이에요.'); end if;
  if not p_accept then
    update priv.offers set status = 'declined', decided_at = now() where id = o.id;
    perform priv.notice(priv.cname(me.country_id) || '이(가) 거래 제안을 거절했어요.', 'offer', o.from_c);
    perform priv.bump(o.from_c); perform priv.bump(o.to_c);
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;
  if not g.market_open then perform priv.err('CLOSED', '세계 시장이 닫혀 있어요.'); end if;
  -- 두 나라를 번호 순서로 잠금 (교착 방지)
  perform 1 from priv.countries where id in (o.from_c, o.to_c) order by id for update;
  s := priv.cost_short(o.from_c, jsonb_build_object(o.give_item, o.give_qty));
  if s is not null then perform priv.err('NO_MONEY', priv.cname(o.from_c) || '의 물건이 모자라 거래할 수 없어요: ' || s); end if;
  s := priv.cost_short(o.to_c, jsonb_build_object(o.get_item, o.get_qty));
  if s is not null then perform priv.err('NO_MONEY', '우리 나라가 줄 것이 모자라요: ' || s); end if;
  perform priv.trade_check(o.from_c, o.give_item, o.give_qty, case when o.get_item = 'coin' then o.get_qty end);
  perform priv.trade_check(o.to_c, o.get_item, o.get_qty, case when o.give_item = 'coin' then o.give_qty end);
  perform priv.add(o.from_c, o.give_item, -o.give_qty); perform priv.add(o.to_c, o.give_item, o.give_qty);
  perform priv.add(o.to_c, o.get_item, -o.get_qty);     perform priv.add(o.from_c, o.get_item, o.get_qty);
  if o.give_item <> 'coin' then tar := tar + priv.record_trade(o.from_c, o.to_c, o.give_item, o.give_qty, case when o.get_item = 'coin' then o.get_qty end); end if;
  if o.get_item <> 'coin' then tar := tar + priv.record_trade(o.to_c, o.from_c, o.get_item, o.get_qty, case when o.give_item = 'coin' then o.give_qty end); end if;
  update priv.offers set status = 'accepted', decided_at = now() where id = o.id;
  perform priv.notice('거래 성사! ' || priv.cname(o.from_c) || ' ↔ ' || priv.cname(o.to_c) || ': '
    || priv.iname(o.give_item) || ' ' || o.give_qty || ' ↔ ' || priv.iname(o.get_item) || ' ' || o.get_qty, 'trade', o.from_c);
  perform priv.notice('거래 성사! ' || priv.cname(o.from_c) || ' ↔ ' || priv.cname(o.to_c) || ': '
    || priv.iname(o.give_item) || ' ' || o.give_qty || ' ↔ ' || priv.iname(o.get_item) || ' ' || o.get_qty, 'trade', o.to_c);
  perform priv.bump(o.from_c); perform priv.bump(o.to_c); perform priv.bump_game();
  return jsonb_build_object('ok', true, 'accepted', true, 'tariff', tar);
end $$;

-- 조약 (17차시) · 개인 한 문장
create or replace function public.treaty_submit(p_focus text, p_problem text, p_promise text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if not me.is_leader then perform priv.err('LEADER_ONLY', '조약 등록은 국가 대표가 해요.'); end if;
  if priv.phase() < 10 then perform priv.err('PHASE', '조약 회의 시간에 등록할 수 있어요.'); end if;
  insert into priv.treaties(country, focus, problem, promise, reason, agreed, updated_at)
    values (me.country_id, p_focus, left(trim(p_problem), 120), left(trim(p_promise), 120), left(trim(p_reason), 120), '{}', now())
    on conflict (country) do update set focus = excluded.focus, problem = excluded.problem, promise = excluded.promise,
      reason = excluded.reason, agreed = '{}', updated_at = now();
  perform priv.bump_all(); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.treaty_agree() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if not me.is_leader then perform priv.err('LEADER_ONLY', '공동 약속 동의는 국가 대표가 해요.'); end if;
  if priv.phase() < 10 then perform priv.err('PHASE', '조약 회의 시간에 동의할 수 있어요.'); end if;
  update priv.treaties set agreed = array(select distinct x from unnest(agreed || me.country_id) x) where true;
  perform priv.bump_all(); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reflection_submit(p_body text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if coalesce(trim(p_body), '') = '' then perform priv.err('EMPTY', '문장을 써 주세요.'); end if;
  insert into priv.reflections(student_id, body) values (me.id, left(trim(p_body), 200))
    on conflict (student_id) do update set body = excluded.body, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 전자칠판 (전체 지도, 읽기 전용)
-- ---------------------------------------------------------------------
create or replace function public.get_board() returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object(
    'now', now(),
    'game', (select jsonb_build_object('phase', phase, 'turn', turn, 'turn_end', turn_end, 'market_open', market_open,
      'diplomacy_open', diplomacy_open, 'world_first', world_first, 'timer_end', timer_end, 'timer_label', timer_label) from public.game where id = 1),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'emblem_url', c.emblem_url, 'happy', c.happy, 'title', c.title,
        'cities', (select count(*) from priv.cities where country = c.id), 'discovered', coalesce(array_length(c.discovered, 1), 0),
        'exports', (select coalesce(sum(qty), 0) from priv.trades where from_c = c.id and not broker),
        'imports', (select coalesce(sum(qty), 0) from priv.trades where to_c = c.id and not broker)) order by c.id), '[]') from priv.countries c),
    'tiles', (select jsonb_agg(jsonb_build_array(t.id, t.terrain, t.res, t.owner, t.imp) order by t.id) from priv.tiles t),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'country', c.country,
        'buildings', c.buildings, 'unrest', c.unrest)) from priv.cities c),
    'volume', (select coalesce(jsonb_agg(jsonb_build_object('turn', t, 'qty', priv.trade_volume(t)) order by t), '[]')
        from generate_series(greatest(1, (select turn from public.game where id = 1) - 12), (select turn from public.game where id = 1)) t),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') from (select * from priv.events order by id desc limit 10) e),
    'treaties', (select coalesce(jsonb_agg(to_jsonb(t) order by t.country), '[]') from priv.treaties t),
    'gauge', priv.gauge()
  )
$$;

-- ---------------------------------------------------------------------
-- 교사
-- ---------------------------------------------------------------------
create or replace function priv.set_admin_password(pw text) returns void
language plpgsql as $$
declare sa text := md5(random()::text || clock_timestamp()::text);
begin
  insert into priv.admin_secret(id, salt, hash) values (1, sa, encode(sha256(convert_to(sa || pw, 'UTF8')), 'hex'))
  on conflict (id) do update set salt = excluded.salt, hash = excluded.hash;
  delete from priv.admins where true;
end $$;

create or replace function public.admin_login(p_pw text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare sec priv.admin_secret; fails int;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  select count(*) into fails from priv.admin_attempts where not ok and at > now() - interval '10 minutes';
  if fails >= 20 then perform priv.err('TOO_MANY', '비밀번호를 너무 많이 틀렸어요. 10분 뒤에 다시 해 주세요.'); end if;
  select * into sec from priv.admin_secret where id = 1;
  if not found then perform priv.err('NO_PASSWORD', '교사 비밀번호가 아직 설정되지 않았어요.'); end if;
  if encode(sha256(convert_to(sec.salt || coalesce(p_pw, ''), 'UTF8')), 'hex') <> sec.hash then
    insert into priv.admin_attempts(uid, ok) values (auth.uid(), false);
    perform priv.err('WRONG', '비밀번호가 틀렸어요.');
  end if;
  insert into priv.admin_attempts(uid, ok) values (auth.uid(), true);
  insert into priv.admins(uid) values (auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_check() returns jsonb
language sql stable security definer set search_path = public, priv as $$ select jsonb_build_object('admin', priv.is_admin()) $$;

create or replace function public.admin_logout() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin delete from priv.admins where uid = auth.uid(); return jsonb_build_object('ok', true); end $$;

create or replace function public.admin_state() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1;
  return jsonb_build_object(
    'now', now(),
    'game', to_jsonb(g),
    'gauge', priv.gauge(),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'coin', c.coin, 'happy', c.happy, 'income', c.income, 'lux', c.lux_types,
        'short', c.short, 'title', c.title, 'techs', c.techs, 'discovered', coalesce(array_length(c.discovered, 1), 0),
        'cities', (select count(*) from priv.cities where country = c.id),
        'targets', (select count(*) from priv.cities where kind = 'cs' and type = c.type),
        'unrest', (select count(*) from priv.cities where country = c.id and unrest),
        'units', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from priv.units where country = c.id group by kind) u),
        'improved', (select count(*) from priv.tiles where owner = c.id and imp is not null),
        'inventory', (select coalesce(jsonb_object_agg(item, qty), '{}') from priv.inventory where country = c.id and qty <> 0),
        'factories', (select coalesce(jsonb_agg(kind), '[]') from priv.factories where country = c.id),
        'advanced', (select coalesce(jsonb_agg(kind), '[]') from priv.advanced where country = c.id),
        'exports', (select coalesce(sum(qty), 0) from priv.trades where from_c = c.id and not broker),
        'imports', (select coalesce(sum(qty), 0) from priv.trades where to_c = c.id and not broker),
        'online', (select count(*) from priv.students where country_id = c.id and last_seen > now() - interval '60 seconds')
      ) order by c.id), '[]') from priv.countries c),
    'students', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'country_id', s.country_id, 'no', s.no, 'name', s.name,
        'role', s.role, 'is_leader', s.is_leader, 'bound', s.uid is not null, 'online', s.last_seen > now() - interval '60 seconds',
        'reflection', (select body from priv.reflections where student_id = s.id)) order by s.country_id, s.no, s.id), '[]') from priv.students s),
    'pairings', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'student_id', r.student_id, 'name', s.name, 'country_id', s.country_id,
        'created_at', r.created_at) order by r.id), '[]') from priv.pairing_requests r join priv.students s on s.id = r.student_id where r.status = 'pending'),
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc), '[]') from (select * from priv.trades order by id desc limit 80) t),
    'offers_pending', (select count(*) from priv.offers where status = 'pending'),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') from (select * from priv.events order by id desc limit 30) e),
    'treaties', (select coalesce(jsonb_agg(to_jsonb(t) order by t.country), '[]') from priv.treaties t),
    'volume', (select coalesce(jsonb_agg(jsonb_build_object('turn', t, 'qty', priv.trade_volume(t)) order by t), '[]')
        from generate_series(greatest(1, g.turn - 12), g.turn) t)
  );
end $$;

-- 단계 넘기기 (앞으로만)
create or replace function public.admin_set_phase(p_target int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game; nxt int;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1 for update;
  if p_target <= g.phase then perform priv.err('BACKWARD', '뒤로 가기는 「단계 강제 이동」으로만 할 수 있어요.'); end if;
  if p_target > 11 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
  nxt := g.phase;
  while nxt < p_target loop
    nxt := nxt + 1;
    if nxt = 1 then
      update public.game set turn = 1, turn_end = case when auto_turn > 0 then now() + make_interval(secs => auto_turn) end where id = 1;
      perform priv.notice('나라 키우기가 시작됐어요! 노동자로 땅을 개발하고, 도시에 건물을 지어 보세요.', 'phase');
    elsif nxt = 2 then
      update public.game set crisis = true where id = 1;
      perform priv.notice('성장의 한계! 나라가 커지자 시민들이 더 다양한 물건을 원합니다. 사치품, 강철, 연료가 필요해요.', 'crisis');
      perform priv.event('crisis', '성장의 한계');
    elsif nxt = 3 then
      update public.game set market_open = true, diplomacy_open = true where id = 1;
      perform priv.notice('세계 시장이 열렸어요! 무역 탭에서 다른 나라에 거래를 제안해 보세요.', 'market');
      perform priv.event('market', '세계 시장 개방');
    elsif nxt = 8 then
      update public.game set fair_cap = false where id = 1;
      perform priv.notice('긴급: 세계 무역 협정 기간이 끝났습니다. 이제 공정 거래 규칙이 없어요.', 'alert');
      perform priv.event('expire', '세계 무역 협정 만료');
    elsif nxt = 10 then
      update public.game set locked = true where id = 1;
      perform priv.notice('조약 회의 시간이에요. 게임 조작은 멈추고, 피해를 살펴보며 약속을 만들어요.', 'phase');
    end if;
  end loop;
  update public.game set phase = p_target where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true, 'phase', p_target);
end $$;

create or replace function public.admin_force_phase(p_target int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  if p_target < 0 or p_target > 11 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
  update public.game set phase = p_target, locked = (p_target = 10) where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

-- 다음 턴: 이번 턴 정산 후 턴 번호 +1
create or replace function public.admin_next_turn() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1 for update;
  if g.phase < 1 or g.turn < 1 then perform priv.err('PHASE', '먼저 1단계 「나라 키우기」를 시작해 주세요.'); end if;
  perform priv.end_turn();
  update priv.offers set status = 'expired', decided_at = now() where status = 'pending';
  update public.game set turn = turn + 1, turn_end = case when auto_turn > 0 then now() + make_interval(secs => auto_turn) end,
    cold_snap = null where id = 1;
  perform priv.notice('턴 ' || (g.turn + 1) || ' 시작! 생산한 자원이 창고에 들어왔어요.', 'turn');
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true, 'turn', g.turn + 1);
end $$;

create or replace function public.admin_auto_turn(p_seconds int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set auto_turn = greatest(0, coalesce(p_seconds, 0)),
    turn_end = case when coalesce(p_seconds, 0) > 0 and turn >= 1 then now() + make_interval(secs => p_seconds) end where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_timer(p_seconds int, p_label text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set timer_end = case when coalesce(p_seconds, 0) > 0 then now() + make_interval(secs => p_seconds) end,
    timer_label = case when coalesce(p_seconds, 0) > 0 then nullif(trim(coalesce(p_label, '')), '') end where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_flags(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set require_approval = coalesce((p->>'require_approval')::boolean, require_approval) where id = 1;
  perform priv.bump_game();
  return (select to_jsonb(g) from public.game g where id = 1);
end $$;

-- 모둠 번호 ↔ 나라 유형 (건국 단계에서만)
create or replace function public.admin_set_type(p_country int, p_type text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare other int; old text;
begin
  perform priv.need_admin();
  if priv.phase() > 0 then perform priv.err('PHASE', '나라 유형은 건국 단계에서만 바꿀 수 있어요.'); end if;
  if priv.cfg()->'TYPES'->p_type is null then perform priv.err('BAD_TYPE', '없는 유형이에요.'); end if;
  select type into old from priv.countries where id = p_country;
  select id into other from priv.countries where type = p_type;
  update priv.countries set type = '_' where id = p_country;
  if other is not null then update priv.countries set type = old where id = other; end if;
  update priv.countries set type = p_type where id = p_country;
  perform priv.init_world();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_roster_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare n int;
begin
  perform priv.need_admin();
  delete from priv.pairing_requests where true;
  delete from priv.reflections where true;
  delete from priv.students where true;
  insert into priv.students(country_id, no, name)
    select (r->>'group')::int, nullif(r->>'no', '')::int, trim(r->>'name')
    from jsonb_array_elements(p_rows) r
    where coalesce(trim(r->>'name'), '') <> '' and (r->>'group')::int between 1 and 6;
  get diagnostics n = row_count;
  perform priv.bump_game();
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.admin_set_leader(p_student int, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c int;
begin
  perform priv.need_admin();
  update priv.students set is_leader = p_on where id = p_student returning country_id into c;
  perform priv.bump(c);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_binding(p_student int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c int;
begin
  perform priv.need_admin();
  update priv.students set uid = null, bound_at = null where id = p_student returning country_id into c;
  perform priv.bump(c); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_approve(p_request int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare r priv.pairing_requests; c int;
begin
  perform priv.need_admin();
  select * into r from priv.pairing_requests where id = p_request and status = 'pending' for update;
  if not found then perform priv.err('NO_REQUEST', '요청을 찾을 수 없어요.'); end if;
  update priv.students set uid = null where uid = r.uid and id <> r.student_id;
  update priv.students set uid = r.uid, bound_at = now() where id = r.student_id returning country_id into c;
  update priv.pairing_requests set status = case when id = p_request then 'approved' else 'replaced' end
    where status = 'pending' and (id = p_request or student_id = r.student_id or uid = r.uid);
  perform priv.bump(c); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_approve_group(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare r record; n int := 0; skipped int := 0;
begin
  perform priv.need_admin();
  for r in
    select max(q.id) as id, q.student_id, count(*) as cnt
    from priv.pairing_requests q join priv.students s on s.id = q.student_id
    where q.status = 'pending' and (p_country is null or s.country_id = p_country)
    group by q.student_id
  loop
    if r.cnt > 1 then skipped := skipped + 1; else perform public.admin_approve(r.id); n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'approved', n, 'skipped', skipped);
end $$;

create or replace function public.admin_reject(p_request int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update priv.pairing_requests set status = 'rejected' where id = p_request and status = 'pending';
  perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

-- 지원: 코인·물건 (p_country null이면 모든 나라)
create or replace function public.admin_grant(p_country int, p_items jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c record; k text; v text;
begin
  perform priv.need_admin();
  for c in select id from priv.countries where p_country is null or id = p_country loop
    for k, v in select key, value from jsonb_each_text(coalesce(p_items, '{}'::jsonb)) loop
      perform priv.add(c.id, k, v::int);
    end loop;
    perform priv.notice('우주 운영진 지원: ' || coalesce(nullif(trim(p_reason), ''), '나라 발전 지원'), 'grant', c.id);
    perform priv.bump(c.id);
  end loop;
  perform priv.event('grant', coalesce(p_reason, ''), jsonb_build_object('country', p_country, 'items', p_items));
  return jsonb_build_object('ok', true);
end $$;

-- 불안 진정: 행복도 +15 (점령 환호처럼 3턴에 걸쳐 줄어듦), 불안 도시 회복
create or replace function public.admin_relief(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update priv.countries set glory = glory || 15, happy = least(100, happy + 15) where id = p_country;
  update priv.cities set unrest = false where country = p_country;
  perform priv.notice('우주 운영진이 축제를 열어 시민들의 마음을 달랬어요. (행복도 +15)', 'grant', p_country);
  perform priv.event('relief', priv.cname(p_country), jsonb_build_object('country', p_country));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true);
end $$;

-- 턴 지원: 다음 도시국가 방어력 -5, 코인 +40
create or replace function public.admin_turn_help(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare tp text := priv.ctype(p_country); nxt text;
begin
  perform priv.need_admin();
  select id into nxt from priv.cities where kind = 'cs' and type = tp and country is null order by def limit 1;
  if nxt is not null then update priv.cities set def_help = def_help + 5 where id = nxt; end if;
  update priv.countries set coin = coin + 40 where id = p_country;
  perform priv.notice('우주 운영진 지원: 코인 40과 함께, 다음 도시국가의 성벽이 약해졌다는 소식이 들어왔어요.', 'grant', p_country);
  perform priv.event('turn_help', priv.cname(p_country), jsonb_build_object('country', p_country, 'city', nxt));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true);
end $$;

-- 탐험 지원: 바다(해안·바다) 칸 지도 공유. 발견은 정찰병이 직접 해야 함
create or replace function public.admin_explore_help(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c record;
begin
  perform priv.need_admin();
  for c in select id from priv.countries where p_country is null or id = p_country loop
    perform priv.reveal(c.id, array(select id from priv.tiles where terrain in ('ocean', 'coast')));
    perform priv.notice('탐험대에 새 지도 정보가 전해졌어요. 바닷길이 모두 보여요!', 'grant', c.id);
    perform priv.bump(c.id);
  end loop;
  perform priv.check_discovery();
  perform priv.event('explore_help', '탐험 지원', jsonb_build_object('country', p_country));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_open_diplomacy() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set diplomacy_open = true where id = 1;
  perform priv.notice('우주 운영진이 세계 지도를 전했어요. 외교 창에서 여섯 나라를 볼 수 있어요.', 'world');
  perform priv.event('diplomacy', '교사가 외교 열기');
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

-- 중립 상인 보조 거래: p_qty > 0 이면 나라에 팔기(나라가 받음), < 0 이면 나라에서 사기
create or replace function public.admin_broker_trade(p_country int, p_item text, p_qty int, p_coin int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s text;
begin
  perform priv.need_admin();
  if p_qty > 0 then
    s := priv.cost_short(p_country, jsonb_build_object('coin', p_coin));
    if s is not null then perform priv.err('NO_MONEY', s); end if;
    perform priv.add(p_country, 'coin', -p_coin); perform priv.add(p_country, p_item, p_qty);
    perform priv.record_trade(null, p_country, p_item, p_qty, p_coin, true);
  else
    s := priv.cost_short(p_country, jsonb_build_object(p_item, -p_qty));
    if s is not null then perform priv.err('NO_MONEY', s); end if;
    perform priv.add(p_country, p_item, p_qty); perform priv.add(p_country, 'coin', p_coin);
    perform priv.record_trade(p_country, null, p_item, -p_qty, p_coin, true);
  end if;
  perform priv.notice('중립 상인과 거래했어요: ' || priv.iname(p_item) || ' ' || abs(p_qty) || '개', 'trade', p_country);
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_notice(p_message text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  perform priv.notice(p_message, 'teacher');
  perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_game(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  if p_confirm <> '초기화' then perform priv.err('CONFIRM', '「초기화」라고 입력해야 해요.'); end if;
  perform priv.init_world();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_export() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  return jsonb_build_object(
    'exported_at', now(),
    'game', (select to_jsonb(g) from public.game g),
    'countries', (select jsonb_agg(to_jsonb(x)) from priv.countries x),
    'students', (select jsonb_agg(to_jsonb(x) - 'uid') from priv.students x),
    'cities', (select jsonb_agg(to_jsonb(x)) from priv.cities x),
    'tiles', (select jsonb_agg(jsonb_build_array(id, owner, imp)) from priv.tiles where owner is not null),
    'units', (select jsonb_agg(to_jsonb(x)) from priv.units x),
    'inventory', (select jsonb_agg(to_jsonb(x)) from priv.inventory x),
    'factories', (select jsonb_agg(to_jsonb(x)) from priv.factories x),
    'advanced', (select jsonb_agg(to_jsonb(x)) from priv.advanced x),
    'offers', (select jsonb_agg(to_jsonb(x)) from priv.offers x),
    'trades', (select jsonb_agg(to_jsonb(x)) from priv.trades x),
    'events', (select jsonb_agg(to_jsonb(x)) from priv.events x),
    'treaties', (select jsonb_agg(to_jsonb(x)) from priv.treaties x),
    'reflections', (select jsonb_agg(to_jsonb(x)) from priv.reflections x),
    'snapshots', (select jsonb_agg(to_jsonb(x)) from priv.snapshots x));
end $$;

-- 처음 설치할 때 게임판 준비 (이미 시작한 게임은 건드리지 않음)
do $$ begin
  if not exists(select 1 from priv.units) and (select turn from public.game where id = 1) = 0 then
    perform priv.init_world();
  end if;
end $$;

-- =====================================================================
-- 권한: 화면에서는 public 함수만 호출 가능
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'priv' loop
    execute 'revoke all on function ' || f.sig || ' from public';
  end loop;
  begin execute 'revoke all on all tables in schema priv from anon, authenticated'; exception when others then null; end;
  begin execute 'grant select on public.game, public.notices, public.country_ticks to anon, authenticated'; exception when others then null; end;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef loop
    begin execute 'grant execute on function ' || f.sig || ' to anon, authenticated'; exception when others then null; end;
  end loop;
end $$;

-- 이미지 저장소 (국기·문장)
do $$ begin
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('images', 'images', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do nothing;
  execute 'drop policy if exists es_images_insert on storage.objects';
  execute $p$create policy es_images_insert on storage.objects for insert to authenticated with check (bucket_id = 'images')$p$;
  execute 'drop policy if exists es_images_read on storage.objects';
  execute $p$create policy es_images_read on storage.objects for select using (bucket_id = 'images')$p$;
exception when others then
  raise notice 'storage 설정 건너뜀: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
