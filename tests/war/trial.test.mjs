// 체험 준비 시험: 실제로 배포되는 가짜 미리보기 파일(app/war/preview/db.tar.gz)을 열어
// 「합참의장 → 요청 승인 → 공군 대신 생산」과 「육군 요청 → 승인 → 생산」이 되는지 확인한다.
// (npm run war:preview 가 먼저 돼 있어야 해요. 실제 데이터 미리보기는 열지 않아요.)
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_PATH || '@electric-sql/pglite');
const meta = JSON.parse(readFileSync(new URL('../../app/war/preview/db.json', import.meta.url), 'utf8'));
const archive = new Blob([readFileSync(new URL('../../app/war/preview/db.tar.gz', import.meta.url))]);
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };

async function open(country, role) {
  const db = new PGlite({ loadDataDir: archive }); await db.waitReady;
  const student = meta.students.filter(s => s.country === country)[0];
  await db.query('delete from war.roles where student = $1', [student.id]);
  if (role) await db.query('insert into war.roles(student, country, role) values ($1,$2,$3)', [student.id, country, role]);
  await db.query("select set_config('request.uid', $1, false)", [student.uid]);
  const rpc = async (fn, args = {}) => {
    const e = Object.entries(args);
    const named = e.map(([k], i) => `${k} => $${i + 1}`).join(', ');
    return (await db.query(`select public.${fn}(${named}) as r`, e.map(([, v]) => v !== null && typeof v === 'object' ? JSON.stringify(v) : v))).rows[0].r;
  };
  const one = async (q, ...a) => (await db.query(q, a)).rows[0];
  return { db, rpc, one };
}
const tryRpc = async p => { try { return { r: await p }; } catch (e) { return { err: e.message }; } };

console.log('— 가짜 미리보기 체험 준비');
{
  const { db, one } = await open(1, null);
  const cap = await one(`select id, buildings from war.cities where country=1 and kind='capital'`);
  ok(cap.buildings.includes('barracks') && cap.buildings.includes('harbor'), '수도에 병영·항구가 있음');
  const all = await db.query(`select count(*)::int n from war.cities where kind='capital' and 'barracks'=any(buildings) and 'harbor'=any(buildings)`);
  ok(all.rows[0].n === 6, '여섯 나라 수도 모두 병영·항구');
  const w = await one(`select coalesce(sum(qty),0)::int s from war.wallets where country=1 and role='army'`);
  ok(w.s > 0 && w.s < 10, '역할 지갑에 재고가 조금 있음 (유닛 하나엔 모자람)');
  ok((await one(`select count(*)::int n from war.budget_requests where country=1 and role='air' and status='pending'`)).n === 1, '공군의 예시 요청이 하나 대기 중');
  await db.close();
}

console.log('— 합참의장 혼자: 승인 → 공군 대신 생산');
{
  const { db, rpc, one } = await open(1, 'chief');
  const st = await rpc('war_budget_state', { p_country: 1 });
  ok(st.requests?.length === 1, '요청함에 예시 요청이 보임');
  const treasury = await one('select coin from war.countries where id=1');
  const a = await rpc('war_budget_approve', { p_id: st.requests[0].id });
  ok(a.ok, '승인 성공');
  const after = await one('select coin from war.countries where id=1');
  ok(after.coin === treasury.coin - 16, '국고 코인이 16 줄어듦');
  const cap = await one(`select id from war.cities where country=1 and kind='capital'`);
  const made = await tryRpc(rpc('war_produce', { p_city: cap.id, p_kind: 'helicopter' }));
  ok(made.r?.ok, '공군을 대신해 전투 헬기 생산 성공' + (made.err ? ' — ' + made.err : ''));
  await db.close();
}

console.log('— 육군 혼자: 요청 → (다른 사람이 승인) → 생산');
{
  const { db, rpc, one } = await open(1, 'army');
  const cap = await one(`select id from war.cities where country=1 and kind='capital'`);
  const before = await tryRpc(rpc('war_produce', { p_city: cap.id, p_kind: 'spear' }));
  ok(before.err && /NOT_ENOUGH|부족/.test(before.err), '재고가 모자라 생산이 막힘 (요청이 필요해요)');
  const req = await rpc('war_budget_request', { p_items: { coin: 5, wood: 2, iron: 1 }, p_note: '유닛 생산' });
  ok(req.ok, '요청 성공 (육군은 이미 대기 중인 요청이 없음)');
  // 승인은 합참의장이 해요: 같은 DB에서 학생만 바꿔서 승인
  const chiefStudent = meta.students.filter(s => s.country === 1)[1];
  await db.query('delete from war.roles where student = $1', [chiefStudent.id]);
  await db.query(`insert into war.roles(student, country, role) values ($1, 1, 'chief')`, [chiefStudent.id]);
  await db.query("select set_config('request.uid', $1, false)", [chiefStudent.uid]);
  const ap = await rpc('war_budget_approve', { p_id: req.id });
  ok(ap.ok, '합참의장이 승인');
  await db.query("select set_config('request.uid', $1, false)", [meta.students.filter(s => s.country === 1)[0].uid]);
  const made = await tryRpc(rpc('war_produce', { p_city: cap.id, p_kind: 'spear' }));
  ok(made.r?.ok, '승인된 재료로 창병 생산 성공' + (made.err ? ' — ' + made.err : ''));
  await db.close();
}

console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
