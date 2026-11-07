// E3 시험: 이동(war_move)·지휘권 넘기기(war_transfer)·한 칸 한 유닛·역할 검사
// PGlite는 연결이 하나라 진짜 동시 실행은 시험할 수 없다. 설치 후 웨일북 2대로 확인한다.
// 실행: node tests/war/e3.test.mjs  (또는 npm run test:war:e3)
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
  const of = c => seed.students.filter(s => s.country_id === c);
  const [chief, engineer, army, navy, air] = of(1);
  const chief4 = of(2)[0];
  for (const [s, role] of [[chief, 'chief'], [engineer, 'engineer'], [army, 'army'], [navy, 'navy'], [air, 'air'], [chief4, 'chief']]) {
    await db.query(`insert into war.roles(student, country, role) values ($1, $2, $3)`, [s.id, s.country_id, role]);
  }

  const u1 = await q1(`select id, country, tile_id from war.units where country = 1 and kind = 'spear' order by id limit 1`);
  const fighter = await q1(`select id from war.units where country = 1 and kind = 'fighter' order by id limit 1`);
  const worker1 = await q1(`select id from war.units where country = 1 and kind = 'worker' order by id limit 1`);
  const enemyU = await q1(`select u.id, u.country, u.tile_id from war.units u where u.country = 2 and u.kind not in ('worker', 'scout')
    and u.tile_id is not null and not exists (select 1 from war.cities c where c.tile_id = u.tile_id) order by u.id limit 1`);
  ok(!!u1 && !!fighter && !!worker1 && !!enemyU, '준비: 육군 병력·전투기(지급)·노동자·다른 나라 병력(도시 밖)');

  // 산·바다·빈 땅이 모두 옆에 있는 칸으로 출발
  const X = await q1(`select t.id from war.tiles t
    where t.terrain not in ('ocean', 'coast', 'mountain')
      and not exists (select 1 from war.cities c where c.tile_id = t.id)
      and not exists (select 1 from war.units u where u.tile_id = t.id)
      and not exists (select 1 from war.markets m where m.tile_id = t.id)
      and exists (select 1 from war.tiles m where m.terrain = 'mountain' and priv.tdist(m.id, t.id) = 1)
      and exists (select 1 from war.tiles o where o.terrain in ('ocean', 'coast') and priv.tdist(o.id, t.id) = 1)
      and exists (select 1 from war.tiles e where e.terrain not in ('ocean', 'coast', 'mountain')
        and priv.tdist(e.id, t.id) = 1
        and not exists (select 1 from war.cities c2 where c2.tile_id = e.id)
        and not exists (select 1 from war.units u2 where u2.tile_id = e.id)
        and not exists (select 1 from war.markets mk where mk.tile_id = e.id))
    order by t.id limit 1`);
  ok(!!X, '준비: 산·바다·빈 땅이 옆에 있는 출발 칸 (칸 ' + (X || {}).id + ')');
  const M = await q1(`select id from war.tiles where terrain = 'mountain' and priv.tdist(id, $1) = 1 limit 1`, X.id);
  const O = await q1(`select id from war.tiles where terrain in ('ocean', 'coast') and priv.tdist(id, $1) = 1 limit 1`, X.id);
  const E = await q1(`select id from war.tiles t where t.terrain not in ('ocean', 'coast', 'mountain')
    and priv.tdist(t.id, $1) = 1
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.units u where u.tile_id = t.id)
    and not exists (select 1 from war.markets m where m.tile_id = t.id) limit 1`, X.id);
  await db.query(`select war.place_unit($1, $2)`, [u1.id, X.id]);
  await db.query(`update war.units set moves_left = 3 where id = $1`, [u1.id]);

  // 이동 성공: 남은 이동력 줄어듦
  const mv = await ctx.rpc(army.uid, 'war_move', u1.id, [E.id]);
  ok(mv.ok && mv.tile === E.id && mv.moves_left === 2, '육군 병력을 빈 땅으로 이동 성공, 남은 이동력 3 → 2');
  ok((await q1(`select moves_left from war.units where id = $1`, u1.id)).moves_left === 2, 'DB에도 남은 이동력이 줄어듦');

  // 산·바다 거절 (출발 칸으로 되돌려 옆 칸 검사)
  await db.query(`select war.place_unit($1, $2)`, [u1.id, X.id]);
  await db.query(`update war.units set moves_left = 3 where id = $1`, [u1.id]);
  ok(await fail(ctx.rpc(army.uid, 'war_move', u1.id, [M.id]), 'BAD_TILE'), '산으로 가는 경로 거절');
  ok(await fail(ctx.rpc(army.uid, 'war_move', u1.id, [O.id]), 'BAD_TILE'), '바다로 가는 경로 거절');

  // 이동력보다 긴 경로 거절
  await db.query(`update war.units set moves_left = 1 where id = $1`, [u1.id]);
  ok(await fail(ctx.rpc(army.uid, 'war_move', u1.id, [E.id, X.id]), 'NO_MOVES'), '이동력보다 긴 경로 거절 (NO_MOVES)');
  // 이어지지 않은 경로 거절
  await db.query(`update war.units set moves_left = 3 where id = $1`, [u1.id]);
  const far = await q1(`select id from war.tiles where priv.tdist(id, $1) >= 2 and terrain not in ('ocean', 'coast') limit 1`, E.id);
  ok(await fail(ctx.rpc(army.uid, 'war_move', u1.id, [E.id, far.id]), 'BAD_PATH'), '이어지지 않은 경로 거절');

  // 다른 나라 병력 칸 통과: 땅 유닛 거절 / 공군은 통과 가능
  const nearEnemy = await q1(`select t.id from war.tiles t
    where t.terrain not in ('ocean', 'coast', 'mountain') and priv.tdist(t.id, $1) = 1
      and not exists (select 1 from war.cities c where c.tile_id = t.id)
      and not exists (select 1 from war.units u where u.tile_id = t.id)
      and not exists (select 1 from war.markets m where m.tile_id = t.id)
    order by t.id limit 1`, enemyU.tile_id);
  const pastEnemy = await q1(`select t.id from war.tiles t
    where t.terrain not in ('ocean', 'coast', 'mountain') and priv.tdist(t.id, $1) = 1 and t.id <> $2
      and not exists (select 1 from war.cities c where c.tile_id = t.id)
      and not exists (select 1 from war.units u where u.tile_id = t.id)
      and not exists (select 1 from war.markets m where m.tile_id = t.id)
    order by t.id limit 1`, enemyU.tile_id, nearEnemy.id);
  ok(!!nearEnemy && !!pastEnemy, '준비: 다른 나라 병력 옆·그 너머 칸');
  await db.query(`select war.place_unit($1, $2)`, [u1.id, nearEnemy.id]);
  await db.query(`update war.units set moves_left = 5 where id = $1`, [u1.id]);
  ok(await fail(ctx.rpc(army.uid, 'war_move', u1.id, [enemyU.tile_id, pastEnemy.id]), 'BLOCKED'),
    '다른 나라 병력이 있는 칸을 지나가는 땅 유닛 경로 거절');
  await db.query(`select war.place_unit($1, $2)`, [u1.id, X.id]);   // 자리 비우고 공군을 적군 옆에
  await db.query(`select war.place_unit($1, $2)`, [fighter.id, nearEnemy.id]);
  const airMv = await ctx.rpc(air.uid, 'war_move', fighter.id, [enemyU.tile_id, pastEnemy.id]);
  ok(airMv.ok && airMv.tile === pastEnemy.id, '공군은 다른 나라 병력 위를 지나갈 수 있음');
  ok((await q1(`select moves_left from war.units where id = $1`, fighter.id)).moves_left === 4, '공군 이동력도 줄어듦');

  // 공군이 바다 위에 멈추면 거절
  const coastLand = await q1(`select t.id from war.tiles t where t.terrain not in ('ocean', 'coast', 'mountain')
    and exists (select 1 from war.tiles o where o.terrain in ('ocean', 'coast') and priv.tdist(o.id, t.id) = 1)
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.units u where u.tile_id = t.id)
    and not exists (select 1 from war.markets m where m.tile_id = t.id) order by t.id limit 1`);
  const oceanNear = await q1(`select id from war.tiles where terrain in ('ocean', 'coast') and priv.tdist(id, $1) = 1 limit 1`, coastLand.id);
  await db.query(`select war.place_unit($1, $2)`, [fighter.id, coastLand.id]);
  ok(await fail(ctx.rpc(air.uid, 'war_move', fighter.id, [oceanNear.id]), 'BAD_STOP'), '공군이 바다 칸에서 멈추면 거절');

  // 다른 나라 도시 칸 거절
  const capJ = (await q1(`select tile_id from war.cities where id = 'J'`)).tile_id;
  const nearJ = await q1(`select t.id from war.tiles t where t.terrain not in ('ocean', 'coast', 'mountain')
    and priv.tdist(t.id, $1) = 1
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind not in ('worker', 'scout'))
    order by t.id limit 1`, capJ);
  await db.query(`select war.place_unit($1, $2)`, [u1.id, nearJ.id]);
  await db.query(`update war.units set moves_left = 3 where id = $1`, [u1.id]);
  ok(await fail(ctx.rpc(army.uid, 'war_move', u1.id, [capJ]), 'NO_ENTRY'), '다른 나라 도시 칸으로 들어가기 거절');

  // 시장 칸 거절 (공군을 시장 옆 바다 칸에 두고 시도)
  const mTile = (await q1(`select tile_id from war.markets order by id limit 1`)).tile_id;
  const seaNearM = await q1(`select t.id from war.tiles t where t.terrain in ('ocean', 'coast')
    and priv.tdist(t.id, $1) = 1 and not exists (select 1 from war.units u where u.tile_id = t.id) limit 1`, mTile);
  await db.query(`select war.place_unit($1, $2)`, [fighter.id, seaNearM.id]);
  ok(await fail(ctx.rpc(air.uid, 'war_move', fighter.id, [mTile]), 'NO_ENTRY'), '시장 칸으로 들어가기 거절');

  // 다른 역할·다른 나라 거절
  ok(await fail(ctx.rpc(navy.uid, 'war_move', u1.id, [E.id]), 'ROLE_ONLY'), '다른 역할(해군 참모총장)이 육군 병력 이동 거절');
  ok(await fail(ctx.rpc(chief4.uid, 'war_move', u1.id, [E.id]), 'NOT_MINE'), '다른 나라 병력 이동 거절');

  // 결석 대행: 육군 참모총장이 결석하면 합참의장이 이동 가능
  await db.query(`update war.roles set absent = true where country = 1 and role = 'army'`);
  const curTile = (await q1(`select tile_id from war.units where id = $1`, u1.id)).tile_id;
  const stepE = await q1(`select t.id from war.tiles t where t.terrain not in ('ocean', 'coast', 'mountain')
    and priv.tdist(t.id, $1) = 1
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.units u where u.tile_id = t.id)
    and not exists (select 1 from war.markets m where m.tile_id = t.id) limit 1`, curTile);
  await db.query(`update war.units set moves_left = 3 where id = $1`, [u1.id]);
  const deputyMv = await ctx.rpc(chief.uid, 'war_move', u1.id, [stepE.id]);
  ok(deputyMv.ok && deputyMv.tile === stepE.id, '결석 대행: 합참의장이 육군 병력 이동');

  // 공병사령관이 노동자를 2칸 이동
  const chain = await q1(`select x.id x_id, a.id a_id, b.id b_id from war.tiles x
    join war.tiles a on priv.tdist(a.id, x.id) = 1 and a.terrain not in ('ocean', 'coast', 'mountain')
    join war.tiles b on priv.tdist(b.id, a.id) = 1 and b.terrain not in ('ocean', 'coast', 'mountain') and b.id <> x.id
    where not exists (select 1 from war.cities c where c.tile_id in (x.id, a.id, b.id))
      and not exists (select 1 from war.units u where u.tile_id in (x.id, a.id, b.id))
      and not exists (select 1 from war.markets m where m.tile_id in (x.id, a.id, b.id))
    order by x.id limit 1`);
  ok(!!chain, '준비: 빈 땅 3칸 연결');
  await db.query(`select war.place_unit($1, $2)`, [worker1.id, chain.x_id]);
  const wmv = await ctx.rpc(engineer.uid, 'war_move', worker1.id, [chain.a_id, chain.b_id]);
  ok(wmv.ok && wmv.tile === chain.b_id && wmv.moves_left === 0, '공병사령관이 노동자를 2칸 이동 (이동력 2 → 0)');

  // 지휘권 넘기기: 육군 → 해군
  await db.query(`update war.units set moves_left = 3 where id = $1`, [u1.id]);
  const tr = await ctx.rpc(army.uid, 'war_transfer', u1.id, 'navy');
  ok(tr.ok && tr.commander === 'navy', '지휘권 넘기기: 육군 → 해군');
  ok((await q1(`select commander, kind, moves_left from war.units where id = $1`, u1.id)).commander === 'navy',
    '병력 종류·이동력은 그대로, 조종 역할만 바뀜');
  const after = await q1(`select tile_id from war.units where id = $1`, u1.id);
  const stepBack = await q1(`select t.id from war.tiles t where t.terrain not in ('ocean', 'coast', 'mountain')
    and priv.tdist(t.id, $1) = 1
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.units u where u.tile_id = t.id)
    and not exists (select 1 from war.markets m where m.tile_id = t.id) limit 1`, after.tile_id);
  ok(await fail(ctx.rpc(army.uid, 'war_move', u1.id, [stepBack.id]), 'ROLE_ONLY'), '넘긴 뒤 육군 참모총장은 못 움직임');
  const navyMv = await ctx.rpc(navy.uid, 'war_move', u1.id, [stepBack.id]);
  ok(navyMv.ok && navyMv.tile === stepBack.id, '넘긴 뒤 해군 참모총장은 움직임');
  // 같은 병과·없는 병과·노동자 거절
  ok(await fail(ctx.rpc(navy.uid, 'war_transfer', u1.id, 'navy'), 'SAME_BRANCH'), '같은 참모총장에게 넘기기 거절');
  ok(await fail(ctx.rpc(navy.uid, 'war_transfer', u1.id, 'foot'), 'BAD_BRANCH'), '없는 병과 거절');
  ok(await fail(ctx.rpc(engineer.uid, 'war_transfer', worker1.id, 'navy'), 'NOT_MILITARY'), '노동자 넘기기 거절');

  // 일시정지면 이동 거절
  await db.query(`update war.game set paused = true`);
  ok(await fail(ctx.rpc(navy.uid, 'war_move', u1.id, [after.tile_id]), 'PAUSED'), '일시정지면 이동 거절');
  await db.query(`update war.game set paused = false`);
} catch (e) {
  ctx.ok(false, '예외: ' + (e.stack ? e.stack.split('\n')[0] : e.message));
}
ctx.summary();
