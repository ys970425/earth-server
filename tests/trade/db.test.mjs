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
ok(m.country.type === 'K' && m.inventory.wood === 5 && m.inventory.iron === 1 && m.country.coin === 150, '반도의 나라 출발 재고');
ok(m.units.length === 5 && m.targets.filter(t => t.mine).length === 5, '시작 병력 5(노동자·정찰병·창병2·투석기), 우리 쪽 도시국가 5곳');
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
ok(await fail(rpc(L(1), 'city_build', 'K', 'barracks'), 'BUSY'), '도시는 한 턴에 건물 하나');
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
ok(k1 && k1.hp === 60 && k1.tier === 0, '튜토리얼 도시국가 체력 60');
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
ok(ca.ranged && ca.city_dmg >= 40 && ca.unit_dmg <= 6, '투석기 원거리 공격: 도시 -' + ca.city_dmg + ', 반격 -' + ca.unit_dmg);
ok(await fail(rpc(of(1)[2].uid, 'unit_attack', cat1.id, k1.id), 'BUSY'), '한 병력은 한 턴에 한 번 공격');
const sa = await rpc(of(1)[2].uid, 'unit_attack', spear1.id, k1.id);
ok(sa.captured && sa.unit_dmg > 0, '창병 공격으로 점령 (반격 -' + sa.unit_dmg + ')');
m = await rpc(L(1), 'my_state');
ok(['shipbuilding', 'steelmaking', 'chipmaking'].every(t => m.country.techs.includes(t)) && sa.coin === 100, '튜토리얼 보상: 핵심 기술 3개 + 코인 100');
ok(m.cities.length === 2, '도시 2곳');
// 다른 나라 튜토리얼 도시국가는 보호
const j1 = (await rpc(L(2), 'my_state')).targets.find(t => t.tutorial);
await db.query(`update priv.units set tile_id = ${await beside(j1.id, 1)}, attacked_turn = -1 where id = ${(await unitsOf(1, 'spear'))[1].id}`);
ok(await fail(rpc(L(1), 'unit_attack', (await unitsOf(1, 'spear'))[1].id, j1.id), 'PROTECTED'), '다른 나라 첫 도시국가는 못 건드림');
// 철옹성: 창병은 크게 다치거나 쓰러짐
const strong = (await db.query(`select id from priv.cities where kind = 'cs' and tier = 4 and type = 'K'`)).rows[0].id;
const sp2 = (await unitsOf(1, 'spear'))[1];
await db.query(`update priv.units set tile_id = ${await beside(strong, 1)}, attacked_turn = -1 where id = ${sp2.id}`);
const sr = await rpc(L(1), 'unit_attack', sp2.id, strong);
ok(sr.city_dmg <= 5 && (sr.died || sr.unit_hp < 20), '철옹성 반격: 창병 -' + sr.unit_dmg + (sr.died ? ' (쓰러짐)' : ''));
// 육군은 바다 불가
const sea = nb(T[(await unitsOf(1, 'spear'))[0].tile]).find(x => ['ocean', 'coast'].includes(x.terrain));
if (sea) ok(await fail(rpc(L(1), 'unit_move', (await unitsOf(1, 'spear'))[0].id, [sea.id])), '육군은 바다로 못 감');
// 기술 연구
ok(await fail(rpc(L(1), 'research_tech', 'economics'), 'NEED'), '먼저 배울 기술이 없으면 연구 불가');
await rpc(L(1), 'research_tech', 'engineering');
ok(await fail(rpc(L(1), 'research_tech', 'chivalry'), 'BUSY'), '연구는 한 턴에 하나');

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
await rpc(L(1), 'city_build', 'K', 'barracks');
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
// 성장의 한계: 반도는 도시국가 4곳이면 자동
const kfree = (await db.query(`select id from priv.cities where kind = 'cs' and type = 'K' and country is null order by sea, tier`)).rows;
await db.query(`update priv.cities set country = 1 where id in ('${kfree[0].id}', '${kfree[1].id}')`);
await db.query(`update priv.cities set hp = 1 where id = '${kfree[2].id}'`);
const sp3 = (await unitsOf(1, 'spear')).slice(-1)[0];
await db.query(`update priv.units set tile_id = ${await beside(kfree[2].id, 1)}, attacked_turn = -1 where id = ${sp3.id}`);
const gl = await rpc(L(1), 'unit_attack', sp3.id, kfree[2].id);
ok(gl.captured && (await rpc(L(1), 'my_state')).country.crisis === true, '도시국가 4곳 → 반도에 자동으로 성장의 한계');

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
ok(a1.countries.filter(c => c.id !== 1).every(c => c.happy > 40), '13차시 행복도 (반도는 성장의 한계) ' + a1.countries.map(c => c.happy).join(','));

// 성장의 한계
await rpc(ADMIN, 'admin_set_phase', 2);
await rpc(ADMIN, 'admin_next_turn');
const a2 = await rpc(ADMIN, 'admin_state');
ok(a2.countries.some(c => c.short.length > 0), '부족 알림: ' + a2.countries.map(c => c.short.join('/')).join(' | '));
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
await rpc(L(1), 'factory_build', 'chipfab');
ok(await fail(rpc(L(3), 'factory_build', 'refinery'), 'NO_TECH'), '기술 없으면 공장 불가 (대륙, 정유)');
await db.query(`insert into priv.inventory values (1, 'copper', 3) on conflict (country, item) do update set qty = 3`);
await rpc(ADMIN, 'admin_next_turn');
ok((await rpc(L(1), 'my_state')).inventory.chip === 2, '반도체 공장: 구리 → 반도체 2개');

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
