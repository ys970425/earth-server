import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';
const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx), { db, ok, fail, rpc } = ctx;
  const q = async (sql, ...args) => (await db.query(sql, args)).rows[0];
  for (const f of ['schema.sql','config.sql','functions.sql']) await db.exec(readFileSync(new URL('../../supabase/war/' + f, import.meta.url),'utf8'));
  await rpc(seed.ADMIN,'war_admin_import','초기화');
  ok(true,'준비: DB 설치');
  const [chief, engineer] = seed.students.filter(s => s.country_id === 1);
  const chief4 = seed.students.find(s => s.country_id === 2);
  for (const [s, role] of [[chief,'chief'],[engineer,'engineer'],[chief4,'chief']])
    await db.query('insert into war.roles(student,country,role) values($1,$2,$3)',[s.id,s.country_id,role]);
  await db.exec('update war.countries set coin=500 where id=1');
  ok((await rpc(chief.uid,'war_budget_give','engineer','coin',50)).ok &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='coin'")).qty===50 &&
    (await q('select coin from war.countries where id=1')).coin===450,'예산_나눠주기_성공');
  ok(await fail(rpc(chief.uid,'war_budget_give','engineer','coin',99999),'NOT_ENOUGH'),'예산_나눠주기_부족');
  ok((await rpc(chief.uid,'war_budget_take','engineer','coin',20)).ok &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='coin'")).qty===30 &&
    (await q('select coin from war.countries where id=1')).coin===470,'예산_회수_성공');
  ok(await fail(rpc(chief.uid,'war_budget_take','engineer','coin',31),'NOT_ENOUGH'),'예산_회수_부족');
  ok(await fail(rpc(engineer.uid,'war_budget_give','army','coin',1),'ROLE_ONLY'),'비참모총장_나눠주기_거절');
  ok(await fail(rpc(chief.uid,'war_budget_take','air','coin',1),'NOT_ENOUGH'),'없는_지갑_회수_거절');
  ok(await fail(rpc(chief.uid,'war_budget_give','army','wood',99999),'NOT_ENOUGH'),'자원_초과_거절');
  ok(await fail(rpc(chief.uid,'war_budget_give','army','coin',null),'BAD_QTY'),'null_양_거절');
  await db.exec("update war.cities set country=1,buildings='{}' where id='K1'; update war.game set paused=false");
  for (const item of ['coin','wood','food','iron','chip','aluminum','copper','steel','tire'])
    await db.query("insert into war.wallets(country,role,item,qty) values(1,'engineer',$1,100) on conflict(country,role,item) do update set qty=100",[item]);
  ok((await rpc(engineer.uid,'war_city_build','K1','market')).ok &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='coin'")).qty===60 &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='wood'")).qty===97,'건물_짓기_성공');
  ok(await fail(rpc(engineer.uid,'war_city_build','K1','market'),'ALREADY_BUILT'),'건물_중복_거절');
  ok(await fail(rpc(chief.uid,'war_city_build','K1','plaza'),'ROLE_ONLY'),'5명_모둠_chief_건설_거절');
  await db.exec("update war.wallets set qty=0 where country=1 and role='engineer' and item='coin'");
  ok(await fail(rpc(engineer.uid,'war_city_build','K1','plaza'),'NOT_ENOUGH'),'건물_비용_부족');
  ok((await q("select qty from war.wallets where country=1 and role='engineer' and item='wood'")).qty===97,'부족하면_다른_자원_보존');
  await db.exec("update war.wallets set qty=100 where country=1 and role='engineer' and item='coin'");
  const worker=await q("select * from war.units where country=1 and kind='worker' order by id limit 1");
  await db.query("update war.tiles set owner=1,imp='mine',imp_ruined=true where id=$1",[worker.tile_id]);
  await db.query('update war.units set moves_left=2 where id=$1',[worker.id]);
  ok((await rpc(engineer.uid,'war_repair',worker.id,'tile:'+worker.tile_id)).ok &&
    !(await q('select imp_ruined from war.tiles where id=$1',worker.tile_id)).imp_ruined &&
    (await q('select moves_left from war.units where id=$1',worker.id)).moves_left===0 &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='coin'")).qty===92,'수리_성공_타일');
  await db.query('update war.units set moves_left=2 where id=$1',[worker.id]);
  ok(await fail(rpc(engineer.uid,'war_repair',worker.id,'tile:'+worker.tile_id),'NOT_RUINED'),'수리_파괴_아님_거절');
  await db.query('update war.units set moves_left=0 where id=$1',[worker.id]);
  ok(await fail(rpc(engineer.uid,'war_repair',worker.id,'tile:'+worker.tile_id),'NO_MOVES'),'수리_행동력_없음_거절');
  await db.exec("update priv.countries set techs='{}' where id=1");
  ok(await fail(rpc(engineer.uid,'war_city_build','K1','chipfab'),'NEED_TECH'),'공장_기술_조건');
  await db.exec("update priv.countries set techs=array['chipmaking'] where id=1; delete from war.city_facilities where city='K1' and kind='chipfab'");
  ok((await rpc(engineer.uid,'war_city_build','K1','chipfab')).ok &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='coin'")).qty===52,'특산_공장_할인');
  await db.exec("update war.city_facilities set ruined=true where city='K1' and kind='chipfab'");
  const city=await q("select tile_id from war.cities where id='K1'");
  await db.query('select war.place_unit($1,$2)',[worker.id,city.tile_id]);
  await db.query('update war.units set moves_left=2 where id=$1',[worker.id]);
  ok((await rpc(engineer.uid,'war_repair',worker.id,'city:K1:chipfab')).ok &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='chip'")).qty===99 &&
    (await q("select qty from war.wallets where country=1 and role='engineer' and item='coin'")).qty===32,'특산_공장_수리');
  await db.exec("update war.cities set buildings='{}' where id='J'; update war.countries set coin=500 where id=2; insert into war.inventory(country,item,qty) values(2,'wood',100) on conflict(country,item) do update set qty=100");
  ok((await rpc(chief4.uid,'war_city_build','J','market')).ok && (await q('select coin from war.countries where id=2')).coin===460,'4명_모둠_chief_국고_건설');
  ok((await rpc(engineer.uid,'war_missions')).find(m=>m.key==='eng_build').open,'E6_서버_미션_열림');
  ok((await rpc(engineer.uid,'war_mission_done','eng_build')).ok,'E6_미션_완료');
  await screenTests(ctx, chief, engineer, chief4, worker);
} catch(e) { ctx.ok(false, e.stack || e.message); }
ctx.summary();

async function screenTests(ctx, chief, engineer, chief4, worker) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    let uid = chief.uid;
    const calls = [];
    const keys = { war_poll: ['p_known'], war_budget_give: ['p_to_role','p_item','p_qty'],
      war_budget_take: ['p_from_role','p_item','p_qty'], war_city_build: ['p_city','p_kind'],
      war_repair: ['p_unit','p_target'], war_mission_done: ['p_mission'] };
    await page.exposeFunction('testRpc', async (fn, args={}) => {
      calls.push({fn,args});
      try { return { data: await ctx.rpc(uid, fn, ...(keys[fn] || []).map(k=>args[k])) }; }
      catch(e) { return { error: e.message }; }
    });
    async function load(student) {
      uid = student.uid;
      await page.goto('about:blank');
      await page.setContent('<div id="app"></div>');
      for (const file of ['app/trade/js/rules.js','app/war/js/war-rules.js'])
        await page.addScriptTag({content:readFileSync(new URL('../../'+file,import.meta.url),'utf8')});
      await page.evaluate(() => {
        window.WarHexMap = { create: () => new Proxy({}, {get:()=>()=>{}}) };
        window.WarAPI = {
          rpc: async (fn,args) => { const result=await window.testRpc(fn,args); if(result.error) throw new Error(result.error); return result.data; },
          startPoll: cb => window.WarAPI.rpc('war_poll',{p_known:{}}).then(cb)
        };
      });
      await page.addScriptTag({content:readFileSync(new URL('../../app/war/js/war-app.js',import.meta.url),'utf8')});
      await page.waitForFunction(()=>document.querySelectorAll('.war-nav-btn').length>0);
    }
    async function tab(text) {
      await page.evaluate(text=>[...document.querySelectorAll('.war-nav-btn,.war-tab')].find(e=>e.textContent===text)?.click(),text);
    }
    async function button(text) {
      await page.evaluate(text=>[...document.querySelectorAll('button')].find(e=>e.textContent===text)?.click(),text);
      await page.waitForFunction(()=>!document.querySelector('.war-msg'));
    }
    await load(chief); await tab('예산');
    await page.waitForSelector('#budget-give-qty');
    await page.$eval('#budget-give-qty',e=>e.value='5');
    await button('나눠 주기');
    await page.waitForFunction(()=>document.querySelector('.panel')?.textContent.includes('현재 지갑'));
    // Each next load waits for the previous action's poll by observing the DB-backed balance.
    await page.waitForFunction(()=>document.querySelector('.panel')?.textContent.includes('코인 37'));
    ctx.ok(calls.some(c=>c.fn==='war_budget_give' && c.args.p_qty===5),'화면_예산_나눠주기');
    await page.$eval('#budget-take-qty',e=>e.value='2'); await button('회수하기');
    await page.waitForFunction(()=>document.querySelector('.panel')?.textContent.includes('코인 35'));
    ctx.ok(calls.some(c=>c.fn==='war_budget_take' && c.args.p_qty===2),'화면_예산_회수');
    await ctx.db.exec("update war.wallets set qty=100 where country=1 and role='engineer'; update war.cities set buildings=array_remove(buildings,'plaza') where id='K1'");
    await load(engineer); await tab('건물');
    await page.select('#build-city','K1'); await page.select('#build-kind','plaza'); await button('짓기');
    await page.waitForFunction(()=>document.querySelector('.war-tab-body')?.textContent.includes('현재 건물: 도시 시장, 광장'));
    ctx.ok(calls.some(c=>c.fn==='war_city_build' && c.args.p_kind==='plaza'),'화면_건물_짓기');
    const tile=(await ctx.db.query("select tile_id from war.cities where id='K1'")).rows[0].tile_id;
    await ctx.db.query("update war.tiles set owner=1,imp='mine',imp_ruined=true where id=$1",[tile]);
    await ctx.db.query('update war.units set moves_left=2 where id=$1',[worker.id]);
    await load(engineer); await tab('개발·수리');
    await page.waitForFunction(()=>[...document.querySelectorAll('.war-tab-body button')].some(e=>e.textContent==='수리'&&!e.disabled));
    await button('수리');
    await page.waitForFunction(()=>!document.querySelector('.war-tab-body')?.textContent.includes('광산'));
    ctx.ok(calls.some(c=>c.fn==='war_repair' && c.args.p_target==='tile:'+tile),'화면_타일_수리');
    await load(chief4); await tab('건물');
    ctx.ok(!!await page.$('#build-city'),'화면_4명_모둠_건물');
    ctx.ok(errors.length===0,'화면_자바스크립트_오류_없음: '+errors.join(', '));
  } finally { await browser.close(); }
}
