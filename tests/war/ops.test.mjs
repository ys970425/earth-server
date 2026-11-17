// 운영 도구 시험 (수업 당일 대비): 첩보 예외 격리 · 정찰병 이동만 첩보 갱신 · 전투 잠금 함수 · 일시정지 시간 보존 · 성찰 이름 가리기(이름만 쓴 글)
// 실행: npm run test:war:ops
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
const { db, rpc, ok, fail } = ctx;
const seed = await seedTradeState(ctx);
for (const f of ['schema.sql', 'config.sql', 'functions.sql']) await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
await rpc(seed.ADMIN, 'war_admin_import', '초기화');
const q1 = async (sql, ...a) => (await db.query(sql, a)).rows[0];

const of = c => seed.students.filter(s => s.country_id === c);
const [chief, engineer, army] = of(1);
for (const [s, role] of [[chief, 'chief'], [engineer, 'engineer'], [army, 'army']])
  await db.query('insert into war.roles(student, country, role) values ($1,1,$2)', [s.id, role]);
await db.query(`update war.game set turn = 10, paused = false, combat_on = true where id = 1`);
const NB = `unnest(war.neighbors(t.c, t.r, (select max(c) + 1 from war.tiles)))`;

// ================= 1. 첩보 쪽 오류가 나도 이동·턴 넘김은 성공 =================
console.log('— 1. 첩보(intel_refresh) 예외 격리');
{
  // 첩보 갱신 자리에 「부르면 호출 수를 세고 곧바로 오류를 내는」 가짜를 끼운다
  // (호출 수는 시퀀스로 센다: 시퀀스는 오류로 되돌려지지 않아서, 격리가 삼킨 호출도 셀 수 있어요)
  await db.exec(`create sequence if not exists war.probe_seq`);
  await db.exec(`create or replace function war.intel_refresh(p_country int default null) returns void
    language plpgsql as $$ begin perform nextval('war.probe_seq'); raise exception 'BOOM 첩보가 고장났어요'; end $$`);
  const calls = async () => { const r = await q1('select last_value::int v, is_called c from war.probe_seq'); return r.c ? r.v : 0; };

  // 군사 병력 이동: 첩보를 부르지 않아야 한다 (정찰병만 갱신)
  const spear = await q1(`select id, tile_id from war.units where country = 1 and commander = 'army' and kind not in ('worker','scout') order by id limit 1`);
  const toMil = await q1(`select n.id from war.tiles t cross join lateral ${NB} nid join war.tiles n on n.id = nid
    where t.id = $1 and n.terrain in ('plains','forest','hills') and not exists (select 1 from war.units u where u.tile_id = n.id and u.kind not in ('worker','scout'))
      and not exists (select 1 from war.cities c where c.tile_id = n.id) and not exists (select 1 from war.markets m where m.tile_id = n.id) limit 1`, spear.tile_id);
  ok(!!toMil, '준비: 창병이 갈 빈 이웃 칸');
  const before = await calls();
  if (toMil) {
    const mv = await rpc(army.uid, 'war_move', spear.id, [toMil.id]);
    ok(mv.ok === true, '창병 이동 성공');
    ok(await calls() === before, '정찰병이 아닌 병력 이동은 첩보를 부르지 않음 (이동이 느려지지 않아요)');
  }

  // 정찰병 이동: 첩보가 불리고(고장) 그래도 이동은 성공해야 한다
  const scout = await q1(`select id, tile_id from war.units where country = 1 and kind = 'scout' order by id limit 1`);
  const toCivil = await q1(`select n.id from war.tiles t cross join lateral ${NB} nid join war.tiles n on n.id = nid
    where t.id = $1 and n.terrain in ('plains','forest','hills') and not exists (select 1 from war.units u where u.tile_id = n.id and u.kind in ('worker','scout')) limit 1`, scout.tile_id);
  ok(!!scout && !!toCivil, '준비: 정찰병과 갈 빈 이웃 칸');
  if (scout && toCivil) {
    const c0 = await calls();
    const mv = await rpc(engineer.uid, 'war_move', scout.id, [toCivil.id]);
    ok(mv.ok === true, '첩보가 고장나도 정찰병 이동은 성공');
    ok(await calls() === c0 + 1, '정찰병 이동 때는 첩보를 한 번 불렀음 (그리고 그 오류는 삼켜짐)');
    ok((await q1('select tile_id from war.units where id = $1', scout.id)).tile_id === toCivil.id, '정찰병이 실제로 그 칸에 있음');
  }

  // 턴 넘김: 첩보가 고장나도 반드시 넘어간다
  const t0 = (await q1('select turn from war.game where id = 1')).turn;
  const nt = await rpc(seed.ADMIN, 'war_next_turn', t0);
  ok(nt.ok === true && (await q1('select turn from war.game where id = 1')).turn === t0 + 1, '첩보가 고장나도 다음 턴은 성공 (' + t0 + ' → ' + (t0 + 1) + ')');
  ok((await calls()) >= 2, '턴 넘김 때도 첩보를 불렀음 (그 오류는 삼켜짐)');
}

// ================= 2. 전투 잠금 함수 =================
console.log('— 2. 전투 잠금 (war_admin_set_combat)');
{
  // 교사용 poll 에 game(턴·타이머·정지·전투)이 있어야 관제실에 「다음 턴·일시정지·자동 넘김·전투 잠금」 패널이 떠요 (예전엔 빠져 있었어요)
  const adminPoll = await rpc(seed.ADMIN, 'war_poll', {});
  ok(adminPoll.game && ['turn', 'turn_seconds', 'turn_end', 'paused', 'combat_on'].every(k => k in adminPoll.game), '교사용 war_poll 에 game(turn·turn_seconds·turn_end·paused·combat_on)이 들어 있음');
  ok(await fail(rpc(army.uid, 'war_admin_set_combat', false), 'NOT_ADMIN'), '학생은 전투 잠금을 못 바꿈');
  ok(await fail(rpc(seed.ADMIN, 'war_admin_set_combat', null), 'BAD_ARGS'), '켤지 끌지 모르면 거절');
  // 공격 준비: 2번 나라와 전쟁, 수도 옆에 우리 창병
  await db.query(`update war.diplomacy set status = 'war', no_war_until = 0 where (a = 1 and b = 2) or (a = 2 and b = 1)`);
  await db.query(`update war.countries set shield_until = 0 where id in (1, 2)`);
  await db.query(`delete from war.units where country = 2 and kind not in ('worker','scout')`);
  const cap2 = await q1(`select id, tile_id from war.cities where country = 2 and kind = 'capital'`);
  await db.query(`update war.cities set hp = max_hp, besieged = false where id = $1`, [cap2.id]);
  const spot = await q1(`select t.id from war.tiles t where priv.tdist(t.id, $1) = 1 and t.terrain not in ('ocean','coast','mountain')
    and not exists (select 1 from war.units u where u.tile_id = t.id) and not exists (select 1 from war.cities c where c.tile_id = t.id) limit 1`, cap2.tile_id);
  const uid = (await q1('select coalesce(max(id),0)+1 n from war.units')).n;
  await db.query(`insert into war.units(id, country, kind, hp, moves_left, commander, moves_turn) values ($1,1,'spear',100,2,'army',0)`, [uid]);
  await db.query('select war.place_unit($1, $2)', [uid, spot.id]);

  const off = await rpc(seed.ADMIN, 'war_admin_set_combat', false);
  ok(off.ok && off.combat_on === false, '잠금 켜기 → combat_on=false');
  ok((await rpc(army.uid, 'war_poll', {})).game.combat_on === false, '학생 화면(poll)에도 전투 잠금이 내려옴');
  ok(await fail(rpc(army.uid, 'war_attack', uid, cap2.tile_id), 'NO_COMBAT'), '잠금 중 공격은 NO_COMBAT');
  const on = await rpc(seed.ADMIN, 'war_admin_set_combat', true);
  ok(on.ok && on.combat_on === true, '풀기 → combat_on=true');
  const atk = await rpc(army.uid, 'war_attack', uid, cap2.tile_id);
  ok(atk.damage !== undefined, '풀린 뒤에는 공격이 됨');
  ok((await q1('select combat_on from war.game where id = 1')).combat_on === true, '서버 값이 true');
}

// ================= 3. 일시정지 동안 턴 시간이 흐르지 않는다 =================
console.log('— 3. 일시정지·재개: 남은 시간 보존');
{
  const secsLeft = async () => { const g = await q1(`select extract(epoch from (turn_end - now()))::float s from war.game where id = 1`); return g.s; };
  await rpc(seed.ADMIN, 'war_set_turn_time', 180);
  let g = await q1('select turn from war.game where id = 1');
  await rpc(seed.ADMIN, 'war_next_turn', g.turn);
  await db.query(`update war.game set turn_end = now() + interval '100 seconds' where id = 1`);
  const p = await rpc(seed.ADMIN, 'war_pause', true);
  g = await q1('select paused, turn_end, paused_left from war.game where id = 1');
  ok(p.paused === true && g.paused && g.turn_end === null, '일시정지: 타이머가 멈춤(turn_end 없음)');
  ok(g.paused_left >= 99 && g.paused_left <= 100, `남은 시간(${g.paused_left}초)을 맡아 둠`);
  ok((await rpc(army.uid, 'war_poll', {})).game.turn_end === null, '학생 화면에도 타이머가 멈춘 것으로 내려옴');
  await rpc(seed.ADMIN, 'war_pause', true);   // 두 번 눌러도
  ok((await q1('select paused_left from war.game where id = 1')).paused_left >= 99, '일시정지를 두 번 눌러도 맡아 둔 시간이 그대로');
  await db.query(`update war.game set paused_left = 100 where id = 1`);
  await rpc(seed.ADMIN, 'war_pause', false);
  const s = await secsLeft();
  g = await q1('select paused, paused_left from war.game where id = 1');
  ok(g.paused === false && g.paused_left === null, '재개: 일시정지 해제, 맡긴 시간 비움');
  ok(s > 97 && s <= 100, `재개하면 맡아 둔 100초부터 다시 흐름 (남은 ${s.toFixed(1)}초) — 쉬는 동안 시간이 지나지 않아 자동 넘김이 곧바로 터지지 않아요`);

  // 일시정지 중 다음 턴: 시간은 흐르지 않고, 재개하면 새 턴 전체 시간이 주어진다
  await rpc(seed.ADMIN, 'war_pause', true);
  const t = (await q1('select turn from war.game where id = 1')).turn;
  await rpc(seed.ADMIN, 'war_next_turn', t);
  g = await q1('select turn, turn_end, paused_left, paused from war.game where id = 1');
  ok(g.turn === t + 1 && g.paused && g.turn_end === null && g.paused_left === 180, '정지 중에 넘긴 새 턴은 시간이 멈춘 채(180초 보관)');
  await rpc(seed.ADMIN, 'war_pause', false);
  const s2 = await secsLeft();
  ok(s2 > 177 && s2 <= 180, `재개하면 새 턴이 180초부터 (남은 ${s2.toFixed(1)}초)`);

  // 타이머가 없을 때(첫 「다음 턴」 전) 정지·재개해도 타이머가 생기지 않는다
  await db.query(`update war.game set turn_end = null, paused = false, paused_left = null where id = 1`);
  await rpc(seed.ADMIN, 'war_pause', true); await rpc(seed.ADMIN, 'war_pause', false);
  g = await q1('select turn_end, paused_left from war.game where id = 1');
  ok(g.turn_end === null && g.paused_left === null, '타이머가 없던 때 정지·재개해도 타이머가 새로 생기지 않음');
  ok(await fail(rpc(army.uid, 'war_pause', true), 'NOT_ADMIN'), '학생은 일시정지를 못 누름');
}

// ================= 4. 성찰: 이름만 쓴 글도 가린다 =================
console.log('— 4. 성찰 이름 가리기 (성을 뺀 이름)');
{
  await db.query(`update priv.students set name = '김민수' where id = $1`, [engineer.id]);
  await db.query(`update priv.students set name = '박수아' where id = $1`, [army.id]);
  await rpc(seed.ADMIN, 'war_admin_reflect_set', true);
  const text = '민수가 많이 도와줬어요. 김민수랑 수아도 같이 했어요';
  await rpc(chief.uid, 'war_reflect_submit', 1, 2, 3, text);
  const list = await rpc(seed.ADMIN, 'war_admin_reflect_list');
  const shown = list.responses[0].text;
  ok(!/민수|수아|김민수|박수아/.test(shown), '교사 목록: 성을 뺀 이름·전체 이름 모두 가려짐 → ' + shown);
  ok(shown.includes('도와줬어요') && shown.includes('같이 했어요'), '나머지 글은 그대로');
  const ex = await rpc(seed.ADMIN, 'war_admin_reflect_export');
  ok(!/민수|수아/.test(ex.markdown) && ex.markdown.includes('○○'), 'AI에 넘기는 글: 이름이 없고 「○○」가 있음');
  ok(ex.replaced >= 1, '바꾼 응답 수 기록 (' + ex.replaced + ')');
  ok(!/학생 ?\d|uid|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ex.markdown), '내보내기에 학생 번호·기기 id 같은 것이 없음');
  // 저장된 표에 이름 칸이 없다(학생 id만)
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema = 'war' and table_name = 'reflections'`)).rows.map(r => r.column_name);
  ok(!cols.some(c => /name|nick/i.test(c)), 'war.reflections 에는 이름·닉네임 칸이 없음 (' + cols.join(',') + ')');
}

ctx.summary();
