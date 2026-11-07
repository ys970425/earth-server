// E2 시험 (H3): 접속(war_me)·역할 고르기·바뀐 것만 받기(war_poll)·교사 역할 관리
// 실행: node tests/war/e2.test.mjs  (또는 npm run test:war:e2)
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx);
  const { db, one, ok, rpc, fail } = ctx;
  const dir = new URL('../../supabase/war/', import.meta.url);
  for (const f of ['schema.sql', 'config.sql', 'functions.sql']) {
    await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const of = c => seed.students.filter(s => s.country_id === c);
  const [c1a, c1b, c1c, c1d, c1e] = of(1);   // 5명 모둠
  const [c2a, c2b] = of(2);                  // 4명 모둠

  // ---------- 역할 고르기 ----------
  ok((await rpc(c1a.uid, 'war_choose_role', 'chief')).role === 'chief', '역할 고르기 성공');
  ok(await fail(rpc(c1b.uid, 'war_choose_role', 'chief'), 'ROLE_TAKEN'), '같은 역할 두 번째 학생 거절');
  ok(await fail(rpc(c2a.uid, 'war_choose_role', 'engineer'), 'FOUR_GROUP'), '4명 모둠은 공병사령관을 고를 수 없음');
  ok(await fail(rpc(c1a.uid, 'war_choose_role', 'army'), 'HAS_ROLE'), '이미 역할 있는 학생이 또 고르기 거절');
  ok(await fail(rpc(randomUUID(), 'war_choose_role', 'chief'), 'NO_AUTH'), '연결 안 된 uid는 NO_AUTH');
  ok(await fail(rpc(null, 'war_me'), 'NO_AUTH'), '로그인 없는 uid는 NO_AUTH');
  ok(await fail(rpc(randomUUID(), 'war_me'), 'NO_AUTH: 무역 앱에서 먼저 접속해 주세요'), '무역 앱에 연결 안 된 uid 안내 문구');
  await rpc(c1b.uid, 'war_choose_role', 'army');
  await rpc(c1c.uid, 'war_choose_role', 'navy');
  await rpc(c1d.uid, 'war_choose_role', 'air');
  await rpc(c2a.uid, 'war_choose_role', 'chief');

  // ---------- war_me ----------
  const me = await rpc(c1a.uid, 'war_me');
  ok(me.country.id === 1 && me.role === 'chief' && me.country.color, 'war_me: 나라(번호·색)와 내 역할');
  ok(Array.isArray(me.countries) && me.countries.length === 6 &&
    me.countries.every(c => Object.keys(c).sort().join() === 'id,name,type' && typeof c.id === 'number'),
    'war_me의 countries는 6개 나라의 번호·이름·유형만 (코인·창고 등 없음)');
  ok(me.menus.length === 6 && me.menus.includes('외교') && !me.menus.includes('노동자'),
    '5명 모둠 합참 메뉴는 합참 것만 (' + me.menus.join(', ') + ')');
  const me4 = await rpc(c2a.uid, 'war_me');
  ok(me4.menus.length === 12 && me4.menus.includes('노동자') && me4.menus.includes('외교'),
    '4명 모둠 합참 메뉴에 공병 메뉴 포함 (' + me4.menus.length + '개)');
  ok(me.deputy_roles.some(d => d.key === 'engineer') && me.deputy_roles.every(d => d.key !== 'army'),
    '빈 역할은 합참 대행 목록에, 채워진 역할은 없음');
  // 결석 표시 → 대행 목록에 나옴
  await rpc(seed.ADMIN, 'war_admin_set_absent', c1b.id, true);
  const meAbsent = await rpc(c1a.uid, 'war_me');
  ok(meAbsent.deputy_roles.some(d => d.key === 'army' && d.absent), '결석 표시한 역할이 합참 대행 목록에 나옴');
  const str = JSON.stringify(meAbsent);
  ok(!str.includes('학생'), 'war_me에 실명이 없음 (역할 이름·닉네임만)');

  // ---------- war_poll ----------
  const full = await rpc(c1a.uid, 'war_poll');
  ok(['game', 'map', 'units', 'cities', 'diplomacy', 'country', 'notice'].every(k => full[k] !== undefined),
    '처음(빈 p_known)엔 모든 영역을 돌려줌');
  ok(full.map.length === 1120, '지도 전체 칸 1120');
  ok(full.units.length > 0 && full.units.every(u => 'commander' in u), '병력 전체 목록에 조종 역할 포함');
  ok(full.diplomacy.length === 15 && full.diplomacy.every(d => d.status === 'peace'), '외교 15쌍');
  ok(full.country.country === 1 && full.country.coin !== undefined && full.country.inventory &&
    full.country.roles && Array.isArray(full.country.facilities), 'country 영역: 국고·창고·지갑·시설·역할 현황');
  ok(full.game.turn_seconds === 180 && full.game.combat_on && !full.game.paused, 'game 영역: 턴 180초·전투 켜짐·정지 아님');
  // 다른 나라의 창고·지갑이 없음
  const cstr = JSON.stringify(full.country);
  ok(!cstr.includes('"country":2') && !cstr.includes('"country":3') && !cstr.includes('"country":4'),
    'country 영역에 다른 나라 데이터가 없음');
  // 같은 번호로 다시 부르면 versions 말고 아무 영역도 없음
  const known = { ...full.versions, country: full.versions['country:1'] };
  const quiet = await rpc(c1a.uid, 'war_poll', known);
  ok(quiet.versions && !quiet.game && !quiet.map && !quiet.units && !quiet.cities &&
    !quiet.diplomacy && !quiet.country && !quiet.notice, '같은 번호로 다시 부르면 versions 말고 아무 영역도 없음');
  // 역할을 고르면 country만 돌아옴 (다른 웨일북에 4초 안에 반영되게)
  await rpc(c1e.uid, 'war_choose_role', 'engineer');
  const afterChoose = await rpc(c1a.uid, 'war_poll', known);
  ok(afterChoose.country && !afterChoose.map && !afterChoose.units && !afterChoose.game &&
    !afterChoose.diplomacy && !afterChoose.cities && !afterChoose.notice, '역할을 고르면 country 영역만 돌아옴');
  ok(afterChoose.country.roles.some(r => r.key === 'engineer' && r.nick), 'country 영역의 역할 현황에 새 역할이 보임');
  const otherCountry = (await one(`select ver::bigint v from war.versions where area = 'country' and country = 2`)).v;
  const forC2 = await rpc(c2a.uid, 'war_poll', { ...known, country: 0 });
  ok(forC2.country && forC2.country.country === 2 && !forC2.map, '2번 나라 학생은 country를 다시 받으면 자기 나라만 받음');
  ok(!JSON.stringify(forC2.country).includes('"country":1'), '2번 나라 학생의 country 영역에 1번 나라 데이터가 없음');

  // ---------- 학생은 교사 함수 실행 불가 ----------
  ok(await fail(rpc(c1b.uid, 'war_admin_roles'), 'NOT_ADMIN'), '학생은 역할 현황을 볼 수 없음');
  ok(await fail(rpc(c1b.uid, 'war_admin_set_absent', c1c.id, true), 'NOT_ADMIN'), '학생은 결석 표시를 못 함');
  ok(await fail(rpc(c1b.uid, 'war_admin_set_role', c1c.id, null), 'NOT_ADMIN'), '학생은 역할 지정을 못 함');

  // ---------- 교사 기능 ----------
  const roles = await rpc(seed.ADMIN, 'war_admin_roles');
  ok(roles.roles.length === 25 && roles.roles.every(r => !('name' in r)),
    '교사 역할 현황 25명 (닉네임만)');
  ok(roles.roles.filter(r => r.country === 1 && r.role).length === 5, '1번 나라 역할 5개 기록');
  await rpc(seed.ADMIN, 'war_admin_set_absent', c1b.id, false);
  ok((await db.query(`select absent from war.roles where student = $1`, [c1b.id])).rows[0].absent === false,
    '교사가 결석 표시 끄기');
  await rpc(seed.ADMIN, 'war_admin_set_role', c1e.id, null);
  ok((await db.query(`select count(*)::int n from war.roles where student = $1`, [c1e.id])).rows[0].n === 0,
    '교사가 역할 비우기 (null)');
  await rpc(seed.ADMIN, 'war_admin_set_role', c1a.id, null);
  await rpc(seed.ADMIN, 'war_admin_set_role', c1e.id, 'chief');
  ok((await db.query(`select role from war.roles where student = $1`, [c1e.id])).rows[0].role === 'chief',
    '교사가 chief 지정 (다른 학생이 고른 역할도 바꿀 수 있음)');
  ok(await fail(rpc(seed.ADMIN, 'war_admin_set_role', c1b.id, 'chief'), 'ROLE_TAKEN'),
    '이미 다른 친구가 가진 역할로 지정하면 거절');
  ok(await fail(rpc(seed.ADMIN, 'war_admin_set_role', c2b.id, 'engineer'), 'FOUR_GROUP'),
    '4명 모둠에 engineer 지정 거절');
} catch (e) {
  ctx.ok(false, '예외: ' + e.message);
}
ctx.summary();
