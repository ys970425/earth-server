import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';

const ctx = await createDb();
try {
  const { db, ok, fail } = ctx;
  const seed = await seedTradeState(ctx);
  const q = async (sql, ...args) => (await db.query(sql, args)).rows[0];
  // 실제 무역 스키마 확인: nations/techs 대신 countries.techs를 쓴다.
  const columns = (await db.query(`select table_name,column_name from information_schema.columns
    where table_schema='priv' and table_name in ('nations','techs','countries')`)).rows;
  ok(columns.some(c => c.table_name === 'countries' && c.column_name === 'techs'), '무역 기술 스키마 확인');
  for (const f of ['schema.sql', 'config.sql', 'functions.sql'])
    await db.exec(readFileSync(new URL('../../supabase/war/' + f, import.meta.url), 'utf8'));
  await ctx.rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const [chief, engineer, army, navy, air] = seed.students.filter(s => s.country_id === 1);
  for (const [s, role] of [[chief, 'chief'], [engineer, 'engineer'], [army, 'army'], [navy, 'navy'], [air, 'air']])
    await db.query('insert into war.roles(student,country,role) values($1,1,$2)', [s.id, role]);
  const cities = (await db.query('select * from war.cities where country=1 order by id')).rows;
  ok(cities.length >= 2, '준비: DB 설치');
  const capital = cities.find(c => c.kind === 'capital');
  const other = cities.find(c => c.kind !== 'capital');
  // 테스트마다 시설을 명시하여 무역 seed의 건설 여부와 독립시킨다.
  await db.query(`update war.cities set buildings=array['barracks','harbor'] where country=1`);
  await db.query(`delete from war.units where country=1`);
  const reset = async () => db.exec('update war.cities set produced_turn=-1 where country=1');
  const fund = async role => db.query(`insert into war.wallets(country,role,item,qty)
    select 1,$1,key,1000 from jsonb_each(priv.cfg()->'ITEMS' || '{"coin":{}}'::jsonb)
    on conflict(country,role,item) do update set qty=1000`, [role]);
  for (const role of ['army', 'navy', 'air', 'engineer']) await fund(role);
  const before = await q('select qty from war.wallets where country=1 and role=\'army\' and item=\'coin\'');
  const built = await ctx.rpc(army.uid, 'war_produce', other.id, 'spear');
  const unit = await q('select * from war.units where id=$1', built.unit_id);
  ok(built.ok && unit.kind === 'spear' && unit.commander === 'army', '육군_생산_성공');
  ok(unit.moves_left === 1, '생산 직후 이동력 절반');
  ok((await q(`select qty from war.wallets where country=1 and role='army' and item='coin'`)).qty ===
    before.qty - 20, '역할 지갑에서 비용 차감');
  ok(await fail(ctx.rpc(army.uid, 'war_produce', other.id, 'spear'), 'CITY_BUSY'), '같은_도시_두번_거절');
  ok((await ctx.rpc(army.uid, 'war_produce', capital.id, 'spear')).ok, '다른_도시_생산_가능');
  await reset();
  await db.query(`update war.cities set buildings='{}' where id=$1`, [other.id]);
  ok(await fail(ctx.rpc(army.uid, 'war_produce', other.id, 'spear'), 'NO_BARRACKS'), '병영_없는_도시_거절');
  ok(await fail(ctx.rpc(navy.uid, 'war_produce', other.id, 'trireme'), 'NO_HARBOR'), '항구_없는_도시_거절');
  await db.query(`update war.cities set buildings=array['harbor','barracks'],sea=false where id=$1`, [other.id]);
  await db.query('delete from war.units');
  ok((await ctx.rpc(navy.uid, 'war_produce', other.id, 'trireme')).ok, '해군_생산_성공: sea 불필요');
  ok((await ctx.rpc(air.uid, 'war_produce', capital.id, 'fighter')).ok, '공군_생산_성공');
  await reset();
  ok(await fail(ctx.rpc(air.uid, 'war_produce', other.id, 'fighter'), 'NOT_CAPITAL'), '수도_아닌_도시_거절');
  await db.exec(`update war.wallets set qty=0 where role='army'`);
  ok(await fail(ctx.rpc(army.uid, 'war_produce', other.id, 'spear'), 'NOT_ENOUGH'), '비용_부족_거절');
  ok(await fail(ctx.rpc(navy.uid, 'war_produce', other.id, 'spear'), 'ROLE_ONLY'), '역할_불일치_거절');
  await fund('army');
  const adjacent = await ctx.rpc(army.uid, 'war_produce', other.id, 'spear');
  ok(adjacent.ok && adjacent.tile !== other.tile_id && (await q(`select $1=any(war.neighbors(c,r,
    (select max(c)+1 from war.tiles))) valid from war.tiles where id=$2`, adjacent.tile, other.tile_id)).valid,
    '비관리자_부대_배치_칸_확인: 점유 도시의 인접 칸');
  const poll = await ctx.rpc(army.uid, 'war_poll', {});
  ok(poll.cities.find(c => c.id === other.id).produced_turn === poll.game.turn, 'poll 도시 생산 잠금 전달');
  await reset();
  const worker = await ctx.rpc(engineer.uid, 'war_produce', other.id, 'worker');
  ok(worker.ok && (await q('select commander from war.units where id=$1', worker.unit_id)).commander === 'engineer', '노동자 생산');
  await reset();
  ok(await fail(ctx.rpc(air.uid, 'war_produce', capital.id, 'j_patrol'), 'NO_BOSS'), '다른 나라 특수 부대 거절');
  await db.exec(`update priv.countries set techs='{}' where id=1`);
  ok(await fail(ctx.rpc(army.uid, 'war_produce', other.id, 'knight'), 'NEED_TECH'), '기술 부족 거절');
  ok((await ctx.rpc(army.uid, 'war_mission_done', 'army_build')).ok, 'E7 서버 미션 열림');
  await db.query('delete from war.mission_done where student=$1', [army.id]);
  await reset();
  await screenTests(ctx, army, chief, other.id);
} catch (e) {
  ctx.ok(false, '예외: ' + e.stack);
}
ctx.summary();

async function screenTests(ctx, army, chief, city) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
  const errors = [], calls = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    let uid;
    const keys = { war_poll: ['p_known'], war_produce: ['p_city', 'p_kind'], war_mission_done: ['p_mission'] };
    await page.exposeFunction('testRpc', async (fn, args = {}) => {
      calls.push({ fn, args });
      try { return { data: await ctx.rpc(uid, fn, ...(keys[fn] || []).map(k => args[k])) }; }
      catch (e) { return { error: e.message }; }
    });
    async function load(student) {
      uid = student.uid;
      await page.goto('about:blank');
      await page.setContent('<div id="app"></div>');
      for (const f of ['app/trade/js/rules.js', 'app/war/js/war-rules.js'])
        await page.addScriptTag({ content: readFileSync(new URL('../../' + f, import.meta.url), 'utf8') });
      await page.evaluate(() => {
        window.WarHexMap = { create: () => new Proxy({}, { get: () => () => {} }) };
        window.WarAPI = {
          rpc: async (fn, args) => {
            const r = await window.testRpc(fn, args);
            if (r.error) throw new Error(r.error);
            return r.data;
          },
          startPoll: cb => window.WarAPI.rpc('war_poll', { p_known: {} }).then(cb)
        };
      });
      await page.addScriptTag({ content: readFileSync(new URL('../../app/war/js/war-app.js', import.meta.url), 'utf8') });
      await page.waitForSelector('.war-nav-btn');
    }
    await load(army);
    await page.evaluate(() => [...document.querySelectorAll('.war-nav-btn')].find(b => b.textContent === '생산').click());
    await page.waitForSelector('#produce-city');
    await page.select('#produce-city', city);
    ctx.ok(await page.evaluate(() => {
      const text = document.querySelector('.war-tab-body').textContent;
      return text.includes('창병') && !text.includes('전투기') && !text.includes('삼단노선');
    }), '화면 병과별 생산 목록');
    await page.evaluate(() => [...document.querySelectorAll('.war-tab-body tr')].find(r => r.textContent.includes('창병')).querySelector('button').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.war-tab-body button')].every(b => b.disabled));
    ctx.ok(calls.some(c => c.fn === 'war_produce' && c.args.p_city === city && c.args.p_kind === 'spear'), '화면 만들기 RPC');
    ctx.ok(calls.some(c => c.fn === 'war_mission_done' && c.args.p_mission === 'army_build'), '화면 생산 미션 완료');
    ctx.ok(await page.$eval('#produce-city', e => e.selectedOptions[0].textContent.includes('🔒')), '화면 생산 도시 잠금');
    await load(chief);
    ctx.ok(await page.evaluate(() => ![...document.querySelectorAll('.war-nav-btn')].some(b => b.textContent === '생산')), 'chief 생산 탭 없음');
    ctx.ok(errors.length === 0, '화면 JavaScript 오류 없음: ' + errors.join(', '));
  } finally { await browser.close(); }
}
