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
declare r priv.students; obs text := current_setting('trade.observe', true);
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  -- 선생님 관전: admin_observe 안에서만 잠깐 그 나라 학생처럼 보기 (아무것도 바꿀 수 없음)
  if obs is not null and obs <> '' and exists(select 1 from priv.admins where uid = auth.uid()) then
    r.id := 0; r.country_id := obs::int; r.name := '선생님 관전'; r.is_leader := false; r.roles := '{}'; return r;
  end if;
  select * into r from priv.students where uid = auth.uid();
  if not found then
    -- 선생님 체험 모드: 관제실에서 고른 나라의 모든 역할로 직접 조작
    select control into obs from priv.admins where uid = auth.uid() and control is not null;
    if found then
      r.id := 0; r.country_id := obs::int; r.name := '선생님'; r.is_leader := true;
      r.roles := array(select jsonb_array_elements_text(priv.cfg()->'ROLES')); return r;
    end if;
    perform priv.err('NOT_JOINED', '아직 나라에 입장하지 않았어요.');
  end if;
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

create or replace function priv.notice_d(msg text, k text, c int, d jsonb) returns void
language sql as $$ insert into public.notices(country, kind, message, data) values (c, k, msg, d) $$;

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
-- 도시 그림 종류: 수도는 나라 유형(K·J…), 도시국가는 harbor(바다) / fortress(방어 13 이상) / village
-- 물건 목록 글자로: {"gold":2,"coin":50} → 금 2개 · 코인 50
create or replace function priv.items_text(p jsonb) returns text
language sql stable as $$
  select coalesce(string_agg(case when key = 'coin' then '코인 ' || value else priv.iname(key) || ' ' || value || '개' end, ' · '), '')
  from jsonb_each_text(coalesce(p, '{}'::jsonb))
$$;

create or replace function priv.city_art(p_id text) returns text
language sql stable as $$
  select case when c.boss or c.rebel then 'boss' when c.final then 'final' when c.kind = 'capital' then coalesce((select type from priv.countries where id = c.country), c.type)
              when c.tier >= 3 then 'fortress' when c.sea then 'harbor' else 'village' end
  from priv.cities c where c.id = p_id
$$;

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

create or replace function priv.coin(c int) returns int
language sql stable as $$ select coalesce((select coin from priv.countries where id = c), 0) $$;

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
language sql stable as $$ select count(*)::int from priv.units where country = c and kind not in ('worker', 'scout') $$;

create or replace function priv.strength(c int, t int) returns int
language sql stable as $$
  select coalesce(sum((priv.cfg()->'UNITS'->kind->>'str')::int), 0)::int
  from priv.units where country = c and kind not in ('worker', 'scout') and attacked_turn < t
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
  -- 반란 도시였던 튜토리얼 도시국가는 원래 성벽으로
  update priv.cities set rebel = false, def = (cfg->'CS_TIERS'->tier->>'def')::int, max_hp = (cfg->'CS_TIERS'->tier->>'hp')::int, bonus = (cfg->'CS_TIERS'->tier->>'coin')::int
   where rebel or (tutorial and not final);
  update priv.cities set country = null, buildings = '{}', built_turn = -1, trained_turn = -1, trained_count = 0, built_count = 0, unrest = false, taken_turn = null, def_help = 0, hp = max_hp where true;
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
  delete from priv.trade_fails where true;
  delete from priv.expert_notes where true;
  delete from public.notices where true;
  update public.game set phase = 0, turn = 0, turn_end = null, market_open = false, diplomacy_open = false, crisis = false,
    fair_cap = true, tariff = 0, tariffs = '{}'::jsonb, banned = '{}'::jsonb, alliance = false, normalized = false, meet_step = 2, cold_snap = null, world_first = null, locked = false, timer_end = null where id = 1;
  for co in select * from priv.countries order by id loop
    update priv.countries set coin = (cfg->'START'->>'coin')::int, happy = (cfg->'HAPPY'->>'base')::int, glory = '{}', happy_detail = '[]', research_count = 0, lux_used = '{}',
      techs = '{}',
      discovered = '{}', explored = '{}', title = null, lux_types = 0, income = 0, short = '{}', tariff_turn = 0, attacked_turn = -1,
      ready_turn = 0, research_turn = -1, crisis = false, rebuilt = false
     where id = co.id;
    for k, v in select key, value from jsonb_each_text(cfg->'START') loop
      if k <> 'coin' then perform priv.add(co.id, k, v::int); end if;
    end loop;
    for k, v in select key, value from jsonb_each_text(coalesce(cfg->'START_BONUS'->co.type, '{}'::jsonb)) loop
      perform priv.add(co.id, k, v::int);
    end loop;
    perform priv.add(co.id, cfg->'LUX_OF'->>co.type, 4);   -- 우리 나라 사치품 4개로 시작
    select * into cap from priv.cities where kind = 'capital' and type = co.type;
    update priv.cities set country = co.id, taken_turn = 0 where id = cap.id;
    perform priv.claim(co.id, cap.tile_id, 2);
    -- 도시국가와 그 바로 옆 칸은 처음 국경에서 뺌 (아직 차지하지 않은 중립 도시가 국경 안에 들어가지 않게)
    update priv.tiles t set owner = null
     where t.owner = co.id and priv.tdist(t.id, cap.tile_id) >= 2
       and exists(select 1 from priv.cities c2 where c2.kind = 'cs' and priv.tdist(t.id, c2.tile_id) <= 1);
    -- 우리 나라 쪽 도시국가는 처음부터 지도에 보임 (확장 목표)
    perform priv.reveal(co.id, coalesce((select array_agg(x) from priv.cities c2, unnest(priv.within(c2.tile_id, 1)) x
      where c2.kind = 'cs' and c2.type = co.type), '{}'));
    -- 시작 병력 (노동자·정찰병·창병 2·투석기)
    insert into priv.units(country, kind, tile_id) select co.id, su.kind, cap.tile_id from jsonb_array_elements_text(cfg->'START_UNITS') as su(kind);
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
  with w as (select priv.world_power() p), g as (select turn, base_vol, banned from public.game where id = 1)
  select round(0.4 * least(100, greatest(0, (w.p->>'happy')::numeric + 50))
             + 0.2 * least(100, (w.p->>'econ')::numeric / 4.2)
             + 0.2 * least(100, (w.p->>'culture')::numeric / 1.5)
             + 0.2 * least(100, priv.trade_volume(g.turn - 1) * 100.0 / greatest(1, g.base_vol))
             - case when g.banned <> '{}'::jsonb then 15 else 0 end
             - 3 * (select count(*) from priv.cities where rebel))::int
  from w, g
$$;

-- ---------------------------------------------------------------------
-- 턴 끝 처리: 생산 → 공장 → 사치품 → 행복도 → 불안 → 기록
-- ---------------------------------------------------------------------
-- 행복도 계산 (턴이 끝날 때 + 무역·점령·건설 직후 바로). 사치품은 이번 턴에 즐긴 것 + 창고에 있는 것
create or replace function priv.refresh_happy(p_c int, p_turn int default null) returns int
language plpgsql as $$
declare cfg jsonb := priv.cfg(); h jsonb := cfg->'HAPPY'; co priv.countries; g public.game; tn int; types int; own text; ownv int; nimp int; impv int; plz int; adv int; gl int; press int; ncity int; cityv int; tarv int; bore int; hung int; v int;
begin
  select * into co from priv.countries where id = p_c;
  tn := coalesce(p_turn, priv.turn());
  own := cfg->'LUX_OF'->>co.type;
  ownv := case when own = any(co.lux_used) or priv.inv(p_c, own) >= 1 then (h->>'ownLux')::int else 0 end;
  select count(*) into nimp from jsonb_array_elements_text(cfg->'LUX') x where x <> own and (x = any(co.lux_used) or priv.inv(p_c, x) >= 1);
  impv := (h->'importLux'->>least(nimp, 3))::int;
  types := nimp + case when ownv > 0 then 1 else 0 end;
  select count(*) into ncity from priv.cities where country = p_c;
  plz := (select count(*) from priv.cities where country = p_c and 'plaza' = any(buildings))::int * (h->>'perPlaza')::int;
  adv := coalesce((select sum(coalesce((cfg->'ADVANCED'->kind->>'happy')::int, 0)) from priv.advanced where country = p_c), 0)::int;
  gl := coalesce((select sum(x) from unnest(co.glory) x), 0)::int;
  press := least((h->>'pressureMax')::int, greatest(0, tn - 1) * (h->>'pressurePerTurn')::int);
  cityv := greatest(0, ncity - 1) * (h->>'perCity')::int;
  select * into g from public.game where id = 1;
  -- 17차시: 잊힌 제국의 테러 (우리 반란 도시가 남아 있는 동안) · 인터넷으로 사치품에 싫증
  tarv := case when exists(select 1 from priv.cities where rebel and type = co.type)
               then (cfg->'REBEL'->>(case when g.alliance then 'terrorWeak' else 'terror' end))::int else 0 end;
  bore := case when g.phase >= 4 then (cfg->'REBEL'->>'boredom')::int else 0 end;
  hung := case when '식량' = any(co.short) then (h->>'hunger')::int else 0 end;
  v := greatest(-100, least(100, (h->>'base')::int + ownv + impv + plz + adv + gl - press + cityv - tarv - bore + hung));
  update priv.countries set happy = v, happy_detail = jsonb_build_array(
      jsonb_build_object('k', '우리 사치품', 'v', ownv, 'tip', '우리 나라 사치품(' || priv.iname(own) || ')은 수도에서 매 턴 ' || (cfg->>'LUX_PER_TURN') || '개씩 생겨요 +' || (h->>'ownLux')),
      jsonb_build_object('k', '수입 사치품 ' || nimp || '종', 'v', impv, 'tip', '다른 나라 사치품을 여러 가지 수입할수록 크게 올라요: 1종 +' || (h->'importLux'->>1) || ' · 2종 +' || (h->'importLux'->>2) || ' · 3종 +' || (h->'importLux'->>3) || ' (사치품은 2턴에 1개씩 써요)'),
      jsonb_build_object('k', '광장', 'v', plz, 'tip', '광장이 있는 도시마다 +' || (h->>'perPlaza')),
      jsonb_build_object('k', '특별 건물', 'v', adv, 'tip', '극장·통신탑·방송국'),
      jsonb_build_object('k', '점령 환호', 'v', gl, 'tip', '도시국가를 차지하면 +' || (h->>'glory') || ', 매 턴 ' || (h->>'gloryDecay') || '씩 줄어요'),
      jsonb_build_object('k', '인구 증가', 'v', -press, 'tip', '턴마다 사람이 늘어 물건이 더 필요해요 (턴마다 -' || (h->>'pressurePerTurn') || ', 최대 -' || (h->>'pressureMax') || ')'),
      jsonb_build_object('k', '도시 관리', 'v', cityv, 'tip', '수도 말고 도시마다 ' || (h->>'perCity')),
      jsonb_build_object('k', '잊힌 제국의 테러', 'v', -tarv, 'tip', '반란 도시를 되찾으면 사라져요 (무역 동맹을 맺으면 줄어요)'),
      jsonb_build_object('k', '사치품에 싫증', 'v', -bore, 'tip', '인터넷으로 다른 나라 물건을 보게 되어 사람들이 더 다양한 사치품을 원해요'),
      jsonb_build_object('k', '식량 부족', 'v', hung, 'tip', '식량이 모자라면 ' || (h->>'hunger')))
   where id = p_c;
  update priv.countries set lux_types = types where id = p_c;
  -- 행정 마비: 행복도가 -20보다 낮으면 모든 도시가 붉게 (병력 훈련·건물 짓기 멈춤, 생산은 그대로)
  update priv.cities set unrest = (v < (h->>'paralysis')::int) where country = p_c;
  if v < (h->>'paralysis')::int and co.happy >= (h->>'paralysis')::int then
    perform priv.notice('행정 마비! 행복도가 ' || (h->>'paralysis') || '보다 낮아져 병력 훈련과 건물 짓기가 멈췄어요. 사치품으로 행복도를 올려요.', 'alert', p_c);
  elsif v >= (h->>'paralysis')::int and co.happy < (h->>'paralysis')::int then
    perform priv.notice('행정이 다시 돌아가요! 병력 훈련과 건물 짓기를 할 수 있어요.', 'info', p_c);
  end if;
  if v < (h->>'unhappy')::int and co.happy >= (h->>'unhappy')::int then
    perform priv.notice('나라가 불행해져서 병사들이 약해졌어요! (공격력 -30%) 사치품을 구해 행복도를 0 위로 올려요.', 'alert', p_c);
  elsif v >= (h->>'unhappy')::int and co.happy < (h->>'unhappy')::int then
    perform priv.notice('행복도가 회복됐어요! 병사들이 다시 힘을 냈어요.', 'info', p_c);
  end if;
  return v;
end $$;

create or replace function priv.end_turn() returns void
language plpgsql as $$
declare
  cfg jsonb := priv.cfg(); g public.game; co record; ci record; t record; f record;
  inc jsonb; gross int; upkeep int; ncity int; food int; v int; types int; h jsonb; cr jsonb;
  n int; cost int; it text; y int; shortl text[]; recent record; mil int; usedl text[];
begin
  select * into g from public.game where id = 1;
  h := cfg->'HAPPY'; cr := h->'crisis';
  for co in select * from priv.countries order by id loop
    inc := (cfg->'INCOME') || coalesce(cfg->'PRODUCTIVITY'->co.type, '{}'::jsonb);
    select count(*) into ncity from priv.cities where country = co.id;
    -- 코인
    gross := (inc->>'capital')::int + (ncity - 1) * (inc->>'city')::int;
    for ci in select * from priv.cities where country = co.id loop
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
          + (select count(*) from priv.cities where country = co.id and 'granary' = any(buildings))::int * 2;
    -- 개발한 칸 생산 (불안한 도시 옆 칸은 멈춤)
    for t in select tl.* from priv.tiles tl where tl.owner = co.id and tl.imp is not null loop
      if t.imp = 'farm' then food := food + case when t.terrain = 'tundra' then (cfg->>'TUNDRA_FOOD')::int else 2 end;
      elsif t.imp = 'lumber' then perform priv.add(co.id, 'wood', 2);
      elsif t.imp = 'quarry' then gross := gross + (cfg->>'QUARRY_COIN')::int; update priv.countries set coin = coin + (cfg->>'QUARRY_COIN')::int, income = income + (cfg->>'QUARRY_COIN')::int where id = co.id;
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
    if true then
      for f in select * from priv.factories where country = co.id loop
        it := cfg->'FACTORIES'->f.kind->>'input';
        cost := (cfg->'PROC_COST'->co.type->>(cfg->'FACTORIES'->f.kind->>'output'))::int;
        select coin into v from priv.countries where id = co.id;
        -- 특산 공장은 원료 없이
        n := least((cfg->'FACTORIES'->f.kind->>'perTurn')::int,
                   case when (cfg->'FACTORY_FREE'->co.type->>f.kind)::boolean is true then 99 else priv.inv(co.id, it) end,
                   case when cost > 0 then v / cost else 99 end);
        if n > 0 then
          if (cfg->'FACTORY_FREE'->co.type->>f.kind)::boolean is not true then perform priv.add(co.id, it, -n); end if;
          perform priv.add(co.id, 'coin', -n * cost);
          perform priv.add(co.id, cfg->'FACTORIES'->f.kind->>'output', n);
        end if;
      end loop;
    end if;
    -- 우리 나라 사치품: 수도에서 매 턴 저절로
    perform priv.add(co.id, cfg->'LUX_OF'->>co.type, (cfg->>'LUX_PER_TURN')::int);
    -- 사치품은 2턴에 한 번, 종류마다 1개씩 써요 (그동안은 즐긴 것으로 쳐요)
    if g.turn % 2 = 0 then
      usedl := '{}';
      for it in select jsonb_array_elements_text(cfg->'LUX') loop
        if priv.inv(co.id, it) >= 1 then perform priv.add(co.id, it, -1); usedl := usedl || it; end if;
      end loop;
      update priv.countries set lux_used = usedl where id = co.id;
    end if;
    update priv.countries set short = shortl where id = co.id;
    -- 행복도: 다음 턴 기준으로 다시 계산 (계산식은 priv.refresh_happy 하나로)
    v := priv.refresh_happy(co.id, g.turn + 1);
    if least((h->>'pressureMax')::int, g.turn * (h->>'pressurePerTurn')::int) < (h->>'pressureMax')::int then
      perform priv.notice('인구가 늘어 물건이 더 필요해요! 인구 증가 불행 -' || least((h->>'pressureMax')::int, g.turn * (h->>'pressurePerTurn')::int) || ' (매 턴 -' || (h->>'pressurePerTurn') || '씩 커져요). 사치품을 구해요.', 'short', co.id);
    end if;
    update priv.countries set tariff_turn = 0,
      glory = array(select x - (h->>'gloryDecay')::int from unnest(glory) x where x - (h->>'gloryDecay')::int > 0)
     where id = co.id;
    if array_length(shortl, 1) > 0 then
      perform priv.notice('부족해요: ' || array_to_string(shortl, ', ') || ' → 행복도가 떨어졌어요.', 'short', co.id);
    end if;
    -- 병력 회복: 우리 땅 +20, 밖 +10
    update priv.units u set hp = least(100, hp + case when exists(select 1 from priv.tiles tt where tt.id = u.tile_id and tt.owner = co.id)
        then (cfg->'COMBAT'->>'healHome')::int else (cfg->'COMBAT'->>'healField')::int end)
     where u.country = co.id and u.hp < 100;
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
        'flag_url', c.flag_url, 'emblem_url', c.emblem_url) order by c.id), '[]') from priv.countries c))
  from public.game g where g.id = 1
$$;

create or replace function public.get_roster(p_country int) returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nick', s.nickname, 'taken', s.uid is not null) order by s.no, s.id), '[]')
  from priv.students s where s.country_id = p_country
$$;

-- 닉네임 검사: 2~8글자, 비속어 거르기 (실명 대신 닉네임으로 게임에 보여요)
create or replace function priv.check_nick(p text) returns text
language plpgsql as $$
declare n text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')); bad text; flat text;
begin
  if char_length(n) < 2 or char_length(n) > 8 then perform priv.err('NICK_LEN', '닉네임은 2~8글자로 지어요.'); end if;
  flat := lower(regexp_replace(n, '[^가-힣a-zA-Z0-9ㄱ-ㅎ]', '', 'g'));
  foreach bad in array array['시발','씨발','ㅅㅂ','ㅆㅂ','병신','ㅂㅅ','개새','새끼','ㅅㄲ','미친','ㅁㅊ','존나','ㅈㄴ','좆','썅','니미','느금','엠창','애미','애비','꺼져','닥쳐','지랄','ㅈㄹ','등신','멍청','바보','찐따','fuck','shit','bitch','sex','섹스','자살','죽어'] loop
    if position(bad in flat) > 0 then perform priv.err('NICK_BAD', '그 닉네임은 쓸 수 없어요. 친구가 기분 좋을 이름으로 지어요.'); end if;
  end loop;
  return n;
end $$;

drop function if exists public.join_student(int);
create or replace function public.join_student(p_student int, p_nick text default null) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students; mine priv.students; appr boolean; nick text;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  select * into mine from priv.students where uid = auth.uid();
  if found then
    if mine.id = p_student then return jsonb_build_object('status', 'joined'); end if;
    perform priv.err('DEVICE_TAKEN', '이 기기는 이미 「' || coalesce(mine.nickname, '다른 자리') || '」(으)로 연결되어 있어요. 선생님께 말해 주세요.');
  end if;
  select * into s from priv.students where id = p_student for update;
  if not found then perform priv.err('NO_STUDENT', '자리를 찾을 수 없어요.'); end if;
  if s.uid is null then
    nick := priv.check_nick(p_nick);
    if exists(select 1 from priv.students where country_id = s.country_id and nickname = nick and id <> s.id) then
      perform priv.err('NICK_DUP', '우리 나라에 같은 닉네임이 있어요. 다른 닉네임으로 지어요.'); end if;
    update priv.students set nickname = nick where id = s.id;
  end if;
  select require_approval into appr from public.game where id = 1;
  if s.uid is null and not appr then
    update priv.students set uid = auth.uid(), bound_at = now(), last_seen = now() where id = s.id;
    perform priv.bump(s.country_id);
    return jsonb_build_object('status', 'joined');
  end if;
  if s.uid is not null and not appr then
    perform priv.err('NAME_TAKEN', '이 자리는 이미 다른 기기로 들어와 있어요. 선생님께 말해 주세요.');
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
    return jsonb_build_object('status', 'joined', 'student_id', s.id, 'country_id', s.country_id, 'name', coalesce(s.nickname, '이름 없음'),
      'role', s.role, 'is_leader', s.is_leader);
  end if;
  select exists(select 1 from priv.pairing_requests where uid = auth.uid() and status = 'pending') into pend;
  return jsonb_build_object('status', case when pend then 'pending' else 'none' end);
end $$;

create or replace function public.set_role(p_role text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); who text; lead text := (priv.cfg()->'ROLES'->>0);
begin
  if not (p_role = any(array(select jsonb_array_elements_text(priv.cfg()->'ROLES')))) then perform priv.err('BAD_ROLE', '없는 역할이에요.'); end if;
  if p_role = any(me.roles) then   -- 다시 누르면 내려놓기
    update priv.students set roles = array_remove(roles, p_role), is_leader = case when p_role = lead then false else is_leader end where id = me.id;
  else
    if cardinality(me.roles) >= 3 then perform priv.err('ROLE_MAX', '역할은 3개까지 맡을 수 있어요.'); end if;
    if p_role = lead then
      select coalesce(nickname, '다른') into who from priv.students where country_id = me.country_id and id <> me.id and (is_leader or lead = any(roles)) limit 1;
      if who is not null then perform priv.err('LEADER_TAKEN', who || ' 친구가 이미 국가 대표예요.'); end if;
    end if;
    update priv.students set roles = roles || p_role, is_leader = case when p_role = lead then true else is_leader end where id = me.id;
  end if;
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
      'diplomacy_open', g.diplomacy_open, 'crisis', g.crisis, 'fair_cap', g.fair_cap, 'tariff', g.tariff, 'tariffs', g.tariffs, 'banned', g.banned,
      'world_first', g.world_first, 'locked', g.locked, 'timer_end', g.timer_end, 'timer_label', g.timer_label, 'test_mode', g.test_mode,
      'meet_step', g.meet_step, 'normalized', g.normalized),
    'me', jsonb_build_object('id', me.id, 'name', coalesce(me.nickname, me.name), 'roles', me.roles, 'is_leader', me.is_leader),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(s.nickname, '(아직 안 들어옴)'), 'roles', s.roles, 'is_leader', s.is_leader, 'bound', s.uid is not null,
        'online', s.last_seen > now() - interval '60 seconds') order by s.no, s.id), '[]') from priv.students s where s.country_id = co.id),
    'country', jsonb_build_object('id', co.id, 'type', co.type, 'name', priv.cname(co.id), 'flag_url', co.flag_url, 'emblem_url', co.emblem_url,
      'coin', co.coin, 'happy', co.happy, 'income', co.income, 'lux_types', co.lux_types, 'short', co.short, 'techs', co.techs,
      'title', co.title, 'glory', coalesce((select sum(x) from unnest(co.glory) x), 0), 'attacked', co.attacked_turn >= g.turn,
      'ready', co.ready_turn = g.turn, 'researched', co.research_turn >= g.turn and co.research_count >= (priv.cfg()->>'RESEARCH_PER_TURN')::int, 'research_n', case when co.research_turn >= g.turn then co.research_count else 0 end, 'happy_detail', co.happy_detail, 'crisis', co.crisis, 'rebuilt', co.rebuilt,
      'discovered', co.discovered, 'explored_count', coalesce(array_length(co.explored, 1), 0)),
    'inventory', (select coalesce(jsonb_object_agg(item, qty), '{}') from priv.inventory where country = co.id and qty <> 0),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'art', priv.city_art(c.id),
        'buildings', c.buildings, 'built', c.built_turn >= g.turn and c.built_count >= (priv.cfg()->>'BUILD_PER_TURN')::int, 'built_n', case when c.built_turn >= g.turn then c.built_count else 0 end, 'trained', c.trained_turn >= g.turn and c.trained_count >= (priv.cfg()->>'TRAIN_PER_TURN')::int,
        'trained_n', case when c.trained_turn >= g.turn then c.trained_count else 0 end, 'unrest', c.unrest,
        'coastal', exists(select 1 from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.terrain in ('ocean', 'coast') and priv.hdist(t.c, t.r, ct.c, ct.r) = 1))
        order by c.kind, c.taken_turn), '[]') from priv.cities c where c.country = co.id),
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'name', c.name, 'art', priv.city_art(c.id), 'def', greatest(1, c.def - c.def_help),
        'sea', c.sea, 'tech', c.tech, 'taken', c.country is not null, 'mine', c.type = co.type, 'owner', c.country,
        'tier', c.tier, 'hp', c.hp, 'max_hp', c.max_hp, 'bonus', c.bonus, 'tutorial', c.tutorial, 'boss', c.boss, 'final', c.final, 'rebel', c.rebel,
        'res', (select coalesce(jsonb_agg(t.res), '[]') from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.res is not null and priv.hdist(t.c, t.r, ct.c, ct.r) <= 1))
        order by c.tier, c.id), '[]') from priv.cities c where c.kind = 'cs' and (c.type = co.type or c.tile_id = any(co.explored))),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'tile', u.tile_id, 'acted', u.acted_turn >= g.turn,
        'hp', u.hp, 'attacked', u.attacked_turn >= g.turn, 'moves', priv.unit_moves_left(u), 'max_moves', priv.unit_max_moves(u)) order by u.id), '[]')
        from priv.units u where u.country = co.id),
    'strength', 0,
    'factories', (select coalesce(jsonb_agg(kind), '[]') from priv.factories where country = co.id),
    'advanced', (select coalesce(jsonb_agg(kind), '[]') from priv.advanced where country = co.id),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'emblem_url', c.emblem_url, 'title', c.title,
        'known', c.id = any(known), 'happy', case when c.id = any(known) then c.happy end, 'ready', c.ready_turn = g.turn) order by c.id), '[]') from priv.countries c),
    'offers', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id desc), '[]') from priv.offers o
        where (o.from_c = co.id or o.to_c = co.id) and (o.status = 'pending' or o.turn >= g.turn - 1)),
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc), '[]') from (select * from priv.trades
        where from_c = co.id or to_c = co.id order by id desc limit 60) t),
    'notices', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id desc), '[]') from (select * from public.notices
        where country is null or country = co.id order by id desc limit 30) n),
    'treaty', (select to_jsonb(t) from priv.treaties t where t.country = co.id),
    'treaties', case when g.phase >= 6 then (select coalesce(jsonb_agg(to_jsonb(t) order by t.country), '[]') from priv.treaties t) end,
    'report', case when g.phase >= 4 then priv.crisis_report(co.id) end,
    'alliance', g.alliance,
    'experts', case when g.phase >= 6 then (select coalesce(jsonb_agg(jsonb_build_object('nick', coalesce(s.nickname, s.name), 'role', e.role, 'body', e.body, 'me', s.id = me.id) order by e.role, s.id), '[]')
      from priv.expert_notes e join priv.students s on s.id = e.student_id where e.country = co.id) end,
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
    -- 아직 못 본 다른 나라 국경 칸: 정찰병이 갈 수 없는 곳만 알려 줌 (가까운 곳만)
    'blocked', (select coalesce(jsonb_agg(t.id), '[]') from priv.tiles t
      where t.owner is not null and t.owner <> co.id and not (t.id = any(co.explored)) and t.terrain not in ('ocean', 'coast')
        and exists(select 1 from priv.units u, priv.tiles ut where u.country = co.id and ut.id = u.tile_id and priv.hdist(ut.c, ut.r, t.c, t.r) <= 8)),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'art', priv.city_art(c.id),
        'country', c.country, 'mine', c.type = co.type, 'buildings', case when c.country = co.id then c.buildings end,
        'unrest', case when c.country = co.id then c.unrest end,
        'def', case when c.kind = 'cs' and c.country is null then greatest(1, c.def - c.def_help) end,
        'hp', case when c.kind = 'cs' and c.country is null then c.hp end, 'max_hp', c.max_hp, 'tier', c.tier, 'boss', c.boss, 'final', c.final, 'tutorial', c.tutorial, 'rebel', c.rebel)), '[]')
      from priv.cities c where c.tile_id = any(co.explored))
  );
end $$;

-- ---------------------------------------------------------------------
-- 학생: 행동 (모두 나라 단위로 잠그고 검사)
-- ---------------------------------------------------------------------
-- 역할: 맡은 친구가 있으면 그 친구만, 아무도 안 맡았으면 누구나 (결석·빈 역할 대비)
create or replace function priv.need_role(me priv.students, p_role text) returns void
language plpgsql stable as $$
begin
  if p_role is null or p_role = any(me.roles) or me.is_leader then return; end if;
  perform priv.err('ROLE_ONLY', '「' || p_role || '」이(가) 하는 일이에요. 우리 나라 사람들 탭에서 역할을 확인해요.');
end $$;

drop function if exists priv.act_start(int);
create or replace function priv.act_start(need_phase int default 1, need_role text default null) returns priv.students
language plpgsql as $$
declare me priv.students := priv.me(); g public.game;
begin
  perform priv.need_role(me, need_role);
  select * into g from public.game where id = 1;
  if g.phase < need_phase or g.turn < 1 then perform priv.err('PHASE', '아직 시작 전이에요. 선생님 신호를 기다려 주세요.'); end if;
  if g.locked then perform priv.err('LOCKED', '지금은 회의 시간이라 게임 조작이 멈춰 있어요.'); end if;
  perform 1 from priv.countries where id = me.country_id for update;
  return me;
end $$;

create or replace function public.worker_build(p_tile int, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국토부 장관'); cfg jsonb := priv.cfg(); t priv.tiles; imp jsonb; u priv.units; mult numeric := 1; tn int := priv.turn();
begin
  select * into t from priv.tiles where id = p_tile;
  if not found or t.owner is distinct from me.country_id then perform priv.err('NOT_MINE', '우리 나라 땅에만 개발할 수 있어요.'); end if;
  if t.imp is not null then perform priv.err('DONE', '이미 개발한 칸이에요.'); end if;
  if exists(select 1 from priv.cities where tile_id = p_tile) then perform priv.err('CITY', '도시가 있는 칸이에요. 도시를 눌러 건물을 지어 보세요.'); end if;
  imp := cfg->'IMPROVE'->p_kind;
  if imp is null then perform priv.err('BAD_KIND', '없는 시설이에요.'); end if;
  if imp ? 'res' then
    if t.res is null or not (imp->'res' ? t.res) then perform priv.err('NO_RES', imp->>'name' || '은(는) 알맞은 자원이 있는 칸에만 지을 수 있어요.'); end if;
  elsif not (imp->'on' ? t.terrain) then perform priv.err('BAD_TERRAIN', imp->>'name' || '은(는) 이 지형에 지을 수 없어요.');
  elsif t.res is not null and exists(select 1 from jsonb_each(cfg->'IMPROVE') x where x.value->'res' ? t.res) then
    perform priv.err('HAS_RES', '「' || (cfg->'ITEMS'->t.res->>'name') || '」이(가) 있는 칸이에요. 자원 시설(광산·농원·유정)을 지어요.'); end if;
  if imp ? 'tech' and not priv.has_tech(me.country_id, imp->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(imp->>'tech')) || '」 기술이 있어야 해요.'); end if;
  select * into u from priv.units where country = me.country_id and kind = 'worker' and acted_turn < tn order by priv.tdist(tile_id, p_tile), id limit 1;
  if not found then perform priv.err('NO_WORKER', '이번 턴에 일할 수 있는 노동자가 없어요. 노동자를 더 고용하거나 다음 턴을 기다려요.'); end if;
  if t.terrain = 'jungle' and not priv.has_tech(me.country_id, 'economics') then mult := (cfg->>'JUNGLE_MULT')::numeric; end if;
  perform priv.pay(me.country_id, imp->'cost', mult);
  update priv.tiles set imp = p_kind where id = p_tile;
  update priv.units set acted_turn = tn, tile_id = p_tile where id = u.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'unit', u.id, 'from', u.tile_id, 'to', p_tile);
end $$;

-- 잘못 지은 시설 해체 (자원이 있는 칸만): 노동자 한 명과 해체 비용이 들어요
create or replace function public.worker_demolish(p_tile int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국토부 장관'); cfg jsonb := priv.cfg(); t priv.tiles; u priv.units; tn int := priv.turn();
begin
  select * into t from priv.tiles where id = p_tile;
  if not found or t.owner is distinct from me.country_id then perform priv.err('NOT_MINE', '우리 나라 땅이 아니에요.'); end if;
  if t.imp is null then perform priv.err('NO_IMP', '해체할 시설이 없어요.'); end if;
  if t.res is null or (cfg->'IMPROVE'->t.imp ? 'res') then perform priv.err('NO_NEED', '자원 칸에 잘못 지은 시설만 해체할 수 있어요.'); end if;
  select * into u from priv.units where country = me.country_id and kind = 'worker' and acted_turn < tn order by priv.tdist(tile_id, p_tile), id limit 1;
  if not found then perform priv.err('NO_WORKER', '이번 턴에 일할 수 있는 노동자가 없어요.'); end if;
  perform priv.pay(me.country_id, cfg->'DEMOLISH_COST');
  update priv.tiles set imp = null where id = p_tile;
  update priv.units set acted_turn = tn, tile_id = p_tile where id = u.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'unit', u.id, 'to', p_tile);
end $$;

create or replace function public.hire_worker(p_city text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국토부 장관'); c priv.cities;
begin
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시에서만 고용할 수 있어요.'); end if;
  perform priv.pay(me.country_id, priv.cfg()->'HIRE_WORKER');
  insert into priv.units(country, kind, tile_id) values (me.country_id, 'worker', c.tile_id);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 행정 마비: 행복도가 너무 낮으면 병력 훈련·건물 짓기 불가
create or replace function priv.need_order(p_c int) returns void
language plpgsql stable as $$
begin
  if (select happy from priv.countries where id = p_c) < (priv.cfg()->'HAPPY'->>'paralysis')::int then
    perform priv.err('PARALYSIS', '행정 마비! 행복도가 ' || (priv.cfg()->'HAPPY'->>'paralysis') || '보다 낮아서 병력 훈련과 건물 짓기를 할 수 없어요. 사치품을 구해 행복도를 올려요.'); end if;
end $$;
-- 확장 건설(공장·발전 건물): 도시국가를 3곳 이상 차지해야 열려요 (우리 특산 공장은 처음부터)
create or replace function priv.need_expand(p_c int) returns void
language plpgsql stable as $$
begin
  if (select count(*) from priv.cities where country = p_c and kind = 'cs') < (priv.cfg()->>'EXPAND_CS')::int then
    perform priv.err('EXPAND', '확장 건설은 도시국가를 ' || (priv.cfg()->>'EXPAND_CS') || '곳 이상 차지하면 열려요.'); end if;
end $$;

create or replace function public.city_build(p_city text, p_building text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '기획부 장관'); cfg jsonb := priv.cfg(); c priv.cities; b jsonb; tn int := priv.turn();
begin
  perform priv.need_order(me.country_id);
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시가 아니에요.'); end if;
  b := cfg->'BUILDINGS'->p_building;
  if b is null then perform priv.err('BAD_KIND', '없는 건물이에요.'); end if;
  if p_building = any(c.buildings) then perform priv.err('DONE', '이미 지은 건물이에요.'); end if;
  if c.built_turn >= tn and c.built_count >= (cfg->>'BUILD_PER_TURN')::int then perform priv.err('BUSY', '이 도시는 이번 턴에 건물을 ' || (cfg->>'BUILD_PER_TURN') || '개 지었어요. 다음 턴에 지어요.'); end if;
  if b ? 'tech' and not priv.has_tech(me.country_id, b->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(b->>'tech')) || '」 기술이 있어야 해요.'); end if;
  if (b->>'coastal')::boolean and not exists(select 1 from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.terrain in ('ocean', 'coast') and priv.hdist(t.c, t.r, ct.c, ct.r) = 1) then
    perform priv.err('NOT_COAST', '바닷가 도시에만 지을 수 있어요.'); end if;
  perform priv.pay(me.country_id, b->'cost');
  update priv.cities set buildings = buildings || p_building, built_count = case when built_turn >= tn then built_count + 1 else 1 end, built_turn = tn where id = c.id;
  perform priv.refresh_happy(me.country_id);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.train_unit(p_city text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국방부 장관'); cfg jsonb := priv.cfg(); c priv.cities; u jsonb; tn int := priv.turn();
begin
  perform priv.need_order(me.country_id);
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시가 아니에요.'); end if;
  if c.trained_turn >= tn and c.trained_count >= (cfg->>'TRAIN_PER_TURN')::int then
    perform priv.err('BUSY', '이 도시는 이번 턴에 ' || (cfg->>'TRAIN_PER_TURN') || '부대를 다 훈련했어요.'); end if;
  u := cfg->'UNITS'->p_kind;
  if u is null then perform priv.err('BAD_KIND', '없는 병력이에요.'); end if;
  if (u->>'sea')::boolean is true then
    if not ('harbor' = any(c.buildings)) then perform priv.err('NO_HARBOR', '배는 항구가 있는 도시에서 만들어요.'); end if;
  elsif not ('barracks' = any(c.buildings)) then perform priv.err('NO_BARRACKS', '병영이 있는 도시에서만 훈련할 수 있어요.'); end if;
  if u ? 'tech' and not priv.has_tech(me.country_id, u->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(u->>'tech')) || '」 기술이 있어야 해요.'); end if;
  if u ? 'needs' and not exists(select 1 from priv.advanced where country = me.country_id and kind = u->>'needs') then
    perform priv.err('LOCKED', '「' || (cfg->'ADVANCED'->(u->>'needs')->>'name') || '」을(를) 먼저 지어야 해요.'); end if;
  if u ? 'boss' and u->>'boss' <> priv.ctype(me.country_id) then perform priv.err('NOT_OURS', '다른 나라의 특수 부대예요.'); end if;
  perform priv.pay(me.country_id, u->'cost');
  insert into priv.units(country, kind, tile_id) values (me.country_id, p_kind,
    case when (u->>'sea')::boolean is true then coalesce((select t.id from priv.tiles t where t.id = any(priv.within(c.tile_id, 1)) and t.terrain in ('coast', 'ocean') order by t.id limit 1), c.tile_id)
         else c.tile_id end);
  update priv.cities set trained_count = case when trained_turn >= tn then trained_count + 1 else 1 end, trained_turn = tn where id = c.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 병력·정찰병 이동: 화면에서 계산한 길(칸 번호 목록)을 받아 한 칸씩 검사
create or replace function priv.unit_max_moves(u priv.units) returns int
language sql stable as $$
  select case when u.kind = 'scout' then (priv.cfg()->>'SCOUT_MOVE')::int + case when priv.has_tech(u.country, 'navigation') then 2 else 0 end
              else coalesce((priv.cfg()->'UNITS'->u.kind->>'move')::int, 0) end
$$;
create or replace function priv.unit_moves_left(u priv.units) returns int
language sql stable as $$
  select case when u.attacked_turn >= priv.turn() then 0 when u.moves_turn >= priv.turn() then u.moves_left else priv.unit_max_moves(u) end
$$;

create or replace function public.unit_move(p_unit int, p_path int[]) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1); cfg jsonb := priv.cfg(); u priv.units; tn int := priv.turn();
  left_ int; prev int; step int; t priv.tiles; before int; seen int[] := '{}'; disc_before int[]; disc_after int[];
  sea boolean; water boolean; sight int; fly boolean;
begin
  select * into u from priv.units where id = p_unit and country = me.country_id for update;
  if not found or u.kind = 'worker' then perform priv.err('NO_UNIT', '움직일 수 있는 우리 병력이 아니에요.'); end if;
  perform priv.need_role(me, case when u.kind = 'scout' then cfg->'ROLE_KEY'->>'explore' else cfg->'ROLE_KEY'->>'army' end);
  left_ := priv.unit_moves_left(u);
  sea := (cfg->'UNITS'->u.kind->>'sea')::boolean is true;
  fly := (cfg->'UNITS'->u.kind->>'fly')::boolean is true;
  sight := case when u.kind = 'scout' then (cfg->>'SCOUT_SIGHT')::int else 1 end;
  if coalesce(array_length(p_path, 1), 0) = 0 then perform priv.err('NO_PATH', '갈 곳을 골라 주세요.'); end if;
  if left_ <= 0 then perform priv.err('NO_MOVES', '이번 턴에는 더 움직일 수 없어요.'); end if;
  if array_length(p_path, 1) > left_ then perform priv.err('TOO_FAR', '이번 턴에는 ' || left_ || '칸까지만 갈 수 있어요.'); end if;
  prev := u.tile_id;
  foreach step in array p_path loop
    select * into t from priv.tiles where id = step;
    if not found or priv.tdist(prev, step) <> 1 then perform priv.err('BAD_PATH', '이어지지 않는 길이에요.'); end if;
    water := t.terrain in ('ocean', 'coast');
    if u.kind <> 'scout' and not fly and sea and not water then perform priv.err('LAND', '배는 바다로만 다녀요.'); end if;
    if u.kind <> 'scout' and not fly and not sea and water then perform priv.err('WATER', '육군은 바다를 건널 수 없어요. 배가 필요해요.'); end if;
    if not water and t.owner is not null and t.owner <> me.country_id then
      perform priv.err('BORDER', '다른 나라 국경 안으로는 들어갈 수 없어요.'); end if;
    if exists(select 1 from priv.cities c where c.tile_id = step and c.country is distinct from me.country_id) then
      perform priv.err('CITY', '도시국가 안으로는 들어갈 수 없어요. 바로 옆에서 공격해요.'); end if;
    seen := seen || priv.within(step, sight);
    prev := step;
  end loop;
  select coalesce(array_length(explored, 1), 0), discovered into before, disc_before from priv.countries where id = me.country_id;
  perform priv.reveal(me.country_id, seen);
  update priv.units set tile_id = prev, moves_turn = tn, moves_left = left_ - array_length(p_path, 1) where id = u.id;
  perform priv.check_discovery();
  select discovered into disc_after from priv.countries where id = me.country_id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'to', prev, 'left', left_ - array_length(p_path, 1),
    'new_tiles', (select coalesce(array_length(explored, 1), 0) from priv.countries where id = me.country_id) - before,
    'discovered', (select coalesce(jsonb_agg(x), '[]') from unnest(disc_after) x where not (x = any(disc_before))));
end $$;

-- 예전 이름 (정찰병)
create or replace function public.scout_move(p_unit int, p_path int[]) returns jsonb
language sql security definer set search_path = public, priv as $$ select public.unit_move(p_unit, p_path) $$;

-- 전투 미리보기 (화면과 서버가 같은 식): 피해 = 30 × 공격힘/방어력
create or replace function priv.combat(p_str int, p_hp int, p_def int, p_ranged boolean) returns int[]
language plpgsql stable as $$
declare cb jsonb := priv.cfg()->'COMBAT'; a numeric; ratio numeric; dc int; du int;
begin
  a := p_str * (0.5 + 0.5 * p_hp / 100.0);
  ratio := a / greatest(1, p_def);
  dc := greatest((cb->>'min')::int, least((cb->>'max')::int, round((cb->>'base')::int * ratio)::int));
  du := greatest(1, least(150, round((cb->>'base')::int * coalesce((cb->>'counter')::numeric, 1) / ratio)::int));
  if p_ranged then du := round(du * (cb->>'rangedCounter')::numeric)::int; end if;
  return array[dc, du];
end $$;

-- 공격: 도시국가 바로 옆(원거리 병력은 사거리 안)에서. 도시가 반격해서 우리 병력도 다쳐요
create or replace function public.unit_attack(p_unit int, p_city text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국방부 장관'); cfg jsonb := priv.cfg(); u priv.units; c priv.cities; co priv.countries;
  tn int := priv.turn(); ud jsonb; d int; rng int; ranged boolean; dmg int[]; def int; chp int; uhp int;
  captured boolean := false; died boolean := false; got text[] := '{}'; tk text; res jsonb := '[]'; bonus int := 0;
begin
  select * into co from priv.countries where id = me.country_id;
  select * into u from priv.units where id = p_unit and country = co.id for update;
  if not found or u.kind in ('worker', 'scout') then perform priv.err('NO_UNIT', '공격할 수 있는 우리 병력이 아니에요.'); end if;
  if u.attacked_turn >= tn then perform priv.err('BUSY', '이 병력은 이번 턴에 이미 공격했어요.'); end if;
  select * into c from priv.cities where id = p_city for update;
  if not found or c.kind <> 'cs' then perform priv.err('BAD_CITY', '공격할 수 있는 도시국가가 아니에요.'); end if;
  if c.country is not null then perform priv.err('TAKEN', '이미 ' || priv.cname(c.country) || '의 도시예요.'); end if;
  if c.rebel and c.type <> co.type then perform priv.err('PROTECTED', c.name || '은(는) ' || (select priv.cname(id) from priv.countries where type = c.type limit 1) || '의 반란 도시예요. 우리 나라 반란 도시를 되찾아요!'); end if;
  if c.tutorial and c.type <> co.type then perform priv.err('PROTECTED', '각 나라의 첫 도시국가는 그 나라만 차지할 수 있어요.'); end if;
  ud := cfg->'UNITS'->u.kind;
  if c.final and ud->>'boss' is distinct from c.type then
    perform priv.err('NEED_SPECIAL', c.name || '은(는) 평범한 병력으로는 꿈쩍도 하지 않아요. 「' || (cfg->'UNITS'->(cfg->'BOSS_UNIT'->c.type->>'unit')->>'name') || '」이(가) 필요해요.'); end if;
  if c.boss and not (ud ? 'boss') then
    perform priv.err('NEED_SPECIAL', c.name || '은(는) 여러 나라의 특수 부대가 힘을 합쳐야 무너뜨릴 수 있어요.'); end if;
  ranged := ud ? 'range';
  rng := coalesce((ud->>'range')::int, 1);
  d := priv.tdist(u.tile_id, c.tile_id);
  if d > rng then perform priv.err('FAR', case when ranged then '사거리 ' || rng || '칸 안까지 다가가야 해요.' else '도시국가 바로 옆 칸까지 움직여야 공격할 수 있어요.' end); end if;
  def := greatest(1, c.def - c.def_help);
  -- 나라가 불행하면 병사들이 약해져요
  dmg := priv.combat(round((ud->>'str')::int * case when co.happy < (cfg->'HAPPY'->>'unhappy')::int then (cfg->'COMBAT'->>'unhappyMult')::numeric else 1 end)::int, u.hp, def, ranged and d > 1);
  chp := greatest(0, c.hp - dmg[1]);
  uhp := u.hp - dmg[2];
  update priv.cities set hp = chp where id = c.id;
  if uhp <= 0 then
    died := true; delete from priv.units where id = u.id;
    -- 쓰러진 병력이 쓰던 물자(코인 빼고)는 창고로 돌아와요
    for tk in select key from jsonb_each(ud->'cost') where key <> 'coin' loop
      perform priv.add(co.id, tk, (ud->'cost'->>tk)::int);
    end loop;
    perform priv.notice((ud->>'name') || '이(가) ' || c.name || '의 반격에 쓰러졌어요. 쓰던 물자는 창고로 돌아왔어요.', 'alert', co.id);
  else
    update priv.units set hp = uhp, attacked_turn = tn, moves_turn = tn, moves_left = 0 where id = u.id;
  end if;
  if chp = 0 then
    captured := true;
    update priv.cities set country = co.id, taken_turn = tn, hp = max_hp where id = c.id;
    if c.rebel then   -- 잊힌 제국 격퇴: 원래 도시로
      update priv.cities set rebel = false, def = (cfg->'CS_TIERS'->c.tier->>'def')::int, max_hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int,
        hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int, bonus = (cfg->'CS_TIERS'->c.tier->>'coin')::int where id = c.id;
    end if;
    -- 주변 땅 (주인 없는 땅이면 어느 지역이든)
    update priv.tiles set owner = co.id where id = any(priv.within(c.tile_id, 1)) and owner is null and terrain not in ('ocean', 'coast');
    perform priv.reveal(co.id, priv.within(c.tile_id, (cfg->>'CITY_SIGHT')::int));
    update priv.countries set glory = glory || (case when c.final then (cfg->'FINAL_CS'->>'glory')::int when c.rebel then (cfg->'REBEL'->>'glory')::int else (cfg->'HAPPY'->>'glory')::int end), coin = coin + c.bonus,
      title = case when c.final then '최종 도전 성공' else title end where id = co.id;
    perform priv.refresh_happy(co.id);
    if c.final then perform priv.notice(priv.cname(co.id) || '이(가) 무역으로 모은 자원으로 특수 부대를 만들어 최종 도전 「' || c.name || '」을(를) 무너뜨렸어요!', 'world'); end if;
    bonus := c.bonus;
    if c.tech is not null then
      foreach tk in array string_to_array(c.tech, ',') loop
        if not priv.has_tech(co.id, tk) then update priv.countries set techs = techs || tk where id = co.id; got := got || (cfg->'TECHS'->>tk); end if;
      end loop;
    end if;
    select coalesce(jsonb_agg(t.res), '[]') into res from priv.tiles t where t.id = any(priv.within(c.tile_id, 1)) and t.owner = co.id and t.res is not null;
    perform priv.check_discovery();
    perform priv.notice(c.name || '을(를) 차지했어요! 시민들이 환호합니다.' || case when bonus > 0 then ' (코인 +' || bonus || ')' else '' end, 'capture', co.id);
    if array_length(got, 1) > 0 then
      perform priv.notice(c.name || '의 기술자들이 합류해 「' || array_to_string(got, '」·「') || '」 기술을 얻었어요.', 'tech', co.id);
    end if;
    if c.boss then perform priv.notice(priv.cname(co.id) || '이(가) 최종 보스 「' || c.name || '」을(를) 무너뜨렸어요!', 'world'); end if;
    if c.rebel then
      perform priv.notice(priv.cname(co.id) || '이(가) 잊힌 제국을 몰아내고 「' || c.name || '」을(를) 되찾았어요!', 'world');
      perform priv.event('rebel_down', priv.cname(co.id) || ' 반란 도시 탈환', jsonb_build_object('country', co.id, 'city', c.id));
      perform priv.normal_done();
    end if;
    perform priv.event('capture', priv.cname(co.id) || ' → ' || c.name, jsonb_build_object('country', co.id, 'city', c.id));
  end if;
  perform priv.bump(co.id); perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true, 'city', c.id, 'name', c.name, 'tile', c.tile_id, 'from', u.tile_id,
    'city_dmg', dmg[1], 'unit_dmg', dmg[2], 'city_hp', chp, 'max_hp', c.max_hp, 'unit_hp', greatest(0, uhp), 'ranged', ranged and d > 1,
    'captured', captured, 'died', died, 'techs', to_jsonb(got), 'coin', bonus, 'res', res);
end $$;

-- [테스트용] 최종 성장 모드: 모든 나라가 연구·개발을 끝낸 상태로 (나라마다 가장 강한 도시국가 하나만 남김) → 무역 시험
create or replace function public.test_endgame() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); g public.game; co record; c record; t record; keep text; k text; ik text; n int := 0;
begin
  select * into g from public.game where id = 1 for update;
  if not g.test_mode and not priv.is_admin() then perform priv.err('OFF', '테스트 버튼이 꺼져 있어요.'); end if;
  if g.turn < 1 then update public.game set turn = 1, phase = greatest(phase, 1) where id = 1; end if;
  for co in select * from priv.countries order by id loop
    -- 모든 기술
    update priv.countries set techs = array(select jsonb_object_keys(cfg->'TECH_TREE')), coin = coin + 300 where id = co.id;
    -- 가장 강한 도시국가 하나만 남기고 차지
    select id into keep from priv.cities where kind = 'cs' and type = co.type and country is null order by final desc, tier desc, def desc, id limit 1;
    for c in select * from priv.cities where kind = 'cs' and type = co.type and country is null and id <> keep loop
      update priv.cities set country = co.id, taken_turn = greatest(g.turn, 1), hp = max_hp where id = c.id;
      update priv.tiles set owner = co.id where id = any(priv.within(c.tile_id, 1)) and owner is null and terrain not in ('ocean', 'coast');
      if c.tech is not null then
        foreach k in array string_to_array(c.tech, ',') loop
          if not priv.has_tech(co.id, k) then update priv.countries set techs = techs || k where id = co.id; end if;
        end loop;
      end if;
      n := n + 1;
    end loop;
    -- 우리 땅 모두 개발
    for t in select * from priv.tiles where owner = co.id and imp is null and id not in (select tile_id from priv.cities) loop
      ik := case
        when t.res = 'oil' then 'oilwell'
        when t.res in ('iron', 'copper', 'aluminum', 'gold', 'uranium') then 'mine'
        when t.res in ('cotton', 'spice', 'wine', 'rubber') then 'plantation'
        when t.terrain in ('plains', 'tundra', 'desert') then 'farm'
        when t.terrain in ('forest', 'jungle') then 'lumber'
        when t.terrain = 'hills' then 'quarry' end;
      if ik is not null then update priv.tiles set imp = ik where id = t.id; end if;
    end loop;
    -- 모든 도시에 기본 건물 (항구는 바닷가만)
    update priv.cities ci set buildings = array(select distinct x from unnest(ci.buildings || array['market', 'barracks', 'granary', 'plaza'] ||
        case when exists(select 1 from priv.tiles tt, priv.tiles ct where ct.id = ci.tile_id and tt.terrain in ('ocean', 'coast') and priv.hdist(tt.c, tt.r, ct.c, ct.r) = 1)
             then array['harbor'] else '{}'::text[] end) x)
     where country = co.id;
    -- 우리 나라가 만들 수 있는 공장 모두
    insert into priv.factories(country, kind)
      select co.id, f.key from jsonb_each(cfg->'FACTORIES') f where cfg->'PROC_COST'->co.type ? (f.value->>'output')
      on conflict do nothing;
  end loop;
  -- 모두 서로 발견, 세계 지도 공개, 외교·시장 열기
  update priv.countries set discovered = array(select id from priv.countries x where x.id <> priv.countries.id),
    explored = array(select id from priv.tiles) where true;
  update public.game set phase = greatest(phase, 3), market_open = true, diplomacy_open = true, crisis = true,
    world_first = coalesce(world_first, 1) where id = 1;
  perform priv.advance_turn();   -- 한 턴 정산해서 창고 채우기
  perform priv.notice('[테스트] 최종 성장 모드! 모든 나라가 연구·개발을 마쳤어요. 이제 무역으로 모자란 자원을 구해 보세요.', 'world');
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true, 'captured', n);
end $$;

-- 기술 연구 (별빛 탐험가): 먼저 배울 기술을 다 알아야 하고, 한 턴에 하나
create or replace function public.research_tech(p_tech text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '과학기술부 장관'); cfg jsonb := priv.cfg(); t jsonb; co priv.countries; q text; tn int := priv.turn();
begin
  select * into co from priv.countries where id = me.country_id;
  t := cfg->'TECH_TREE'->p_tech;
  if t is null then perform priv.err('BAD_TECH', '없는 기술이에요.'); end if;
  if p_tech = any(co.techs) then perform priv.err('HAVE', '이미 아는 기술이에요.'); end if;
  if co.research_turn >= tn and co.research_count >= (cfg->>'RESEARCH_PER_TURN')::int then perform priv.err('BUSY', '이번 턴에는 기술을 ' || (cfg->>'RESEARCH_PER_TURN') || '개 연구했어요. 다음 턴에 또 연구해요.'); end if;
  for q in select jsonb_array_elements_text(t->'req') loop
    if not (q = any(co.techs)) then perform priv.err('NEED', '「' || (cfg->'TECHS'->>q) || '」을(를) 먼저 연구해야 해요.'); end if;
  end loop;
  perform priv.pay(co.id, t->'cost');
  update priv.countries set techs = techs || p_tech, research_count = case when research_turn >= tn then research_count + 1 else 1 end, research_turn = tn where id = co.id;
  perform priv.notice('「' || (t->>'name') || '」 연구 완료! ' || (t->>'unlock'), 'tech', co.id);
  perform priv.bump(co.id);
  return jsonb_build_object('ok', true, 'tech', p_tech);
end $$;

create or replace function public.factory_build(p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '기획부 장관'); cfg jsonb := priv.cfg(); f jsonb; tp text;
begin
  tp := priv.ctype(me.country_id);
  f := cfg->'FACTORIES'->p_kind;
  if f is null then perform priv.err('BAD_KIND', '없는 공장이에요.'); end if;
  perform priv.need_order(me.country_id);
  if p_kind is distinct from cfg->'SPECIALTY'->tp->>'factory' then perform priv.need_expand(me.country_id); end if;
  if exists(select 1 from priv.factories where country = me.country_id and kind = p_kind) then perform priv.err('DONE', '이미 지은 공장이에요.'); end if;
  if not priv.has_tech(me.country_id, f->>'tech') or (cfg->'PROC_COST'->tp->(f->>'output')) is null then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(f->>'tech')) || '」 기술이 있어야 지을 수 있어요.'); end if;
  perform priv.pay(me.country_id, coalesce(cfg->'FACTORY_BUILD'->p_kind->tp, f->'build'));
  insert into priv.factories(country, kind) values (me.country_id, p_kind);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.advanced_build(p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(2, '기획부 장관'); cfg jsonb := priv.cfg(); a jsonb;
begin
  a := cfg->'ADVANCED'->p_kind;
  if a is null then perform priv.err('BAD_KIND', '없는 건물이에요.'); end if;
  perform priv.need_order(me.country_id);
  perform priv.need_expand(me.country_id);
  if exists(select 1 from priv.advanced where country = me.country_id and kind = p_kind) then perform priv.err('DONE', '이미 지은 건물이에요.'); end if;
  if a ? 'tech' and not priv.has_tech(me.country_id, a->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(a->>'tech')) || '」 기술이 있어야 해요.'); end if;
  perform priv.pay(me.country_id, a->'cost');
  insert into priv.advanced(country, kind) values (me.country_id, p_kind);
  perform priv.refresh_happy(me.country_id);
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
  if priv.is_banned(me.country_id, p_give_item) then
    perform priv.fail(p_to, me.country_id, p_give_item, p_give_qty, 'ban');
    perform priv.bump(me.country_id);
    return jsonb_build_object('ok', false, 'blocked', 'ban', 'own', true, 'item', p_give_item, 'seller', me.country_id,
      'message', '잊힌 제국이 무역선과 수송기를 공격하고 있어서 「' || priv.iname(p_give_item) || '」은(는) 지금 실어 보낼 수 없어요.');
  end if;
  if priv.is_banned(p_to, p_get_item) then
    perform priv.fail(me.country_id, p_to, p_get_item, p_get_qty, 'ban');
    perform priv.notice(priv.cname(me.country_id) || '이(가) 우리 ' || priv.iname(p_get_item) || '을(를) 사려고 했지만, 잊힌 제국의 무역로 공격 때문에 막혔어요.', 'alert', p_to);
    perform priv.bump(me.country_id); perform priv.bump(p_to);
    return jsonb_build_object('ok', false, 'blocked', 'ban', 'own', false, 'item', p_get_item, 'seller', p_to,
      'message', '잊힌 제국이 무역선과 수송기를 공격하고 있어서 「' || priv.iname(p_get_item) || '」을(를) 실어 올 수 없어요!');
  end if;
  perform priv.trade_check(me.country_id, p_give_item, p_give_qty, case when p_get_item = 'coin' then p_get_qty end);
  perform priv.trade_check(p_to, p_get_item, p_get_qty, case when p_give_item = 'coin' then p_give_qty end);
  insert into priv.offers(turn, from_c, to_c, give_item, give_qty, get_item, get_qty, by_student)
    values (g.turn, me.country_id, p_to, p_give_item, p_give_qty, p_get_item, p_get_qty, me.id) returning id into id_;
  perform priv.notice(priv.cname(me.country_id) || '이(가) 거래를 제안했어요: ' || priv.iname(p_give_item) || ' ' || p_give_qty
    || ' ↔ ' || priv.iname(p_get_item) || ' ' || p_get_qty, 'offer', p_to);
  perform priv.bump(me.country_id); perform priv.bump(p_to);
  return jsonb_build_object('ok', true, 'id', id_, 'tariff', priv.tariff_of(p_get_item, p_get_qty));
end $$;

create or replace function public.offer_cancel(p_offer int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); o priv.offers;
begin
  update priv.offers set status = 'cancelled', decided_at = now() where id = p_offer and from_c = me.country_id and status = 'pending' returning * into o;
  if found then perform priv.bump(o.from_c); perform priv.bump(o.to_c); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 관세: 관세가 붙은 물건을 수입하면 1개마다 (기준가 × 관세율, 올림) 코인을 더 내요
create or replace function priv.tariff_of(p_item text, p_qty int) returns int
language sql stable as $$
  select case when p_item <> 'coin' and g.tariffs ? p_item then ((g.tariffs->>p_item)::numeric * p_qty)::int else 0 end
  from public.game g where g.id = 1
$$;

-- 수출 제한인지 (판 나라가 그 물건 수출을 막았나)
create or replace function priv.is_banned(p_seller int, p_item text) returns boolean
language sql stable as $$
  select p_item <> 'coin' and g.banned ? p_seller::text and (g.banned->p_seller::text) ? p_item from public.game g where g.id = 1
$$;

-- 막힌 거래 기록 (피해 보고서에 그대로 씀)
create or replace function priv.fail(p_buyer int, p_seller int, p_item text, p_qty int, p_reason text) returns void
language sql as $$
  insert into priv.trade_fails(turn, phase, buyer, seller, item, qty, reason)
  select g.turn, g.phase, p_buyer, p_seller, p_item, p_qty, p_reason from public.game g where g.id = 1
$$;

-- 한 방향 기록 (판 나라 → 산 나라)
drop function if exists priv.record_trade(int, int, text, int, int, boolean);
create or replace function priv.record_trade(seller int, buyer int, item text, qty int, coin int, broker boolean default false, tar int default 0) returns int
language plpgsql as $$
declare g public.game; cfg jsonb := priv.cfg(); val int;
begin
  select * into g from public.game where id = 1;
  val := coalesce(coin, (cfg->'ITEMS'->item->>'ref')::int * qty);
  insert into priv.trades(turn, phase, from_c, to_c, item, qty, price, value, tariff, broker)
    values (g.turn, g.phase, seller, buyer, item, qty, case when coin is not null then round(coin::numeric / qty) end, val, tar, broker);
  return tar;
end $$;

create or replace function public.offer_respond(p_offer int, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(3); o priv.offers; g public.game; s text; tar int := 0; tar_to int; tar_from int; bs int; bb int; bi text; bq int;
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
  -- 수출 제한 (제안을 보낸 뒤에 협정이 끝났을 수도 있어요)
  if priv.is_banned(o.from_c, o.give_item) or priv.is_banned(o.to_c, o.get_item) then
    if priv.is_banned(o.from_c, o.give_item) then bs := o.from_c; bb := o.to_c; bi := o.give_item; bq := o.give_qty;
    else bs := o.to_c; bb := o.from_c; bi := o.get_item; bq := o.get_qty; end if;
    perform priv.fail(bb, bs, bi, bq, 'ban');
    update priv.offers set status = 'blocked', decided_at = now() where id = o.id;
    perform priv.notice('무역로 공격! 잊힌 제국 때문에 ' || priv.iname(bi) || '을(를) 실어 나를 수 없어 거래가 막혔어요.', 'alert', o.from_c);
    perform priv.notice('무역로 공격! 잊힌 제국 때문에 ' || priv.iname(bi) || '을(를) 실어 나를 수 없어 거래가 막혔어요.', 'alert', o.to_c);
    perform priv.bump(o.from_c); perform priv.bump(o.to_c);
    return jsonb_build_object('ok', false, 'blocked', 'ban', 'own', bs = me.country_id, 'item', bi, 'seller', bs,
      'message', '잊힌 제국이 무역선과 수송기를 공격하고 있어서 「' || priv.iname(bi) || '」을(를) 실어 나를 수 없어요!');
  end if;
  s := priv.cost_short(o.from_c, jsonb_build_object(o.give_item, o.give_qty));
  if s is not null then perform priv.err('NO_MONEY', priv.cname(o.from_c) || '의 물건이 모자라 거래할 수 없어요: ' || s); end if;
  s := priv.cost_short(o.to_c, jsonb_build_object(o.get_item, o.get_qty));
  if s is not null then perform priv.err('NO_MONEY', '우리 나라가 줄 것이 모자라요: ' || s); end if;
  perform priv.trade_check(o.from_c, o.give_item, o.give_qty, case when o.get_item = 'coin' then o.get_qty end);
  perform priv.trade_check(o.to_c, o.get_item, o.get_qty, case when o.give_item = 'coin' then o.give_qty end);
  -- 관세: 수입한 나라가 코인으로 더 내요. 코인이 모자라면 거래가 막혀요
  tar_to := priv.tariff_of(o.give_item, o.give_qty);     -- 받는 나라(o.to_c)가 냄
  tar_from := priv.tariff_of(o.get_item, o.get_qty);     -- 제안한 나라(o.from_c)가 냄
  if tar_to > 0 and priv.coin(o.to_c) < tar_to + (case when o.get_item = 'coin' then o.get_qty else 0 end) then
    perform priv.fail(o.to_c, o.from_c, o.give_item, o.give_qty, 'tariff');
    perform priv.bump(o.to_c);
    return jsonb_build_object('ok', false, 'blocked', 'tariff', 'item', o.give_item, 'tariff', tar_to,
      'message', '관세 폭탄! 관세 ' || tar_to || '코인을 낼 코인이 모자라 거래하지 못했어요.');
  end if;
  if tar_from > 0 and priv.coin(o.from_c) < tar_from + (case when o.give_item = 'coin' then o.give_qty else 0 end) then
    perform priv.fail(o.from_c, o.to_c, o.get_item, o.get_qty, 'tariff');
    update priv.offers set status = 'blocked', decided_at = now() where id = o.id;
    perform priv.notice(priv.cname(o.from_c) || '은(는) 관세 ' || tar_from || '코인을 낼 코인이 모자라 거래가 막혔어요.', 'alert', o.from_c);
    perform priv.bump(o.from_c); perform priv.bump(o.to_c);
    return jsonb_build_object('ok', false, 'blocked', 'tariff', 'item', o.get_item, 'tariff', tar_from,
      'message', priv.cname(o.from_c) || '이(가) 관세 ' || tar_from || '코인을 낼 코인이 모자라 거래하지 못했어요.');
  end if;
  perform priv.add(o.from_c, o.give_item, -o.give_qty); perform priv.add(o.to_c, o.give_item, o.give_qty);
  perform priv.add(o.to_c, o.get_item, -o.get_qty);     perform priv.add(o.from_c, o.get_item, o.get_qty);
  if tar_to > 0 then perform priv.add(o.to_c, 'coin', -tar_to); end if;
  if tar_from > 0 then perform priv.add(o.from_c, 'coin', -tar_from); end if;
  tar := tar_to + tar_from;
  if o.give_item <> 'coin' then perform priv.record_trade(o.from_c, o.to_c, o.give_item, o.give_qty, case when o.get_item = 'coin' then o.get_qty end, false, tar_to); end if;
  if o.get_item <> 'coin' then perform priv.record_trade(o.to_c, o.from_c, o.get_item, o.get_qty, case when o.give_item = 'coin' then o.give_qty end, false, tar_from); end if;
  perform priv.refresh_happy(o.from_c); perform priv.refresh_happy(o.to_c);   -- 사치품이 오면 행복도가 바로 올라요
  update priv.offers set status = 'accepted', decided_at = now() where id = o.id;
  perform priv.notice('거래 성사! ' || priv.cname(o.from_c) || ' ↔ ' || priv.cname(o.to_c) || ': '
    || priv.iname(o.give_item) || ' ' || o.give_qty || ' ↔ ' || priv.iname(o.get_item) || ' ' || o.get_qty, 'trade', o.from_c);
  perform priv.notice('거래 성사! ' || priv.cname(o.from_c) || ' ↔ ' || priv.cname(o.to_c) || ': '
    || priv.iname(o.give_item) || ' ' || o.give_qty || ' ↔ ' || priv.iname(o.get_item) || ' ' || o.get_qty, 'trade', o.to_c);
  perform priv.bump(o.from_c); perform priv.bump(o.to_c); perform priv.bump_game();
  return jsonb_build_object('ok', true, 'accepted', true, 'tariff', tar, 'tariff_me', case when me.country_id = o.to_c then tar_to else tar_from end);
end $$;

drop function if exists public.city_rebuild();
-- 우리 나라가 겪은 일 (실제 거래 기록으로만): 세계 무역 회의 화면에 한 줄 요약
create or replace function priv.crisis_report(p_c int) returns jsonb
language plpgsql stable as $$
declare ct int;
begin
  select min(turn) into ct from priv.events where kind = 'expire';
  return jsonb_build_object(
    'crisis_turn', ct,
    'fails', (select coalesce(jsonb_agg(jsonb_build_object('turn', f.turn, 'buyer', f.buyer, 'seller', f.seller, 'item', f.item, 'qty', f.qty, 'reason', f.reason) order by f.id), '[]')
      from priv.trade_fails f where f.buyer = p_c or f.seller = p_c),
    'tariff_paid', (select coalesce(sum(tariff), 0) from priv.trades where to_c = p_c and phase >= 5),
    'trades_before', (select count(*) from priv.trades where (from_c = p_c or to_c = p_c) and not broker and ct is not null and turn between ct - 2 and ct - 1),
    'trades_after', (select count(*) from priv.trades where (from_c = p_c or to_c = p_c) and not broker and phase between 5 and 6),
    'rebel', (select jsonb_build_object('id', c.id, 'name', c.name, 'hp', c.hp, 'max_hp', c.max_hp, 'def', c.def) from priv.cities c, priv.countries co
              where co.id = p_c and c.rebel and c.type = co.type limit 1)
  );
end $$;

-- 무역 동맹: 무역이 되살아나고 잊힌 제국이 크게 약해져요
create or replace function priv.alliance() returns void
language plpgsql as $$
declare cfg jsonb := priv.cfg(); co record;
begin
  update public.game set alliance = true, locked = false, banned = '{}'::jsonb, tariffs = '{}'::jsonb, fair_cap = true, phase = greatest(phase, 7) where id = 1;
  update priv.cities set def = (cfg->'REBEL'->>'weakDef')::int, max_hp = (cfg->'REBEL'->>'weakHp')::int, hp = least(hp, (cfg->'REBEL'->>'weakHp')::int) where rebel;
  for co in select id from priv.countries loop perform priv.refresh_happy(co.id); end loop;
  perform priv.notice('무역 동맹 체결! 여섯 나라가 함께 약속하자 잊힌 제국의 협박이 더는 통하지 않아요. 잊힌 제국의 영향력이 크게 줄고, 무역로가 다시 열렸어요 — 우리 반란 도시를 되찾아요!', 'market');
  perform priv.event('alliance', '무역 동맹 체결');
end $$;

-- 활동 2 전문가 회의: 같은 역할끼리 정한 문장 (학생마다 자기 화면에 저장 → 활동 3에서 모둠이 함께 봐요)
create or replace function public.expert_submit(p_role text, p_body text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if priv.phase() < 6 then perform priv.err('PHASE', '세계 무역 회의 시간에 쓸 수 있어요.'); end if;
  if not (p_role = any(me.roles) or (me.is_leader and p_role = '국가 대표')) then perform priv.err('ROLE_ONLY', '내가 맡은 역할의 문장만 쓸 수 있어요.'); end if;
  if length(regexp_replace(coalesce(p_body, ''), '올바른 무역을 위해|[()（） .\s]', '', 'g')) < 8 then
    perform priv.err('SHORT', '괄호 안에 우리 모임이 정한 내용을 직접 써 주세요. (8글자 이상)'); end if;
  insert into priv.expert_notes(student_id, country, role, body, updated_at) values (me.id, me.country_id, p_role, left(trim(p_body), 120), now())
    on conflict (student_id) do update set role = excluded.role, body = excluded.body, updated_at = now();
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 국가 정상화: 반란 도시가 모두 돌아오면 (직접 되찾거나, 시간이 없으면 선생님 버튼으로)
create or replace function priv.normal_done() returns void
language plpgsql as $$
begin
  if exists(select 1 from priv.cities where rebel) or (select normalized from public.game where id = 1) then return; end if;
  update public.game set normalized = true, video_seq = video_seq + 1 where id = 1;
  perform priv.notice('국가 정상화 성공! 잊힌 제국의 영향력이 사라지고 무역이 정상으로 돌아왔어요. 축하합니다!', 'world');
  perform priv.event('normal', '국가 정상화');
end $$;

create or replace function public.admin_normalize() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); c record;
begin
  perform priv.need_admin();
  if not (select alliance from public.game where id = 1) then perform priv.alliance(); end if;
  for c in select ci.*, co.id cid from priv.cities ci join priv.countries co on co.type = ci.type where ci.rebel loop
    update priv.cities set rebel = false, country = c.cid, taken_turn = priv.turn(), def = (cfg->'CS_TIERS'->c.tier->>'def')::int,
      max_hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int, hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int, bonus = (cfg->'CS_TIERS'->c.tier->>'coin')::int where id = c.id;
    update priv.tiles set owner = c.cid where id = any(priv.within(c.tile_id, 1)) and owner is null and terrain not in ('ocean', 'coast');
    update priv.countries set glory = glory || (cfg->'REBEL'->>'glory')::int where id = c.cid;
  end loop;
  for c in select id from priv.countries loop perform priv.refresh_happy(c.id); end loop;
  perform priv.normal_done();
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_video() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set video_seq = video_seq + 1 where id = 1;
  perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

-- 세계 무역 회의: 모둠이 고른 무역 규칙 1개 (국가 대표가 입력). 6나라가 다 입력하면 무역 동맹!
create or replace function public.treaty_submit(p_focus text, p_problem text, p_promise text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); n int; ally boolean := false;
begin
  if not me.is_leader and not exists(select 1 from priv.admins where uid = auth.uid() and control = me.country_id) then perform priv.err('LEADER_ONLY', '규칙 입력은 국가 대표가 해요.'); end if;
  if priv.phase() < 6 then perform priv.err('PHASE', '세계 무역 회의 시간에 입력할 수 있어요.'); end if;
  if length(regexp_replace(coalesce(p_promise, ''), '우리가 제안한 조약은|입니다|[()（）「」 .\s]', '', 'g')) < 8 then
    perform priv.err('SHORT', '괄호 안에 우리 나라 무역 조항을 직접 써 주세요. (8글자 이상)'); end if;
  insert into priv.treaties(country, focus, problem, promise, reason, agreed, updated_at)
    values (me.country_id, p_focus, left(trim(coalesce(p_problem, '')), 120), left(trim(p_promise), 120), left(trim(coalesce(p_reason, '')), 120), '{}', now())
    on conflict (country) do update set focus = excluded.focus, problem = excluded.problem, promise = excluded.promise,
      reason = excluded.reason, updated_at = now();
  select count(*) into n from priv.treaties;
  perform priv.notice(priv.cname(me.country_id) || '이(가) 무역 조항을 등록했어요: ' || left(trim(p_promise), 70) || ' (' || n || '/6)', 'world');
  if n >= 6 and priv.phase() = 6 then perform priv.alliance(); ally := true; end if;
  perform priv.bump_all(); perform priv.bump_game();
  return jsonb_build_object('ok', true, 'count', n, 'alliance', ally);
end $$;

create or replace function public.treaty_agree() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if not me.is_leader then perform priv.err('LEADER_ONLY', '공동 약속 동의는 국가 대표가 해요.'); end if;
  if priv.phase() < 6 then perform priv.err('PHASE', '조약 회의 시간에 동의할 수 있어요.'); end if;
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
      'diplomacy_open', diplomacy_open, 'world_first', world_first, 'timer_end', timer_end, 'timer_label', timer_label, 'banned', banned, 'tariffs', tariffs, 'alliance', alliance,
      'meet_step', meet_step, 'video_url', video_url, 'video_seq', video_seq, 'normalized', normalized) from public.game where id = 1),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'emblem_url', c.emblem_url, 'happy', c.happy, 'title', c.title,
        'cities', (select count(*) from priv.cities where country = c.id), 'discovered', coalesce(array_length(c.discovered, 1), 0),
        'exports', (select coalesce(sum(qty), 0) from priv.trades where from_c = c.id and not broker),
        'imports', (select coalesce(sum(qty), 0) from priv.trades where to_c = c.id and not broker),
        'coin', c.coin, 'military', priv.military(c.id), 'units', (select count(*) from priv.units u where u.country = c.id and u.kind not in ('worker', 'scout')),
        'rebel', exists(select 1 from priv.cities r where r.rebel and r.type = c.type), 'final_done', exists(select 1 from priv.cities f where f.final and f.type = c.type and f.country = c.id),
        'fails', (select count(*) from priv.trade_fails f where f.buyer = c.id or f.seller = c.id),
        'tariff_paid', (select coalesce(sum(tariff), 0) from priv.trades where to_c = c.id and phase >= 5)) order by c.id), '[]') from priv.countries c),
    'tiles', (select jsonb_agg(jsonb_build_array(t.id, t.terrain, t.res, t.owner, t.imp) order by t.id) from priv.tiles t),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'country', c.country, 'art', priv.city_art(c.id),
        'buildings', c.buildings, 'unrest', c.unrest, 'tier', c.tier, 'boss', c.boss, 'max_hp', c.max_hp,
        'hp', case when c.kind = 'cs' and c.country is null then c.hp end)) from priv.cities c),
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
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object('admin', priv.is_admin(), 'control', (select control from priv.admins where uid = auth.uid())) $$;

-- 선생님 체험 모드: 고른 나라를 모든 역할로 직접 조작 (null이면 끄기)
create or replace function public.admin_control(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  if p_country is not null and not exists(select 1 from priv.countries where id = p_country) then perform priv.err('BAD_COUNTRY', '없는 나라예요.'); end if;
  update priv.admins set control = p_country where uid = auth.uid();
  return jsonb_build_object('ok', true, 'control', p_country);
end $$;

-- 선생님 관전 모드 (투명한 무적 정찰병): 고른 나라의 화면 + 온 세상 지도와 모든 병력
create or replace function public.admin_observe(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare st jsonb; mv jsonb;
begin
  perform priv.need_admin();
  if not exists(select 1 from priv.countries where id = p_country) then perform priv.err('BAD_COUNTRY', '없는 나라예요.'); end if;
  perform set_config('trade.observe', p_country::text, true);
  st := public.my_state(); mv := public.map_view();
  perform set_config('trade.observe', '', true);
  return jsonb_build_object('state', st, 'map', mv, 'world', jsonb_build_object(
    'tiles', (select jsonb_agg(jsonb_build_array(t.id, t.terrain, t.res, t.owner, t.imp) order by t.id) from priv.tiles t),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'art', priv.city_art(c.id),
        'country', c.country, 'buildings', c.buildings, 'unrest', c.unrest,
        'def', case when c.kind = 'cs' and c.country is null then greatest(1, c.def - c.def_help) end,
        'hp', case when c.kind = 'cs' and c.country is null then c.hp end, 'max_hp', c.max_hp, 'tier', c.tier, 'boss', c.boss)) from priv.cities c),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'country', u.country, 'kind', u.kind, 'tile', u.tile_id, 'hp', u.hp) order by u.id), '[]') from priv.units u),
    'countries', (select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'name', priv.cname(c.id), 'flag_url', c.flag_url,
        'happy', c.happy, 'coin', c.coin, 'discovered', coalesce(array_length(c.discovered, 1), 0)) order by c.id) from priv.countries c)));
end $$;

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
        'online', (select count(*) from priv.students where country_id = c.id and last_seen > now() - interval '60 seconds'),
        'rebel', (select jsonb_build_object('name', r.name, 'hp', r.hp, 'max_hp', r.max_hp) from priv.cities r where r.rebel and r.type = c.type limit 1),
        'final', (select jsonb_build_object('id', f.id, 'name', f.name, 'hp', f.hp, 'max_hp', f.max_hp, 'taken', f.country = c.id, 'owner', f.country)
                  from priv.cities f where f.final and f.type = c.type limit 1),
        'report', case when g.phase >= 4 then priv.crisis_report(c.id) end
      ) order by c.id), '[]') from priv.countries c),
    'students', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'country_id', s.country_id, 'no', s.no, 'name', s.name, 'nick', s.nickname,
        'roles', s.roles, 'is_leader', s.is_leader, 'bound', s.uid is not null, 'online', s.last_seen > now() - interval '60 seconds',
        'reflection', (select body from priv.reflections where student_id = s.id)) order by s.country_id, s.no, s.id), '[]') from priv.students s),
    'pairings', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'student_id', r.student_id, 'name', s.name || coalesce(' (' || s.nickname || ')', ''), 'country_id', s.country_id,
        'created_at', r.created_at) order by r.id), '[]') from priv.pairing_requests r join priv.students s on s.id = r.student_id where r.status = 'pending'),
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc), '[]') from (select * from priv.trades order by id desc limit 80) t),
    'offers_pending', (select count(*) from priv.offers where status = 'pending'),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') from (select * from priv.events order by id desc limit 30) e),
    'treaties', (select coalesce(jsonb_agg(to_jsonb(t) order by t.country), '[]') from priv.treaties t),
    'experts', (select coalesce(jsonb_agg(jsonb_build_object('country', e.country, 'role', e.role, 'body', e.body, 'nick', coalesce(s.nickname, s.name)) order by e.country, e.role), '[]')
        from priv.expert_notes e join priv.students s on s.id = e.student_id),
    'volume', (select coalesce(jsonb_agg(jsonb_build_object('turn', t, 'qty', priv.trade_volume(t)) order by t), '[]')
        from generate_series(greatest(1, g.turn - 12), g.turn) t)
  );
end $$;

-- 단계 넘기기 (앞으로만)
create or replace function public.admin_set_phase(p_target int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game; nxt int; cfg jsonb := priv.cfg(); co record; rb jsonb;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1 for update;
  if p_target <= g.phase then perform priv.err('BACKWARD', '뒤로 가기는 「단계 강제 이동」으로만 할 수 있어요.'); end if;
  if p_target > 8 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
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
    elsif nxt = 4 then
      -- 잊힌 제국 등장: 각 나라가 처음 차지한 도시를 빼앗아 반란 도시로
      update public.game set phase = 4 where id = 1;   -- 행복도 계산(사치품 싫증)이 바로 반영되게
      for co in select c.*, p.id pid, (select tile_id from priv.cities where kind = 'capital' and type = c.type) cap
                from priv.cities c join priv.countries p on p.type = c.type where c.tutorial and not c.final loop
        update priv.units set tile_id = co.cap where tile_id = co.tile_id;
        update priv.cities set rebel = true, country = null, buildings = '{}', unrest = false,
          def = (cfg->'REBEL'->>'def')::int, max_hp = (cfg->'REBEL'->>'hp')::int, hp = (cfg->'REBEL'->>'hp')::int, bonus = (cfg->'REBEL'->>'coin')::int
         where id = co.id;
        perform priv.reveal(co.pid, priv.within(co.tile_id, 1));
        perform priv.notice_d('긴급속보! 잊힌 제국이 「' || co.name || '」을(를) 빼앗아 반란 도시로 만들었어요. 테러로 시민들이 불안해해요.', 'crisis', co.pid,
          jsonb_build_object('mode', 'rebel', 'city', co.name, 'tile', co.tile_id));
      end loop;
      for co in select id from priv.countries loop perform priv.refresh_happy(co.id); end loop;
      perform priv.notice('긴급속보: 잊힌 제국 등장! 여섯 나라의 첫 도시가 잊힌 제국에게 넘어갔어요. 인터넷으로 다른 나라 물건을 보게 된 시민들은 사치품에 싫증을 내기 시작했어요.', 'alert');
      perform priv.event('rebel', '잊힌 제국 등장');
    elsif nxt = 5 then
      -- 협정 만료: 잊힌 제국이 무역 규칙을 깨요 (사치품 거래 불가 · 나머지 관세 폭탄)
      update public.game set fair_cap = false,
        tariffs = (select coalesce(jsonb_object_agg(k, (cfg->'CRISIS'->>'tariffPerUnit')::int), '{}') from jsonb_object_keys(cfg->'ITEMS') k
                   where not (cfg->'LUX') ? k and not (cfg->'BANNED_STRAT') ? k),
        banned = (select coalesce(jsonb_object_agg(c.id::text, (cfg->'LUX') || (cfg->'BANNED_STRAT')), '{}') from priv.countries c)
       where id = 1;
      perform priv.notice('긴급속보: 세계 무역 협정 만료! 잊힌 제국이 "관세를 말도 안 되게 올리지 않으면 무역선을 공격하겠다"고 협박했어요. 겁먹은 나라들이 관세를 크게 올렸고(1개마다 +' || (cfg->'CRISIS'->>'tariffPerUnit') || '코인), 사치품과 핵심 전략 자원은 실어 나를 수 없어요.', 'alert');
      perform priv.event('expire', '협정 만료: 잊힌 제국의 무역 파괴');
    elsif nxt = 6 then
      update public.game set locked = true where id = 1;
      perform priv.notice('세계 무역 회의 시간이에요! ① 같은 역할끼리 모이고 → ② 모둠 규칙 1개 → ③ 대표들이 세계 무역 헌장을 만들어요.', 'phase');
      perform priv.event('meeting', '세계 무역 회의');
    elsif nxt = 7 then
      perform priv.alliance();
    elsif nxt = 8 then
      update public.game set locked = true where id = 1;
      perform priv.notice('정리 시간이에요. 무역을 할 때 필요한 노력을 학습지에 적어 봅시다.', 'phase');
      perform priv.event('wrap', '정리');
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
  if p_target < 0 or p_target > 8 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
  update public.game set phase = p_target, locked = (p_target in (6, 8)) where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

-- 다음 턴: 이번 턴 정산 후 턴 번호 +1
drop function if exists public.admin_next_turn();
-- 다음 턴 (관제실 버튼, 자동 넘김, 모든 나라 준비 완료가 같이 씀)
create or replace function priv.advance_turn() returns int
language plpgsql as $$
declare g public.game; cfg jsonb := priv.cfg();
begin
  select * into g from public.game where id = 1 for update;
  perform priv.end_turn();
  -- 도시국가 성벽 회복 (한 번에 못 무너뜨리면 다시 단단해져요)
  update priv.cities set hp = least(max_hp, hp + case when final then (cfg->'FINAL_CS'->>'heal')::int else coalesce((cfg->'CS_TIERS'->tier->>'heal')::int, 10) end)
   where kind = 'cs' and country is null and hp < max_hp and not rebel;
  if not g.alliance then update priv.cities set hp = max_hp where rebel; end if;   -- 잊힌 제국: 무역 동맹 전에는 매 턴 체력을 모두 회복
  update priv.offers set status = 'expired', decided_at = now() where status = 'pending';
  update public.game set turn = turn + 1, turn_end = case when auto_turn > 0 then now() + make_interval(secs => auto_turn) end,
    cold_snap = null where id = 1;
  perform priv.notice('턴 ' || (g.turn + 1) || ' 시작! 생산한 자원이 창고에 들어왔어요.', 'turn');
  perform priv.bump_game(); perform priv.bump_all();
  return g.turn + 1;
end $$;

create or replace function public.admin_next_turn(p_from int default null) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1 for update;
  if g.phase < 1 or g.turn < 1 then perform priv.err('PHASE', '먼저 1단계 「나라 키우기」를 시작해 주세요.'); end if;
  -- 자동 넘김이 두 번 겹치지 않게: 화면이 알던 턴과 다르면 그냥 둠
  if p_from is not null and p_from <> g.turn then return jsonb_build_object('ok', true, 'turn', g.turn, 'skipped', true); end if;
  return jsonb_build_object('ok', true, 'turn', priv.advance_turn());
end $$;

-- 턴 끝내기 (국가 대표): 학생이 있는 모든 나라가 누르면 바로 다음 턴. 다시 누르면 취소
create or replace function public.turn_ready() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국가 대표'); tn int := priv.turn(); waiting int; nt int;
begin
  update priv.countries set ready_turn = case when ready_turn = tn then 0 else tn end where id = me.country_id;
  select count(*) into waiting from priv.countries c
   where c.ready_turn <> tn and (exists(select 1 from priv.students s where s.country_id = c.id and s.uid is not null)
                                or exists(select 1 from priv.admins a where a.control = c.id));
  perform priv.bump_all();
  if waiting = 0 then
    nt := priv.advance_turn();
    return jsonb_build_object('ok', true, 'next', true, 'turn', nt);
  end if;
  return jsonb_build_object('ok', true, 'next', false, 'waiting', waiting,
    'ready', (select ready_turn = tn from priv.countries where id = me.country_id));
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
  update public.game set require_approval = coalesce((p->>'require_approval')::boolean, require_approval),
    test_mode = coalesce((p->>'test_mode')::boolean, test_mode),
    meet_step = coalesce((p->>'meet_step')::int, meet_step),
    video_url = case when p ? 'video_url' then nullif(trim(p->>'video_url'), '') else video_url end where id = 1;
  perform priv.bump_all();
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
  select country_id into c from priv.students where id = p_student;
  if p_on then   -- 국가 대표는 한 나라에 한 명
    update priv.students set is_leader = false, roles = array_remove(roles, priv.cfg()->'ROLES'->>0) where country_id = c and id <> p_student;
    update priv.students set is_leader = true, roles = case when (priv.cfg()->'ROLES'->>0) = any(roles) then roles else (priv.cfg()->'ROLES'->>0) || roles end where id = p_student;
  else
    update priv.students set is_leader = false, roles = array_remove(roles, priv.cfg()->'ROLES'->>0) where id = p_student;
  end if;
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
    perform priv.refresh_happy(c.id);
    perform priv.notice_d('지구 서버 관리자의 지원: ' || priv.items_text(p_items) || coalesce(' (' || nullif(trim(p_reason), '') || ')', ''), 'grant', c.id,
      jsonb_build_object('mode', 'grant', 'items', p_items, 'reason', nullif(trim(p_reason), '')));
    perform priv.bump(c.id);
  end loop;
  perform priv.event('grant', coalesce(p_reason, ''), jsonb_build_object('country', p_country, 'items', p_items));
  return jsonb_build_object('ok', true);
end $$;

-- 긴급 중립 상인: 거래가 막혔을 때만. 기준가의 2배 코인을 받고 팔아요
create or replace function public.admin_merchant(p_country int, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); k text; v text; total int := 0; unit int;
begin
  perform priv.need_admin();
  for k, v in select key, value from jsonb_each_text(coalesce(p_items, '{}'::jsonb)) loop
    if k = 'coin' or cfg->'ITEMS'->k is null or v::int <= 0 then perform priv.err('BAD_ITEM', '팔 수 없는 물건이에요.'); end if;
    total := total + ceil((cfg->'ITEMS'->k->>'ref')::numeric * (cfg->'CRISIS'->>'merchantMult')::numeric)::int * v::int;
  end loop;
  if total = 0 then perform priv.err('BAD_ITEM', '물건을 골라 주세요.'); end if;
  if priv.coin(p_country) < total then perform priv.err('NO_MONEY', priv.cname(p_country) || '의 코인이 모자라요 (필요 ' || total || ', 있음 ' || priv.coin(p_country) || ')'); end if;
  for k, v in select key, value from jsonb_each_text(p_items) loop
    unit := ceil((cfg->'ITEMS'->k->>'ref')::numeric * (cfg->'CRISIS'->>'merchantMult')::numeric)::int;
    perform priv.add(p_country, k, v::int);
    perform priv.record_trade(null, p_country, k, v::int, unit * v::int, true);
  end loop;
  perform priv.add(p_country, 'coin', -total);
  perform priv.refresh_happy(p_country);
  perform priv.notice_d('긴급 중립 상인이 물건을 팔았어요: ' || priv.items_text(p_items) || ' (코인 -' || total || ')', 'grant', p_country,
    jsonb_build_object('mode', 'merchant', 'items', p_items, 'coin', total));
  perform priv.event('merchant', priv.cname(p_country) || ' 긴급 중립 상인', jsonb_build_object('country', p_country, 'items', p_items, 'coin', total));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true, 'coin', total);
end $$;

-- 특수 부대 지원 (17차시 정복 준비): 최종 도시국가에서 2칸 떨어진 곳에 그 나라 특수 부대 1대
create or replace function public.admin_boss_help(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); tp text := priv.ctype(p_country); uk text; f priv.cities; tl int;
begin
  perform priv.need_admin();
  uk := cfg->'BOSS_UNIT'->tp->>'unit';
  select * into f from priv.cities where final and type = tp limit 1;
  if not found then perform priv.err('NO_FINAL', '이 나라의 최종 도시국가가 없어요.'); end if;
  if f.country is not null then perform priv.err('TAKEN', '이미 최종 도시국가를 차지했어요.'); end if;
  select t.id into tl from priv.tiles t, priv.tiles ft where ft.id = f.tile_id and priv.hdist(t.c, t.r, ft.c, ft.r) = 2
   order by (t.terrain in ('ocean', 'coast')), (t.owner is not distinct from p_country) desc, t.id limit 1;
  insert into priv.units(country, kind, tile_id) values (p_country, uk, tl);
  perform priv.reveal(p_country, priv.within(tl, 2));
  perform priv.notice_d('지구 서버 관리자의 지원: 「' || (cfg->'UNITS'->uk->>'name') || '」이(가) ' || f.name || ' 근처에 도착했어요!', 'grant', p_country,
    jsonb_build_object('mode', 'boss', 'unit', uk, 'city', f.name));
  perform priv.event('boss_help', priv.cname(p_country) || ' 특수 부대 지원', jsonb_build_object('country', p_country));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true, 'tile', tl);
end $$;

-- 불안 진정: 행복도 +15 (점령 환호처럼 3턴에 걸쳐 줄어듦), 불안 도시 회복
create or replace function public.admin_relief(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update priv.countries set glory = glory || 15, happy = least(100, happy + 15) where id = p_country;
  update priv.cities set unrest = false where country = p_country;
  perform priv.notice('지구 서버 관리자가 축제를 열어 시민들의 마음을 달랬어요. (행복도 +15)', 'grant', p_country);
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
  perform priv.notice('지구 서버 관리자 지원: 코인 40과 함께, 다음 도시국가의 성벽이 약해졌다는 소식이 들어왔어요.', 'grant', p_country);
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
  perform priv.notice('지구 서버 관리자가 세계 지도를 전했어요. 외교 창에서 여섯 나라를 볼 수 있어요.', 'world');
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
  -- 아직 시작 전(0단계, 0턴)이면 새 지도·규칙으로 다시 준비 (명단·나라 이름·국기는 그대로)
  if (select phase = 0 and turn = 0 from public.game where id = 1) then
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
