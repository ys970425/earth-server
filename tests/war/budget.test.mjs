import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
try {
  const { db, ok, fail } = ctx;
  const seed = await seedTradeState(ctx);
  const q = async (sql, ...args) => (await db.query(sql, args)).rows[0];
  for (const f of ['schema.sql', 'config.sql', 'functions.sql'])
    await db.exec(readFileSync(new URL('../../supabase/war/' + f, import.meta.url), 'utf8'));
  await ctx.rpc(seed.ADMIN, 'war_admin_import', '초기화');

  // 나라 1: chief, army, navy 역할 배정
  const [chief, army, navy, air] = seed.students.filter(s => s.country_id === 1);
  for (const [student, role] of [[chief,'chief'],[army,'army'],[navy,'navy'],[air,'air']])
    await db.query('insert into war.roles(student,country,role) values($1,1,$2)', [student.id, role]);

  // chief 지갑에 코인·자원 채워두기
  await db.exec(`insert into war.wallets(country,role,item,qty) values(1,'chief','coin',200)
    on conflict(country,role,item) do update set qty=200`);
  await db.exec(`insert into war.wallets(country,role,item,qty) values(1,'chief','iron',50)
    on conflict(country,role,item) do update set qty=50`);

  const rw = async (role, item) =>
    (await q('select qty from war.role_wallets where country=1 and role=$1 and item=$2', role, item))?.qty ?? 0;
  const cw = async (item) =>
    (await q("select qty from war.wallets where country=1 and role='chief' and item=$1", item))?.qty ?? 0;

  // --- 분배 ---
  const dist = await ctx.rpc(chief.uid, 'war_budget_distribute', 'army', { coin: 30, iron: 10 });
  ok(dist.ok, '합참의장_분배_성공');
  ok(await rw('army','coin') === 30, '분배_후_army_코인_창고_30');
  ok(await rw('army','iron') === 10, '분배_후_army_철_창고_10');
  ok(await cw('coin') === 170, '분배_후_chief_코인_170');

  ok(await fail(ctx.rpc(army.uid, 'war_budget_distribute', 'navy', { coin: 10 }), 'ROLE_ONLY'),
    '합참의장_아니면_분배_거절');
  ok(await fail(ctx.rpc(chief.uid, 'war_budget_distribute', 'army', { coin: 999 }), 'NOT_ENOUGH'),
    '잔액_초과_분배_거절');

  // --- 요청 ---
  const req = await ctx.rpc(army.uid, 'war_budget_request', { coin: 20 }, '전차 구매');
  ok(req.ok && req.id, 'army_예산_요청_성공');
  ok(await fail(ctx.rpc(army.uid, 'war_budget_request', { coin: 5 }), 'ALREADY_PENDING'),
    '이미_pending이면_요청_거절');
  ok(await fail(ctx.rpc(chief.uid, 'war_budget_request', { coin: 5 }), 'BAD_ROLE'),
    '합참의장은_요청_못_함');

  // --- 승인 (그대로) ---
  const approve = await ctx.rpc(chief.uid, 'war_budget_approve', req.id);
  ok(approve.ok, '합참의장_요청_승인');
  ok(await rw('army','coin') === 50, '승인_후_army_코인_창고_50');
  ok(await cw('coin') === 150, '승인_후_chief_코인_150');

  // --- 조정 승인 ---
  const req2 = await ctx.rpc(navy.uid, 'war_budget_request', { iron: 20 });
  ok(req2.ok, 'navy_iron_요청');
  const adj = await ctx.rpc(chief.uid, 'war_budget_approve', req2.id, { iron: 5 });
  ok(adj.ok, '조정_승인_성공');
  ok(await rw('navy','iron') === 5, '조정_승인_후_navy_iron_5');
  ok(await cw('iron') === 35, '조정_승인_후_chief_iron_35');

  // --- 거절 ---
  const req3 = await ctx.rpc(air.uid, 'war_budget_request', { coin: 100 });
  ok(req3.ok, 'air_요청');
  const rej = await ctx.rpc(chief.uid, 'war_budget_reject', req3.id, '예산 부족');
  ok(rej.ok, '합참의장_요청_거절');
  ok(await rw('air','coin') === 0, '거절_후_air_코인_창고_0');

  // --- 취소 ---
  const req4 = await ctx.rpc(air.uid, 'war_budget_request', { coin: 10 });
  ok(req4.ok, 'air_재요청');
  const cancel = await ctx.rpc(air.uid, 'war_budget_request_cancel', req4.id);
  ok(cancel.ok, '역할이_자기_요청_취소');

  // --- 회수 ---
  const recall = await ctx.rpc(chief.uid, 'war_budget_recall', 'army', { coin: 10 });
  ok(recall.ok, '합참의장_회수');
  ok(await rw('army','coin') === 40, '회수_후_army_코인_40');
  ok(await cw('coin') === 160, '회수_후_chief_코인_160');

  ok(await fail(ctx.rpc(chief.uid, 'war_budget_recall', 'army', { coin: 999 }), 'NOT_ENOUGH'),
    '창고_초과_회수_거절');

  // --- 반납 ---
  const ret = await ctx.rpc(army.uid, 'war_budget_return', { coin: 5 });
  ok(ret.ok, '역할이_반납');
  ok(await rw('army','coin') === 35, '반납_후_army_코인_35');
  ok(await cw('coin') === 165, '반납_후_chief_코인_165');

  ok(await fail(ctx.rpc(chief.uid, 'war_budget_return', { coin: 1 }), 'BAD_ROLE'),
    '합참의장은_반납_못_함');

  // --- 조회 ---
  const state = await ctx.rpc(chief.uid, 'war_budget_state');
  ok(state.role_wallets && state.log && state.log.length > 0, '상태_조회_성공');

} finally {
  await ctx.close?.();
}
