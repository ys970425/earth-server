// 비상 SQL 4개(next-turn · pause · resume · reset-student-link) 시험
// 교사 로그인 없이(postgres 권한, request.uid 없음) 실행해도 관제실 버튼과 같은 효과인지, 두 번 실행해도 안전한지 증명해요.
// 두 개의 가짜 DB를 같은 상태로 만들고: A = 관제실 버튼(교사 로그인) / B = ops SQL 파일(로그인 없음) → 결과를 비교해요.
// 실행: npm run test:war:ops-sql  (dist/war-install/ops 를 먼저 새로 만들어요)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createDb, seedTradeState } from './helpers.mjs';

execFileSync(process.execPath, ['tools/war/build-install-sql.mjs'], { cwd: new URL('../../', import.meta.url), stdio: 'ignore' });
const OPS = f => readFileSync(new URL(`../../dist/war-install/ops/${f}`, import.meta.url), 'utf8');
const withNum = (sql, re, n) => { if (!re.test(sql)) throw new Error('숫자 칸을 못 찾았어요: ' + re); return sql.replace(re, m => m.replace(/\d+/, String(n))); };

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };

async function make() {
  const ctx = await createDb();
  const { db } = ctx;
  // 실제 Supabase의 auth.uid() 와 같게: request.jwt.claim.sub 를 읽어요 (시험 틀의 가짜는 request.uid 만 읽어요)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.uid', true), ''))::uuid $$;`);
  const seed = await seedTradeState(ctx);
  for (const f of ['schema.sql', 'config.sql', 'functions.sql']) await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
  await ctx.rpc(seed.ADMIN, 'war_admin_import', '초기화');
  await db.query(`update war.game set turn = 10, turn_seconds = 180, turn_end = now() + interval '100 seconds', paused = false, paused_left = null, combat_on = true where id = 1`);
  // 병력 이동력을 일부러 줄여 두면 「다음 턴」이 채워 주는지 볼 수 있어요
  await db.query(`update war.units set moves_left = 0, attacked_turn = 10`);
  await db.query(`select set_config('request.uid', '', false)`);
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  return { ...ctx, seed };
}
const A = await make(), B = await make();
const state = async ({ db }) => {
  const g = (await db.query(`select turn, paused, combat_on, turn_seconds, paused_left, turn_end is null as no_end,
    case when turn_end is null then null else greatest(0, round(extract(epoch from (turn_end - now()))))::int end as left_s from war.game where id = 1`)).rows[0];
  const h = async t => (await db.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from war.${t} x`)).rows[0].h;
  return { g, units: await h('units'), cities: await h('cities'), roles: await h('roles') };
};
const near = (a, b, d = 3) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= d);
const sameState = (a, b) => a.g.turn === b.g.turn && a.g.paused === b.g.paused && a.g.combat_on === b.g.combat_on && a.g.no_end === b.g.no_end
  && near(a.g.paused_left, b.g.paused_left) && near(a.g.left_s, b.g.left_s) && a.units === b.units && a.cities === b.cities && a.roles === b.roles;
const runOps = (c, sql) => c.db.exec(sql);
const button = (c, fn, ...a) => c.rpc(c.seed.ADMIN, fn, ...a);

// 0. 로그인 없이는 함수가 막혀요 (ops 파일의 첫 줄이 그 역할을 대신한다는 뜻)
console.log('— 0. 교사 로그인 없이 직접 함수를 부르면 막힘 (ops 파일만 통과)');
{
  let blocked = false;
  try { await B.db.query(`select public.war_pause(true)`); } catch (e) { blocked = /NOT_ADMIN|교사/.test(e.message); }
  ok(blocked, '로그인 없이 war_pause 는 NOT_ADMIN');
  ok((await state(B)).g.paused === false, '막혔으니 상태 그대로');
}

// 1. 일시정지: 버튼 == pause.sql, 두 번 실행해도 같다
console.log('— 1. pause.sql = 「일시정지」 버튼');
{
  for (const c of [A, B]) await c.db.query(`update war.game set turn_end = now() + interval '100 seconds' where id = 1`);
  await button(A, 'war_pause', true);
  await runOps(B, OPS('pause.sql'));
  const a = await state(A), b = await state(B);
  ok(b.g.paused === true && b.g.no_end === true && b.g.paused_left > 90 && b.g.paused_left <= 100, `멈춤 · 타이머 정지 · 남은 시간 ${b.g.paused_left}초 보관`);
  ok(sameState(a, b), '버튼과 같은 결과 (턴·멈춤·남은 시간·병력·도시·역할)');
  await runOps(B, OPS('pause.sql'));
  const b2 = await state(B);
  ok(sameState(b, b2) || (b2.g.paused === true && near(b.g.paused_left, b2.g.paused_left, 1)), '두 번 Run 해도 그대로 멈춰 있고 남은 시간도 그대로');
}

// 2. 일시정지 중 다음 턴 / 다음 턴 버튼 == next-turn.sql, 숫자가 틀리면 아무 일도 없고, 두 번 Run 해도 한 번만 넘어감
console.log('— 2. next-turn.sql = 「다음 턴」 버튼');
{
  const nt = OPS('next-turn.sql');
  // 틀린 숫자 → 무변화
  const before = await state(B);
  const wrong = (await runOps(B, withNum(nt, /war_next_turn\(\d+\)/, 3))).at(-2);
  const afterWrong = await state(B);
  ok(afterWrong.g.turn === before.g.turn && sameState(before, afterWrong), '지금 턴이 아닌 숫자(3)를 쓰면 아무 일도 안 일어남');
  // 맞는 숫자
  await button(A, 'war_next_turn', 10);
  await runOps(B, withNum(nt, /war_next_turn\(\d+\)/, 10));
  const a = await state(A), b = await state(B);
  ok(b.g.turn === 11, '턴 10 → 11');
  ok(sameState(a, b), '버튼과 같은 결과 (턴·타이머·병력 이동력 채움·공격 기록·도시·역할)');
  ok((await B.db.query(`select count(*)::int n from war.units where moves_left > 0`)).rows[0].n > 0, '병력 이동력이 다시 채워짐');
  // 같은 파일 한 번 더 (숫자 10 그대로) → 넘어가지 않음
  await runOps(B, withNum(nt, /war_next_turn\(\d+\)/, 10));
  ok((await state(B)).g.turn === 11, '같은 파일(숫자 10)을 두 번 Run 해도 턴은 한 번만 넘어감 (11 그대로)');
  ok(b.g.paused === true && b.g.no_end === true, '멈춘 상태에서 넘기면 시간은 안 흐르고 멈춘 채 새 턴이 됨 (버튼과 같음)');
}

// 3. 재개: 버튼 == resume.sql, 두 번 Run 해도 안전
console.log('— 3. resume.sql = 「다시시작」 버튼');
{
  await button(A, 'war_pause', false);
  await runOps(B, OPS('resume.sql'));
  const a = await state(A), b = await state(B);
  ok(b.g.paused === false && b.g.no_end === false && b.g.left_s > 170 && b.g.left_s <= 180, `다시 흐름 · 새 턴 시간 ${b.g.left_s}초부터`);
  ok(sameState(a, b), '버튼과 같은 결과');
  await runOps(B, OPS('resume.sql'));
  const b2 = await state(B);
  ok(b2.g.paused === false && near(b.g.left_s, b2.g.left_s, 2), '두 번 Run 해도 안전 (이미 진행 중이면 그대로)');
  // 멈춤 → 재개 때 남은 시간이 보존되는지 (진행 중에 pause.sql → resume.sql)
  await runOps(B, `update war.game set turn_end = now() + interval '77 seconds' where id = 1;`);
  await runOps(B, OPS('pause.sql'));
  await B.db.query(`select pg_sleep(1.2)`);
  await runOps(B, OPS('resume.sql'));
  const b3 = await state(B);
  ok(b3.g.left_s >= 75 && b3.g.left_s <= 78, `쉰 시간은 빠지지 않고 남은 시간(약 77초)부터 다시 흐름 (${b3.g.left_s}초)`);
}

// 4. 학생 연결 초기화
console.log('— 4. reset-student-link.sql = 무역 관제실 「연결 초기화」 버튼');
{
  const sid = A.seed.students[7].id;
  const sidB = B.seed.students[7].id;
  const bound = async c => (await c.db.query(`select (uid is null) as unbound from priv.students where id = $1`, [c === A ? sid : sidB])).rows[0].unbound;
  const roleBefore = await state(B);
  ok(!(await bound(A)) && !(await bound(B)), '시작: 두 DB 모두 그 학생이 접속(연결)돼 있음');
  await A.rpc(A.seed.ADMIN, 'admin_reset_binding', sid);
  const sql = withNum(OPS('reset-student-link.sql'), /admin_reset_binding\(\d+\)/, sidB);
  await runOps(B, sql);
  ok(await bound(A) && await bound(B), '버튼도 SQL도 그 학생의 연결이 풀림');
  const others = async c => (await c.db.query(`select count(*)::int n from priv.students where uid is null`)).rows[0].n;
  ok(await others(A) === 1 && await others(B) === 1, '다른 학생 연결은 그대로 (풀린 학생은 정확히 1명)');
  ok(sameState(roleBefore, await state(B)) || (await state(B)).roles === roleBefore.roles, '역할·병력·도시는 그대로');
  await runOps(B, sql);
  ok(await bound(B) && await others(B) === 1, '두 번 Run 해도 안전');
  // 이름을 다시 고르면(join) 다시 연결돼요
  const nu = (await B.db.query(`select gen_random_uuid()::text u`)).rows[0].u;
  await B.rpc(nu, 'join_student', sidB, '다시접속');
  ok(!(await bound(B)), '그 학생이 다시 접속(이름 고르기)하면 다시 연결됨');
}

console.log(fails ? `실패 ${fails}개` : '전체 통과');
await A.db.close(); await B.db.close();
process.exit(fails ? 1 : 0);
