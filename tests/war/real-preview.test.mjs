import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';
import { stateFromWar } from '../../tools/war/state-from-war.mjs';
import { convert } from '../../tools/war/make-real-preview.mjs';

const ctx = await createDb();
try {
  const { db, rpc } = ctx;
  const { ADMIN, students } = await seedTradeState(ctx);
  for (const f of ['schema.sql', 'config.sql', 'functions.sql']) {
    await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
  }
  await db.exec(`update priv.cities set country = 1 where id = (
    select id from priv.cities where final and not rebel order by id limit 1)`);
  assert.ok((await db.query(`select tile_id from priv.units where kind not in ('worker', 'scout')
    group by tile_id having count(*) >= 2`)).rows.length > 0);
  const exp = JSON.parse(JSON.stringify(await rpc(ADMIN, 'admin_export')));
  await rpc(ADMIN, 'war_admin_import', '초기화');
  const expected = await stateFromWar(db);
  const actual = await convert(exp);
  assert.deepStrictEqual(actual, expected);
  console.log('  ✓ 실제 백업 모양의 변환 결과가 같은 DB의 W1 결과와 같음');
  const serialized = JSON.stringify(actual);
  assert.ok(!serialized.includes('"students"'));
  for (const s of students) assert.ok(!serialized.includes('별' + s.id));
  console.log('  ✓ 학생 키와 닉네임이 없음');
  const wrongCity = structuredClone(exp);
  wrongCity.cities[0].tile_id += 1;
  await assert.rejects(convert(wrongCity), /지도 버전이 달라요/);
  const wrongTile = structuredClone(exp);
  (wrongTile.tiles ??= []).push([99999, 1, null]);
  await assert.rejects(convert(wrongTile), /지도 버전이 달라요/);
  console.log('  ✓ 도시 위치와 없는 칸의 지도 버전 오류');
} finally {
  await ctx.db.close();
}
console.log('전체 통과');
