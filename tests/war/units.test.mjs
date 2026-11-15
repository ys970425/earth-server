// 병과 개편 시험: 유닛 데이터·대응표·생산 재고·미사일 소멸·원거리 사거리
// 실행: node tests/war/units.test.mjs  (또는 npm run test:war:units)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../../app/war/js/war-rules.js');

const ctx = {
  results: [], fails: 0,
  ok(c, m) { this.results.push(c); console.log(`  ${c ? '✔' : '✘'} ${m}`); if (!c) this.fails++; }
};

// --- 1. 유닛 데이터 검증 (war-rules.js) ---
const expect = {
  spear:       { name: '창병', branch: 'army', atk: 4, def: 4, move: 2 },
  catapult:    { name: '투석기', branch: 'army', atk: 5, def: 2, move: 1, range: 2 },
  mech_inf:    { name: '기계화 보병', branch: 'army', atk: 5, def: 6, move: 3 },
  tank_modern: { name: '현대 전차', branch: 'army', atk: 7, def: 5, move: 3 },
  destroyer:   { name: '구축함', branch: 'navy', atk: 6, def: 5, move: 4, sea: true },
  battleship:  { name: '전함', branch: 'navy', atk: 7, def: 6, move: 3, range: 2, sea: true },
  helicopter:  { name: '전투 헬기', branch: 'air', atk: 6, def: 4, move: 4, fly: true },
  drone:       { name: '살상용 드론', branch: 'air', atk: 5, def: 2, move: 5, fly: true },
  missile:     { name: '유도미사일', branch: 'air', atk: 4, def: 0, move: 0, range: 3, fly: true, oneTime: true }
};
for (const [k, e] of Object.entries(expect)) {
  const u = W.UNITS[k];
  ctx.ok(!!u, `${e.name} 종류 존재`);
  if (!u) continue;
  for (const field of ['atk', 'def', 'move']) {
    ctx.ok(u[field] === e[field], `${e.name} ${field}=${u[field]} (기대 ${e[field]})`);
  }
  if (e.range) ctx.ok(u.range === e.range, `${e.name} range=${u.range} (기대 ${e.range})`);
  if (e.sea) ctx.ok(u.sea === true, `${e.name} sea`);
  if (e.fly) ctx.ok(u.fly === true, `${e.name} fly`);
  if (e.oneTime) ctx.ok(u.oneTime === true, `${e.name} oneTime (쏘면 사라짐)`);
  ctx.ok(u.branch === e.branch, `${e.name} branch=${u.branch}`);
  ctx.ok(!!u.cost && Object.keys(u.cost).length > 0, `${e.name} 비용 있음`);
}

// --- 2. 특수부대: 공격 7·방어 5 ---
const bossKinds = ['k_missile', 'j_patrol', 'c_jet', 'a_stealth', 'n_hyper', 't_marine'];
for (const k of bossKinds) {
  const u = W.UNITS[k];
  ctx.ok(!!u && u.atk === 7 && u.def === 5, `${u?.name || k} 공격 7·방어 5`);
  ctx.ok(!!u?.boss, `${u?.name || k} boss 유지`);
}

// --- 3. KIND_MAP: 기존 무역 앱 유닛 전부 대응 ---
const tradeRequire = createRequire(import.meta.url);
const R = tradeRequire('../../app/trade/js/rules.js');
const oldKinds = Object.keys(R.UNITS);
const missing = oldKinds.filter(k => !W.KIND_MAP[k]);
ctx.ok(missing.length === 0, `KIND_MAP이 기존 ${oldKinds.length}종 전부 커버 (빠진 것: ${missing.join(',') || '없음'})`);
// 매핑 대상이 새 UNITS에 존재
const badTarget = oldKinds.filter(k => W.KIND_MAP[k] && !W.UNITS[W.KIND_MAP[k]]);
ctx.ok(badTarget.length === 0, `매핑 대상이 모두 새 UNITS에 존재 (잘못된 것: ${badTarget.join(',') || '없음'})`);

// --- 4. 병과별 유닛 목록 ---
ctx.ok(W.BRANCH_UNITS.army.includes('spear'), 'BRANCH_UNITS.army에 창병');
ctx.ok(W.BRANCH_UNITS.navy.includes('destroyer'), 'BRANCH_UNITS.navy에 구축함');
ctx.ok(W.BRANCH_UNITS.air.includes('drone'), 'BRANCH_UNITS.air에 드론');
ctx.ok(W.BRANCH_UNITS.civil.includes('worker'), 'BRANCH_UNITS.civil에 노동자');

// --- 5. 이동력·원거리 판정 함수 ---
ctx.ok(W.MOVES_OF('spear') === 2, '창병 이동력 2');
ctx.ok(W.MOVES_OF('missile') === 0, '유도미사일 이동력 0');
ctx.ok(W.unitIsRanged('catapult') === true, '투석기는 원거리');
ctx.ok(W.unitIsRanged('spear') === false, '창병은 근접');
ctx.ok(W.unitIsAir('helicopter') === true, '전투 헬기는 공군');
ctx.ok(W.unitIsSea('destroyer') === true, '구축함은 해군');

// --- 6. DB 시험: 생산 재고 차감·부족 막힘·미사일 소멸·원거리 사거리 ---
const { createRequire: cr } = { createRequire: null };
const req = (await import('node:module')).createRequire(import.meta.url);
const { createDb, seedTradeState } = await import('./helpers.mjs');
const testCtx = await createDb();
try {
  const { db, rpc, one } = testCtx;
  const ok = (c, m) => ctx.ok(c, m);
  const fail = async (p, code) => { try { await p; return false; } catch (e) { return !code || e.message.includes(code); } };
  const seed = await seedTradeState(testCtx);
  for (const f of ['schema', 'config', 'functions']) {
    await db.exec(readFileSync(new URL(`../../supabase/war/${f}.sql`, import.meta.url), 'utf8'));
  }
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');

  const [chief1] = seed.students.filter(s => s.country_id === 1);
  await db.query(`insert into war.roles(student,country,role) values ($1,1,'chief')`, [chief1.id]);
  await db.query(`update war.game set turn=10, paused=false, combat_on=true`);

  // 나라 1 지갑에 자원 충분히 넣기 (육군 = army 지갑)
  // 나라 1 지갑에 자원 충분히 넣기 (모든 역할 지갑에 넣어 어느 곳이 쓰이는지 관계없이 통과하게)
  await db.query(`insert into war.wallets(country, role, item, qty)
    select 1, r, i, 1000 from unnest(array['army','navy','air','chief','engineer']) r, unnest(array['coin','wood','iron','steel','tire','fuel','rubber','chip','rare','engine']) i
    on conflict (country,role,item) do update set qty = 1000`);

  // 병력 위치: 수도 옆 빈 땅 찾기
  const cap1 = await one(`select tile_id from war.cities where country = 1 and kind = 'capital'`);
  const nearTile = await one(`select t.id from war.tiles t where t.terrain = 'plains' and t.id != ${cap1.tile_id}
    and priv.tdist(t.id, ${cap1.tile_id}) = 1
    and not exists (select 1 from war.units u where u.tile_id = t.id)
    and not exists (select 1 from war.cities c where c.tile_id = t.id) limit 1`);

  // 생산: 창병 만들기 → 지갑에서 코인·목재·철광석 차감
  const cap1City = await one(`select id, tile_id from war.cities where country = 1 and kind = 'capital'`);
  // 병영이 있어야 육군 생산 가능
  await db.query(`update war.cities set buildings = array_append(buildings, 'barracks') where id = $1`, [cap1City.id]);
  const prod1 = await rpc(chief1.uid, 'war_produce', cap1City.id, 'spear');
  ok(prod1.ok, '창병 생산 성공');
  const coinAfter = await one(`select qty from war.wallets where country = 1 and role = 'army' and item = 'coin'`);
    ok(+coinAfter.qty < 1000, `생산 후 코인 차감 (${coinAfter.qty} < 1000)`);

  // 생산 실패: 부족한 자원 (도시 생산 기록 초기화, 모든 지갑·창고의 목재를 0으로)
  await db.query(`update war.cities set produced_turn = 0 where id = $1`, [cap1City.id]);
  await db.query(`update war.wallets set qty = 0 where item = 'wood'`);
  await db.query(`update war.inventory set qty = 0 where item = 'wood'`);  ok(await fail(rpc(chief1.uid, 'war_produce', cap1City.id, 'spear'), 'NOT_ENOUGH'), '목재 부족 시 생산 막힘');
  await db.query(`update war.wallets set qty = 20 where country = 1 and role = 'army' and item = 'wood'`);

  // 유도미사일 생산 → 공격 → 사라짐 (도시 생산 기록 초기화)
  await db.query(`update war.cities set produced_turn = 0 where id = $1`, [cap1City.id]);
  await db.query(`insert into war.wallets(country, role, item, qty) values (1,'air','chip',10) on conflict (country,role,item) do update set qty = 10`);
  const prodMissile = await rpc(chief1.uid, 'war_produce', cap1City.id, 'missile');
  ok(prodMissile.ok, '유도미사일 생산 성공');
  const missileUnit = await one(`select id, tile_id from war.units where country = 1 and kind = 'missile' order by id desc limit 1`);
  ok(!!missileUnit, '유도미사일 유닛 존재');

  // 적 도시 찾아서 전쟁 상태 만들고, 미사일을 사거리 3 이내로 이동시켜 공격
  const enemyCity = await one(`select c.id, c.tile_id, c.country from war.cities c where c.country != 1 and c.country is not null and c.kind = 'capital' order by c.tile_id limit 1`);
  await db.query(`update war.diplomacy set status = 'war' where (a = 1 and b = ${enemyCity.country}) or (a = ${enemyCity.country} and b = 1)`);
  // 미사일을 적 도시 사거리 3 이내로 이동 (거리 1로 배치 — 근접 공격 가능)
  const nearEnemy = await one(`select t.id from war.tiles t where priv.tdist(t.id, ${enemyCity.tile_id}) = 1 and t.terrain not in ('ocean', 'coast', 'mountain') and not exists (select 1 from war.units u where u.tile_id = t.id) limit 1`);
  ok(!!nearEnemy, '준비: 적 도시 옆 빈 평지');
  if (nearEnemy) {
    await db.query(`update war.units set tile_id = ${nearEnemy.id} where id = ${missileUnit.id}`);
    const missileAtk = await rpc(chief1.uid, 'war_attack', missileUnit.id, enemyCity.tile_id);
    ok(missileAtk.damage > 0, '유도미사일 공격 성공');
    ok(!(await one(`select count(*)::int n from war.units where id = ${missileUnit.id}`)).n, '유도미사일 쏘면 사라짐 (oneTime)');
  }

  // 원거리 사거리: 투석기(range 2)는 2칸에서 공격 가능, 창병(range 1)은 1칸만
  const enemyCity2 = await one(`select c.id, c.tile_id, c.country from war.cities c where c.country != 1 and c.country is not null and c.kind = 'capital' and c.tile_id != ${enemyCity.tile_id} order by c.tile_id limit 1`);
  ok(!!enemyCity2, '준비: 두 번째 적 수도');
  if (enemyCity2) {
    await db.query(`update war.diplomacy set status = 'war' where (a = 1 and b = ${enemyCity2.country}) or (a = ${enemyCity2.country} and b = 1)`);
    // 투석기를 적 도시 2칸 앞에 배치
    const d2Tile = await one(`select t.id from war.tiles t where priv.tdist(t.id, ${enemyCity2.tile_id}) = 2 and t.terrain = 'plains' and not exists (select 1 from war.units u where u.tile_id = t.id) limit 1`);
    ok(!!d2Tile, '준비: 적 수도 2칸 앞 빈 평지');
    if (d2Tile) {
      await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99990, 1, 'catapult', ${d2Tile.id}, 100, 'army') on conflict (id) do nothing`);
      const inserted = await one(`select id from war.units where id = 99990`);
      ok(!!inserted, '투석기(99990) 배치됨');
      const distCheck = await one(`select priv.tdist((select tile_id from war.units where id = 99990), ${enemyCity2.tile_id}) d`);
      ok(distCheck.d === 2, `투석기와 적 도시 거리 = ${distCheck.d} (기대 2)`);
      const rangedAtk = await rpc(chief1.uid, 'war_attack', 99990, enemyCity2.tile_id);
      ok(rangedAtk.damage > 0, '투석기(range 2) 2칸에서 공격 성공');
      // 창병(range 1)은 2칸에서 공격 불가 — 투석기와 다른 칸에 배치 (한 칸 한 유닛)
      const d2Tile2 = await one(`select t.id from war.tiles t where priv.tdist(t.id, ${enemyCity2.tile_id}) = 2 and t.terrain = 'plains' and not exists (select 1 from war.units u where u.tile_id = t.id) limit 1`);
      if (d2Tile2) {
        await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99991, 1, 'spear', ${d2Tile2.id}, 100, 'army') on conflict (id) do nothing`);
        ok(await fail(rpc(chief1.uid, 'war_attack', 99991, enemyCity2.tile_id), 'TOO_FAR'), '창병(range 1) 2칸에서 공격 불가 (TOO_FAR)');
      }
    }
  }

} catch (e) {
  ctx.ok(false, '예외: ' + (e.stack || e.message).split('\n')[0]);
}
// 요약
const fails = ctx.fails;
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
