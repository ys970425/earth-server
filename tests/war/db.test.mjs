// 전쟁 버전 W0 점검: PGlite 테스트 틀이 잘 준비되었는지 확인한다
// 실행: node tests/war/db.test.mjs  (또는 npm run test:war)
import { createDb, seedTradeState, tradeFingerprint } from './helpers.mjs';

const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx);
  const { db, one, ok } = ctx;

  // a. 나라 6개, 학생 25명 모두 기기 연결됨
  ok((await one(`select count(*)::int n from priv.countries`)).n === 6, '나라 6개');
  ok((await one(`select count(*)::int n from priv.students`)).n === 25, '학생 명단 25명');
  ok((await one(`select count(*)::int n from priv.students where uid is not null`)).n === 25, '학생 25명 모두 기기 연결됨');

  // b. 점령된 도시국가 1곳 이상
  ok((await one(`select count(*)::int n from priv.cities where kind = 'cs' and country is not null`)).n >= 1, '점령한 도시국가 1곳 이상');

  // c. 같은 칸에 군사 유닛(worker, scout 제외) 2개 이상 있는 칸 1곳 이상
  const stack = await one(`select tile_id, count(*)::int n from priv.units where kind not in ('worker', 'scout')
    group by tile_id having count(*) >= 2 order by n desc, tile_id limit 1`);
  ok(!!stack, `같은 칸에 군사 유닛 2개 이상인 칸 있음 (칸 ${stack ? stack.tile_id : '-'}에 ${stack ? stack.n : 0}개)`);

  // d. 무역 표 지문(fingerprint): 두 번 만들면 같고, 한 행을 바꾸면 그 표의 값만 달라짐
  const fp1 = await tradeFingerprint(db);
  const fp2 = await tradeFingerprint(db);
  const same = Object.keys(fp1).length === Object.keys(fp2).length && Object.keys(fp1).every(k => fp1[k] === fp2[k]);
  ok(same, `tradeFingerprint를 두 번 만들면 완전히 같음 (표 ${Object.keys(fp1).length}개)`);
  // priv.units의 한 행을 바꿔 본다 (검사 뒤 원래대로 되돌림)
  const u = await one(`select id, moves_left from priv.units order by id limit 1`);
  await db.query(`update priv.units set moves_left = $1 where id = $2`, [u.moves_left + 1, u.id]);
  const fp3 = await tradeFingerprint(db);
  const diff = Object.keys(fp1).filter(k => fp1[k] !== fp3[k]);
  ok(diff.length === 1 && diff[0] === 'units', `한 행을 바꾸면 units 표의 지문만 달라짐 (달라진 표: ${diff.join(', ') || '없음'})`);
  await db.query(`update priv.units set moves_left = $1 where id = $2`, [u.moves_left, u.id]);
  const fp4 = await tradeFingerprint(db);
  ok(Object.keys(fp1).every(k => fp1[k] === fp4[k]), '되돌리면 지문도 원래대로');
} catch (e) {
  ctx.ok(false, '예외: ' + e.message);
}
ctx.summary();
