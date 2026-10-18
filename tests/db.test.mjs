// 데이터베이스 함수 통합 테스트 (PGlite = 메모리 안의 실제 PostgreSQL)
// 실행: node tests/db.test.mjs  (PGLITE_PATH 환경변수로 pglite 모듈 위치 지정 가능)
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const { PGlite } = await import(process.env.PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✔', msg); else { failures++; console.log('  ✘', msg); } };

// Supabase의 auth.uid() 흉내
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
`);
await db.exec(readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
// 두 번 실행해도 안전한지
await db.exec(readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
console.log('setup.sql 2회 실행 OK');

async function as(uid, sql, params = []) {
  await db.query(`select set_config('request.uid', $1, false)`, [uid || '']);
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}
async function rpc(uid, fn, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  return as(uid, `select public.${fn}(${ph}) as r`, args);
}
async function fails(uid, fn, args, code, label) {
  try { await rpc(uid, fn, ...args); ok(false, label + ' (에러가 나야 하는데 성공함)'); }
  catch (e) { ok(String(e.message).startsWith(code), label + ' → ' + e.message); }
}

const ADMIN = randomUUID();
await db.query(`select priv.set_admin_password('test-pw')`);
await fails(ADMIN, 'admin_state', [], 'NOT_ADMIN', '로그인 전 관제실 차단');
await fails(ADMIN, 'admin_login', ['1111'], 'WRONG', '틀린 비밀번호');
ok((await rpc(ADMIN, 'admin_login', 'test-pw')).ok, '교사 로그인');

// 명단 25명: 1모둠 5명, 나머지 4명
const rows = [];
let no = 1;
for (let g = 1; g <= 6; g++) for (let i = 0; i < (g === 1 ? 5 : 4); i++) rows.push({ group: g, no: no, name: '학생' + no++ });
ok((await rpc(ADMIN, 'admin_roster_import', JSON.stringify(rows))).count === 25, '명단 25명 등록');

// 입장
const students = [];
for (let g = 1; g <= 6; g++) {
  const roster = await rpc(null, 'get_roster', g);
  for (const s of roster) {
    const uid = randomUUID();
    const r = await rpc(uid, 'join_student', s.id, s.no % 2 ? 'boy' : 'girl');
    students.push({ ...s, uid, group: g });
    if (r.status !== 'joined') ok(false, '입장 실패 ' + s.name);
  }
}
ok(students.length === 25, '25명 입장');
await fails(randomUUID(), 'join_student', [students[0].id, 'boy'], 'NAME_TAKEN', '이미 연결된 이름 차단');
await fails(students[1].uid, 'join_student', [students[0].id, 'boy'], 'DEVICE_TAKEN', '이미 연결된 기기로 다른 학생 선택 차단');
ok((await rpc(students[0].uid, 'get_me')).status === 'joined', '재접속 시 자동 인식');

// 승인 모드
await rpc(ADMIN, 'admin_flags', JSON.stringify({ require_approval: true }));
const newDevice = randomUUID();
ok((await rpc(newDevice, 'join_student', students[0].id, 'girl')).status === 'pending', '승인 모드: 대기');
const st0 = await rpc(ADMIN, 'admin_state');
await rpc(ADMIN, 'admin_approve', st0.pairings[0].id);
ok((await rpc(newDevice, 'get_me')).student_id === students[0].id, '교사 승인 후 새 기기 연결');
ok((await rpc(students[0].uid, 'get_me')).status === 'none', '예전 기기는 연결 해제');
students[0].uid = newDevice;
await rpc(ADMIN, 'admin_flags', JSON.stringify({ require_approval: false }));

// 모둠장
const leaders = {};
for (let g = 1; g <= 6; g++) {
  const s = students.find(x => x.group === g);
  await rpc(ADMIN, 'admin_set_leader', s.id, true);
  leaders[g] = s.uid;
}
const member = g => students.filter(x => x.group === g)[1].uid;

// 단계 1: 제작
await rpc(ADMIN, 'admin_set_phase', 1);
const P = (sole, body, insole, lace) => JSON.stringify({ sole, body, insole, lace });
const normal = P('M02', 'M07', 'M12', 'M17');   // 280, env -4
const cheap = P('M01', 'M06', 'M11', 'M16');    // 160, env -8
const eco = P('M03', 'M08', 'M13', 'M18');      // 480, env +4
const prem = P('M04', 'M09', 'M14', 'M19');     // 520, env -12
const ecoP = P('M05', 'M10', 'M15', 'M20');     // 640, env +8
const ecoLite = P('M03', 'M08', 'M13', 'M16'); // 400, env +1 (1차 예산 600 안에서 친환경 위주)
await fails(member(1), 'product_save', [1, 'lowtop', '{}', prem], 'LOCKED_MATERIAL', '연구 전 고급 재료 차단');
await fails(member(1), 'product_save', [3, 'lowtop', '{}', normal], 'BAD_SLOT', '없는 칸 차단');
for (let g = 1; g <= 6; g++) {
  const a = g === 3 ? ecoLite : g === 1 ? cheap : normal;
  await rpc(member(g), 'product_save', 1, 'lowtop', JSON.stringify({ body: 2 }), a);
  await rpc(leaders[g], 'product_save', 2, 'hightop', '{}', cheap);
}
const s1 = await rpc(member(1), 'my_state');
ok(s1.wallet === 600 - 160 - 160, '1모둠 지갑 280 (저가 2켤레)');
ok(s1.materials.every(m => m.env === null), '환경점수 비공개 (재료)');
ok(s1.score === null && s1.gauge === null, '성적표·게이지 비공개');
// 판매 전 수정: 저가→일반 (추가 120)
await rpc(member(1), 'product_save', 1, 'lowtop', '{}', normal);
ok((await rpc(member(1), 'my_state')).wallet === 160, '판매 전 수정 시 차액만 결제');
// 편집 잠금
await rpc(member(2), 'slot_lock', 1);
await fails(leaders[2], 'product_save', [1, 'clog', '{}', normal], 'LOCKED', '다른 학생이 고치는 중이면 차단');
await rpc(member(2), 'slot_unlock', 1);
// 취소 환불
await rpc(member(4), 'product_save', 2, 'oxford', '{}', normal); // 이미 cheap → normal로 수정 (+120)
const w4 = (await rpc(member(4), 'my_state')).wallet;
await rpc(member(4), 'product_cancel', 2);
ok((await rpc(member(4), 'my_state')).wallet === w4 + 280, '판매 전 취소 전액 환불');
await rpc(member(4), 'product_save', 2, 'oxford', '{}', cheap);

// 단계 2: 1차 시장
await rpc(ADMIN, 'admin_set_phase', 2);
await fails(member(1), 'product_save', [1, 'lowtop', '{}', normal], 'PHASE', '시장 중 제작 차단');
const mk = await rpc(students[5].uid, 'market');
const prodOf = (m, g, slot = 1) => m.groups.find(x => x.id === g).products.find(p => p.slot === slot).id;
ok(mk.groups.every(g => g.products.every(p => p.stars === null)), '1차 시장: 친환경 별 표시 없음');
const me5 = students[5]; // 2모둠
await fails(me5.uid, 'votes_submit', [JSON.stringify([{ product_id: prodOf(mk, 2), qty: 1 }])], 'OWN_GROUP', '자기 회사 투표 차단');
await fails(me5.uid, 'votes_submit', [JSON.stringify([{ product_id: prodOf(mk, 1), qty: 2 }, { product_id: prodOf(mk, 1, 2), qty: 1 }])], 'GROUP_LIMIT', '한 회사 3표 차단');
await fails(me5.uid, 'votes_submit', [JSON.stringify([{ product_id: prodOf(mk, 1), qty: 2 }, { product_id: prodOf(mk, 3), qty: 2 }])], 'TOO_MANY', '1차 4표 차단');
// 실패한 제출은 기록이 남지 않아야 함 (트랜잭션 롤백) → 다시 제출 가능
let totalVotes1 = 0;
for (const s of students) {
  const others = [1, 2, 3, 4, 5, 6].filter(g => g !== s.group);
  const pick = others.slice((s.no) % 5).concat(others).slice(0, 3);
  const items = pick.map(g => ({ product_id: prodOf(mk, g, (s.no % 2) + 1), qty: 1 }));
  await rpc(s.uid, 'votes_submit', JSON.stringify(items));
  totalVotes1 += 3;
}
await fails(me5.uid, 'votes_submit', [JSON.stringify([{ product_id: prodOf(mk, 1), qty: 1 }])], 'ALREADY_VOTED', '중복 구매 확정 차단');
// 교사 가상 주문 + 취소
const ev = await rpc(ADMIN, 'admin_event', 'luxury', prodOf(mk, 6), 5, 0, '명품 열풍!');
await rpc(ADMIN, 'admin_undo_event', ev.event_id);
await rpc(ADMIN, 'admin_event', 'practical', prodOf(mk, 6), 5, 0, '실용 신발 인기!');

// 단계 3: 1차 정산
await rpc(ADMIN, 'admin_set_phase', 3);
const a3 = await rpc(ADMIN, 'admin_state');
const revenueSum = a3.groups.reduce((t, g) => t + (g.wallet - 600), 0);
const spent = (await db.query(`select -sum(amount) s from priv.ledger where kind in ('design','refund','swap')`)).rows[0].s;
ok(Number(revenueSum) === (totalVotes1 + 5) * 100 - Number(spent), '1차 정산 금액 = (학생표 75 + 가상주문 5) × 100 − 제작비');
await db.query(`select priv.settle(1)`);
const sales1 = (await db.query(`select count(*) c from priv.ledger where kind='sale' and round=1`)).rows[0].c;
ok(Number(sales1) === 6, '정산 두 번 실행해도 판매수입 6건(중복 없음)');
await fails(ADMIN, 'admin_undo_event', [a3.events.find(e => e.status === 'active').id], 'SETTLED', '정산 후 가상주문 취소 차단');

// 단계 4: 2차 경영
await rpc(ADMIN, 'admin_set_phase', 4);
await fails(member(1), 'invest', ['research'], 'LEADER_ONLY', '모둠장 아닌 학생 투자 차단');
await fails(leaders[1], 'invest', ['eco_research'], 'PHASE', '2차에 친환경 연구 차단');
await rpc(ADMIN, 'admin_grant', 1, 600, '테스트: 1모둠 투자 여력 보정');
await rpc(leaders[1], 'invest', 'research');
await rpc(leaders[1], 'invest', 'factory');
await fails(leaders[1], 'invest', ['factory'], 'ALREADY', '같은 투자 중복 차단');
await rpc(member(1), 'product_save', 3, 'hightop', '{}', prem);
await fails(member(2), 'product_save', [1, 'lowtop', '{}', normal], 'ALREADY_SOLD', '이미 판 신발 수정 차단');
await rpc(member(2), 'product_retire', 2);
await rpc(member(2), 'product_save', 2, 'clog', '{}', normal);
const st1 = await rpc(member(1), 'my_state');
ok(st1.group.slot_count === 4 && st1.products.length === 3, '공장 확장 후 칸 4개, 신발 3켤레');

// 단계 5~6: 2차 시장·정산 (공개 전)
await rpc(ADMIN, 'admin_set_phase', 5);
const mk2 = await rpc(students[0].uid, 'market');
for (const s of students) {
  const others = [1, 2, 3, 4, 5, 6].filter(g => g !== s.group);
  const items = others.slice(0, 2).map(g => ({ product_id: mk2.groups.find(x => x.id === g).products[0].id, qty: 2 }));
  await rpc(s.uid, 'votes_submit', JSON.stringify(items));
}
await rpc(ADMIN, 'admin_set_phase', 6);
const r6 = await rpc(member(1), 'report');
ok(r6.score === null && r6.env === null && r6.detail === null, '6단계: 보고서에 환경 정보 없음');
const b6 = await rpc(null, 'get_board');
ok(b6.gauge === null && b6.groups.every(g => g.score === null), '6단계: 전자칠판 비공개');

// 단계 7: 환경 공개
await rpc(ADMIN, 'admin_set_phase', 7);
await db.query(`update public.game set phase = 6 where id = 1`);
await rpc(ADMIN, 'admin_set_phase', 7); // 다시 넘겨도 지원금 1번만
const grants = (await db.query(`select count(*) c from priv.ledger where kind='grant'`)).rows[0].c;
ok(Number(grants) === 6, '지원금 6건만 지급(중복 없음)');
const s7 = await rpc(member(1), 'my_state');
ok(s7.score !== null && s7.gauge !== null && s7.materials[0].env !== null, '7단계: 성적표·게이지·환경점수 공개');
const a7 = await rpc(ADMIN, 'admin_state');
console.log('  2차 공개 시 게이지', a7.gauge, '/ 기업 종합점수', a7.groups.map(g => g.score).join(', '));

// 단계 8: 3차 경영
await rpc(ADMIN, 'admin_set_phase', 8);
await fails(member(1), 'product_save', [4, 'lowtop', '{}', eco], 'PHASE', '3차 새 디자인 차단');
const before = (await rpc(member(2), 'my_state')).wallet;
await rpc(member(2), 'product_save', 1, 'lowtop', '{}', P('M03', 'M08', 'M12', 'M17')); // 2부품 교체 240
ok((await rpc(member(2), 'my_state')).wallet === before - 240, '3차 재료 교체: 바꾼 부품 값만 결제');
await rpc(leaders[4], 'invest', 'eco_research');
await rpc(leaders[4], 'invest', 'purifier');
await rpc(member(4), 'product_save', 1, 'lowtop', '{}', ecoP);
const snapR2 = (await db.query(`select env from priv.snapshots s join priv.products p on p.id=s.product_id where s.round=2 and p.group_id=2 and p.slot=1`)).rows[0].env;
ok(snapR2 === -4, '3차 교체 후에도 2차 기록(환경 -4) 그대로');

// 단계 9~10: 3차 시장·최종
await rpc(ADMIN, 'admin_set_phase', 9);
const mk3 = await rpc(students[0].uid, 'market');
ok(mk3.groups.find(g => g.id === 4).products.find(p => p.slot === 1).stars === 2, '3차 시장: 친환경 고급 신발 ★★');
for (const s of students) {
  const others = [1, 2, 3, 4, 5, 6].filter(g => g !== s.group);
  const items = [];
  for (const g of others) {
    const best = mk3.groups.find(x => x.id === g).products.sort((a, b) => (b.stars || 0) - (a.stars || 0))[0];
    items.push({ product_id: best.id, qty: 1 });
  }
  await rpc(s.uid, 'votes_submit', JSON.stringify(items));
}
await rpc(ADMIN, 'admin_event', 'citizen', null, 0, 30, '시민 친환경 운동!');
await rpc(ADMIN, 'admin_set_phase', 10);
const a10 = await rpc(ADMIN, 'admin_state');
console.log('  최종 게이지', a10.gauge, '/ 공동보너스', a10.common_bonus);
for (const g of a10.groups) console.log(`   ${g.id}모둠 지갑 ${g.wallet} 성과 ${g.perf} 환경 ${g.env} 친환경보너스 ${g.eco_bonus} 종합 ${g.score}`);
ok(a10.groups.every(g => g.eco_bonus <= 250), '친환경 소비 보너스 상한 250');
ok(a10.groups.every(g => g.wallet >= 0), '모든 기업 지갑 0 이상');
const rep = await rpc(member(4), 'report');
ok(rep.detail.length > 0 && rep.investments.length === 2, '보고서 상세 내역');

// 단계 11: 경영 원칙
await rpc(ADMIN, 'admin_set_phase', 11);
await fails(member(1), 'principle_submit', ['company', '환경을 지키자'], 'LEADER_ONLY', '기업 원칙은 모둠장만');
await rpc(leaders[1], 'principle_submit', 'company', '환경을 생각하는 신발을 만든다');
await rpc(member(1), 'principle_submit', 'personal', '기업이 환경을 지켜야 모두가 오래 산다');
ok((await rpc(member(1), 'my_principles')).personal !== null, '개인 한 문장 저장');

// 초기화
await fails(ADMIN, 'admin_reset_game', ['아니'], 'CONFIRM', '초기화 확인 문구');
await rpc(ADMIN, 'admin_reset_game', '초기화');
ok((await rpc(member(1), 'my_state')).wallet === 600, '초기화 후 지갑 600, 명단·연결 유지');

console.log(failures ? `\n실패 ${failures}건` : '\n전체 통과');
process.exit(failures ? 1 : 0);
