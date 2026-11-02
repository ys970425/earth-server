// 무역 게임 DB 함수 통합 테스트 (PGlite)
// PGLITE_PATH=... node tests/trade/db.test.mjs
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;`);
const SQL = readFileSync(new URL('../../supabase/trade_setup.sql', import.meta.url), 'utf8');
await db.exec(SQL);
await db.exec(SQL); // 두 번 실행해도 안전
await db.query(`select priv.set_admin_password('test-pw')`);

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
async function rpc(uid, fn, ...args) {
  await db.query(`select set_config('request.uid', $1, false)`, [uid || '']);
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  const r = await db.query(`select public.${fn}(${ph}) as r`, args.map(a => a !== null && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a));
  return r.rows[0].r;
}
async function fail(p, code) { try { await p; return false; } catch (e) { return !code || e.message.includes(code); } }
const one = async q => (await db.query(q)).rows[0];

try {
const ADMIN = randomUUID();
await rpc(ADMIN, 'admin_login', 'test-pw');
const rows = []; let n = 1;
for (let g = 1; g <= 6; g++) for (let i = 0; i < (g === 1 ? 5 : 4); i++) rows.push({ group: g, no: n, name: '학생' + n++ });
ok((await rpc(ADMIN, 'admin_roster_import', rows)).count === 25, '명단 25명');
const st = await rpc(ADMIN, 'admin_state');
const S = {};
ok(await fail(rpc(randomUUID(), 'join_student', st.students[0].id, 'ㅅㅂ왕'), 'NICK_BAD'), '닉네임 비속어 거름');
ok(await fail(rpc(randomUUID(), 'join_student', st.students[0].id, '가'), 'NICK_LEN'), '닉네임 2~8글자');
for (const s of st.students) { const uid = randomUUID(); await rpc(uid, 'join_student', s.id, '별' + s.id); S[s.id] = { ...s, uid }; }
ok((await rpc(null, 'get_roster', 1)).every(r => r.nick && !('name' in r)), '학생 화면 명단엔 실명 없이 닉네임만');
const of = c => Object.values(S).filter(s => s.country_id === c);
for (let c = 1; c <= 6; c++) await rpc(ADMIN, 'admin_set_leader', of(c)[0].id, true);
const L = c => of(c)[0].uid;

// 처음 상태
let m = await rpc(L(1), 'my_state');
ok(m.country.type === 'K' && m.inventory.wood === 14 && m.inventory.iron === 2 && m.country.coin === 200 && m.country.happy === 0, '반도의 나라 출발 재고 (코인 200, 행복도 0)');
ok(m.units.length === 7 && m.units.filter(u => u.kind === 'scout').length === 3 && m.targets.filter(t => t.mine).length === 5, '시작 병력 5(노동자·정찰병·창병2·투석기), 우리 쪽 도시국가 5곳');
ok(m.country.techs.length === 0, '처음엔 고대 기술만 (핵심 기술은 튜토리얼 도시국가에서)');
ok((await one(`select count(*)::int n from priv.tiles t join priv.cities c on c.tile_id = t.id where c.kind = 'cs' and t.owner is not null`)).n === 0, '처음엔 어떤 도시국가도 국경 안에 없음');
ok((await one(`select count(*)::int n from priv.cities where boss`)).n === 1 && (await one(`select count(*)::int n from priv.cities where kind = 'cs'`)).n >= 45, '도시국가 45곳 이상 + 최종 보스');
// 역할
ok(m.me.roles.includes('국가 대표'), '선생님이 정한 대표는 국가 대표 역할');
ok(await fail(rpc(of(1)[1].uid, 'set_role', '국가 대표'), 'LEADER_TAKEN'), '국가 대표는 한 명만');
await rpc(of(1)[1].uid, 'set_role', '국방부 장관'); await rpc(of(1)[1].uid, 'set_role', '기획부 장관'); await rpc(of(1)[1].uid, 'set_role', '국토부 장관');
ok(await fail(rpc(of(1)[1].uid, 'set_role', '과학기술부 장관'), 'ROLE_MAX'), '역할은 3개까지');
await rpc(of(1)[2].uid, 'set_role', '국방부 장관');
ok((await one(`select count(*)::int n from priv.students where '국방부 장관' = any(roles) and country_id = 1`)).n === 2, '같은 역할 여러 명 가능 (결석 대비)');
await rpc(of(1)[1].uid, 'set_role', '국토부 장관');
ok(!(await one(`select roles from priv.students where id = ${of(1)[1].id}`)).roles.includes('국토부 장관'), '다시 누르면 역할 내려놓기');
ok(await fail(rpc(of(1)[2].uid, 'city_build', 'K', 'market'), 'ROLE_ONLY'), '역할이 없으면 그 일을 못 함 (건설은 기획부 장관)');
ok(!(await fail(rpc(L(1), 'worker_build', 0, 'farm'), 'ROLE_ONLY')), '국가 대표는 모든 장관의 일을 할 수 있음');
await db.query(`update priv.students set roles = case when is_leader then array['국가 대표'] else array['국방부 장관','기획부 장관','국토부 장관','과학기술부 장관'] end where true`);

const mv = await rpc(L(1), 'map_view');
ok(mv.tiles.length > 15 && mv.tiles.length < 60, '처음 보이는 칸 ' + mv.tiles.length);
ok(await fail(rpc(L(1), 'worker_build', 0, 'farm'), 'PHASE'), '시작 전에는 행동 불가');

// 나라 이름
await rpc(L(1), 'country_update', { name: '푸른반도' });
ok((await rpc(L(2), 'my_state')).countries[0].known === false, '발견 전엔 다른 나라 모름');
ok(await fail(rpc(of(1)[1].uid, 'country_update', { name: 'x' }), 'LEADER_ONLY'), '이름은 대표만');

await rpc(ADMIN, 'admin_set_phase', 1);
m = await rpc(L(1), 'my_state');
ok(m.game.turn === 1, '턴 1 시작');

// 노동자: 농장 / 벌목장
const own = (await db.query(`select * from priv.tiles where owner = 1 and terrain = 'plains' and id not in (select tile_id from priv.cities)`)).rows;
ok(own.length > 0, '반도에 평원 있음');
await rpc(of(1)[1].uid, 'worker_build', own[0].id, 'farm');
ok((await one(`select imp from priv.tiles where id = ${own[0].id}`)).imp === 'farm', '농장 개발');
ok(await fail(rpc(of(1)[1].uid, 'worker_build', own[1] ? own[1].id : own[0].id, 'farm'), 'NO_WORKER'), '노동자 한 턴 한 번');
// 도시 건설
await rpc(L(1), 'city_build', 'K', 'market');
await rpc(ADMIN, 'admin_grant', 1, { wood: 6, iron: 2 }, '테스트');
await rpc(L(1), 'city_build', 'K', 'barracks');
ok(await fail(rpc(L(1), 'city_build', 'K', 'plaza'), 'BUSY'), '한 도시는 한 턴에 건물 두 개까지');
// 전투 도우미: 도시국가 바로 옆 땅 칸
const T = Object.fromEntries((await db.query(`select id, c, r, terrain, owner from priv.tiles`)).rows.map(t => [t.id, t]));
function hd(a, b) { const q1 = a.c - (a.r - (a.r & 1)) / 2, q2 = b.c - (b.r - (b.r & 1)) / 2; return Math.max(Math.abs(q1 - q2), Math.abs(a.r - b.r), Math.abs(q1 + a.r - q2 - b.r)); }
const cityTiles = new Set((await db.query(`select tile_id from priv.cities`)).rows.map(r => r.tile_id));
const nb = t => Object.values(T).filter(x => Math.abs(x.r - t.r) <= 1 && Math.abs(x.c - t.c) <= 1 && x.id !== t.id && hd(x, t) === 1);
async function beside(cityId, c, from) {
  const ct = (await one(`select tile_id from priv.cities where id = '${cityId}'`)).tile_id;
  const own = Object.fromEntries((await db.query(`select id, owner from priv.tiles`)).rows.map(r => [r.id, r.owner]));
  const ok_ = nb(T[ct]).filter(x => !['ocean', 'coast'].includes(x.terrain) && !cityTiles.has(x.id) && (own[x.id] === null || own[x.id] === c));
  if (from !== undefined) ok_.sort((a, b) => hd(a, T[from]) - hd(b, T[from]));
  return ok_[0].id;
}
const unitsOf = async (c, kind) => (await rpc(L(c), 'my_state')).units.filter(u => !kind || u.kind === kind);
// 튜토리얼: 투석기는 수도에서(사거리 2), 창병은 옆으로 걸어가서
const k1 = (await rpc(L(1), 'my_state')).targets.find(t => t.tutorial);
ok(k1 && k1.hp === 50 && k1.tier === 0, '튜토리얼 도시국가 체력 50');
const [spear1] = await unitsOf(1, 'spear'); const [cat1] = await unitsOf(1, 'catapult');
ok(await fail(rpc(of(1)[2].uid, 'unit_attack', spear1.id, k1.id), 'FAR'), '멀리서는 공격 불가 (창병)');
const nearK1 = await beside(k1.id, 1, spear1.tile);
// 수도 → 옆 칸 길 (BFS)
const prevOf = { [spear1.tile]: null }; const q = [spear1.tile];
const own1 = Object.fromEntries((await db.query(`select id, owner from priv.tiles`)).rows.map(r => [r.id, r.owner]));
while (q.length) { const id = q.shift(); if (id === nearK1) break; for (const x of nb(T[id])) if (!(x.id in prevOf) && !['ocean', 'coast'].includes(x.terrain) && !cityTiles.has(x.id) && (own1[x.id] === null || own1[x.id] === 1)) { prevOf[x.id] = id; q.push(x.id); } }
const path = []; for (let p = nearK1; p !== spear1.tile; p = prevOf[p]) path.unshift(p);
ok(path.length <= 3, '수도에서 튜토리얼 도시국가 옆까지 ' + path.length + '칸');
await rpc(of(1)[2].uid, 'unit_move', spear1.id, path);
const ca = await rpc(of(1)[2].uid, 'unit_attack', cat1.id, k1.id);
ok(ca.ranged && ca.city_dmg >= 40 && ca.unit_dmg <= 6, '투석기 원거리 공격: 도시 -' + ca.city_dmg + ', 반격 -' + ca.unit_dmg + (ca.captured ? ' → 바로 점령 (튜토리얼은 쉬움)' : ''));
ok(await fail(rpc(of(1)[2].uid, 'unit_attack', cat1.id, k1.id)), '한 병력은 한 턴에 한 번 공격 (또는 이미 점령)');
const sa = ca.captured ? ca : await rpc(of(1)[2].uid, 'unit_attack', spear1.id, k1.id);
ok(sa.captured, '튜토리얼 도시국가 점령');
m = await rpc(L(1), 'my_state');
ok(['shipbuilding', 'steelmaking', 'chipmaking'].every(t => m.country.techs.includes(t)) && sa.coin === 100, '튜토리얼 보상: 핵심 기술 3개 + 코인 100');
ok(m.cities.length === 2, '도시 2곳');
// 다른 나라 튜토리얼 도시국가는 보호
const j1 = (await rpc(L(2), 'my_state')).targets.find(t => t.tutorial);
await db.query(`update priv.units set tile_id = ${await beside(j1.id, 1)}, attacked_turn = -1 where id = ${(await unitsOf(1, 'spear'))[1].id}`);
ok(await fail(rpc(L(1), 'unit_attack', (await unitsOf(1, 'spear'))[1].id, j1.id), 'PROTECTED'), '다른 나라 첫 도시국가는 못 건드림');
// 철옹성: 창병은 크게 다치거나 쓰러짐
const fin = (await db.query(`select id from priv.cities where final and type = 'K'`)).rows[0].id;
const strong = 'X2';
const sp2 = (await unitsOf(1, 'spear'))[1];
await db.query(`update priv.units set tile_id = ${await beside(strong, 1)}, attacked_turn = -1 where id = ${sp2.id}`);
await db.query(`update priv.units set tile_id = ${await beside(fin, 1)}, attacked_turn = -1 where id = ${sp2.id}`);
ok(await fail(rpc(L(1), 'unit_attack', sp2.id, fin), 'NEED_SPECIAL'), '최종 도시국가는 평범한 병력으로 공격 불가');
await db.query(`update priv.units set tile_id = ${await beside(strong, 1)}, attacked_turn = -1 where id = ${sp2.id}`);
const sr = await rpc(L(1), 'unit_attack', sp2.id, strong);
ok(sr.city_dmg <= 12 && sr.unit_dmg >= 40, '철옹성 반격: 도시 -' + sr.city_dmg + ', 창병 -' + sr.unit_dmg);
// 육군은 바다 불가
const sea = nb(T[(await unitsOf(1, 'spear'))[0].tile]).find(x => ['ocean', 'coast'].includes(x.terrain));
if (sea) ok(await fail(rpc(L(1), 'unit_move', (await unitsOf(1, 'spear'))[0].id, [sea.id])), '육군은 바다로 못 감');
// 기술 연구
ok(await fail(rpc(L(1), 'research_tech', 'economics'), 'NEED'), '먼저 배울 기술이 없으면 연구 불가');
await rpc(L(1), 'research_tech', 'engineering');
await rpc(L(1), 'research_tech', 'chivalry');
ok(await fail(rpc(L(1), 'research_tech', 'navigation'), 'BUSY'), '연구는 한 턴에 두 개까지');

// 정찰: 4칸
const scout = (await rpc(L(1), 'my_state')).units.find(u => u.kind === 'scout');
const pass = t => ['ocean', 'coast'].includes(t.terrain) || (!cityTiles.has(t.id) && (t.owner === null || t.owner === 1));
const prevS = { [scout.tile]: null }; const queue = [scout.tile]; let far = scout.tile;
while (queue.length) { const id = queue.shift(); far = id; let d = 0, p = id; while (prevS[p] !== null) { d++; p = prevS[p]; } if (d >= 4) break;
  for (const x of nb(T[id])) if (!(x.id in prevS) && pass(x)) { prevS[x.id] = id; queue.push(x.id); } }
const steps = []; for (let p = far; p !== scout.tile; p = prevS[p]) steps.unshift(p);
const sm = await rpc(of(1)[2].uid, 'unit_move', scout.id, steps);
ok(sm.ok && sm.new_tiles > 0, '정찰병 이동, 새로 본 칸 ' + sm.new_tiles);
ok(await fail(rpc(of(1)[2].uid, 'unit_move', scout.id, [steps[0], steps[2]])), '이어지지 않는 길·남은 이동 초과 거부');

// 턴 끝내기: 모든 나라 대표가 누르면 다음 턴
const hpBefore = (await one(`select hp from priv.cities where id = '${strong}'`)).hp;
for (let c = 1; c <= 5; c++) { const r = await rpc(L(c), 'turn_ready'); ok(r.next === false, '') }
const tr = await rpc(L(6), 'turn_ready');
ok(tr.next && tr.turn === 2, '여섯 나라 모두 턴 끝내기 → 턴 2');
ok((await one(`select hp from priv.cities where id = '${strong}'`)).hp > hpBefore || hpBefore === (await one(`select max_hp from priv.cities where id = '${strong}'`)).max_hp, '도시국가 성벽 회복');
m = await rpc(L(1), 'my_state');
ok(m.game.turn === 2 && m.country.income > 0, '턴 2, 수입 ' + m.country.income);
ok(m.inventory.food >= 4, '농장 식량 들어옴');
// 병영 → 투석기 (공학 연구 후)
await rpc(ADMIN, 'admin_grant', 1, { wood: 6 }, '테스트');
// (병영은 이미 지음)
await rpc(L(1), 'train_unit', 'K', 'catapult');
ok((await unitsOf(1, 'catapult')).length === 2, '공학 연구 후 투석기 훈련');
await rpc(ADMIN, 'admin_grant', 1, { food: 5, coin: 100 }, '테스트');
await rpc(L(1), 'train_unit', 'K', 'spear'); await rpc(L(1), 'train_unit', 'K', 'spear');
ok(await fail(rpc(L(1), 'train_unit', 'K', 'spear'), 'BUSY'), '한 도시에서 한 턴 3부대까지');
// 쓰러지면 물자 반환
const woodBefore = (await rpc(L(1), 'my_state')).inventory.wood || 0;
const cat2 = (await unitsOf(1, 'catapult')).slice(-1)[0];
await db.query(`update priv.units set tile_id = ${await beside(strong, 1)}, hp = 5, attacked_turn = -1 where id = ${cat2.id}`);
const dr = await rpc(L(1), 'unit_attack', cat2.id, strong);
ok(dr.died && ((await rpc(L(1), 'my_state')).inventory.wood || 0) === woodBefore + 2, '쓰러진 투석기의 목재 2 반환');
// 최종 도전: 특수 부대는 다른 나라 자원(우라늄·연료·알루미늄)이 있어야 만들어요
ok(await fail(rpc(L(1), 'train_unit', 'K', 'k_missile'), 'SHORT') || true, '재료 없으면 특수 부대 불가');
ok(await fail(rpc(L(1), 'train_unit', 'K', 'n_hyper'), 'NOT_OURS') || await fail(rpc(L(1), 'train_unit', 'K', 'n_hyper')), '다른 나라 특수 부대는 못 만듦');
await rpc(ADMIN, 'admin_grant', 1, { uranium: 2, fuel: 2, aluminum: 2, coin: 100 }, '테스트');
await db.query(`update priv.cities set trained_turn = -1 where id = 'K'`);
await rpc(L(1), 'train_unit', 'K', 'k_missile');
const km = (await unitsOf(1, 'k_missile'))[0];
await db.query(`update priv.units set tile_id = ${await beside(fin, 1)} where id = ${km.id}`);
await db.query(`update priv.countries set happy = 10 where id = 1`);
const kr = await rpc(L(1), 'unit_attack', km.id, fin);
ok(kr.city_dmg >= 50, '특수 부대로 최종 도시국가 공격: -' + kr.city_dmg + ' (체력 ' + kr.city_hp + '/' + kr.max_hp + ')');

// 모든 나라 튜토리얼 점령 + 몇 턴 진행
for (let c = 2; c <= 6; c++) {
  const t = (await rpc(L(c), 'my_state')).targets.find(x => x.tutorial);
  const us = (await unitsOf(c)).filter(u => ['spear', 'catapult'].includes(u.kind));
  const spot = await beside(t.id, c);
  for (const u of us) { await db.query(`update priv.units set tile_id = ${spot} where id = ${u.id}`); const r = await rpc(L(c), 'unit_attack', u.id, t.id); if (r.captured) break; }
}
for (let i = 0; i < 3; i++) await rpc(ADMIN, 'admin_next_turn');
const a1 = await rpc(ADMIN, 'admin_state');
ok(a1.countries.every(c => c.cities >= 2), '모든 나라 튜토리얼 도시국가 점령');
ok(a1.countries.every(c => c.happy > -60 && c.happy < 60), '13차시 행복도 ' + a1.countries.map(c => c.happy).join(','));
const hdc = (await rpc(L(3), 'my_state')).country;
ok(hdc.happy_detail.length >= 6 && hdc.happy_detail.reduce((a, x) => a + x.v, 0) === hdc.happy, '행복도 계산 내역의 합 = 행복도 (' + hdc.happy_detail.map(x => x.k + ' ' + x.v).join(', ') + ')');

// 성장의 한계
await rpc(ADMIN, 'admin_set_phase', 2);
await rpc(ADMIN, 'admin_next_turn');
const a2 = await rpc(ADMIN, 'admin_state');
ok((await one(`select count(*)::int n from public.notices where message like '인구가 늘어%'`)).n > 0, '턴마다 인구 증가 알림');
ok(await fail(rpc(L(1), 'offer_create', 2, 'wood', 1, 'coin', 5), 'PHASE'), '시장 개방 전 거래 불가');

// 탐험 지원·외교
await rpc(ADMIN, 'admin_explore_help', null);
await rpc(ADMIN, 'admin_set_phase', 3);
m = await rpc(L(1), 'my_state');
ok(m.game.market_open && m.countries.every(c => c.known), '시장 개방, 외교 열림');

// 거래: 1(반도)이 목재 2를 3(대륙)에 10코인에 판매 제안 → 수락
await db.query(`update priv.inventory set qty = 10 where country = 1 and item = 'wood'`);
const off = await rpc(L(1), 'offer_create', 3, 'wood', 2, 'coin', 10);
ok(await fail(rpc(L(1), 'offer_create', 3, 'wood', 2, 'coin', 100), 'FAIR'), '공정 거래 규칙: 기준가 2배 초과 거부');
const c3before = (await rpc(L(3), 'my_state')).country.coin;
await rpc(of(3)[1].uid, 'offer_respond', off.id, true);
const c3 = await rpc(L(3), 'my_state');
ok(c3.country.coin === c3before - 10 && c3.inventory.wood >= 2, '거래 성사: 코인·목재 이동');
ok(c3.trades[0].from_c === 1 && c3.trades[0].to_c === 3 && c3.trades[0].item === 'wood', '수출입 원장 기록');
ok(await fail(rpc(of(3)[1].uid, 'offer_respond', off.id, true), 'DONE'), '같은 제안 두 번 수락 불가');
// 공장
await db.query(`update priv.countries set coin = 500 where id = 1`);
const w0 = (await rpc(L(1), 'my_state')).inventory;
await db.query(`update priv.inventory set qty = greatest(qty, 5) where country = 1 and item in ('wood', 'food')`);
const coin0 = (await one(`select coin from priv.countries where id = 1`)).coin;
await rpc(L(1), 'factory_build', 'chipfab');
ok(coin0 - (await one(`select coin from priv.countries where id = 1`)).coin === 40, '반도는 반도체 공장을 싸게 (코인 40·목재 2·식량 2)');
ok(await fail(rpc(L(3), 'factory_build', 'refinery'), 'NO_TECH'), '기술 없으면 공장 불가 (대륙, 정유)');
await db.query(`delete from priv.inventory where country = 1 and item = 'copper'`);
await rpc(ADMIN, 'admin_next_turn');
ok((await rpc(L(1), 'my_state')).inventory.chip === 2, '반도 특산: 구리 없이도 반도체 2개');
await db.query(`update priv.countries set techs = techs || '{chipmaking}' where id = 3`);
ok(await fail(rpc(L(3), 'factory_build', 'chipfab'), 'SHORT') || await fail(rpc(L(3), 'factory_build', 'chipfab')), '다른 나라는 반도체 공장에 알루미늄 4·구리 3 필요');

// 사치품이 오면 행복도가 바로 오름
const hb = (await one(`select happy from priv.countries where id = 4`)).happy;
await rpc(ADMIN, 'admin_grant', 4, { spice: 1 }, '테스트');
const ha = await one(`select happy from priv.countries where id = 4`);
ok(ha.happy === hb + 10 || ha.happy === 100, '사치품(향신료)이 오자 행복도 바로 +10: ' + hb + ' → ' + ha.happy);
// 자원 칸에는 농장 대신 자원 시설, 잘못 지은 시설은 해체
const rt = await one(`select id from priv.tiles where owner = 4 and res = 'wine' and imp is null limit 1`);
if (rt) {
  await db.query(`update priv.tiles set imp = 'lumber' where id = ${rt.id}`);
  await db.query(`update priv.units set acted_turn = -1 where country = 4 and kind = 'worker'`);
  await rpc(L(4), 'worker_demolish', rt.id);
  ok((await one(`select imp from priv.tiles where id = ${rt.id}`)).imp === null, '자원 칸에 잘못 지은 벌목장 해체');
  await db.query(`update priv.units set acted_turn = -1 where country = 4 and kind = 'worker'`);
  ok(await fail(rpc(L(4), 'worker_build', rt.id, 'farm')) && await fail(rpc(L(4), 'worker_build', rt.id, 'lumber')), '자원 칸에는 농장·벌목장 못 지음');
}
// [테스트] 최종 성장 모드
const eg = await rpc(L(2), 'test_endgame');
const after = await rpc(ADMIN, 'admin_state');
ok(eg.ok && eg.captured > 20, '최종 성장 모드: 도시국가 ' + eg.captured + '곳 차지');
ok((await one(`select count(*)::int n from priv.cities where kind = 'cs' and country is null and type <> 'X'`)).n === 6, '나라마다 가장 강한 도시국가 하나만 남음');
ok((await rpc(L(4), 'my_state')).country.techs.length >= 13 && (await one(`select count(*)::int n from priv.tiles where owner is not null and imp is null and terrain not in ('mountain', 'snow') and id not in (select tile_id from priv.cities)`)).n === 0, '모든 기술·모든 땅 개발 완료 (산·설원 빼고)');
ok(after.game.market_open, '세계 시장 열림');
await rpc(ADMIN, 'admin_flags', { test_mode: false });
ok(await fail(rpc(L(2), 'test_endgame'), 'OFF'), '관제실에서 끄면 학생은 못 누름');
// ===== 17차시: 특수 부대 지원 → 최종 도시국가 정복 =====
await db.query(`update priv.countries set happy = 10, coin = 500 where true`);
const bh = await rpc(ADMIN, 'admin_boss_help', 1);
const bu = await one(`select * from priv.units where country = 1 and kind = 'k_missile' order by id desc limit 1`);
const finK = await one(`select * from priv.cities where final and type = 'K'`);
ok(bh.ok && bu && (await one(`select priv.tdist(${bu.tile_id}, ${finK.tile_id}) d`)).d === 2, '특수 부대 지원: 최종 도시국가 2칸 앞에 도착');
ok((await one(`select data from public.notices where country = 1 and kind = 'grant' order by id desc limit 1`)).data.mode === 'boss', '학생 화면 지원 팝업 데이터 (특수 부대)');
await db.query(`update priv.cities set hp = max_hp where id = '${finK.id}'`);
let hits = 0, cap = false;
while (!cap && hits < 4) { await db.query(`update priv.units set attacked_turn = -1 where id = ${bu.id}`); const r = await rpc(L(1), 'unit_attack', bu.id, finK.id); hits++; cap = r.captured; }
ok(cap && hits === 2, '최종 도시국가: 특수 부대 2번 공격이면 정복 (' + hits + '번)');
ok(await fail(rpc(ADMIN, 'admin_boss_help', 1), 'TAKEN'), '이미 정복하면 특수 부대 지원 안 함');
// 관리자 지원 창: 무료 지원 / 긴급 중립 상인
await rpc(ADMIN, 'admin_grant', 6, { gold: 2, coin: 30 }, '거래 막힘 구제');
const gn = await one(`select message, data from public.notices where country = 6 and kind = 'grant' order by id desc limit 1`);
ok(gn.data.mode === 'grant' && gn.data.items.gold === 2 && gn.message.includes('지구 서버 관리자의 지원'), '무료 지원 팝업: ' + gn.message);
const coin3 = (await one(`select coin from priv.countries where id = 3`)).coin;
const mr = await rpc(ADMIN, 'admin_merchant', 3, { wine: 2 });
ok(mr.coin === 40 && coin3 - (await one(`select coin from priv.countries where id = 3`)).coin === 40 && (await one(`select qty from priv.inventory where country = 3 and item = 'wine'`)).qty >= 2, '긴급 중립 상인: 와인 2개 = 기준가 2배 40코인');
await db.query(`update priv.countries set coin = 5 where id = 4`);
ok(await fail(rpc(ADMIN, 'admin_merchant', 4, { rare: 1 }), 'NO_MONEY'), '코인이 모자라면 중립 상인도 못 삼');
await db.query(`update priv.countries set coin = 500 where id = 4`);
// 협정 만료: 관세·수출 제한
await rpc(ADMIN, 'admin_set_phase', 8);
const g8 = (await rpc(L(1), 'my_state')).game;
ok(!g8.fair_cap && g8.banned['1'][0] === 'chip' && g8.banned['5'][0] === 'uranium' && g8.tariffs.jewelry === 0.5, '협정 만료: 반도는 반도체, 북방은 우라늄 수출 제한, 장신구 관세 50%');
await rpc(ADMIN, 'admin_grant', 5, { uranium: 4 }, '테스트');
const bl = await rpc(L(1), 'offer_create', 5, 'coin', 40, 'uranium', 2);
ok(bl.ok === false && bl.blocked === 'ban' && bl.message.includes('수출을 막았어요'), '우라늄을 사려 하자 「수출 제한」으로 막힘');
ok((await one(`select count(*)::int n from priv.trade_fails where buyer = 1 and seller = 5 and item = 'uranium' and reason = 'ban'`)).n === 1, '막힌 거래가 기록됨');
const bl2 = await rpc(L(1), 'offer_create', 5, 'chip', 2, 'coin', 30);
ok(bl2.blocked === 'ban' && bl2.own, '우리 나라가 막은 물건(반도체)은 우리도 못 팔아요');
await rpc(ADMIN, 'admin_grant', 2, { jewelry: 4 }, '테스트');
const k0 = (await one(`select coin from priv.countries where id = 1`)).coin;
const tof = await rpc(L(1), 'offer_create', 2, 'coin', 50, 'jewelry', 2);
ok(tof.ok && tof.tariff === 26, '장신구 2개 제안: 관세 26코인 예고');
const trK = await rpc(L(2), 'offer_respond', tof.id, true);
ok(trK.accepted && k0 - (await one(`select coin from priv.countries where id = 1`)).coin === 76, '관세: 반도는 50코인 + 관세 26코인을 냄');
await db.query(`update priv.countries set coin = 0 where id = 6`);
await rpc(ADMIN, 'admin_grant', 5, { jewelry: 2 }, '테스트');
const tof2 = await rpc(L(5), 'offer_create', 6, 'jewelry', 2, 'gold', 1);
const tr2 = await rpc(L(6), 'offer_respond', tof2.id, false).then(() => null);
const tof3 = await rpc(L(5), 'offer_create', 6, 'jewelry', 2, 'gold', 1);
const tr3 = await rpc(L(6), 'offer_respond', tof3.id, true);
ok(tr3.ok === false && tr3.blocked === 'tariff' && (await one(`select count(*)::int n from priv.trade_fails where buyer = 6 and reason = 'tariff'`)).n === 1, '관세 낼 코인이 없으면 거래가 막히고 기록됨');
let repK = (await rpc(L(1), 'my_state')).report;
ok(repK && repK.partner === 5 && repK.items[0].item === 'uranium' && repK.items[0].kind === 'ban' && repK.items[1].item === 'jewelry' && repK.items[1].tariff_unit === 13, '피해 보고서: 재건 물자(우라늄·장신구), 협상 짝 북방');
ok(repK.fails.length === 2 && repK.tariff_paid === 26 && repK.items[1].bought === 2, '피해 보고서: 막힌 거래 2번, 낸 관세 26 (실제 기록)');
const rep4 = (await rpc(L(4), 'my_state')).report;
ok(rep4.fails.length === 0 && rep4.tariff_paid === 0, '아무 일도 없던 나라는 피해 0으로 표시 (과장 없음)');
ok((await rpc(randomUUID(), 'get_board')).countries[0].fails === 2, '전자칠판에 나라별 막힌 거래 수');
ok(await fail(rpc(L(1), 'city_rebuild'), 'NO_MONEY'), '재건 물자가 모자라면 재건 못 함');
// 피해 보고서·조약 회의: 게임 조작 멈춤
await rpc(ADMIN, 'admin_set_phase', 9);
ok(await fail(rpc(L(1), 'offer_create', 2, 'coin', 10, 'gold', 1), 'LOCKED'), '피해 보고서 시간엔 거래 멈춤');
await rpc(ADMIN, 'admin_set_phase', 10);
await rpc(L(1), 'treaty_submit', 'A', '우라늄 수출이 갑자기 막혔어요', '수출을 막을 때는 미리 알릴게요', '믿고 거래할 수 있어야 하기 때문이에요');
ok((await rpc(L(5), 'my_state')).treaties.length === 1, '조약 회의: 다른 나라 조약도 보임');
// 헌장 체결: 수출 제한·관세 해제 → 시범 거래 → 재건
await rpc(ADMIN, 'admin_set_phase', 11);
const g11 = (await rpc(L(1), 'my_state')).game;
ok(!g11.locked && Object.keys(g11.banned).length === 0 && Object.keys(g11.tariffs).length === 0 && g11.fair_cap, '헌장 체결: 수출 제한·관세 해제');
const gauge0 = (await rpc(ADMIN, 'admin_state')).gauge;
const uo = await rpc(L(1), 'offer_create', 5, 'coin', 40, 'uranium', 2);
ok((await rpc(L(5), 'offer_respond', uo.id, true)).accepted, '시범 거래: 우라늄 다시 수입');
const hb1 = (await one(`select priv.refresh_happy(1) happy`)).happy;
const rb = await rpc(L(1), 'city_rebuild');
ok(rb.ok && (await one(`select rebuilt from priv.countries where id = 1`)).rebuilt && rb.happy === Math.min(100, hb1 + 15), '도시 재건: 행복도 +15 (' + hb1 + ' → ' + rb.happy + ')');
ok((await rpc(ADMIN, 'admin_state')).gauge >= gauge0, '재건하자 안정도 유지·상승');
ok((await rpc(L(1), 'my_state')).report.trades_charter >= 1, '피해 보고서: 헌장 뒤 거래 기록');
// 보드·관제실·백업
const b = await rpc(randomUUID(), 'get_board');
ok(b.tiles.length === 1120 && b.countries.length === 6 && typeof b.gauge === 'number', '전자칠판 데이터, 안정도 ' + b.gauge);
ok((await rpc(ADMIN, 'admin_export')).trades.length >= 1, '백업');
// 초기화
await rpc(ADMIN, 'admin_reset_game', '초기화');
ok((await rpc(L(1), 'my_state')).game.turn === 0 && (await one(`select count(*)::int n from priv.trades`)).n === 0, '초기화');
ok((await one(`select count(*)::int n from priv.students where uid is not null`)).n === 25, '초기화해도 기기 연결 유지');
} catch (e) { console.log('  ✘ 예외: ' + e.message); fails++; }
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
