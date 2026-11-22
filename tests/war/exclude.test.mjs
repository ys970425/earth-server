// 가져오기에서 학생 빼기 시험: 반 25명인데 무역 데이터에는 30명(모둠마다 5명)이 있을 때,
// 시험용 계정을 뺀 모둠이 「4명 모둠 규칙」을 받는지 · 뺀 학생은 전쟁판에서 없는 사람인지 · 무역 표는 그대로인지 증명한다.
// (학생 이름은 모두 가짜이고, 이 시험은 이름을 출력하지 않아요.)
// 실행: npm run test:war:exclude
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDb, seedTradeState, tradeFingerprint } from './helpers.mjs';

const ctx = await createDb();
const { db, rpc, ok, fail } = ctx;
const seed = await seedTradeState(ctx);
for (const f of ['schema.sql', 'config.sql', 'functions.sql']) await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
await rpc(seed.ADMIN, 'war_admin_import', '초기화');
const q1 = async (sql, ...a) => (await db.query(sql, a)).rows[0];

// ---- 30명 만들기: 무역 시드는 25명(1모둠 5명, 나머지 4명). 2~6모둠에 「시험용 계정」을 한 명씩 더해 모둠마다 5명으로 ----
const extra = {};
for (let c = 2; c <= 6; c++) {
  const uid = randomUUID();
  const r = await q1(`insert into priv.students(country_id, no, name, uid, bound_at, nickname) values ($1, $2, $3, $4, now(), $5) returning id`,
    c, 90 + c, '가짜시험계정' + c, uid, '시험' + c);
  extra[c] = { id: r.id, uid, country: c };
}
const mem = c => seed.students.filter(s => s.country_id === c);   // 시드 학생 (1모둠 5명, 나머지 4명)
const size = async c => (await rpc(mem(c)[0].uid, 'war_me')).country.size;
const setRole = (s, c, role) => db.query(`insert into war.roles(student, country, role) values ($1,$2,$3) on conflict (student) do update set role = $3`, [s.id, c, role]);
const total = (await q1('select count(*)::int n from priv.students')).n;
ok(total === 30, '준비: 무역 데이터에 학생 30명 (모둠마다 5명)');
const tradeBefore = await tradeFingerprint(db);

// ================= 1. 목록·권한 =================
console.log('— 1. 가져오기 학생 목록');
{
  const list = (await rpc(seed.ADMIN, 'war_admin_students')).students;
  ok(list.length === 30 && list.every(s => s.excluded === false), '교사 목록: 30명 모두 (처음엔 아무도 안 뺌)');
  const perC = {}; for (const s of list) perC[s.country] = (perC[s.country] || 0) + 1;
  ok(Object.values(perC).every(n => n === 5), '모둠마다 5명으로 보임');
  ok(list.every(s => 'name' in s && 'id' in s && 'country' in s), '교사 목록에는 이름·번호·모둠이 있음 (교사 화면에만 써요)');
  ok(await fail(rpc(mem(2)[0].uid, 'war_admin_students'), 'NOT_ADMIN'), '학생은 목록을 못 봄');
  ok(await fail(rpc(mem(2)[0].uid, 'war_admin_set_excluded', [extra[2].id]), 'NOT_ADMIN'), '학생은 빼기를 못 바꿈');
}

// ================= 2. 빼기 전(5명 모둠): 규칙이 5명 기준 =================
console.log('— 2. 빼기 전에는 5명 모둠 규칙');
// 2번 나라: 합참·공병·육군 + (시험용 계정은 역할 없음). 합참의장은 공병 일을 못 한다 (공병 자리가 있으니까)
await setRole(mem(2)[0], 2, 'chief'); await setRole(mem(2)[1], 2, 'engineer'); await setRole(mem(2)[2], 2, 'army');
const scout2 = await q1(`select id, tile_id from war.units where country = 2 and kind = 'scout' order by id limit 1`);
const toTile = async s => (await q1(`select n.id from war.tiles t cross join lateral unnest(war.neighbors(t.c, t.r, (select max(c) + 1 from war.tiles))) nid join war.tiles n on n.id = nid
    where t.id = $1 and n.terrain in ('plains','forest','hills') and not exists (select 1 from war.units u where u.tile_id = n.id and u.kind in ('worker','scout')) limit 1`, s.tile_id)).id;
{
  ok((await size(2)) === 5, '2번 나라 인원 5명');
  ok(await fail(rpc(mem(2)[0].uid, 'war_move', scout2.id, [await toTile(scout2)]), 'ROLE_ONLY'), '5명 모둠: 공병이 자리에 있으면 합참의장이 공병 일(정찰병 이동)을 못 함');
  // 6번 나라: 5명이라 공병을 고를 수 있다
  const r6 = await rpc(mem(6)[1].uid, 'war_choose_role', 'engineer');
  ok(r6.ok, '5명 모둠(6번 나라): 공병사령관을 고를 수 있음');
  // 5번 나라: 교사가 공병으로 지정할 수 있다
  ok((await rpc(seed.ADMIN, 'war_admin_set_role', mem(5)[1].id, 'engineer')).ok, '5명 모둠(5번 나라): 교사가 공병으로 지정할 수 있음');
  await rpc(seed.ADMIN, 'war_admin_set_role', mem(5)[1].id, null);
  // 3번 나라에 시험용 계정이 역할·미션 기록을 가지고 있었다면, 빼면 지워져야 한다
  await setRole(extra[3], 3, 'navy');
  await db.query(`insert into war.mission_done(student, mission) values ($1, 'x_probe')`, [extra[3].id]);
}

// ================= 3. 빼기: 2~6모둠의 시험용 계정 5명 =================
console.log('— 3. 시험용 계정 5명 빼기 → 25명');
const ids = Object.values(extra).map(e => e.id);
{
  const ex = await rpc(seed.ADMIN, 'war_admin_set_excluded', ids);
  ok(ex.ok && ex.excluded === 5, '5명을 뺌');
  ok(ex.sizes['1'] === 5 && [2, 3, 4, 5, 6].every(c => ex.sizes[String(c)] === 4), '모둠 인원: 1모둠 5명, 2~6모둠 4명 (반 25명)');
  const list = (await rpc(seed.ADMIN, 'war_admin_students')).students;
  ok(list.length === 30 && list.filter(s => s.excluded).length === 5, '교사 목록에는 30명이 그대로 있고 5명이 「뺌」으로 표시');
  ok((await rpc(seed.ADMIN, 'war_admin_roles')).roles.length === 25, '역할 지정 표에는 25명만 나옴');
  ok((await rpc(seed.ADMIN, 'war_admin_missions')).missions.length === 25, '미션 현황에도 25명만 나옴');
  ok((await q1('select count(*)::int n from war.roles where student = $1', extra[3].id)).n === 0, '뺀 학생의 역할 기록이 지워짐');
  ok((await q1('select count(*)::int n from war.mission_done where student = $1', extra[3].id)).n === 0, '뺀 학생의 미션 기록도 지워짐');
}

// ================= 4. 4명 모둠 규칙이 뺀 인원으로 적용되는가 =================
console.log('— 4. 뺀 뒤 4명이 된 모둠에 4명 모둠 규칙');
{
  const me2 = await rpc(mem(2)[0].uid, 'war_me');
  ok(me2.country.size === 4 && (await size(1)) === 5, 'war_me: 2번 나라 크기 4, 1번 나라 크기 5');
  const cfg = (await q1(`select war.cfg()->'ROLES' r`)).r.find(r => r.key === 'chief');
  ok(JSON.stringify(me2.menus) === JSON.stringify(cfg.menus4) && JSON.stringify(me2.menus) !== JSON.stringify(cfg.menus),
    '4명 모둠 합동참모의장은 공병 메뉴까지 가진 메뉴(menus4)를 받음');
  const me1 = await rpc(mem(1)[0].uid, 'war_me'); await setRole(mem(1)[0], 1, 'chief');
  ok(JSON.stringify((await rpc(mem(1)[0].uid, 'war_me')).menus) === JSON.stringify(cfg.menus), '5명 모둠(1번 나라) 합동참모의장은 기본 메뉴(menus)');
  // 의장이 공병 일을 겸함: 공병 자리에 사람이 있어도 4명 모둠이면 의장이 정찰병을 움직일 수 있다
  const mv = await rpc(mem(2)[0].uid, 'war_move', scout2.id, [await toTile(scout2)]);
  ok(mv.ok === true, '4명 모둠: 합참의장이 공병 일(정찰병 이동)을 겸함 — 빼기 전에는 ROLE_ONLY 였어요');
  // 4명 모둠은 공병을 고르거나 지정할 수 없다
  ok(await fail(rpc(mem(5)[1].uid, 'war_choose_role', 'engineer'), 'FOUR_GROUP'), '4명 모둠: 학생이 공병을 고를 수 없음 (FOUR_GROUP)');
  ok(await fail(rpc(seed.ADMIN, 'war_admin_set_role', mem(5)[1].id, 'engineer'), 'FOUR_GROUP'), '4명 모둠: 교사도 공병으로 지정할 수 없음 (FOUR_GROUP)');
  ok((await rpc(seed.ADMIN, 'war_admin_set_role', mem(5)[1].id, 'army')).ok, '나머지 역할(육군)은 지정할 수 있음');
  // 1번 나라(5명 모둠)는 그대로 공병을 지정할 수 있다
  ok((await rpc(seed.ADMIN, 'war_admin_set_role', mem(1)[1].id, 'engineer')).ok, '5명 모둠은 계속 공병을 지정할 수 있음');
}

// ================= 5. 뺀 학생은 전쟁판에서 없는 사람 =================
console.log('— 5. 뺀 학생의 접속·행동');
{
  const x = extra[4];
  for (const fn of ['war_me', 'war_poll']) ok(await fail(rpc(x.uid, fn), 'NOT_IN_WAR'), `뺀 학생: ${fn} → NOT_IN_WAR`);
  ok(await fail(rpc(x.uid, 'war_choose_role', 'army'), 'NOT_IN_WAR'), '뺀 학생은 역할을 고를 수 없음');
  const u = await q1(`select id, tile_id from war.units where country = 4 and kind not in ('worker','scout') order by id limit 1`);
  ok(await fail(rpc(x.uid, 'war_move', u.id, [0]), 'NOT_IN_WAR'), '뺀 학생은 병력을 움직일 수 없음');
  ok(await fail(rpc(seed.ADMIN, 'war_admin_set_role', x.id, 'army'), 'EXCLUDED'), '교사도 뺀 학생에게 역할을 줄 수 없음 (먼저 다시 넣어야 해요)');
  ok((await rpc(mem(4)[0].uid, 'war_me')).country.id === 4, '같은 모둠의 다른 학생은 정상');
}

// ================= 6. 다시 가져와도(초기화) 뺀 목록은 유지 =================
console.log('— 6. 다시 가져와도 뺀 목록 유지');
{
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  ok((await rpc(seed.ADMIN, 'war_admin_students')).students.filter(s => s.excluded).length === 5, '가져오기(초기화) 뒤에도 뺀 5명이 그대로');
  ok((await q1('select count(*)::int n from war.roles')).n === 0, '가져오기 뒤 역할은 비어 있음 (새로 고르면 돼요)');
  ok(await size(2) === 4, '다시 가져온 뒤에도 2번 나라는 4명 모둠');
  ok(await fail(rpc(extra[2].uid, 'war_me'), 'NOT_IN_WAR'), '뺀 학생은 여전히 접속 불가');
}

// ================= 7. 다시 넣기 · 없는 번호 · 비우기 =================
console.log('— 7. 다시 넣기');
{
  const ex = await rpc(seed.ADMIN, 'war_admin_set_excluded', [extra[2].id, 99999]);
  ok(ex.excluded === 1 && ex.sizes['2'] === 4 && ex.sizes['3'] === 5, '없는 번호(99999)는 무시, 2번 나라만 뺌 → 3번 나라는 다시 5명');
  const all = await rpc(seed.ADMIN, 'war_admin_set_excluded', []);
  ok(all.excluded === 0 && Object.values(all.sizes).every(n => n === 5), '빈 목록으로 저장하면 모두 포함 (모둠마다 5명)');
  ok((await rpc(extra[2].uid, 'war_me')).country.id === 2, '다시 넣은 학생은 접속됨');
  const nul = await rpc(seed.ADMIN, 'war_admin_set_excluded', null);
  ok(nul.ok && nul.excluded === 0, 'null 도 「빈 목록」으로 처리');
}

// ================= 8. 무역 표는 한 글자도 안 바뀜 =================
console.log('— 8. 무역 데이터 불변');
{
  const after = await tradeFingerprint(db);
  const changed = Object.keys(tradeBefore).filter(k => tradeBefore[k] !== after[k]);
  ok(changed.length === 0, '빼기·되돌리기·가져오기를 해도 무역 표(priv·public)가 그대로' + (changed.length ? ' — 바뀐 표: ' + changed.join(',') : ''));
}

ctx.summary();
