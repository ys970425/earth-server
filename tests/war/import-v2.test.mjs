// E1 가져오기 v2 시험 (H4): 표 추가·규칙 숫자·공장 배치·병과 지급·시장·외교
// 실행: node tests/war/import-v2.test.mjs  (또는 npm run test:war:import2)
import { readFileSync, readdirSync } from 'node:fs';
import { createDb, seedTradeState, tradeFingerprint } from './helpers.mjs';

const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx);
  const { db, one, ok, rpc, fail } = ctx;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dir = new URL('../../supabase/war/', import.meta.url);
  const sql = ['schema.sql', 'config.sql', 'functions.sql'].map(f => readFileSync(new URL(f, dir), 'utf8'));
  for (let i = 0; i < 2; i++) for (const s of sql) await db.exec(s);
  ok(true, 'schema → config → functions 순서로 두 번 설치해도 안전함');
  ok((await one(`select war.cfg()->'BOSS'->>'str' s`)).s === '95' && (await one(`select war.cfg()->'TURN'->>'seconds' t`)).t === '180',
    'war.cfg()에 규칙 숫자가 들어 있음 (특수 부대 힘 95, 턴 180초)');

  // ---------- 시험 준비 (지문 기준값을 만들기 전에 priv 표를 직접 고친다) ----------
  // 4번 나라(신대륙): 군사 유닛 모두 삭제 → 육·해·공 모두 지급 (수도 칸이 비어 수도 칸에 창병)
  await db.query(`delete from priv.units where country = 4 and kind not in ('worker', 'scout')`);
  // 5번 나라(북방): 군사 유닛 모두 삭제 + 수도 칸에 전투기 1부대
  // → 공군은 이미 있어 지급 기록이 없고, 육군은 수도 칸에 군사 유닛이 있어 가장 가까운 빈 땅 칸에 지급
  await db.query(`delete from priv.units where country = 5 and kind not in ('worker', 'scout')`);
  await db.query(`insert into priv.units(id, country, kind, tile_id)
    select (select max(id) + 1 from priv.units), 5, 'fighter', (select tile_id from priv.cities where id = 'N')`);
  // 3번 나라(대륙): 수도를 바다와 닿지 않는 안쪽 땅으로 옮겨 「해안 도시가 없는 나라」로 만듦 → 해군 skipped
  const inland = (await one(`select t.id from priv.tiles t
    where t.terrain not in ('ocean', 'coast', 'mountain')
      and (t.owner is null or t.owner = 3)
      and not exists (select 1 from priv.tiles nb where priv.tdist(nb.id, t.id) = 1 and nb.terrain in ('ocean', 'coast'))
      and not exists (select 1 from priv.cities c where c.tile_id = t.id)
    order by t.id limit 1`)).id;
  ok(!!inland, '시험용 안쪽 땅 칸 찾음 (칸 ' + inland + ')');
  await db.query(`update priv.cities set tile_id = ${inland} where id = 'C'`);
  ok((await one(`select count(*)::int n from priv.cities c where c.country = 3 and exists (
    select 1 from priv.tiles t where t.terrain in ('ocean', 'coast') and priv.tdist(t.id, c.tile_id) = 1)`)).n === 0,
    '3번 나라는 해안 도시가 없음');
  // 2·4번 나라는 해안 도시국가를 차지한 상태로 만들어 해군 지급을 확인 (도시국가 옆에 바다가 있음)
  await db.query(`update priv.cities set country = 2 where id = 'J2'`);
  await db.query(`update priv.cities set country = 4 where id = 'A4'`);
  // 공장·고등 건물 데이터를 넣어 도시 배치를 확인 (시드 상태에는 공장이 없음)
  await db.query(`insert into priv.factories(country, kind) values (1, 'chipfab'), (2, 'rubberplant')`);
  await db.query(`insert into priv.advanced(country, kind) values (1, 'theater'), (3, 'theater'), (3, 'arsenal')`);

  const before = await tradeFingerprint(db);
  const first = await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  ok(equal(before, await tradeFingerprint(db)), '가져온 뒤 무역의 모든 표 지문이 그대로');
  ok(first.grants > 0 && first.facilities > 0 && first.markets === 3,
    `요약에 지급 ${first.grants}·시설 ${first.facilities}·시장 ${first.markets}이 들어 있음`);

  // ---------- 두 번 가져와도 같음 ----------
  const tables = ['game', 'countries', 'inventory', 'tiles', 'cities', 'units', 'factories', 'advanced',
    'roles', 'wallets', 'city_facilities', 'diplomacy', 'offers', 'markets', 'market_stock', 'versions', 'grants'];
  const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t =>
    [t, (await one(`select count(*)::int n from war.${t}`)).n])));
  const snapshot = async () => JSON.stringify({
    units: (await db.query('select id, country, kind, tile_id, hp, commander from war.units order by id')).rows,
    fac: (await db.query('select * from war.city_facilities order by city, kind')).rows,
    markets: (await db.query('select * from war.markets order by id')).rows,
    stock: (await db.query('select * from war.market_stock order by market, item')).rows,
    dip: (await db.query('select * from war.diplomacy order by a, b')).rows,
    grants: (await db.query('select * from war.grants order by country, branch')).rows,
    game: (await db.query('select turn, turn_seconds, paused, combat_on from war.game')).rows
  });
  const firstCounts = await counts();
  const firstSnap = await snapshot();
  const second = await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  ok(equal(before, await tradeFingerprint(db)), '두 번째 가져온 뒤에도 무역 표 지문이 그대로');
  ok(equal(firstCounts, await counts()), '두 번 가져와도 모든 war 표의 행 수가 같음');
  ok(equal(firstSnap, await snapshot()), '두 번 가져와도 병력 위치·시설 배치·시장 칸·외교·지급이 같음');
  ok(equal(first, second), '개수 요약도 두 번 같음');

  // ---------- 공장·고등 건물 배치 (설계 3-2) ----------
  ok((await one(`select count(*)::int n from war.city_facilities`)).n ===
    (await one(`select count(*)::int n from priv.factories`)).n + (await one(`select count(*)::int n from priv.advanced`)).n,
    '무역의 공장·고등 건물이 하나도 빠짐없이 war.city_facilities에 있음');
  ok((await one(`select count(*)::int n from (
      select country, kind, 'factory' class from priv.factories
      union all select country, kind, 'advanced' from priv.advanced) f
      left join war.city_facilities w on w.kind = f.kind and w.origin_country = f.country and w.class = f.class
      where w.city is null`)).n === 0, '배치된 시설의 나라·종류·분류가 무역 기록과 같음');
  ok((await one(`select count(*)::int n from war.city_facilities w
      join war.cities cap on cap.id = w.city and cap.kind = 'capital'
      where exists (select 1 from war.cities c2 where c2.country = cap.country and c2.kind <> 'capital')`)).n === 0,
    '수도 말고 도시가 있는 나라는 수도에 시설을 하나도 두지 않음');
  ok((await one(`select count(*)::int n from war.city_facilities where ruined`)).n === 0, '가져온 시설은 모두 정상');

  // ---------- 병과 지급 (설계 3-3) ----------
  ok((await one(`select count(*)::int n from war.countries c
      cross join (values ('army'), ('navy'), ('air')) b(branch)
      where not exists (select 1 from war.units u where u.country = c.id
          and coalesce(war.cfg()->'BRANCH'->>u.kind, '') = b.branch)
        and not exists (select 1 from war.grants g where g.country = c.id and g.branch = b.branch and g.result = 'skipped')`)).n === 0,
    '지급 뒤 모든 나라가 육·해·공 각 1부대 이상 (해안 도시가 없어 skipped인 경우 제외)');
  ok((await one(`select count(*)::int n from war.units where commander is null or hp <> 100`)).n === 0,
    '모든 병력의 체력이 100이고 조종 역할이 정해짐');
  // 4번 나라: 세 병과 모두 given, 창병은 수도 칸 (수도에 군사 유닛이 없었음)
  const g4 = (await db.query(`select branch, kind, unit_id, result from war.grants where country = 4 order by branch`)).rows;
  ok(g4.length === 3 && g4.every(g => g.result === 'given') &&
    g4.find(g => g.branch === 'army').kind === 'spear' && g4.find(g => g.branch === 'navy').kind === 'trireme' &&
    g4.find(g => g.branch === 'air').kind === 'fighter',
    '4번 나라는 육(창병)·해(삼단노선)·공(전투기) 모두 지급');
  ok((await one(`select u.tile_id = c.tile_id same from war.units u
      join war.grants g on g.unit_id = u.id and g.country = 4 and g.branch = 'army'
      join war.cities c on c.country = 4 and c.kind = 'capital'`)).same,
    '4번 나라 창병은 수도 칸에 지급 (수도에 군사 유닛이 없었음)');
  // 5번 나라: 육군 given (수도 칸이 전투기로 차 있어 다른 칸), 공군 기록 없음 (이미 전투기가 있음)
  ok((await one(`select u.tile_id <> c.tile_id moved, t.terrain not in ('ocean', 'coast', 'mountain') land from war.units u
      join war.grants g on g.unit_id = u.id and g.country = 5 and g.branch = 'army'
      join war.cities c on c.country = 5 and c.kind = 'capital'
      join war.tiles t on t.id = u.tile_id`)).moved &&
    (await one(`select t.terrain not in ('ocean', 'coast', 'mountain') land from war.units u
      join war.grants g on g.unit_id = u.id and g.country = 5 and g.branch = 'army'
      join war.tiles t on t.id = u.tile_id`)).land,
    '5번 나라 창병은 수도 칸 말고 가까운 빈 땅 칸에 지급');
  ok((await one(`select count(*)::int n from war.grants where country = 5 and branch = 'air'`)).n === 0,
    '5번 나라는 공군이 이미 있어 지급 기록이 없음');
  // 3번 나라: 해안 도시가 없어도 수도에서 가장 가까운 빈 바다 칸에 지급 (E2 해군 지급 A)
  const g3 = (await one(`select result, unit_id from war.grants where country = 3 and branch = 'navy'`));
  ok(g3.result === 'given', '3번 나라(해안 도시 없음) 해군도 given (해군 지급 A: 수도에서 가장 가까운 빈 바다 칸)');
  ok((await one(`select t.terrain in ('ocean', 'coast') sea from war.units u join war.tiles t on t.id = u.tile_id where u.id = ${g3.unit_id}`)).sea,
    '3번 나라 삼단노선이 바다 칸에 있음');
  ok((await one(`select u.tile_id = n.tile_id same from war.units u
      join war.cities c on c.country = 3 and c.kind = 'capital'
      join lateral (select t.id tile_id from war.tiles t where t.terrain in ('ocean', 'coast')
        and not exists (select 1 from war.units m where m.tile_id = t.id and m.kind not in ('worker', 'scout') and m.id <> u.id)
        order by priv.tdist(t.id, c.tile_id), t.id limit 1) n on true
      where u.id = ${g3.unit_id}`)).same,
    '3번 나라 삼단노선은 수도에서 가장 가까운 빈 바다 칸 (군사 유닛 없음, 번호순 동점)');
  // 지급된 병력은 규칙에 맞는 칸 (땅/바다, 군사 유닛 겹침 없음)
  ok((await one(`select count(*)::int n from war.grants g join war.units u on u.id = g.unit_id
      join war.tiles t on t.id = u.tile_id
      where g.result = 'given' and (g.branch = 'navy') <> (t.terrain in ('ocean', 'coast'))`)).n === 0,
    '지급된 병력이 땅/바다 규칙에 맞는 칸에 있음');
  ok((await one(`select count(*)::int n from (
      select tile_id from war.units where kind not in ('worker', 'scout') group by tile_id having count(*) > 1) s`)).n === 0,
    '지급 뒤에도 군사 유닛이 한 칸에 둘 이상인 곳이 없음');
  ok((await one(`select count(*)::int n from war.grants g join war.units u on u.id = g.unit_id
      where g.result = 'given' and u.commander <> g.branch`)).n === 0, '지급된 병력의 조종 역할이 병과와 같음');

  // ---------- 시장 3곳 (설계 7장) ----------
  const markets = (await db.query(`select * from war.markets order by id`)).rows;
  ok(markets.length === 3 && markets.map(m => m.id).join() === '1,2,3' &&
    new Set(markets.map(m => m.tile_id)).size === 3 &&
    markets.map(m => m.art).join() === 'neutral_village,neutral_harbor,neutral_fortress' &&
    markets.map(m => m.name).join() === '북서 마을,남쪽 항구,동쪽 성곽',
    '시장 3곳이 서로 다른 칸에 이름·그림과 함께 있음');
  ok((await one(`select count(*)::int n from war.markets m join war.tiles t on t.id = m.tile_id
      where t.terrain <> 'plains' or t.owner is not null
        or exists (select 1 from war.cities c where c.tile_id = m.tile_id)
        or exists (select 1 from war.units u where u.tile_id = m.tile_id)`)).n === 0,
    '시장 칸은 평원이고 주인·도시·병력이 없음');
  ok((await one(`select count(*)::int n from war.market_stock`)).n === 18 &&
    (await one(`select count(*)::int n from war.market_stock where qty <> 4`)).n === 0 &&
    (await one(`select count(*)::int n from (select market, count(distinct item) from war.market_stock group by market having count(distinct item) <> 6) s`)).n === 0,
    '시장 창고는 여섯 나라 특산 4개씩 (6종 × 3곳)');

  // ---------- 외교·게임 ----------
  ok((await one(`select count(*)::int n from war.diplomacy`)).n === 15 &&
    (await one(`select count(*)::int n from war.diplomacy where status <> 'peace'`)).n === 0 &&
    (await one(`select count(*)::int n from war.diplomacy where a >= b`)).n === 0,
    '외교 15쌍이 모두 peace로 시작 (a < b)');
  ok((await one(`select turn_seconds = 180 and not paused and combat_on and turn_end is null ok from war.game where id = 1`)).ok,
    '게임: 턴 180초, 일시정지 아님, 전투 켜짐, 턴 끝 시각 비움');

  // ---------- 지급 결과 표 함수 ----------
  ok(await fail(rpc(seed.students[0].uid, 'war_admin_grants'), 'NOT_ADMIN'), '학생은 지급 결과를 볼 수 없음');
  const gr = await rpc(seed.ADMIN, 'war_admin_grants');
  ok(Array.isArray(gr.grants) && gr.grants.length === (await one(`select count(*)::int n from war.grants`)).n &&
    gr.grants.every(g => ['army', 'navy', 'air'].includes(g.branch) && ['given', 'skipped'].includes(g.result)),
    '교사는 war_admin_grants로 나라별 지급 결과를 봄 (' + gr.grants.length + '행)');

  // ---------- SQL 검사: 무역 표를 만들거나 고치는 문장 없음 ----------
  const forbidden = /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|alter\s+table|drop\s+table|create\s+table(?:\s+if\s+not\s+exists)?)\s+(?:only\s+)?["']?(?:priv|public)["']?\s*\./ig;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const source = readFileSync(new URL(file, dir), 'utf8').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
    ok([...source.matchAll(forbidden)].length === 0, `${file}: 무역 표를 만들거나 변경하는 SQL이 없음`);
  }
} catch (e) {
  ctx.ok(false, '예외: ' + e.message);
}
ctx.summary();
