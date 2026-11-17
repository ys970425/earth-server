// E10 첩보 시험: 정찰병이 적 도시 바로 옆 칸(거리 1)에 있으면 그 나라 정보를 본다 (설계 2-1)
// 실행: npm run test:war:intel
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
  const [c1a, c1b, c1c] = of(1);
  for (const [s, role] of [[c1a, 'chief'], [c1b, 'engineer'], [c1c, 'army']]) {
    await db.query(`insert into war.roles(student, country, role) values ($1, 1, $2)`, [s.id, role]);
  }
  const [c3a] = of(3);
  await db.query(`insert into war.roles(student, country, role) values ($1, 3, 'engineer')`, [c3a.id]);

  // 준비: 1번 나라 정찰병 (없으면 새로 만든다)
  let scout = await q1(`select id, tile_id from war.units where country = 1 and kind = 'scout' order by id limit 1`);
  if (!scout) {
    const cap1 = await q1(`select tile_id from war.cities where country = 1 and kind = 'capital'`);
    const t = await q1(`select id from war.tiles where priv.tdist(id, $1) = 1 and terrain not in ('ocean','coast','mountain')
      and not exists (select 1 from war.units u where u.tile_id = tiles.id) order by id limit 1`, cap1.tile_id);
    await db.query(`insert into war.units(id, country, kind, tile_id, hp, commander) values (96001, 1, 'scout', $1, 100, 'engineer')`, [t.id]);
    scout = { id: 96001, tile_id: t.id };
  }
  await db.query(`update war.units set commander = 'engineer', moves_left = 5 where id = $1`, [scout.id]);
  const cap2 = await q1(`select tile_id from war.cities where country = 2 and kind = 'capital'`);
  const emptyCivil = (dist, from) => `select t.id from war.tiles t where priv.tdist(t.id, ${from}) = ${dist}
    and t.terrain not in ('ocean','coast','mountain')
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.markets m where m.tile_id = t.id)
    and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind in ('worker','scout'))
    and not exists (select 1 from war.units u where u.tile_id = t.id and u.country <> 1)
    order by t.id limit 1`;
  const near = await q1(emptyCivil(1, cap2.tile_id));
  ok(!!near, '준비: 2번 나라 수도 옆 빈 칸 있음 (칸 ' + (near ? near.id : '-') + ')');
  const cap3 = await q1(`select tile_id from war.cities where country = 3 and kind = 'capital'`);

  // 1) war_move로 정찰병이 도착하면 보임 + 스냅샷 내용 확인
  // 정찰병을 near 바로 옆 빈 칸으로 옮긴 뒤 한 칸 이동으로 도착시킨다
  const step = await q1(`select t.id from war.tiles t where priv.tdist(t.id, ${near.id}) = 1 and t.id <> ${cap2.tile_id}
    and t.terrain not in ('ocean','coast','mountain')
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.markets m where m.tile_id = t.id)
    and not exists (select 1 from war.units u where u.tile_id = t.id and u.id <> ${scout.id})
    order by t.id limit 1`);
  ok(!!step, '준비: 도착 칸 옆에 정찰병이 설 칸 있음 (칸 ' + (step ? step.id : '-') + ')');
  await db.query(`update war.units set tile_id = $1 where id = $2`, [step.id, scout.id]);
  await rpc(c1b.uid, 'war_move', scout.id, [near.id]);   // 공병(정찰병 조종)이 한 칸 이동 → 도착 직후 갱신
  const it12 = await q1(`select * from war.intel where observer = 1 and target = 2`);
  ok(!!it12, 'war_move 도착 직후 첩보 생성');
  const coin2 = (await q1(`select coin from war.countries where id = 2`)).coin;
  ok(it12 && it12.data.coin === coin2, '스냅샷 국고 = 그때의 코인 (' + coin2 + ')');
  const inv2 = (await q1(`select coalesce(jsonb_object_agg(item, qty), '{}'::jsonb) v from war.inventory where country = 2 and qty <> 0`)).v;
  ok(JSON.stringify(it12.data.inventory) === JSON.stringify(inv2), '스냅샷 창고 = 그때의 창고');
  const wallets2 = (await q1(`select coalesce(jsonb_object_agg(role, w), '{}'::jsonb) v
    from (select role, jsonb_object_agg(item, qty) w from war.wallets where country = 2 group by role) x`)).v;
  ok(JSON.stringify(it12.data.wallets) === JSON.stringify(wallets2), '스냅샷 역할 지갑 = 그때의 지갑');
  const facCity = (await q1(`select count(*)::int n from war.cities c
    where c.country = 2 and exists (select 1 from war.city_facilities f where f.city = c.id)`)).n;
  ok((it12.data.cities || []).length === facCity && (it12.data.cities || []).every(c => (c.facilities || []).length > 0),
    '스냅샷 공장·고등 건물 도시 목록 = 그때의 배치 (' + facCity + '곳)');

  // 2) 상대 재고가 바뀌어도 첩보는 그대로, 떠나도 남음
  await db.query(`update war.inventory set qty = qty + 7 where country = 2 and item = 'wood'`);
  await db.query(`update war.units set tile_id = $1 where id = $2`, [step.id, scout.id]);   // 떠난다
  await db.query(`select war.intel_refresh(1)`);
  const it12b = await q1(`select * from war.intel where observer = 1 and target = 2`);
  ok(it12b && it12b.data.coin === coin2 && JSON.stringify(it12b.data.inventory) === JSON.stringify(inv2),
    '떠난 뒤 상대 재고가 바뀌어도 첩보는 그때의 스냅샷 그대로');

  // 3) 거리 2에서는 안 보임
  const far3 = await q1(emptyCivil(2, cap3.tile_id));
  await db.query(`update war.units set tile_id = $1 where id = $2`, [far3.id, scout.id]);
  await db.query(`select war.intel_refresh(1)`);
  ok(!(await q1(`select 1 from war.intel where observer = 1 and target = 3`)), '거리 2에서는 3번 나라 안 보임');
  // 거리 1로 붙으면 보임
  const near3 = await q1(emptyCivil(1, cap3.tile_id));
  await db.query(`update war.units set tile_id = $1 where id = $2`, [near3.id, scout.id]);
  await db.query(`select war.intel_refresh(1)`);
  ok(!!(await q1(`select 1 from war.intel where observer = 1 and target = 3`)), '거리 1로 붙으면 3번 나라 보임');

  // 4) 도시 칸 위에 서 있으면 그 도시는 보지 않음 (이웃 도시도 없는 도시)
  const cityAlone = await q1(`select c.id, c.tile_id from war.cities c
    where c.country = 2 and c.kind <> 'capital'
    and not exists (select 1 from war.cities c2 where c2.country = 2 and c2.id <> c.id and priv.tdist(c2.tile_id, c.tile_id) <= 1)
    and not exists (select 1 from war.units u where u.tile_id = c.tile_id and u.kind in ('worker','scout'))
    limit 1`);
  if (cityAlone) {
    await db.query(`update war.units set tile_id = $1 where id = $2`, [cityAlone.tile_id, scout.id]);
    await db.query(`select war.intel_refresh(1)`);
    const it12c = await q1(`select * from war.intel where observer = 1 and target = 2`);
    ok(it12c && JSON.stringify(it12c.data) === JSON.stringify(it12b.data),
      '도시 칸 위에 서 있으면 그 도시는 보지 않음 (스냅샷 그대로)');
  } else {
    ok(true, '도시 칸 위 시험: 이웃 도시가 없는 2번 나라 비수도 도시가 없어서 건너뜀');
  }

  // 5) 동맹 나라·우리 나라는 안 보임
  await db.query(`delete from war.intel where observer = 1 and target = 2`);
  await db.query(`update war.diplomacy set status = 'ally' where (a = 1 and b = 2) or (a = 2 and b = 1)`);
  const near2b = await q1(emptyCivil(1, cap2.tile_id));
  await db.query(`update war.units set tile_id = $1 where id = $2`, [near2b.id, scout.id]);
  await db.query(`select war.intel_refresh(1)`);
  ok(!(await q1(`select 1 from war.intel where observer = 1 and target = 2`)), '동맹 나라는 안 보임');
  await db.query(`update war.diplomacy set status = 'peace' where (a = 1 and b = 2) or (a = 2 and b = 1)`);
  const near1 = await q1(emptyCivil(1, (await q1(`select tile_id from war.cities where country = 1 and kind = 'capital'`)).tile_id));
  await db.query(`update war.units set tile_id = $1 where id = $2`, [near1.id, scout.id]);
  await db.query(`select war.intel_refresh(1)`);
  ok(!(await q1(`select 1 from war.intel where observer = 1 and target = 1`)), '우리 나라는 안 보임');

  // 6) 다시 옆에 가면 새 스냅샷 (war_move) / 가만히 서 있어도 다음 턴에 갱신
  await db.query(`update war.units set tile_id = $1 where id = $2`, [step.id, scout.id]);
  await db.query(`update war.inventory set qty = qty - 3 where country = 2 and item = 'wood'`);
  await rpc(c1b.uid, 'war_move', scout.id, [near.id]);
  const it12d = await q1(`select * from war.intel where observer = 1 and target = 2`);
  const invNow = (await q1(`select coalesce(jsonb_object_agg(item, qty), '{}'::jsonb) v from war.inventory where country = 2 and qty <> 0`)).v;
  ok(it12d && JSON.stringify(it12d.data.inventory) === JSON.stringify(invNow) && it12d.seen_turn === 10,
    '다시 옆에 가면 새 스냅샷으로 바뀜 (seen_turn ' + (it12d ? it12d.seen_turn : '-') + ')');
  const mark = JSON.stringify(it12d.data);
  await rpc(seed.ADMIN, 'war_next_turn', 10);   // 턴 넘김: 가만히 서 있어도 갱신
  const turnNow = (await q1(`select turn from war.game where id = 1`)).turn;
  const it12e = await q1(`select * from war.intel where observer = 1 and target = 2`);
  ok(it12e && it12e.seen_turn === turnNow, '다음 턴에 가만히 서 있어도 갱신 (seen_turn ' + (it12e ? it12e.seen_turn : '-') + ')');

  // 7) 누수 시험: 같은 나라 다른 역할은 같은 첩보, 다른 나라는 못 본다
  const poll1 = await rpc(c1c.uid, 'war_poll', { p_known: {} });
  const intel1 = (poll1.country && poll1.country.intel) || [];
  ok(intel1.some(i => i.target === 2 && JSON.stringify(i.cities) === (it12e ? JSON.stringify(it12e.data.cities) : '')),
    '같은 나라 다른 역할(육군)이 war_poll로 같은 첩보를 받음');
  const poll3 = await rpc(c3a.uid, 'war_poll', { p_known: {} });
  const intel3 = (poll3.country && poll3.country.intel) || [];
  ok(!intel3.some(i => i.target === 2), '다른 나라(3번) 학생은 첩보를 받지 못함 (누수 금지)');

  // 8) 정찰병이 없으면 새 첩보를 만들지 않는다 (이미 본 정보는 「○턴에 본 정보」로 남는다)
  await db.query(`delete from war.units where id = $1`, [scout.id]);
  await db.query(`select war.intel_refresh(1)`);
  const itAfter = (await db.query(`select count(*)::int n from war.intel where observer = 1`)).rows[0].n;
  ok(itAfter === 2, `정찰병이 없어도 이미 본 정보는 남아요 (${itAfter}건)`);
  const [c4a] = of(4);
  const poll4 = await rpc(c4a.uid, 'war_poll', { p_known: {} });
  const intel4 = (poll4.country && poll4.country.intel) || [];
  ok(intel4.length === 0, '정찰병이 없는 나라(4번)의 첩보는 비어 있음');

  // 9) 가져오기(초기화) 뒤 비워짐
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const n = (await q1(`select count(*)::int n from war.intel`)).n;
  ok(n === 0, '가져오기(초기화) 뒤 첩보 비워짐');
} catch (e) {
  ctx.ok(false, '예외: ' + (e.stack || e.message).split('\n')[0]);
  fails++;
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
