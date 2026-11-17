// E11 성찰 양식 시험: 게임이 끝난 뒤 학생이 돌아보는 양식 (설계 12-6)
// 실행: npm run test:war:reflect
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
let fails = 0;
const ok = (c, m, n = '') => { console.log((c ? '  ✔ ' : '  ✘ ') + m + (n ? ' — ' + n : '')); if (!c) fails++; };
const fail = async (p, code) => { try { await p; return false; } catch (e) { return !code || e.message.includes(code); } };

try {
  const seed = await seedTradeState(ctx);
  const { db, rpc } = ctx;
  const q1 = async (sql, ...p) => (await db.query(sql, p)).rows[0];
  for (const f of ['schema', 'config', 'functions']) {
    await db.exec(readFileSync(new URL(`../../supabase/war/${f}.sql`, import.meta.url), 'utf8'));
  }
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  await db.query(`update war.game set turn = 10, paused = false, combat_on = true where id = 1`);

  const of = c => seed.students.filter(s => s.country_id === c);
  const [c1a, c1b, c1c, c1d] = of(1);
  for (const [s, role] of [[c1a, 'chief'], [c1b, 'army'], [c1c, 'navy'], [c1d, 'air']]) {
    await db.query(`insert into war.roles(student, country, role) values ($1, 1, $2)`, [s.id, role]);
  }
  const [c2a] = of(2);
  const name3 = (await q1(`select name from priv.students where country_id = 1 order by id limit 1`)).name;

  // 1) 닫힘 → REFLECT_CLOSED, 역할 없는 학생 거절
  ok(await fail(rpc(c1b.uid, 'war_reflect_submit', 1, 1, 1, '고민'), 'REFLECT_CLOSED'), '닫혀 있으면 REFLECT_CLOSED');
  ok(await fail(rpc(c2a.uid, 'war_reflect_submit', 1, 1, 1, '고민'), 'REFLECT_CLOSED'), '역할 없는 학생도 닫힘에 걸림');
  await rpc(seed.ADMIN, 'war_admin_reflect_set', true);
  ok(await fail(rpc(c2a.uid, 'war_reflect_submit', 1, 1, 1, '고민'), 'NO_ROLE'), '역할 없는 학생 거절 (열려 있어도)');

  // 2) 열기 → 제출 성공, 두 번째 ALREADY_DONE
  const sub = await rpc(c1b.uid, 'war_reflect_submit', 2, 3, 1, name3 + '과 상의해서 목재를 나눴어요.');
  ok(sub.ok, '제출 성공');
  ok(await fail(rpc(c1b.uid, 'war_reflect_submit', 2, 3, 1, '다시'), 'ALREADY_DONE'), '두 번째 제출 ALREADY_DONE');

  // 3) 선택 번호 범위 검사
  for (const [a1, a2, a3] of [[0, 1, 1], [5, 1, 1], [1, 0, 1], [1, 5, 1], [1, 1, 0], [1, 1, 5], [null, 1, 1]]) {
    ok(await fail(rpc(c1c.uid, 'war_reflect_submit', a1, a2, a3, '글'), 'BAD_ANSWER'),
      `범위 밖 선택 거절 (${a1},${a2},${a3})`);
  }

  // 4) 글 검사: 빈 글·공백·201자 거절, 200자 허용
  ok(await fail(rpc(c1c.uid, 'war_reflect_submit', 1, 1, 1, ''), 'BAD_TEXT'), '빈 글 거절');
  ok(await fail(rpc(c1c.uid, 'war_reflect_submit', 1, 1, 1, '   '), 'BAD_TEXT'), '공백 글 거절');
  ok(await fail(rpc(c1c.uid, 'war_reflect_submit', 1, 1, 1, '가'.repeat(201)), 'BAD_TEXT'), '201자 거절');
  const ok200 = await rpc(c1c.uid, 'war_reflect_submit', 1, 1, 1, '나'.repeat(200));
  ok(ok200.ok, '200자 허용');
  const ok1c = await rpc(c1d.uid, 'war_reflect_submit', 3, 3, 4, '외교를 더 하고 싶었어요.');
  ok(ok1c.ok, '다른 학생 제출 성공');

  // 5) 교사 목록·집계 (이름·id 없음 — 필수)
  const list = await rpc(seed.ADMIN, 'war_admin_reflect_list');
  ok(list.submitted === 3, '제출 수 3 (실제 ' + list.submitted + ')');
  ok(list.total === 4, '전체 수 = 역할 있는 학생 수 4');
  ok(list.open === true, '열림 상태 반영');
  ok((list.counts[0]['2'] || 0) === 1 && (list.counts[1]['3'] || 0) === 2 && (list.counts[2]['4'] || 0) === 1,
    '문항별 선택 수 집계');
  const raw = JSON.stringify(list.responses);
  ok(!raw.includes(name3), '응답 목록에 학생 실명 없음 (필수)');
  ok(!/"student"|student_id|"id"/.test(raw), '응답 목록에 학생 id 없음 (필수)');

  // 6) 내보내기: 실명은 ○○로, id는 없음
  const ex = await rpc(seed.ADMIN, 'war_admin_reflect_export');
  ok(ex.markdown.includes('○○'), '글 속 실명 「○○」로 바꿈');
  ok(!ex.markdown.includes(name3), '내보낸 글에 실명 없음');
  ok(ex.replaced >= 1, '바꾼 개수 기록 (' + ex.replaced + '곳)');
  ok(!/\bstudent\b/i.test(ex.markdown) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(ex.markdown), '내보낸 글에 학생 id·기기 id 없음');
  ok(ex.markdown.includes('제출 3건') && ex.markdown.includes('## 응답'), '내보낸 글에 제출 수·응답 목록');

  // 7) 학생 uid로 교사 함수 거절
  ok(await fail(rpc(c1b.uid, 'war_admin_reflect_set', true), 'NOT_ADMIN'), '학생은 열기/닫기 못 함');
  ok(await fail(rpc(c1b.uid, 'war_admin_reflect_list'), 'NOT_ADMIN'), '학생은 목록을 못 봄');
  ok(await fail(rpc(c1b.uid, 'war_admin_reflect_export'), 'NOT_ADMIN'), '학생은 내보내기를 못 함');

  // 8) 열기/닫기 반복
  await rpc(seed.ADMIN, 'war_admin_reflect_set', false);
  ok((await rpc(c1b.uid, 'war_reflect_state')).open === false, '닫기 후 state.open = false');
  await rpc(seed.ADMIN, 'war_admin_reflect_set', true);
  ok((await rpc(c1b.uid, 'war_reflect_state')).open === true, '다시 열기 반복 동작');
  ok((await rpc(c1b.uid, 'war_reflect_state')).submitted === true, '내가 이미 냈는지 state로 확인');
  // 초기화 뒤 비워짐
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  ok((await q1(`select count(*)::int n from war.reflections`)).n === 0, '가져오기(초기화) 뒤 성찰 비워짐');
} catch (e) {
  ctx.ok(false, '예외: ' + (e.stack || e.message).split('\n')[0]);
  fails++;
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
