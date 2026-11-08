import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
const { db, rpc, ok, fail, one } = ctx;
try {
  const seed = await seedTradeState(ctx);
  for (const f of ['schema', 'config', 'functions']) {
    await db.exec(readFileSync(new URL(`../../supabase/war/${f}.sql`, import.meta.url), 'utf8'));
  }
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  await db.exec('update war.game set turn=0 where id=1');
  const army = seed.students.find(s => s.country_id === 1);
  await db.query(`insert into war.roles(student,country,role) values ($1,1,'army')`, [army.id]);
  ok((await one('select turn from war.game where id=1')).turn === 0, '준비: DB 설치');

  const next = await rpc(seed.ADMIN, 'war_next_turn', 0);
  ok(next.ok === true && next.turn === 1, '다음_턴_성공');
  ok((await rpc(seed.ADMIN, 'war_next_turn', 0)).ok === false, '다음_턴_중복_방지');
  const pause = await rpc(seed.ADMIN, 'war_pause', true);
  ok(pause.paused === true && (await one('select paused from war.game')).paused === true, '일시정지_성공');
  const resume = await rpc(seed.ADMIN, 'war_pause', false);
  ok(resume.paused === false && (await one('select paused from war.game')).paused === false, '다시_시작_성공');
  const time = await rpc(seed.ADMIN, 'war_set_turn_time', 120);
  ok(time.turn_seconds === 120 && (await one('select turn_seconds from war.game')).turn_seconds === 120, '시간_조절_성공');
  ok(await fail(rpc(seed.ADMIN, 'war_set_turn_time', 30), 'BAD_TIME'), '시간_범위_오류');

  await db.exec('update war.units set moves_left=0, attacked_turn=1');
  await rpc(seed.ADMIN, 'war_next_turn', 1);
  const units = await one('select count(*) total, bool_and(moves_left > 0 and attacked_turn = -1) restored from war.units');
  ok(units.total > 0 && units.restored, '턴_끝_이동력_회복');
  await db.exec(`update war.cities set besieged=true, hp=10 where kind='capital'`);
  await rpc(seed.ADMIN, 'war_next_turn', 2);
  const capitals = await one(`select count(*) total, bool_and(not besieged and hp=20) restored from war.cities where kind='capital'`);
  ok(capitals.total > 0 && capitals.restored, '수도_포위_해제');
  // priv.need_admin()의 기존 권한 오류 코드는 NOT_ADMIN이다.
  ok(await fail(rpc(army.uid, 'war_next_turn', 3), 'NOT_ADMIN'), '비관리자_거절');
} catch (e) {
  ok(false, '예외: ' + e.stack);
}
ctx.summary();
