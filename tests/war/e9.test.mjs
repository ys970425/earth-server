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
  const [chief, engineer] = seed.students.filter(s => s.country_id === 1);
  for (const [student, role] of [[chief, 'chief'], [engineer, 'engineer']])
    await db.query('insert into war.roles(student,country,role) values($1,1,$2)', [student.id, role]);
  const { c: cfg } = await q('select war.cfg() as c');
  const specialty = cfg.SPECIALTY_ITEM['1'];
  const item = Object.values(cfg.SPECIALTY_ITEM).find(i => i !== specialty);
  const tariff = Math.floor(cfg.ITEMS[item].ref * 0.5);
  const stock = async i => (await q('select qty from war.market_stock where market=1 and item=$1', i))?.qty || 0;
  const inv = async i => (await q('select qty from war.inventory where country=1 and item=$1', i))?.qty || 0;
  const coin = async () => (await q('select coin from war.countries where id=1')).coin;
  const markets = (await db.query(`select m.id,count(s.item)::int n,min(s.qty) qty
    from war.markets m left join war.market_stock s on s.market=m.id group by m.id`)).rows;
  ok(markets.length === 3 && markets.every(m => m.n > 0 && m.qty >= 1), '시장_재고_초기화');
  await db.query(`insert into war.inventory(country,item,qty) values(1,$1,2)
    on conflict(country,item) do update set qty=2`, [specialty]);
  await db.exec('update war.countries set coin=1000 where id=1');
  const before = { stock: await stock(specialty), target: await stock(item), item: await inv(item), specialty: await inv(specialty), coin: await coin() };
  const known = (await ctx.rpc(chief.uid, 'war_poll', {})).versions;
  const bought = await ctx.rpc(chief.uid, 'war_market_buy', 1, item);
  ok(bought.ok && bought.item === item && bought.spent_specialty && bought.tariff === tariff, '특산_있으면_물물교환_성공');
  ok(await inv(item) === before.item + 1 && await stock(item) === before.target - 1, '구매_후_아이템_증가');
  ok(await stock(specialty) === before.stock + 1, '낸_특산이_시장_창고에_늘어난다');
  ok(await coin() === before.coin - tariff, '구매_후_코인_차감');
  ok(await inv(specialty) === before.specialty - 1, '구매_후_특산_차감');
  const delta = await ctx.rpc(chief.uid, 'war_poll', known);
  ok(delta.market_stock?.['1:' + specialty] === before.stock + 1 && delta.versions.markets > known.markets && delta.country,
    '구매_후_poll_시장과_나라_버전_갱신');
  await db.query('delete from war.inventory where country=1 and item=$1', [specialty]);
  const noSpecialtyStock = await stock(specialty), noSpecialtyCoin = await coin();
  const cash = await ctx.rpc(chief.uid, 'war_market_buy', 1, item);
  ok(cash.ok && !cash.spent_specialty && await coin() === noSpecialtyCoin - tariff * 2, '특산_없으면_2배_관세_성공');
  ok(await stock(specialty) === noSpecialtyStock, '특산_없으면_창고_증가_없음');
  await db.query('update war.market_stock set qty=0 where market=1 and item=$1', [item]);
  ok(await fail(ctx.rpc(chief.uid, 'war_market_buy', 1, item), 'OUT_OF_STOCK'), '재고_없으면_실패');
  await db.query('update war.market_stock set qty=2 where market=1 and item=$1', [item]);
  await db.exec('update war.countries set coin=0 where id=1');
  ok(await fail(ctx.rpc(chief.uid, 'war_market_buy', 1, item), 'NOT_ENOUGH'), '코인_부족_실패');
  ok(await fail(ctx.rpc(engineer.uid, 'war_market_buy', 1, item), 'ROLE_ONLY'), '역할_아니면_실패');
  const poll = await ctx.rpc(chief.uid, 'war_poll', {});
  ok(poll.market_stock && Object.keys(poll.market_stock).some(k => /^1:.+/.test(k)), 'poll에_market_stock_포함');
  ok(await fail(ctx.rpc(null, 'war_market_buy', 1, item), 'NO_AUTH'), '미접속_실패');
  ok(await fail(ctx.rpc(chief.uid, 'war_market_buy', 999, item), 'NO_MARKET'), '없는_시장_실패');
  ok(!(await ctx.rpc(chief.uid, 'war_poll', poll.versions)).market_stock, '같은_버전이면_시장_생략');
  await db.exec('update war.countries set coin=1000 where id=1');
  await screenTests(ctx, chief, engineer);
} catch (e) { ctx.ok(false, '예외: ' + e.stack); }
ctx.summary();

async function screenTests(ctx, chief, engineer) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage(), errors = [], calls = [];
    page.on('pageerror', e => errors.push(e.message));
    let uid;
    const keys = { war_poll: ['p_known'], war_market_buy: ['p_market', 'p_item'], war_mission_done: ['p_mission'] };
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
      await page.waitForSelector('.war-nav-btn,.war-tab');
    }
    await load(chief);
    await page.evaluate(() => [...document.querySelectorAll('.war-nav-btn,.war-tab')].find(b => b.textContent === '시장').click());
    await page.waitForFunction(() => document.querySelector('.panel')?.textContent.includes('원래 값'));
    ctx.ok(await page.evaluate(() => {
      const text = document.querySelector('.panel')?.textContent || '';
      return text.includes('재고') && text.includes('필요한 것') && text.includes('코인');
    }), '화면_시장_재고와_비용_표시');
    const cost = await page.evaluate(() => {
      const button = [...document.querySelectorAll('.panel button')].find(b => b.textContent === '구매' && !b.disabled);
      const cost = Number(button.parentElement.textContent.match(/필요한 것: (\d+) 코인/)[1]);
      button.click();
      return cost;
    });
    await page.waitForFunction(expected => document.querySelector('.panel')?.textContent.includes('보유 코인: ' + expected), {}, 1000 - cost);
    ctx.ok(calls.some(c => c.fn === 'war_market_buy' && c.args.p_market === 1 && typeof c.args.p_item === 'string'), '화면_구매_RPC와_코인_갱신');
    await load(engineer);
    ctx.ok(await page.evaluate(() => ![...document.querySelectorAll('.war-nav-btn,.war-tab')].some(b => b.textContent === '시장')), '화면_공병_시장탭_없음');
    ctx.ok(errors.length === 0, '화면_JavaScript_오류_없음');
  } finally { await browser.close(); }
}
