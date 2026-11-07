// PGlite는 연결이 하나라 진짜 동시 실행은 시험할 수 없다. 설치 후 웨일북 2대로 확인한다.
// 한 칸 한 유닛 유일 조건 + war.place_unit 시험 (G1)
// 실행: node tests/war/place.test.mjs  (또는 npm run test:war:place)
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx);
  const { db, ok, fail } = ctx;
  const q1 = async (sql, ...p) => (await db.query(sql, p)).rows[0];
  for (const f of ['schema.sql', 'config.sql', 'functions.sql']) {
    await db.exec(readFileSync(new URL('../../supabase/war/' + f, import.meta.url), 'utf8'));
  }
  await ctx.rpc(seed.ADMIN, 'war_admin_import', '초기화');
  // 1. 두 번 가져오기
  await ctx.rpc(seed.ADMIN, 'war_admin_import', '초기화');
  ok(true, '가져오기를 두 번 해도 오류가 없음');
  // 2. 겹침 없음
  ok((await q1(`select count(*)::int n from (select tile_id from war.units
      where tile_id is not null and kind not in ('worker', 'scout') group by tile_id having count(*) > 1) s`)).n === 0,
    '가져온 뒤 같은 칸에 군사 유닛 2개 이상인 칸 0곳');
  ok((await q1(`select count(*)::int n from (select tile_id from war.units
      where tile_id is not null and kind in ('worker', 'scout') group by tile_id having count(*) > 1) s`)).n === 0,
    '가져온 뒤 같은 칸에 민간 유닛 2개 이상인 칸 0곳');

  const emptyLand = async () => (await q1(`select t.id from war.tiles t
    where t.terrain not in ('ocean', 'coast', 'mountain')
    and not exists (select 1 from war.units u where u.tile_id = t.id)
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    order by t.id limit 1`)).id;
  const spear = await q1(`select id, country, tile_id from war.units where kind = 'spear' order by id limit 1`);

  // 3. place_unit 성공
  const empty1 = await emptyLand();
  await db.query(`select war.place_unit($1, $2)`, [spear.id, empty1]);
  ok((await q1(`select tile_id from war.units where id = $1`, spear.id)).tile_id === empty1,
    'war.place_unit(병력, 빈 땅 칸) 성공 → 병력 칸이 바뀜');

  // 4. 다른 나라 군사 유닛 칸 → TILE_TAKEN (민간 자리가 비친 군사 칸을 골라 노동자 배치도 확인)
  const enemy = await q1(`select u.id, u.tile_id from war.units u
    where u.country <> $1 and u.kind not in ('worker', 'scout') and u.tile_id is not null
      and not exists (select 1 from war.units w2 where w2.tile_id = u.tile_id and w2.kind in ('worker', 'scout'))
    order by u.id limit 1`, spear.country);
  ok(await fail(db.query(`select war.place_unit($1, $2)`, [spear.id, enemy.tile_id]), 'TILE_TAKEN'),
    '다른 나라 군사 유닛이 있는 칸 → TILE_TAKEN');
  ok(await fail(db.query(`select war.place_unit($1, $2)`, [spear.id, enemy.tile_id]), '먼저 온 병력이 있어요'),
    '오류에 쉬운 말 안내가 들어 있음');
  ok((await q1(`select tile_id from war.units where id = $1`, spear.id)).tile_id === empty1,
    '막힌 병력의 칸은 그대로');

  // 5. 군사 칸에 노동자 → 성공 (군사 1 + 민간 1)
  const worker = await q1(`select id from war.units where kind = 'worker' and country = $1 order by id limit 1`, spear.country);
  await db.query(`select war.place_unit($1, $2)`, [worker.id, enemy.tile_id]);
  ok((await q1(`select tile_id from war.units where id = $1`, worker.id)).tile_id === enemy.tile_id,
    '군사 유닛이 있는 칸에 노동자 배치 성공 (군사 1 + 민간 1)');

  // 6. 민간 칸에 노동자 하나 더 → TILE_TAKEN (나라마다 노동자가 한 명이라 다른 나라 노동자를 씀)
  const worker2 = await q1(`select id from war.units where kind = 'worker' and id <> $1 order by id limit 1`, worker.id);
  ok(await fail(db.query(`select war.place_unit($1, $2)`, [worker2.id, enemy.tile_id]), 'TILE_TAKEN'),
    '노동자가 있는 칸에 다른 노동자 → TILE_TAKEN');

  // 7. 없는 병력
  ok(await fail(db.query(`select war.place_unit($1, $2)`, [999999, empty1]), 'NO_UNIT'), '없는 병력 번호 → NO_UNIT');

  // 8. 직접 insert로 같은 칸에 군사 유닛 하나 더 → DB가 거절
  ok(await fail(db.query(`insert into war.units(id, country, kind, tile_id, hp)
      select 999999, country, kind, tile_id, 100 from war.units
      where kind not in ('worker', 'scout') and tile_id is not null order by id limit 1`), 'war_units_one_military'),
    '직접 insert로 같은 칸에 군사 유닛을 하나 더 넣으면 DB가 거절함 (war_units_one_military)');
} catch (e) {
  ctx.ok(false, '예외: ' + e.message);
}
ctx.summary();
