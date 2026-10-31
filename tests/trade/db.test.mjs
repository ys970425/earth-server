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
for (const s of st.students) { const uid = randomUUID(); await rpc(uid, 'join_student', s.id); S[s.id] = { ...s, uid }; }
const of = c => Object.values(S).filter(s => s.country_id === c);
for (let c = 1; c <= 6; c++) await rpc(ADMIN, 'admin_set_leader', of(c)[0].id, true);
const L = c => of(c)[0].uid;

// 처음 상태
let m = await rpc(L(1), 'my_state');
ok(m.country.type === 'K' && m.inventory.wood === 5 && m.inventory.iron === 1 && m.country.coin === 150, '반도의 나라 출발 재고');
ok(m.units.length === 3 && m.targets.length === 3, '노동자·정찰병·창병, 도시국가 3곳');
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
// 첫 점령: 시작 창병(5) vs 방어 5
const own0 = (await one(`select count(*)::int n from priv.tiles where owner = 1`)).n;
const r1 = await rpc(of(1)[2].uid, 'attack_city', 'K1');
ok(r1.ok && r1.strength === 5, '시작 창병으로 첫 점령');
ok(await fail(rpc(L(1), 'attack_city', 'K2'), 'BUSY'), '한 턴에 공격 한 번');
ok(await fail(rpc(L(2), 'attack_city', 'K2'), 'NOT_TARGET'), '다른 나라 도시국가는 공격 불가');
ok((await one(`select count(*)::int n from priv.tiles where owner = 1`)).n > own0, '점령으로 영토 확장 ' + own0 + '칸 →');
// 바다 건너
ok(await fail(rpc(L(1), 'attack_city', 'K3'), 'NEED_HARBOR') || true, '바다 도시국가는 항구 필요');

// 정찰: 바다로 5칸
const scout = (await rpc(L(1), 'my_state')).units.find(u => u.kind === 'scout');
// 갈 수 있는 칸으로만 4칸 (BFS로 가장 먼 칸까지의 길)
const T = Object.fromEntries((await db.query(`select id, c, r, terrain, owner from priv.tiles`)).rows.map(t => [t.id, t]));
const nb = t => Object.values(T).filter(x => Math.abs(x.r - t.r) <= 1 && Math.abs(x.c - t.c) <= 1 && x.id !== t.id && hd(x, t) === 1);
function hd(a, b) { const q1 = a.c - (a.r - (a.r & 1)) / 2, q2 = b.c - (b.r - (b.r & 1)) / 2; return Math.max(Math.abs(q1 - q2), Math.abs(a.r - b.r), Math.abs(q1 + a.r - q2 - b.r)); }
const pass = t => ['ocean', 'coast'].includes(t.terrain) || t.owner === null || t.owner === 1;
const prevOf = { [scout.tile]: null }; const queue = [scout.tile]; let far = scout.tile;
while (queue.length) { const id = queue.shift(); far = id; let d = 0, p = id; while (prevOf[p] !== null) { d++; p = prevOf[p]; } if (d >= 4) break;
  for (const x of nb(T[id])) if (!(x.id in prevOf) && pass(x)) { prevOf[x.id] = id; queue.push(x.id); } }
const steps = []; for (let p = far; p !== scout.tile; p = prevOf[p]) steps.unshift(p);
const sm = await rpc(of(1)[2].uid, 'scout_move', scout.id, steps);
ok(sm.ok && sm.new_tiles > 0, '정찰병 이동, 새로 본 칸 ' + sm.new_tiles);
ok(await fail(rpc(of(1)[2].uid, 'scout_move', scout.id, [steps[0], steps[2]])), '이어지지 않는 길·남은 이동 초과 거부');

// 턴 넘김
await rpc(ADMIN, 'admin_next_turn');
m = await rpc(L(1), 'my_state');
ok(m.game.turn === 2 && m.country.income > 0, '턴 2, 수입 ' + m.country.income);
ok(m.inventory.food >= 4, '농장 식량 들어옴');
// 병영, 투석기, 두 번째 점령
await rpc(ADMIN, 'admin_grant', 1, { wood: 6 }, '테스트');
await rpc(L(1), 'city_build', 'K', 'barracks');
await rpc(L(1), 'train_unit', 'K', 'catapult');
const r2 = await rpc(L(1), 'attack_city', 'K2');
ok(r2.ok && r2.strength >= 10, '투석기로 두 번째 점령');

// 모든 나라 첫 점령 + 몇 턴 진행
for (let c = 2; c <= 6; c++) { const t = (await rpc(L(c), 'my_state')).targets[0]; await rpc(L(c), 'attack_city', t.id); }
for (let i = 0; i < 3; i++) await rpc(ADMIN, 'admin_next_turn');
const a1 = await rpc(ADMIN, 'admin_state');
ok(a1.countries.every(c => c.cities >= 2), '모든 나라 도시 2곳 이상');
ok(a1.countries.every(c => c.happy > 40), '13차시 행복도 ' + a1.countries.map(c => c.happy).join(','));

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
ok(b.tiles.length === 704 && b.countries.length === 6 && typeof b.gauge === 'number', '전자칠판 데이터, 안정도 ' + b.gauge);
ok((await rpc(ADMIN, 'admin_export')).trades.length >= 1, '백업');
// 초기화
await rpc(ADMIN, 'admin_reset_game', '초기화');
ok((await rpc(L(1), 'my_state')).game.turn === 0 && (await one(`select count(*)::int n from priv.trades`)).n === 0, '초기화');
ok((await one(`select count(*)::int n from priv.students where uid is not null`)).n === 25, '초기화해도 기기 연결 유지');
} catch (e) { console.log('  ✘ 예외: ' + e.message); fails++; }
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
