// 브라우저 전체 흐름 (무역 게임): 교사 1 + 학생 2 화면 + 봇
// CHROMIUM=... PGLITE_PATH=... SUPABASE_UMD=... node tests/trade/run.mjs
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
const { call, db } = await import('./server.mjs');
const SHOT = new URL('./shots/', import.meta.url).pathname; mkdirSync(SHOT, { recursive: true });
const BASE = 'http://localhost:8787';
const UMD = process.env.SUPABASE_UMD;
const FONT_CSS = process.env.FONT_CSS ? readFileSync(process.env.FONT_CSS, 'utf8') : '';
const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function newPage(name, w = 1366, hgt = 768) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: UMD, contentType: 'text/javascript' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: FONT_CSS, contentType: 'text/css' }));
  if (process.env.FONT_DIR) await ctx.route('**/fonts.gstatic.com/ff/**', r => { const [, fam, file] = new URL(r.request().url()).pathname.match(/\/ff\/([^/]+)\/(.+)$/); r.fulfill({ path: process.env.FONT_DIR + fam + '/files/' + file }); });
  else await ctx.route('**/fonts.gstatic.com/**', r => r.abort());
  await ctx.route('**/realtime/**', r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(name + ' PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_FAILED|404/.test(m.text())) errors.push(name + ' CONSOLE ' + m.text()); });
  p.on('dialog', d => d.accept());
  return p;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = (p, n) => p.screenshot({ path: SHOT + n + '.png' });
const one = async q => (await db.query(q)).rows[0];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) errors.push('실패: ' + m); };

// 교사
const ADMIN = randomUUID();
await call(ADMIN, 'admin_login', { p_pw: 'test-pw' });
const adm = await newPage('admin');
await adm.goto(BASE + '/admin.html');
await adm.fill('input[type=password]', 'test-pw');
await adm.click('text=들어가기');
await adm.waitForSelector('text=관제실');
await adm.click('.nav >> text=명단·연결');
const roster = []; let n = 1;
for (let g = 1; g <= 6; g++) for (let i = 0; i < (g === 1 ? 5 : 4); i++) roster.push(`${g},${n},학생${n++}`);
await adm.fill('textarea', roster.join('\n'));
await adm.click('text=명단 저장'); await wait(800);
await shot(adm, '01-admin-roster');

async function joinUI(name, cid, sname) {
  const p = await newPage(name);
  await p.goto(BASE + '/'); await p.waitForSelector('.npick'); await wait(600);
  if (name === 'A') await shot(p, '02-entry');
  await p.click(`.npick:nth-child(${cid})`);
  await p.click(`.roster button >> text=${sname}`);
  await p.waitForSelector('.topbar'); await wait(800);
  return p;
}
const A = await joinUI('A', 1, '학생1');   // 반도의 나라
const B = await joinUI('B', 3, '학생10');  // 대륙의 공장
const st = await call(ADMIN, 'admin_state', {});
const bots = {};
for (const s of st.students) if (!s.bound) { const uid = randomUUID(); await call(uid, 'join_student', { p_student: s.id }); bots[s.id] = { ...s, uid }; }
for (const s of st.students) if (['학생1', '학생10'].includes(s.name) || (s.country_id !== 1 && s.country_id !== 3 && s.no === Math.min(...st.students.filter(x => x.country_id === s.country_id).map(x => x.no)))) await call(ADMIN, 'admin_set_leader', { p_student: s.id, p_on: true });
const lead = c => { const s = st.students.filter(x => x.country_id === c)[0]; return bots[s.id] && bots[s.id].uid; };
await A.reload(); await A.waitForSelector('.hexmap'); await wait(1500);
await shot(A, '03-map-before');

// 나라 이름
await A.click('.nav >> text=우리 나라'); await wait(500);
await A.fill('#cname', '푸른반도'); await A.click('text=이름 저장'); await wait(800);
await A.click('.role-card:has-text("대지 개척자")'); await wait(700);
await shot(A, '04b-role-intro');
await A.click('.modal-x'); await wait(300);
await A.click('.role-card:has-text("수석 건축가")'); await wait(700);
await A.click('.modal-x'); await wait(300);
ok((await one(`select roles from priv.students where name = '학생1'`)).roles.length === 3, 'UI: 역할 고르기 (대표+개척자+건축가)');
ok(await A.$eval('.role-card:has-text("총사령관")', b => b.disabled), 'UI: 3개 넘으면 더 못 고름');
await shot(A, '04-nation');
await A.click('.nav >> text=지도'); await wait(800);

// 1단계 시작
await adm.click('.nav >> text=진행'); await wait(300);
await adm.click('button.primary.big'); await wait(800);
await shot(adm, '05-admin-progress');
await A.reload(); await A.waitForSelector('.hexmap'); await wait(1500);
await shot(A, '06-map-turn1');

// 노동자: 우리 땅 평원 칸 클릭 → 농장
const myPlain = await one(`select t.id from priv.tiles t where owner = 1 and terrain = 'plains' and id not in (select tile_id from priv.cities) limit 1`);
async function clickTile(p, id) {
  await p.evaluate(id => window.__map.centerOn(id), id); await wait(150);
  const box = await p.$eval('canvas.hexmap', c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.click(box.x, box.y); await wait(500);
}
const cardBtn = (p, title, btn) => p.click(`.bcard:has(b:text-is("${title}")) button:has-text("${btn}")`);

// 노동자: 평원 → 농장
await clickTile(A, myPlain.id);
await shot(A, '07-tile-panel');
await cardBtn(A, '농장', '짓기'); await wait(1200);
ok((await one(`select imp from priv.tiles where id = ${myPlain.id}`)).imp === 'farm', 'UI: 농장 짓기');
// 수도 → 시장
const cap = await one(`select tile_id from priv.cities where id = 'K'`);
await clickTile(A, cap.tile_id);
await shot(A, '08-city-window');
await cardBtn(A, '도시 시장', '짓기'); await wait(1000);
ok((await one(`select buildings from priv.cities where id = 'K'`)).buildings.includes('market'), 'UI: 도시 시장 짓기');
// 도시국가 공격: 투석기(사거리 2)는 수도에서, 창병은 옆으로 걸어가서
const k1 = await one(`select id, tile_id from priv.cities where type = 'K' and tutorial`);
await clickTile(A, k1.tile_id);
await shot(A, '09-citystate');
await A.click('button:has-text("투석기로 공격")'); await wait(600);
await shot(A, '09b-unit-window');
await A.click('.bcard.atk button:has-text("공격")'); await wait(2600);
await shot(A, '10-siege');
ok((await one(`select hp from priv.cities where id = '${k1.id}'`)).hp < 60, 'UI: 투석기 공격으로 성벽 깎임');
await A.click('button:has-text("다음 병력")'); await wait(500);
const near = await A.evaluate(ct => [...window.__map.st.hint].find(id => HexMap.hexDist(id, ct) === 1), k1.tile_id);
await clickTile(A, near); await wait(1500);
await shot(A, '10b-spear-moved');
await A.click('.bcard.atk button:has-text("공격")'); await wait(400);
await A.waitForSelector('.capture', { timeout: 8000 }).catch(() => errors.push('점령 창 안 뜸'));
await wait(400);
await shot(A, '11-captured');
await A.click('.modal-x').catch(() => {}); await wait(300);
ok((await one(`select country from priv.cities where id = '${k1.id}'`)).country === 1, 'UI: 도시국가 점령 (이동 → 공격)');
// 정찰
await A.click('.side-head button').catch(() => {}); await wait(300);
await A.click('#btn-scout'); await wait(600);
await shot(A, '12-scout-mode');
const scout = await one(`select tile_id from priv.units where country = 1 and kind = 'scout'`);
const far = await A.evaluate(() => { const ids = [...window.__map.st.hint]; return ids[ids.length - 1]; });
await clickTile(A, far); await wait(2200);
ok((await one(`select tile_id from priv.units where country = 1 and kind = 'scout'`)).tile_id !== scout.tile_id, 'UI: 정찰병 이동');
await shot(A, '13-after-scout');

// 다른 나라 봇: 첫 점령
for (let c = 2; c <= 6; c++) {
  const cs = await one(`select id, tile_id from priv.cities where tutorial and type = (select type from priv.countries where id = ${c})`);
  const spot = await one(`select t.id from priv.tiles t, priv.tiles ct where ct.id = ${cs.tile_id} and priv.hdist(t.c, t.r, ct.c, ct.r) = 1 and t.terrain not in ('ocean', 'coast') and t.id not in (select tile_id from priv.cities) and (t.owner is null or t.owner = ${c}) limit 1`);
  const us = (await db.query(`select id from priv.units where country = ${c} and kind in ('spear', 'catapult')`)).rows;
  for (const u of us) { await db.query(`update priv.units set tile_id = ${spot.id} where id = ${u.id}`); const r = await call(c === 3 ? (await one(`select uid from priv.students where name = '학생10'`)).uid : lead(c), 'unit_attack', { p_unit: u.id, p_city: cs.id }).catch(e => (errors.push('bot attack ' + e.message), {})); if (r.captured) break; }
}
// 턴 넘기기 (관제실 UI)
await adm.click('button.gold.big'); await wait(1000);
await A.reload(); await A.waitForSelector('.hexmap'); await wait(1200);
await shot(A, '14-turn2');
// 여러 턴 + 성장의 한계
for (let i = 0; i < 3; i++) await call(ADMIN, 'admin_next_turn', {});
await call(ADMIN, 'admin_set_phase', { p_target: 2 });
await call(ADMIN, 'admin_next_turn', {});
await A.reload(); await A.waitForSelector('.hexmap'); await wait(1000);
await A.click('.nav >> text=우리 나라'); await wait(500);
await shot(A, '15-nation-crisis');
await A.click('.nav >> text=기술'); await wait(800);
await shot(A, '15b-tech');
await A.click('.tcard.open button:has-text("연구")'); await wait(900);
ok((await one(`select research_turn from priv.countries where id = 1`)).research_turn > 0, 'UI: 기술 연구');
await shot(A, '15c-tech-after');
// 세계 시장 개방
await call(ADMIN, 'admin_set_phase', { p_target: 3 });
await call(ADMIN, 'admin_grant', { p_country: 1, p_items: { wood: 6 }, p_reason: '테스트' });
await A.reload(); await A.waitForSelector('.topbar'); await wait(800);
await A.click('.nav >> text=외교'); await wait(500);
await shot(A, '16-diplomacy');
await A.click('.nav >> text=무역'); await wait(500);
await A.selectOption('#o-to', '3');
await A.selectOption('#o-gi', 'wood'); await A.fill('#o-gq', '2');
await A.selectOption('#o-ti', 'coin'); await A.fill('#o-tq', '10');
await shot(A, '17-trade-form');
await A.click('button:has-text("제안 보내기")'); await wait(800);
await B.reload(); await B.waitForSelector('.topbar'); await wait(800);
await B.click('.nav >> text=무역'); await wait(500);
await shot(B, '18-trade-incoming');
await B.click('.offer button:has-text("수락")'); await wait(1000);
ok((await one(`select count(*)::int n from priv.trades`)).n >= 1, 'UI: 거래 성사');
await shot(B, '19-trade-done');
// 전자칠판
const board = await newPage('board', 1600, 900);
await board.goto(BASE + '/board.html'); await wait(2500);
await shot(board, '20-board');
await adm.reload(); await adm.waitForSelector('text=관제실'); await wait(800);
await shot(adm, '21-admin-progress');
await adm.click('.nav >> text=나라 현황'); await wait(500);
await shot(adm, '22-admin-nations');
// 관전 모드 (관제실 기기에서)
await adm.goto(BASE + '/index.html?observe=3'); await adm.waitForSelector('.topbar'); await wait(1500);
ok(await adm.$('.obs-sel') !== null, 'UI: 관전 모드 열림');
await shot(adm, '23-observe');
await adm.evaluate(() => window.__map.fitAll()); await wait(500);
await shot(adm, '24-observe-world');
await adm.selectOption('.obs-sel', '1'); await wait(1500);
const before = (await one(`select coin from priv.countries where id = 1`)).coin;
await adm.click('.nav >> text=우리 나라'); await wait(500);
await shot(adm, '25-observe-nation');
// 체험 조작: 선생님이 그 나라를 직접 움직여 봄
await adm.click('.me-chip.obs button:has-text("직접 조작")'); await wait(1500);
ok((await one(`select max(control) control from priv.admins`)).control === 1, 'UI: 체험 조작 켜기');
await adm.click('.nav >> text=지도'); await wait(1000);
await adm.click('#btn-scout'); await wait(500);
const farS = await adm.evaluate(() => { const ids = [...window.__map.st.hint]; return ids[ids.length - 1]; });
const sBefore = (await one(`select tile_id from priv.units where country = 1 and kind = 'scout'`)).tile_id;
if (farS !== undefined) { await clickTile(adm, farS); await wait(2000); }
ok((await one(`select tile_id from priv.units where country = 1 and kind = 'scout'`)).tile_id !== sBefore, 'UI: 체험 조작으로 정찰병 이동');
await shot(adm, '26-control');
ok((await one(`select coin from priv.countries where id = 1`)).coin === before, 'UI: 관전은 아무것도 안 바꿈');
console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(0);
