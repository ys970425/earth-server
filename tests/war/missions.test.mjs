// 미션 서버 시험 (①a): war_mission_done·war_missions·war_admin_missions
// 실행: node tests/war/missions.test.mjs
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx);
  const { db, ok, fail } = ctx;
  const q1 = async (sql, ...p) => (await db.query(sql, p)).rows[0];
  for (const f of ['schema.sql', 'config.sql', 'functions.sql']) {
    await db.exec(readFileSync(new URL('../../supabase/war/' + f, import.meta.url), 'utf8'));
  }
  await ctx.rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const of = c => seed.students.filter(s => s.country_id === c);
  const [chief, armyS] = of(1);
  await ctx.rpc(chief.uid, 'war_choose_role', 'chief');
  await ctx.rpc(armyS.uid, 'war_choose_role', 'army');

  // 육군 학생: now 미션 기록 성공
  const done = await ctx.rpc(armyS.uid, 'war_mission_done', 'army_move');
  ok(done.ok && done.done === true, 'army_move 미션 기록 성공');
  await ctx.rpc(armyS.uid, 'war_mission_done', 'army_move');
  ok((await q1(`select count(*)::int n from war.mission_done where student = $1 and mission = 'army_move'`, armyS.id)).n === 1,
    '두 번 해도 오류 없고 기록은 한 줄만');
  // 아직 안 열린 미션 / 남의 역할 미션 / 없는 key (E7은 이제 열림)
  ok(await fail(ctx.rpc(armyS.uid, 'war_mission_done', 'navy_move'), 'BAD_MISSION'), '남의 역할 미션(navy_move)은 BAD_MISSION');
  ok(await fail(ctx.rpc(armyS.uid, 'war_mission_done', 'no_such'), 'BAD_MISSION'), '없는 key는 BAD_MISSION');

  // war_missions: 육군 미션 4개만, 완료·열림 표시
  const list = await ctx.rpc(armyS.uid, 'war_missions');
  ok(Array.isArray(list) && list.length === 4 && list.every(m => m.role === 'army'),
    'war_missions: 육군 학생에게 육군 미션 4개만');
  ok(list.find(m => m.key === 'army_move').done === true && list.find(m => m.key === 'army_move').open === true,
    'army_move는 done: true, open: true');
  ok(list.find(m => m.key === 'army_build').open === true && list.find(m => m.key === 'army_build').done === false,
    'army_build은 open: true (E7 열림), done: false');
  ok(list.every(m => ['key', 'role', 'order', 'text', 'opens', 'open', 'done'].every(k => k in m)),
    '미션 항목에 key·role·order·text·opens·open·done이 모두 있음');

  // 결석 대행: 육군 학생 결석 표시 → 합참의장 war_missions에 육군 미션도 나옴
  await ctx.rpc(seed.ADMIN, 'war_admin_set_absent', armyS.id, true);
  const chiefList = await ctx.rpc(chief.uid, 'war_missions');
  ok(chiefList.some(m => m.role === 'army') && chiefList.some(m => m.key === 'army_move'),
    '결석 표시하면 합참의장 미션 목록에 육군 미션도 나옴');
  const chiefDone = await ctx.rpc(chief.uid, 'war_mission_done', 'army_transfer');
  ok(chiefDone.ok, '합참의장이 대행 미션(army_transfer) 기록 성공');

  // war_admin_missions: 교사만, 실명 없음
  ok(await fail(ctx.rpc(armyS.uid, 'war_admin_missions'), 'NOT_ADMIN'), '학생은 war_admin_missions 실행 불가');
  const adm = await ctx.rpc(seed.ADMIN, 'war_admin_missions');
  ok(adm.missions.length === 25 && adm.missions.every(m => !('name' in m)) &&
    !JSON.stringify(adm).includes('학생'),
    '교사용 현황 25명, 실명(학생이라는 글자) 없음');
  // OPEN_STAGES = ['now','E4','E6','E7','E8','E9'] 기준 고정값
  // army: army_move(now)+army_transfer(now)+army_attack_preview(E4)+army_build(E7) = 4
  // chief: chief_info(now)+chief_budget(E6)+chief_ally(E8)+chief_market(E9) = 4
  const armyRow = adm.missions.find(m => m.student === armyS.id);
  ok(armyRow.role === 'army' && armyRow.done.includes('army_move') && armyRow.total_open === 4,
    '육군 학생 줄: 역할·완료 목록·열린 미션 수(4)');
  const chiefRow = adm.missions.find(m => m.student === chief.id);
  ok(chiefRow.role === 'chief' && chiefRow.done.includes('army_transfer') && chiefRow.total_open === 4,
    '합참의장 줄: 대행 army_transfer 포함, 열린 미션 수(4)');

  // 가져오기를 다시 하면 완료 기록이 비워짐
  await ctx.rpc(seed.ADMIN, 'war_admin_import', '초기화');
  ok((await q1(`select count(*)::int n from war.mission_done`)).n === 0, '다시 가져오면 완료 기록이 비워짐');
} catch (e) {
  ctx.ok(false, '예외: ' + (e.stack ? e.stack.split('\n')[0] : e.message));
}
ctx.summary();
