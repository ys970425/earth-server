// 밤샘 점검 (2026-11-16): 예산 요청 흐름·생산 비용 차감·미사일·원거리 경계 사례
// PGlite는 연결이 하나라 진짜 동시 실행은 시험할 수 없다. 설치 후 웨일북 2대로 확인한다.
// 실행: node tests/war/night.test.mjs  (또는 npm run test:war:night)
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
let fails = 0;
const ok = (c, m, note = '') => { console.log((c ? '  ✔ ' : '  ✘ ') + m + (note ? ' — ' + note : '')); if (!c) fails++; };
const fail = async (p, code) => { try { await p; return false; } catch (e) { return !code || e.message.includes(code); } };

try {
  const seed = await seedTradeState(ctx);
  const { db, rpc, one } = ctx;
  const q1 = async (sql, ...p) => (await db.query(sql, p)).rows[0];
  for (const f of ['schema', 'config', 'functions']) {
    await db.exec(readFileSync(new URL(`../../supabase/war/${f}.sql`, import.meta.url), 'utf8'));
  }
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  await db.query(`update war.game set turn = 10, paused = false, combat_on = true where id = 1`);

  const of = c => seed.students.filter(s => s.country_id === c);
  const [chief, engineerS, armyS, navyS, airS] = of(1);
  for (const [s, role] of [[chief, 'chief'], [engineerS, 'engineer'], [armyS, 'army'], [navyS, 'navy'], [airS, 'air']]) {
    await db.query(`insert into war.roles(student, country, role) values ($1, 1, $2)`, [s.id, role]);
  }

  // ================= 점검 2: 예산 요청 흐름 =================
  console.log('— 점검 2: 예산 요청 흐름');
  // 국고 채우기 (승인·분배는 국고 → 역할 지갑으로 옮겨요)
  const fillWallets = () => db.query(`insert into war.inventory(country, item, qty) values (1,'wood',100),(1,'iron',100)
    on conflict (country, item) do update set qty = 100`);
  await fillWallets();
  const chiefWallet = async (item) => (await q1(`select qty from war.inventory where country=1 and item=$1`, item)).qty;
  const roleWallet = async (role, item) => (await q1(`select coalesce((select qty from war.wallets where country=1 and role=$1 and item=$2),0) q`, role, item)).q;

  // 요청 → 승인
  const req1 = await rpc(engineerS.uid, 'war_budget_request', { wood: 5 }, '개발 자원');
  ok(req1.ok && req1.id > 0, '요청 생성 성공');
  const approve1 = await rpc(chief.uid, 'war_budget_approve', req1.id);
  ok(approve1.ok, '합참의장 승인 성공');
  ok((await roleWallet('engineer', 'wood')) === 5 && (await chiefWallet('wood')) === 95,
    `승인 뒤 수량 정확: 역할 창고 ${await roleWallet('engineer', 'wood')} (기대 5) · chief ${await chiefWallet('wood')} (기대 95, 합계 보존)`);
  // 같은 요청 두 번 승인 → ALREADY_DONE
  ok(await fail(rpc(chief.uid, 'war_budget_approve', req1.id), 'ALREADY_DONE'), '같은 요청 두 번 승인 막힘');

  // 요청 → 조정(수량 바꿔 승인)
  const req2 = await rpc(engineerS.uid, 'war_budget_request', { wood: 10 }, '조정 시험');
  const adjust = await rpc(chief.uid, 'war_budget_approve', req2.id, { wood: 3 });
  ok(adjust.ok, '조정(수량 바꿔) 승인 성공');
  ok((await roleWallet('engineer', 'wood')) === 8 && (await chiefWallet('wood')) === 92,
    `조정 뒤 수량 정확: 역할 창고 ${await roleWallet('engineer', 'wood')} (기대 8) · chief ${await chiefWallet('wood')} (기대 92)`);

  // 요청 → 거절
  const req3 = await rpc(engineerS.uid, 'war_budget_request', { iron: 2 }, '거절 시험');
  const reject = await rpc(chief.uid, 'war_budget_reject', req3.id, '지금은 필요 없어요');
  ok(reject.ok && (await chiefWallet('iron')) === 100 && (await roleWallet('engineer', 'iron')) === 0,
    '거절 뒤 창고 변화 없음, 기록만');
  ok(await fail(rpc(chief.uid, 'war_budget_reject', req3.id), 'ALREADY_DONE'), '같은 요청 두 번 거절 막힘');

  // 회수(recall)
  const recall = await rpc(chief.uid, 'war_budget_recall', 'engineer', { wood: 2 });
  ok(recall.ok && (await roleWallet('engineer', 'wood')) === 6 && (await chiefWallet('wood')) === 94,
    `회수 정확: 역할 창고 ${await roleWallet('engineer', 'wood')} (기대 6) · chief ${await chiefWallet('wood')} (기대 94)`);
  // 부족한 수량 회수
  ok(await fail(rpc(chief.uid, 'war_budget_recall', 'engineer', { wood: 999 }), 'NOT_ENOUGH'), '부족한 수량 회수 막힘');
  // 0·음수·소수·아주 큰 수: 0과 음수는 무시, 소수는 내림? (value::int), 큰 수는 부족으로 막힘
  const r0 = await rpc(chief.uid, 'war_budget_recall', 'engineer', { wood: 0 });
  ok(r0.ok && (await roleWallet('engineer', 'wood')) === 6, '0 회수는 아무 일 없음');
  ok(await fail(rpc(chief.uid, 'war_budget_recall', 'engineer', { wood: -5 }), 'NOT_ENOUGH') || ((await roleWallet('engineer', 'wood')) === 6),
    '음수 회수: 막히거나 아무 일 없음 (창고가 늘지 않는지 확인)');
  ok((await roleWallet('engineer', 'wood')) === 6, '음수 회수 뒤 창고가 늘지 않음');
  // 소수: 소수 값은 ::int 변환이 오류로 막힌다 (소수 입력이 곧바로 거절 — 막히는 게 맞는 동작)
  ok(await fail(rpc(chief.uid, 'war_budget_recall', 'engineer', { wood: 2.9 }), 'invalid') ||
    !(await rpc(chief.uid, 'war_budget_recall', 'engineer', { wood: 2.9 })).ok,
    '소수 회수는 거절 (invalid input) — 창고 그대로');
  ok((await roleWallet('engineer', 'wood')) === 6, '소수 시도 뒤 창고가 그대로 (4가 아니라 6)');

  // 반납(return) — role wood=6, chief wood=94인 상태에서
  await db.query(`update war.cities set produced_turn = 0 where true`);
  const ret = await rpc(engineerS.uid, 'war_budget_return', { wood: 1 });
  ok(ret.ok && (await roleWallet('engineer', 'wood')) === 5 && (await chiefWallet('wood')) === 95,
    `반납 정확: 역할 창고 ${await roleWallet('engineer', 'wood')} (기대 5) · chief ${await chiefWallet('wood')} (기대 95)`);
  ok(await fail(rpc(engineerS.uid, 'war_budget_return', { wood: 999 }), 'NOT_ENOUGH'), '부족한 수량 반납 막힘');
  // 음수는 continue라 아무 일 없음
  const retNeg = await rpc(engineerS.uid, 'war_budget_return', { wood: -3 });
  ok(retNeg.ok, '음수 반납: continue라 아무 일 없음 (성공)');
  ok((await roleWallet('engineer', 'wood')) === 5, '음수 반납 뒤 창고가 그대로');

  // 결석: 요청 막힘 (ROLE_ONLY)
  await db.query(`update war.budget_requests set status='cancelled' where country=1 and role='engineer' and status='pending'`);
  await db.query(`update war.roles set absent = true where student = $1`, [engineerS.id]);
  ok(await fail(rpc(engineerS.uid, 'war_budget_request', { wood: 1 }), 'ROLE_ONLY'), '결석한 역할 요청 막힘');
  await db.query(`update war.roles set absent = false where student = $1`, [engineerS.id]);
  // 역할 없음·남의 나라
  const noRoleS = of(1)[5] || of(2)[0];
  await db.query(`delete from war.roles where student = $1`, [noRoleS.id]);
  ok(await fail(rpc(noRoleS.uid, 'war_budget_request', { wood: 1 }), 'BAD_ROLE'), '역할 없는 학생 요청 막힘');
  const otherChief = of(2)[0];
  await db.query(`insert into war.roles(student, country, role) values ($1, 2, 'army') on conflict (student) do update set role = 'army'`, [otherChief.id]);
  const otherReq = await rpc(otherChief.uid, 'war_budget_request', { wood: 1 });
  ok(otherReq.ok, '2번 나라 요청 생성 (비교용)');
  ok(await fail(rpc(chief.uid, 'war_budget_approve', otherReq.id), 'NO_AUTH'), '남의 나라 요청 승인 막힘');

  // pending 1건 제한
  await fillWallets();
  const reqA = await rpc(armyS.uid, 'war_budget_request', { wood: 1 });
  ok(await fail(rpc(armyS.uid, 'war_budget_request', { wood: 2 }), 'ALREADY_PENDING'), 'pending 중 두 번째 요청 막힘');
  await rpc(armyS.uid, 'war_budget_request_cancel', reqA.id);
  ok(!(await q1(`select status from war.budget_requests where id = $1`, reqA.id)).status.includes('pending'), '요청 취소 성공');
  const reqB = await rpc(armyS.uid, 'war_budget_request', { wood: 2 });
  ok(reqB.ok, '취소 뒤 다시 요청 성공');

  // ================= 점검 3: 생산 비용 차감 =================
  console.log('— 점검 3: 생산 비용 차감');
  const cap1 = await q1(`select id, tile_id from war.cities where country = 1 and kind = 'capital'`);
  await db.query(`update war.cities set buildings = array_append(buildings, 'barracks') where id = $1`, [cap1.id]);
  await db.query(`update war.cities set buildings = array_append(buildings, 'harbor') where id = $1`, [cap1.id]);
  // 지갑 넉넉히
  await db.query(`update war.wallets set qty = 100 where country = 1 and item in ('coin','wood','iron','steel','tire','fuel','rubber','chip','rare','engine')`);
  await db.query(`update war.wallets set qty = 100 where country = 1 and role in ('army','navy','air','engineer') and item in ('coin','wood','iron','steel','tire','fuel','rubber','chip','rare','engine')`);

  const kinds = ['spear', 'catapult', 'mech_inf', 'tank_modern', 'destroyer', 'battleship', 'helicopter', 'drone', 'missile', 'worker'];
  const cfgRow = await q1(`select data->'UNITS' u, (select data->'HIRE_WORKER' from priv.config where id=1) h from war.config where id=1`);
  const roleStudents = { army: armyS, navy: navyS, air: airS, engineer: engineerS };
  for (const kind of kinds) {
    await db.query(`update war.cities set produced_turn = 0 where id = $1`, [cap1.id]);
    await db.query(`delete from war.units where country = 1 and kind <> 'worker'`);
    const branchRow = await q1(`select data->'UNITS'->'${kind}'->>'branch' b from war.config where id=1`);
    const roleFor = branchRow.b === 'civil' ? 'engineer' : (branchRow.b || 'engineer');
    const caller = roleStudents[roleFor];
    const cost = kind === 'worker' ? cfgRow.h : (cfgRow.u[kind] || {}).cost;
    const fillRole = () => db.query(`insert into war.wallets(country, role, item, qty)
      select 1, $1, key, 100 from jsonb_each_text($2::jsonb)
      on conflict (country, role, item) do update set qty = 100`, [roleFor, JSON.stringify(cost || {})]);
    await fillRole();
    // 비용 첫 항목 0으로 만들어 막히는지
    const firstItem = Object.keys(cost || {})[0];
    await db.query(`update war.wallets set qty = 0 where country = 1 and role = $1 and item = $2`, [roleFor, firstItem]);
    const beforeUnits = (await q1(`select count(*)::int n from war.units where country = 1`)).n;
    ok(await fail(rpc(caller.uid, 'war_produce', cap1.id, kind), 'NOT_ENOUGH'), `${kind}: 비용(${firstItem}) 부족 시 NOT_ENOUGH`);
    ok((await q1(`select count(*)::int n from war.units where country = 1`)).n === beforeUnits, `${kind}: 실패한 생산은 유닛 수를 바꾸지 않음`);
    ok((await q1(`select produced_turn from war.cities where id = $1`, cap1.id)).produced_turn === 0, `${kind}: 실패한 생산은 도시 기록을 바꾸지 않음`);
    // 지갑 회복 후 정상 생산, 차감 확인
    await fillRole();
    const prod = await rpc(caller.uid, 'war_produce', cap1.id, kind);
    ok(prod.ok, `${kind}: 생산 성공`);
    for (const [item, qty] of Object.entries(cost || {})) {
      const left = (await q1(`select qty from war.wallets where country = 1 and role = $1 and item = $2`, roleFor, item)).qty;
      ok(+left === 100 - qty, `${kind}: ${item} ${qty} 차감 (남은 ${left})`);
    }
  }

  // 병영·항구·수도 조건
  await db.query(`update war.cities set produced_turn = 0, buildings = array_remove(buildings, 'barracks') where id = $1`, [cap1.id]);
  ok(await fail(rpc(armyS.uid, 'war_produce', cap1.id, 'spear'), 'NO_BARRACKS'), '병영 없으면 육군 생산 막힘');
  await db.query(`update war.cities set buildings = array_append(buildings, 'barracks'), produced_turn = 0 where id = $1`, [cap1.id]);
  await db.query(`update war.cities set buildings = array_remove(buildings, 'harbor'), produced_turn = 0 where id = $1`, [cap1.id]);
  ok(await fail(rpc(navyS.uid, 'war_produce', cap1.id, 'destroyer'), 'NO_HARBOR'), '항구 없으면 해군 생산 막힘');
  // 특수 부대: 나라별 하나 + 필요 자원 (K 나라 = k_missile, needs uranium)
  const kBranch = (cfgRow.u['k_missile'] || {}).branch;
  const kCaller = kBranch === 'navy' ? navyS : kBranch === 'air' ? airS : armyS;
  await db.query(`update war.cities set produced_turn = 0 where id = $1`, [cap1.id]);
  await db.query(`delete from war.units where country = 1 and kind = 'k_missile'`);
  await db.query(`delete from war.inventory where country = 1 and item = 'uranium'`);
  ok(await fail(rpc(kCaller.uid, 'war_produce', cap1.id, 'k_missile'), 'NEED_RESOURCE') ||
    await fail(rpc(kCaller.uid, 'war_produce', cap1.id, 'k_missile'), 'NOT_ENOUGH'), '특수 부대: 필요 자원 없으면 막힘');
  // 다른 나라(type이 K가 아닌 나라)가 k_missile 생산 시도 → NO_BOSS
  const otherC = await q1(`select id, type from priv.countries where type <> 'K' order by id limit 1`);
  const c2 = of(otherC.id)[0];
  await db.query(`insert into war.roles(student, country, role) values ($1, $2, $3) on conflict (student) do update set role = $3`,
    [c2.id, otherC.id, kBranch === 'navy' ? 'navy' : kBranch === 'air' ? 'air' : 'army']);
  const cap2 = await q1(`select id from war.cities where country = $1 and kind = 'capital'`, otherC.id);
  await db.query(`update war.cities set buildings = array_append(buildings, 'barracks'), produced_turn = 0 where id = $1`, [cap2.id]);
  ok(await fail(rpc(c2.uid, 'war_produce', cap2.id, 'k_missile'), 'NO_BOSS'), '다른 나라 특수 부대 생산 막힘');

  // ================= 점검 4: 미사일·원거리 경계 사례 =================
  console.log('— 점검 4: 미사일·원거리 경계 사례');
  // 공격용 적 도시와 전쟁 상태
  const enemyCap = await q1(`select id, tile_id, country from war.cities where country = 2 and kind = 'capital'`);
  await db.query(`update war.diplomacy set status = 'war', no_war_until = 0 where (a = 1 and b = 2) or (a = 2 and b = 1)`);
  await db.query(`update war.countries set shield_until = 0 where id in (1, 2)`);
  // 도시를 비우고 배치할 자리 확보
  await db.query(`delete from war.units where country = 2 and kind <> 'worker'`);
  const atkCaller = { spear: armyS, catapult: armyS, mech_inf: armyS, battleship: navyS, destroyer: navyS, missile: airS, helicopter: airS, k_missile: airS };
  const atk = (kind, fn, ...args) => rpc((atkCaller[kind] || armyS).uid, fn, ...args);
  const placeAt = async (dist, kind, id) => {
    let t = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = $2 and t.terrain not in ('ocean','coast','mountain')
      and not exists (select 1 from war.cities c where c.tile_id = t.id)
      and not exists (select 1 from war.units u where u.tile_id = t.id)
      and not exists (select 1 from war.markets m where m.tile_id = t.id) limit 1`, enemyCap.tile_id, dist);
    if (!t) {
      // 자리가 없으면: 도시·시장이 없는 칸을 골라 지형을 평원으로 만들어 자리를 만든다
      t = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = $2
        and not exists (select 1 from war.cities c where c.tile_id = t.id)
        and not exists (select 1 from war.markets m where m.tile_id = t.id) limit 1`, enemyCap.tile_id, dist);
      if (!t) return null;
      await db.query(`update war.tiles set terrain = 'plains', imp = null where id = $1`, [t.id]);
    }
    const cmd = { spear: 'army', catapult: 'army', mech_inf: 'army', battleship: 'navy', destroyer: 'navy', missile: 'air', helicopter: 'air' }[kind] || 'army';
    await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values ($1, 1, $2, $3, 100, $4) on conflict (id) do nothing`, [id, kind, t.id, cmd]);
    return t.id;
  };
  // 창병(사거리 1): 1칸 성공, 2칸 TOO_FAR
  const s1 = await placeAt(1, 'spear', 99001);
  if (s1) {
    const r = await atk('spear', 'war_attack', 99001, enemyCap.tile_id);
    ok(r.damage !== undefined, '창병 1칸 공격 성공');
    await db.query(`delete from war.units where id = 99001`);
  }
  const s2 = await placeAt(2, 'spear', 99002);
  if (s2) ok(await fail(atk('spear', 'war_attack', 99002, enemyCap.tile_id), 'TOO_FAR'), '창병 2칸 TOO_FAR');
  // 투석기·전함(사거리 2): 2칸 성공, 3칸 TOO_FAR
  const cat2 = await placeAt(2, 'catapult', 99003);
  if (cat2) { const r = await atk('catapult', 'war_attack', 99003, enemyCap.tile_id); ok(r.damage !== undefined, '투석기 2칸 공격 성공'); await db.query(`delete from war.units where id = 99003`); }
  const cat3 = await placeAt(3, 'catapult', 99004);
  if (cat3) ok(await fail(atk('catapult', 'war_attack', 99004, enemyCap.tile_id), 'TOO_FAR'), '투석기 3칸 TOO_FAR');
  const bs2 = await placeAt(2, 'battleship', 99005);
  if (bs2) { const r = await atk('battleship', 'war_attack', 99005, enemyCap.tile_id); ok(r.damage !== undefined, '전함 2칸 공격 성공'); await db.query(`delete from war.units where id = 99005`); }
  const bs3 = await placeAt(3, 'battleship', 99006);
  if (bs3) ok(await fail(atk('battleship', 'war_attack', 99006, enemyCap.tile_id), 'TOO_FAR'), '전함 3칸 TOO_FAR');
  // 유도미사일·특수 부대(사거리 3): 3칸 성공, 4칸 TOO_FAR
  const ms3 = await placeAt(3, 'missile', 99007);
  if (ms3) {
    const pv = await atk('missile', 'war_attack_preview', 99007, enemyCap.tile_id);
    const r = await atk('missile', 'war_attack', 99007, enemyCap.tile_id);
    ok(r.damage !== undefined, '유도미사일 3칸 공격 성공');
    ok(!(await q1(`select count(*)::int n from war.units where id = 99007`)).n, '유도미사일 쏘면 사라짐');
    ok(pv.can_attack && pv.damage === r.damage && pv.counter === r.counter, `미리보기 = 실제 (피해 ${pv.damage}/${r.damage}, 반격 ${pv.counter}/${r.counter})`);
  }
  const ms4 = await placeAt(4, 'missile', 99008);
  if (ms4) ok(await fail(atk('missile', 'war_attack', 99008, enemyCap.tile_id), 'TOO_FAR'), '유도미사일 4칸 TOO_FAR');
  // 유도미사일: 이동력 0이라 움직이지 못함
  const ms0 = await placeAt(5, 'missile', 99009);
  if (ms0) {
    ok(await fail(atk('missile', 'war_move', 99009, [ms0]), 'NO_MOVES'), '유도미사일 이동력 0 → 이동 불가');
    await db.query(`delete from war.units where id = 99009`);
  }
  // 사거리 공격으로는 도시를 점령하지 못함(need_melee) — 도시 체력을 0으로 만들고 근접 필요 확인
  let capCity = await q1(`select id, tile_id, country, hp from war.cities where country = 2 and kind <> 'capital' limit 1`);
  if (!capCity) {
    // 2번 나라에 일반 도시가 없으면 수도 옆에 시험용 도시를 만든다
    const nt = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = 1
      and not exists (select 1 from war.cities c where c.tile_id = t.id)
      and not exists (select 1 from war.markets m where m.tile_id = t.id) limit 1`, enemyCap.tile_id);
    if (nt) {
      await db.query(`update war.tiles set terrain = 'plains', imp = null where id = $1`, [nt.id]);
      await db.query(`insert into war.cities(id, tile_id, kind, type, name, def, sea, country, buildings, tier, hp, max_hp)
        values ('E9N', $1, 'city', 'K', '시험 도시', 1, false, 2, '{}', 1, 100, 100)
        on conflict (id) do update set country = 2, hp = 100, max_hp = 100, kind = 'city'`, [nt.id]);
      capCity = await q1(`select id, tile_id, country, hp from war.cities where id = 'E9N'`);
    }
  }
  if (capCity) {
    await db.query(`update war.diplomacy set status = 'war' where (a = 1 and b = ${capCity.country}) or (a = ${capCity.country} and b = 1)`);
    await db.query(`update war.countries set shield_until = 0 where id = ${capCity.country}`);
    await db.query(`update war.cities set hp = 0 where id = $1`, [capCity.id]);
    const cat = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = 2 and t.terrain not in ('ocean','coast','mountain')
      and not exists (select 1 from war.cities c where c.tile_id = t.id) and not exists (select 1 from war.units u where u.tile_id = t.id) limit 1`, capCity.tile_id);
    if (cat) {
      await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99010, 1, 'catapult', ${cat.id}, 100, 'army') on conflict (id) do nothing`);
      const r = await atk('catapult', 'war_attack', 99010, capCity.tile_id);
      ok(!r.captured, '원거리 공격으로는 도시를 점령하지 못함 (need_melee)');
      await db.query(`delete from war.units where id = 99010`);
      // 근접(창병)으로는 점령됨
      const near = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = 1 and t.terrain not in ('ocean','coast','mountain')
        and not exists (select 1 from war.cities c where c.tile_id = t.id) and not exists (select 1 from war.units u where u.tile_id = t.id) limit 1`, capCity.tile_id);
      if (near) {
        await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99011, 1, 'spear', ${near.id}, 100, 'army') on conflict (id) do nothing`);
        const r2 = await atk('spear', 'war_attack', 99011, capCity.tile_id);
        ok(r2.captured === true, '근접으로 도시 점령 성공');
        await db.query(`delete from war.units where id = 99011`);
      }
    }
  }
  // 보호막·동맹·평화·전투 시간 아님에서 거절
  await db.query(`update war.countries set shield_until = 99 where id = 2`);
  const shieldUnit = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = 1 and t.terrain not in ('ocean','coast','mountain')
    and not exists (select 1 from war.cities c where c.tile_id = t.id) and not exists (select 1 from war.units u where u.tile_id = t.id) limit 1`, enemyCap.tile_id);
  if (shieldUnit) {
    await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99012, 1, 'spear', ${shieldUnit.id}, 100, 'army') on conflict (id) do nothing`);
    ok(await fail(atk('spear', 'war_attack', 99012, enemyCap.tile_id), 'SHIELD'), '보호막 있는 나라 공격 거절');
    await db.query(`delete from war.units where id = 99012`);
  }
  await db.query(`update war.countries set shield_until = 0 where id = 2`);
  await db.query(`update war.diplomacy set status = 'ally' where (a = 1 and b = 2) or (a = 2 and b = 1)`);
  if (shieldUnit) {
    await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99013, 1, 'spear', ${shieldUnit.id}, 100, 'army') on conflict (id) do nothing`);
    ok(await fail(atk('spear', 'war_attack', 99013, enemyCap.tile_id), 'ALLY'), '동맹 나라 공격 거절');
    await db.query(`delete from war.units where id = 99013`);
  }
  await db.query(`update war.diplomacy set status = 'peace' where (a = 1 and b = 2) or (a = 2 and b = 1)`);
  if (shieldUnit) {
    await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99014, 1, 'spear', ${shieldUnit.id}, 100, 'army') on conflict (id) do nothing`);
    ok(await fail(atk('spear', 'war_attack', 99014, enemyCap.tile_id), 'NOT_AT_WAR'), '평화 상태 공격 거절 (NOT_AT_WAR)');
    await db.query(`delete from war.units where id = 99014`);
  }
  await db.query(`update war.game set combat_on = false where id = 1`);
  if (shieldUnit) {
    await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (99015, 1, 'spear', ${shieldUnit.id}, 100, 'army') on conflict (id) do nothing`);
    ok(await fail(atk('spear', 'war_attack', 99015, enemyCap.tile_id), 'NO_COMBAT'), '전투 시간 아님 공격 거절');
    await db.query(`delete from war.units where id = 99015`);
  }
  await db.query(`update war.game set combat_on = true where id = 1`);
} catch (e) {
  ctx.ok(false, '예외: ' + (e.stack || e.message).split('\n')[0]);
  fails++;
}

// ================= 점검 1: 1366×768 역할별 화면 흐름 =================
// screen.test.mjs 방식: 정적 서버 + headless Chrome + ?preview=real&as=1:역할
console.log('— 점검 1: 1366×768 화면 흐름');
{
  const { spawn, spawnSync } = await import('node:child_process');
  const { createServer } = await import('node:http');
  const { existsSync, statSync } = await import('node:fs');
  const { extname, join, normalize } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const puppeteer = require('puppeteer');
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const PORT = 5598;
  const BASE = `http://localhost:${PORT}`;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, timeout, step = 500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { } await wait(step); }
    return null;
  }
  let pyChild = null, nodeServer = null;
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.gz': 'application/gzip', '.woff2': 'font/woff2' };
  nodeServer = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(new URL(req.url, BASE).pathname)).replace(/^([/\\])+/, '');
    const f = join(ROOT, rel);
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  nodeServer.listen(PORT);
  const up = await until(async () => (await fetch(`${BASE}/app/war/index.html`)).ok, 10000, 300);
  const browser = up ? await puppeteer.launch({ channel: 'chrome', headless: true }).catch(() => null) : null;
  if (!browser) ok(false, '정적 서버 또는 Chrome을 띄우지 못했어요 (화면 점검 생략)');
  else {
    const keepVisible = () => { try { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); } catch { } };
    for (const role of ['chief', 'engineer', 'army', 'navy', 'air']) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.evaluateOnNewDocument(keepVisible);
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('response', r => { if (r.status() === 404 && !r.url().includes('favicon')) errors.push('404: ' + r.url().replace(BASE, '')); });
      page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('console: ' + m.text()); });
      try {
        await page.goto(`${BASE}/app/war/index.html?preview=real&as=1:${role}`, { waitUntil: 'domcontentloaded' });
        const hasCanvas = await until(() => page.$('canvas.hexmap'), 60000, 500);
        // 가로 스크롤: 문서가 1366보다 가로로 길면 ✘ (지도 확대 화면은 예외일 수 있어 길이만 기록)
        const hscroll = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, iw: window.innerWidth,
          bodyOverflow: getComputedStyle(document.body).overflowX
        }));
        // 실제 판정: 가로 스크롤바가 생기면 문제
        const clipped = hscroll.sw > hscroll.iw + 1;
        ok(!clipped, `${role}: 가로 스크롤 없음`, `문서 가로 ${hscroll.sw}px (화면 ${hscroll.iw}px)`);
        // 뷰포트 밖으로 나가는 고정 위치 아닌 요소 (지도 canvas는 확대로 밀 수 있어 제외)
        const outside = await page.evaluate(() => {
          const iw = window.innerWidth;
          const bad = [];
          for (const el of document.querySelectorAll('.war-nav button, .war-view .panel, .war-role-bar button')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.left < -2 || r.right > iw + 2)) bad.push((el.className || el.tagName).toString().slice(0, 30));
          }
          return [...new Set(bad)].slice(0, 4);
        });
        ok(outside.length === 0, `${role}: 화면 밖으로 나가는 버튼·패널 없음`, outside.length ? '밖: ' + outside.join(', ') : '');
        // 위쪽 nav 버튼마다 눌러서 화면이 바뀌는지 (클릭마다 다시 그려지므로 라벨로 다시 찾는다.
        // 페이지를 열 때 그 뷰가 기본 뷰인 버튼은 내용 변화가 없어서 on만 확인)
        const navOk = await page.evaluate(async () => {
          const btns = [...document.querySelectorAll('.war-nav .war-nav-btn')];
          const view = document.querySelector('#war-view');
          if (!btns.length || !view) return { n: 0, pass: false };
          for (const b of btns) {
            const label = b.textContent;
            const wasOn = b.classList.contains('on');
            const before = view.innerHTML;
            b.click();
            await new Promise(r => setTimeout(r, 300));
            const nb = [...document.querySelectorAll('.war-nav .war-nav-btn')].find(x => x.textContent === label);
            if (!nb || !nb.classList.contains('on')) return { n: btns.length, pass: false, btn: label };
            if (!wasOn && view.innerHTML === before) return { n: btns.length, pass: false, btn: label + ' (화면 내용 변화 없음)' };
          }
          return { n: btns.length, pass: true };
        });
        ok(navOk.pass, `${role}: nav 버튼 ${navOk.n}개 전환됨`, navOk.pass ? '' : '안 바뀐 버튼: ' + (navOk.btn || '?'));
        // 콘솔·페이지 오류 (지도가 그려지기 전 로딩 중 오류는 제외하지 않고 전부 기록)
        ok(errors.length === 0, `${role}: 콘솔·페이지 오류 없음`, errors.length ? errors.slice(0, 3).join(' | ') : '');
      } catch (e) {
        ok(false, `${role}: 화면 점검 예외`, (e.stack || e.message).split('\n')[0]);
      }
      await page.close();
    }
    await browser.close();
  }
  nodeServer.close();
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
