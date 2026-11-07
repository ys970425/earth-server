import { readFileSync, readdirSync } from 'node:fs';
import { createDb, seedTradeState, tradeFingerprint } from './helpers.mjs';

const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx);
  const { db, one, ok, rpc, fail } = ctx;
  const dir = new URL('../../supabase/war/', import.meta.url);
  const sql = ['schema.sql', 'config.sql', 'functions.sql'].map(f => readFileSync(new URL(f, dir), 'utf8'));
  for (let i = 0; i < 2; i++) for (const source of sql) await db.exec(source);
  ok(true, '전쟁 SQL을 두 번 설치해도 안전함');
  const finalCity = await one(`select id from priv.cities where final and not rebel order by id limit 1`);
  await db.query(`update priv.cities set country = 1 where id = $1`, [finalCity.id]);
  await db.query(`update priv.units set tile_id = (
    select c.tile_id from priv.cities c join priv.tiles t on t.id = c.tile_id
    where c.country is null and not c.rebel and not c.boss and not c.final
      and t.terrain not in ('ocean', 'coast', 'mountain') order by c.id limit 1)
    where id = (select id from priv.units where country = 1
      and kind not in ('worker', 'scout')
      and not coalesce((priv.cfg()->'UNITS'->kind->>'sea')::boolean, false)
      order by id limit 1)`);
  const before = await tradeFingerprint(db);
  const first = await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const afterFirst = await tradeFingerprint(db);
  const counts = async () => {
    const result = {};
    for (const name of ['game', 'countries', 'inventory', 'tiles', 'cities', 'units', 'factories', 'advanced']) {
      result[name] = (await one(`select count(*)::int n from war.${name}`)).n;
    }
    return result;
  };
  const firstCounts = await counts();
  const positions = (await db.query('select id, tile_id from war.units order by id')).rows;
  const second = await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const afterSecond = await tradeFingerprint(db);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(equal(before, afterFirst) && equal(before, afterSecond), '두 번 가져온 뒤에도 무역의 모든 표 지문이 같음');
  ok(first.countries === 6 && first.tiles === 1120, '나라 6개와 지도 칸 1120개를 가져옴');
  ok(first.units === (await one('select count(*)::int n from priv.units')).n +
    (await one(`select count(*)::int n from war.grants where result = 'given'`)).n,
    '무역의 모든 병력 + 병과 지급 병력을 가져옴');
  ok(equal(firstCounts, await counts()), '두 번 가져와도 모든 전쟁 표의 행 수가 같음');
  ok(equal(first, second) && equal(positions, (await db.query('select id, tile_id from war.units order by id')).rows), '재배치 위치와 개수 요약이 결정적임');
  for (const civilian of [false, true]) {
    ok((await one(`select count(*)::int n from (
      select tile_id from war.units where (kind in ('worker','scout')) = ${civilian}
      group by tile_id having count(*) > 1) s`)).n === 0,
    `${civilian ? '민간' : '군사'} 유닛이 한 칸에 둘 이상인 곳이 없음`);
  }
  ok((await one(`select count(*)::int n from war.units u left join war.tiles t on t.id = u.tile_id
    where t.id is null or case when coalesce((priv.cfg()->'UNITS'->u.kind->>'sea')::boolean, false)
      then t.terrain not in ('ocean','coast') else t.terrain in ('ocean','coast','mountain') end`)).n === 0,
  '모든 병력이 바다·땅·산 규칙에 맞는 칸에 있음');
  ok((await one(`select count(*)::int n from war.units u join war.cities c on c.tile_id = u.tile_id
    where not coalesce((priv.cfg()->'UNITS'->u.kind->>'sea')::boolean, false)
      and c.country is distinct from u.country`)).n === 0,
  '땅 유닛이 자기 나라가 아닌 도시 칸(주인 없는 도시 포함)에 있는 경우 0개');
  ok((await one('select count(*)::int n from war.units where hp <> 100')).n === 0, '모든 병력의 체력이 100임');
  ok(first.moved_units > 0, '겹친 병력이 실제로 이동함');
  ok(await fail(rpc(seed.students[0].uid, 'war_admin_import', '초기화'), 'NOT_ADMIN'), '학생은 가져오기를 실행할 수 없음');
  for (const confirm of ['다시', null, '초기화 ']) {
    ok(await fail(rpc(seed.ADMIN, 'war_admin_import', confirm), '초기화'), '교사도 정확한 확인 문구가 필요함');
  }
  const city = (await db.query(`select w.*, s.name = w.name and s.buildings = w.buildings preserved,
    (priv.cfg()->'CS_TIERS'->w.tier->>'def')::int expected_def,
    (priv.cfg()->'CS_TIERS'->w.tier->>'hp')::int expected_hp
    from war.cities w join priv.cities s using(id) where w.id = $1`, [finalCity.id])).rows[0];
  ok(city && !city.final && !city.boss && city.country === 1 && city.tier <= 4 && city.preserved &&
    city.def === city.expected_def && city.max_hp === city.expected_hp && city.hp === city.max_hp,
  '점령한 최종 도시는 이름·주인·건물을 유지하고 일반 도시 수치로 바뀜');
  ok((await one(`select count(*)::int n from war.cities w join priv.cities s using(id)
    where s.rebel or ((s.boss or s.final) and s.country is null)`)).n === 0,
  '주인 없는 특수 도시와 모든 반란 도시는 제외됨');
  ok(equal(firstCounts, await counts()) && equal(before, await tradeFingerprint(db)), '거절된 요청은 전쟁·무역 데이터를 바꾸지 않음');
  const forbidden = /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|alter\s+table|drop\s+table|create\s+table(?:\s+if\s+not\s+exists)?)\s+(?:only\s+)?["']?(?:priv|public)["']?\s*\./ig;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const source = readFileSync(new URL(file, dir), 'utf8').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
    ok([...source.matchAll(forbidden)].length === 0, `${file}: 무역 표를 만들거나 변경하는 SQL이 없음`);
  }
} catch (e) {
  ctx.ok(false, '예외: ' + e.message);
}
ctx.summary();
