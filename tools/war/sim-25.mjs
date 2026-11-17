// 간이 E12 · 수업 당일 점검: 25명 동시 접속 흉내 + 턴 운영 + 재접속 복구를 가짜 DB(PGlite)에서 돌려 봐요.
// 실행: node tools/war/sim-25.mjs   (먼저 node tools/war/build-install-sql.mjs 로 dist/war-install/ops 를 만들어 두세요)
// PGlite는 연결이 하나라 「정말 같은 순간」은 아니지만, 요청 25개를 한꺼번에 던져 서버 규칙(잠금·먼저 온 사람 우선·한 번만 처리)이 지켜지는지 봐요.
// 진짜 서버(Supabase) 부하는 수요일 웨일북 2대 확인과 목요일 아침 입장으로 확인해요.
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDb, seedTradeState } from '../../tests/war/helpers.mjs';

const ctx = await createDb();
const seed = await seedTradeState(ctx);
const { db, ok, fail } = ctx;
// 동시에 던져도 uid가 뒤섞이지 않게, 「uid 설정 + 호출」을 한 덩어리(트랜잭션)로 처리해요. 실패하면 그 호출만 취소돼요.
// (기본 rpc 도우미는 두 단계라서 동시에 던지면 서로 uid를 덮어써요 — 서버 문제가 아니라 시험 도구의 한계)
const rpc = (uid, fn, ...args) => db.transaction(async tx => {
  await tx.query("select set_config('request.uid', $1, false)", [uid || '']);
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  const r = await tx.query(`select public.${fn}(${ph}) as r`, args.map(a => a !== null && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a));
  return r.rows[0].r;
});
const q1 = async (sql, ...a) => (await db.query(sql, a)).rows[0];
const ops = name => {
  const p = new URL('../../dist/war-install/ops/' + name, import.meta.url);
  if (!existsSync(p)) { console.error('dist/war-install/ops 가 없어요. 먼저 node tools/war/build-install-sql.mjs 를 실행하세요.'); process.exit(1); }
  return readFileSync(p, 'utf8');
};
for (const f of ['schema.sql', 'config.sql', 'functions.sql']) await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
await rpc(seed.ADMIN, 'war_admin_import', '초기화');

// ---------- 25명 역할 배정 (1모둠 5명: 합참·공병·육·해·공, 나머지 4명: 합참·육·해·공) ----------
const ROLES5 = ['chief', 'engineer', 'army', 'navy', 'air'], ROLES4 = ['chief', 'army', 'navy', 'air'];
const byCountry = {}, all = [];
for (let c = 1; c <= 6; c++) {
  const members = seed.students.filter(s => s.country_id === c);
  byCountry[c] = {};
  (c === 1 ? ROLES5 : ROLES4).forEach((role, i) => {
    const s = { id: members[i].id, uid: members[i].uid, role, country: c };
    byCountry[c][role] = s; all.push(s);
  });
  for (const s of Object.values(byCountry[c])) await db.query('insert into war.roles(student, country, role) values ($1,$2,$3)', [s.id, c, s.role]);
}
console.log(`— 준비: 학생 ${all.length}명, 나라 6개, 역할 배정 완료`);
ok(all.length === 25, '학생 25명');

const gameRow = () => q1('select turn, turn_end, paused, combat_on, turn_seconds from war.game where id = 1');

// ================= 1. 25명이 한꺼번에 접속·새로고침 =================
console.log('— 1. 25명 동시 접속 (war_me + war_poll 첫 화면, 3번 반복)');
{
  const t0 = Date.now();
  let errors = 0, calls = 0;
  for (let round = 0; round < 3; round++) {
    await Promise.all(all.map(async s => {
      try {
        const me = await rpc(s.uid, 'war_me');
        await rpc(s.uid, 'war_poll', {});
        calls += 2;
        if (me.role !== s.role || me.country.id !== s.country) { errors++; console.log('    다른 역할:', s.country, s.role, '→', me.country.id, me.role); }
      } catch (e) { errors++; console.log('    오류:', s.country, s.role, e.message); }
    }));
  }
  ok(errors === 0, `${calls}번 호출 모두 성공, 나라·역할이 배정한 대로 (${Date.now() - t0}ms)`);
}

// ================= 2. 먼저 누른 사람이 이긴다 (같은 칸 이동 경쟁) =================
console.log('— 2. 같은 빈 칸으로 동시에 이동');
{
  const tiles = (await db.query('select id, c, r, terrain from war.tiles')).rows;
  const W = Math.max(...tiles.map(t => t.c)) + 1;
  const at = new Map(tiles.map(t => [t.c + ',' + t.r, t]));
  const blocked = new Set([
    ...(await db.query('select tile_id from war.units')).rows.map(r => r.tile_id),
    ...(await db.query('select tile_id from war.cities')).rows.map(r => r.tile_id),
    ...(await db.query('select tile_id from war.markets')).rows.map(r => r.tile_id)]);
  const nb = t => [[t.c - 1, t.r], [t.c + 1, t.r], [t.c - 1 + (t.r & 1), t.r - 1], [t.c + (t.r & 1), t.r - 1], [t.c - 1 + (t.r & 1), t.r + 1], [t.c + (t.r & 1), t.r + 1]]
    .filter(([c, r]) => c >= 0 && c < W && r >= 0).map(([c, r]) => at.get(c + ',' + r)).filter(Boolean);
  const land = t => t && ['plains', 'forest', 'hills'].includes(t.terrain) && !blocked.has(t.id);
  let spot = null;
  for (const t of tiles) {
    if (!land(t)) continue;
    const ns = nb(t).filter(land);
    if (ns.length >= 2) { spot = { target: t, a: ns[0], b: ns[1] }; break; }
  }
  ok(!!spot, '준비: 빈 칸 하나와 그 이웃 두 칸을 찾음');
  if (spot) {
    const nextId = (await q1('select coalesce(max(id),0)+1 n from war.units')).n;
    for (const [id, c, tile] of [[nextId, 1, spot.a.id], [nextId + 1, 2, spot.b.id]]) {
      await db.query(`insert into war.units(id, country, kind, hp, moves_left, commander, moves_turn) values ($1,$2,'spear',100,2,'army',0)`, [id, c]);
      await db.query('select war.place_unit($1, $2)', [id, tile]);
    }
    const res = await Promise.allSettled([
      rpc(byCountry[1].army.uid, 'war_move', nextId, [spot.target.id]),
      rpc(byCountry[2].army.uid, 'war_move', nextId + 1, [spot.target.id]),
    ]);
    const wins = res.filter(r => r.status === 'fulfilled').length;
    const why = res.filter(r => r.status === 'rejected').map(r => r.reason.message.slice(0, 40)).join('');
    ok(wins === 1, `두 나라가 같은 칸으로 동시에 이동하면 한 나라만 성공 (성공 ${wins}, 거절 ${res.length - wins}: ${why})`);
    ok(/먼저|OCCUPIED|TAKEN|BUSY|TILE/i.test(why) || wins === 1, '거절된 쪽은 「먼저 온 병력이 있어요」 계열 안내를 받음');
    const there = (await db.query(`select count(*)::int n from war.units where tile_id = $1 and kind not in ('worker','scout')`, [spot.target.id])).rows[0].n;
    ok(there === 1, '그 칸에는 병력이 정확히 하나');
  }
}

// ================= 3. 턴 운영: 다음 턴 · 일시정지 · 재개 · 턴 시간 =================
console.log('— 3. 교사 버튼: 다음 턴 · 일시정지 · 재개 · 턴 시간');
{
  const g0 = await gameRow();
  const both = await Promise.all([rpc(seed.ADMIN, 'war_next_turn', g0.turn), rpc(seed.ADMIN, 'war_next_turn', g0.turn)]);
  ok(both.filter(r => r.ok).length === 1 && (await gameRow()).turn === g0.turn + 1, `「다음 턴」을 두 번 눌러도 한 번만 넘어감 (턴 ${g0.turn} → ${g0.turn + 1})`);

  ok((await rpc(seed.ADMIN, 'war_pause', true)).paused === true, '일시정지');
  const army1 = byCountry[1].army;
  const u = await q1(`select id from war.units where country = 1 and commander = 'army' and kind not in ('worker','scout') order by id limit 1`);
  ok(await fail(rpc(army1.uid, 'war_move', u.id, [0]), 'PAUSED'), '일시정지 중에는 학생 행동이 PAUSED 로 막힘');
  ok((await rpc(seed.ADMIN, 'war_pause', false)).paused === false && !(await gameRow()).paused, '재개');

  ok((await rpc(seed.ADMIN, 'war_set_turn_time', 300)).ok, '턴 시간 300초(5분)로 바꿈');
  ok(await fail(rpc(seed.ADMIN, 'war_set_turn_time', 59), 'BAD_TIME') && await fail(rpc(seed.ADMIN, 'war_set_turn_time', 601), 'BAD_TIME'), '60~600초 밖의 값은 거절');
  const g1 = await gameRow();
  await rpc(seed.ADMIN, 'war_next_turn', g1.turn);
  const g2 = await gameRow();
  const secs = Math.round((new Date(g2.turn_end).getTime() - Date.now()) / 1000);
  ok(secs > 290 && secs <= 300, `다음 턴부터 5분 타이머가 시작됨 (남은 ${secs}초)`);
  ok(await fail(rpc(army1.uid, 'war_next_turn', g2.turn), 'NOT_ADMIN') && await fail(rpc(army1.uid, 'war_pause', true), 'NOT_ADMIN'), '학생은 교사 버튼(다음 턴·일시정지)을 못 누름');
  // 시간이 지나도 서버가 혼자 턴을 넘기지 않는다 (넘기는 것은 교사의 「다음 턴」 버튼뿐)
  await db.query(`update war.game set turn_end = now() - interval '1 minute' where id = 1`);
  await rpc(army1.uid, 'war_poll', {});
  ok((await gameRow()).turn === g2.turn, '타이머가 0이 돼도 서버는 혼자 턴을 넘기지 않음 → 교사가 「다음 턴」을 눌러야 해요');
}

// ================= 4. 전투 잠금 (연습 턴) — 실제 설치 폴더의 SQL 그대로 =================
console.log('— 4. 연습 턴 전투 잠금 (dist/war-install/ops/combat-off.sql · combat-on.sql 을 그대로 실행)');
{
  const cap2 = await q1(`select id, tile_id from war.cities where country = 2 and kind = 'capital'`);
  await db.query(`update war.diplomacy set status = 'war', no_war_until = 0 where (a = 1 and b = 2) or (a = 2 and b = 1)`);
  await db.query(`update war.countries set shield_until = 0 where id in (1, 2)`);
  await db.query(`delete from war.units where country = 2 and kind not in ('worker','scout')`);
  await db.query(`update war.cities set hp = max_hp, besieged = false where id = $1`, [cap2.id]);
  const spot = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = 1 and t.terrain not in ('ocean','coast','mountain')
    and not exists (select 1 from war.units u where u.tile_id = t.id) and not exists (select 1 from war.cities c where c.tile_id = t.id) limit 1`, cap2.tile_id);
  ok(!!spot, '준비: 2번 나라 수도 바로 옆 빈 칸');
  if (spot) {
    const id = (await q1('select coalesce(max(id),0)+1 n from war.units')).n;
    await db.query(`insert into war.units(id, country, kind, hp, moves_left, commander, moves_turn) values ($1,1,'spear',100,2,'army',0)`, [id]);
    await db.query('select war.place_unit($1, $2)', [id, spot.id]);
    await db.exec(ops('combat-off.sql'));
    ok((await gameRow()).combat_on === false, 'combat-off.sql 실행 → 전투 잠김');
    ok(await fail(rpc(byCountry[1].army.uid, 'war_attack', id, cap2.tile_id), 'NO_COMBAT'), '잠금 중에는 공격이 막힘 (NO_COMBAT)');
    const cap1 = await q1(`select id from war.cities where country = 1 and kind = 'capital'`);
    const prodErr = await rpc(byCountry[1].army.uid, 'war_produce', cap1.id, 'spear').then(() => '', e => e.message);
    ok(!/NO_COMBAT/.test(prodErr), '잠금은 생산·예산 연습을 막지 않음 (생산 시도가 NO_COMBAT 로 막히지 않음)');
    await db.exec(ops('combat-on.sql'));
    ok((await gameRow()).combat_on === true, 'combat-on.sql 실행 → 전투 풀림');
    const r = await rpc(byCountry[1].army.uid, 'war_attack', id, cap2.tile_id);
    ok(r.damage !== undefined, '풀린 뒤에는 공격이 됨');
  }
}

// ================= 5. 재접속 =================
console.log('— 5. 재접속: 새로고침 · 웨일북 재시작 · 익명 로그인 분실');
{
  const s = byCountry[3].army;
  const before = await rpc(s.uid, 'war_me');
  // 새로고침/재시작 = 같은 로그인(uid)으로 다시 war_me. 그 사이 턴이 넘어가도 같아야 해요.
  const g = await gameRow(); await rpc(seed.ADMIN, 'war_next_turn', g.turn);
  const after = await rpc(s.uid, 'war_me');
  ok(after.role === 'army' && after.country.id === 3 && before.role === after.role, '새로고침·재시작(같은 로그인): 같은 나라·같은 역할');
  const pollA = await rpc(s.uid, 'war_poll', {});
  ok(pollA.units.length > 0, '새로고침 뒤 war_poll 이 지도·병력을 다시 줌');

  // 로그인이 날아간 경우: 새 익명 uid 는 모르는 사람 → 무역 앱에서 다시 연결해야 해요
  const lost = randomUUID();
  ok(await fail(rpc(lost, 'war_me'), 'NO_AUTH'), '로그인 분실: 새 uid 는 NO_AUTH (화면이 「무역 앱에서 먼저 접속해 주세요」를 보여 줌)');
  // 교사: 무역 관제실 > 명단·연결 > 그 학생 「연결 초기화」
  await rpc(seed.ADMIN, 'admin_reset_binding', s.id);
  ok(await fail(rpc(s.uid, 'war_me'), 'NO_AUTH'), '연결 초기화 뒤 옛 기기는 접속 끊김');
  // 학생: 무역 앱에서 자기 자리를 다시 고름 (닉네임은 그대로 쓰면 돼요)
  const j = await rpc(lost, 'join_student', s.id, '별' + s.id);
  if (j.status === 'pending') {
    const pr = await q1('select id from priv.pairing_requests order by id desc limit 1');
    await rpc(seed.ADMIN, 'admin_approve', pr.id);
  }
  const re = await rpc(lost, 'war_me');
  ok(re.role === 'army' && re.country.id === 3, '다시 연결하면 같은 나라·같은 역할(육군)로 돌아옴 — 역할은 로그인이 아니라 학생 번호에 붙어 있어요');
  const myUnits = (await rpc(lost, 'war_poll', {})).units.filter(u => u.country === 3 && u.commander === 'army').length;
  const dbUnits = (await q1(`select count(*)::int n from war.units where country = 3 and commander = 'army'`)).n;
  ok(myUnits === dbUnits && dbUnits > 0, `육군 병력 ${dbUnits}개를 그대로 조종함 (잃은 것 없음)`);

  // 연결을 못 살릴 때(기기 고장·학생 결석): 결석 표시 → 합참의장이 그 역할을 대신함
  const navy4 = byCountry[4].navy, chief4 = byCountry[4].chief;
  const cap4 = await q1(`select id from war.cities where country = 4 and kind = 'capital'`);
  const before2 = await rpc(chief4.uid, 'war_produce', cap4.id, 'destroyer').then(() => '', e => e.message);
  ok(/ROLE_ONLY/.test(before2), '준비: 해군이 자리에 있으면 합참의장은 해군 일을 못 함 (ROLE_ONLY)');
  await rpc(seed.ADMIN, 'war_admin_set_absent', navy4.id, true);
  const dep = await rpc(chief4.uid, 'war_produce', cap4.id, 'destroyer').then(() => '', e => e.message);
  ok(!/ROLE_ONLY/.test(dep), '결석 표시를 하면 합참의장이 그 역할의 일을 대신할 수 있음 (ROLE_ONLY 로 막히지 않음' + (dep ? ' · 다른 이유: ' + dep.slice(0, 40) : '') + ')');
  await rpc(seed.ADMIN, 'war_admin_set_absent', navy4.id, false);
}

ctx.summary();
