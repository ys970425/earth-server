// 이동 속도 비교: 커밋된 이전 버전(기본 HEAD)과 지금 작업 폴더의 서버 SQL에서 같은 war_move 를 반복해 평균 시간을 재요.
// 실행: node tools/war/bench-move.mjs [기준커밋=HEAD] [반복횟수=150]
// 시간은 가짜 DB(PGlite) 기준이라 절대값보다 「비율」을 봐요. 군사 병력 이동·정찰병 이동·다음 턴을 각각 재요.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from '../../tests/war/helpers.mjs';

const ref = process.argv[2] || 'HEAD';
const N = Number(process.argv[3] || 150);
const git = f => execFileSync('git', ['show', `${ref}:supabase/war/${f}`], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const work = f => readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8');

async function build(label, load) {
  const ctx = await createDb();
  const seed = await seedTradeState(ctx);
  const { db, rpc } = ctx;
  for (const f of ['schema.sql', 'config.sql', 'functions.sql']) await db.exec(load(f));
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const of = seed.students.filter(s => s.country_id === 1);
  for (const [s, role] of [[of[0], 'chief'], [of[1], 'engineer'], [of[2], 'army']])
    await db.query('insert into war.roles(student, country, role) values ($1,1,$2)', [s.id, role]);
  const q1 = async (sql, ...a) => (await db.query(sql, a)).rows[0];
  const NB = 'unnest(war.neighbors(t.c, t.r, (select max(c) + 1 from war.tiles)))';
  const spear = await q1(`select id, tile_id from war.units where country = 1 and commander = 'army' and kind not in ('worker','scout') order by id limit 1`);
  const scout = await q1(`select id, tile_id from war.units where country = 1 and kind = 'scout' order by id limit 1`);
  const free = (t, civil) => q1(`select n.id from war.tiles t cross join lateral ${NB} nid join war.tiles n on n.id = nid
    where t.id = $1 and n.terrain in ('plains','forest','hills') and not exists (select 1 from war.cities c where c.tile_id = n.id)
      and not exists (select 1 from war.markets m where m.tile_id = n.id)
      and not exists (select 1 from war.units u where u.tile_id = n.id and (u.kind in ('worker','scout')) = $2) limit 1`, t, civil);
  const sp2 = await free(spear.tile_id, false), sc2 = await free(scout.tile_id, true);
  const time = async (fn) => { const t0 = performance.now(); for (let i = 0; i < N; i++) await fn(i); return (performance.now() - t0) / N; };
  const pingPong = async (unit, uid, a, b) => time(async i => {
    await db.query('update war.units set moves_left = 5 where id = $1', [unit]);
    await rpc(uid, 'war_move', unit, [i % 2 === 0 ? b : a]);
  });
  const out = {
    군사_이동: await pingPong(spear.id, of[2].uid, spear.tile_id, sp2.id),
    정찰병_이동: await pingPong(scout.id, of[1].uid, scout.tile_id, sc2.id),
    다음_턴: await (async () => { const n = Math.max(10, Math.floor(N / 5)); const t0 = performance.now();
      for (let i = 0; i < n; i++) { const g = (await q1('select turn from war.game where id = 1')).turn; await rpc(seed.ADMIN, 'war_next_turn', g); }
      return (performance.now() - t0) / n; })(),
  };
  await db.close();
  return out;
}

console.log(`기준: ${ref} · 반복 ${N}번 (다음 턴은 ${Math.max(10, Math.floor(N / 5))}번)`);
const before = await build('이전', git);
const after = await build('지금', work);
console.log('종류            이전(ms)  지금(ms)  비율    늘어난 시간');
let bad = false;
for (const k of Object.keys(before)) {
  const r = after[k] / before[k], d = after[k] - before[k];
  // 사람이 느끼는 기준: 한 번의 이동은 +20ms 이하, 학생 수십 명이 쓰는 군사 이동은 1.2배 이하, 3분에 한 번인 다음 턴은 +150ms 이하
  const limit = k === '다음_턴' ? 150 : 20;
  const slow = d > limit || (k === '군사_이동' && r > 1.2);
  if (slow) bad = true;
  console.log(`${k.padEnd(14)} ${before[k].toFixed(2).padStart(8)}  ${after[k].toFixed(2).padStart(8)}  ${r.toFixed(2)}배  ${d >= 0 ? '+' : ''}${d.toFixed(1)}ms ${slow ? '⚠' : '✔'}`);
}
console.log(bad ? '⚠ 기준보다 느려진 항목이 있어요' : '✅ 느려진 정도가 기준 안이에요 (군사 이동은 거의 그대로, 정찰병·다음 턴은 몇 ms~수십 ms)');
process.exit(0);
