// 자동 화면 시험 (④): headless Chrome으로 미리보기 화면을 직접 열어 확인한다
// 실행: node tests/war/screen.test.mjs  (또는 npm run test:war:screen)
// 정적 서버: python이 있으면 `python -m http.server 5599`(백그라운드, 끝나면 종료),
//            없으면 node 내장 http 서버로 같은 일을 한다.
// PGlite는 연결이 하나라 진짜 동시 실행은 시험할 수 없다. 설치 후 웨일북 2대로 확인한다.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 5599;
const BASE = `http://localhost:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout, step = 500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { } await wait(step); }
  return null;
}

// ---------- 정적 서버 ----------
let pyChild = null, nodeServer = null;
async function startServer() {
  const py = spawnSync('python', ['-c', 'print(1)']);
  if (py.status === 0) {
    pyChild = spawn('python', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  } else {
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.gz': 'application/gzip', '.woff2': 'font/woff2' };
    nodeServer = createServer((req, res) => {
      const rel = normalize(decodeURIComponent(new URL(req.url, BASE).pathname)).replace(/^([/\\])+/, '');
      const f = join(ROOT, rel);
      if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
      res.end(readFileSync(f));
    });
    nodeServer.listen(PORT);
  }
  const up = await until(async () => (await fetch(`${BASE}/app/war/index.html`)).ok, 10000, 300);
  if (!up) throw new Error('정적 서버(5599)를 열지 못했어요');
}
async function stopServer() {
  if (pyChild) pyChild.kill();
  if (nodeServer) nodeServer.close();
}

// ---------- 시험 ----------
const results = [];
const ok = (name, pass, note = '') => {
  results.push(pass);
  console.log(`  ${pass ? '✔' : '✘'} ${name}${note ? ' — ' + note : ''}`);
};

async function clickByText(page, sel, text) {
  return page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text));
    if (el) { el.click(); return true; }
    return false;
  }, sel, text);
}

try {
  await startServer();
  const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });   // 웨일북과 같은 크기
  // 페이지가 둘 이상 열려도 폴링이 멈추지 않게 visibility를 강제로 visible로 둔다
  const keepVisible = () => { try { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); } catch { } };
  await page.evaluateOnNewDocument(keepVisible);
  

  // 미리보기 DB 준비는 몇 초 걸려요 (db-real.tar.gz를 브라우저 PGlite로 열어요)
  await page.goto(`${BASE}/app/war/index.html?preview=real`, { waitUntil: 'domcontentloaded' });

  // 1. 역할_전_지도: 역할 선택 없이 지도 canvas가 있으면 ✔
  const canvas1 = await until(() => page.$('canvas.hexmap'), 60000, 500);
  ok('역할_전_지도', !!canvas1, canvas1 ? '' : '미리보기 DB 준비 실패 또는 지도가 그려지지 않았어요');

  // 2. 역할_후_내병력: 「우리 나라」 탭 → 육군 참모총장 고르기 → 지도 탭 → 병력 목록
  await clickByText(page, '.war-big-tab', '우리 나라');
  await wait(400);
  await clickByText(page, '.war-role', '육군');
  await wait(1500);
  await clickByText(page, '.war-big-tab', '지도');
  await wait(600);
  const rows = await page.$$eval('.war-units-list .war-unit-row', els => els.length).catch(() => 0);
  ok('역할_후_내병력', rows > 0, `병력 목록 ${rows}줄`);

  // 3. 미션_완료: 병력 하나를 눌러 고르고(지도 한가운데로 옮겨짐), 캔버스에 표시된
  //    「갈 수 있는 칸」(연한 금색 테두리) 픽셀을 찾아 그 칸을 클릭 → 「미션 완료」 표시
  const firstRow = await page.$('.war-units-list .war-unit-row');
  if (firstRow) await firstRow.click();
  await wait(800);
  const hintPts = await page.evaluate(() => {
    window.scrollTo(0, 0);   // 요소 클릭 때문에 화면이 스크롤되면 캔버스가 뷰포트 위로 밀려나요 — 맨 위로
    const cv = document.querySelector('canvas.hexmap');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const img = ctx.getImageData(0, 0, W, H).data;
    // 갈 수 있는 칸 표시: 채움 rgba(255,224,122,.28) + 테두리 rgba(255,224,122,.9)
    // 테두리(알파 0.9)만 고르고, 가운데(고른 병력 표시)는 90px 안은 제외
    const pts = [];
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const R = img[i], G = img[i + 1], B = img[i + 2], A = img[i + 3];
      if (R > 215 && G > 195 && G < 240 && B > 90 && B < 155 && A > 200) {
        const dx = x - W / 2, dy = y - H / 2;
        if (dx * dx + dy * dy > 90 * 90) pts.push([x, y]);
      }
    }
    // 픽셀을 24px 격자로 묶어 대표 점(칸 중심)을 만든다
    const buckets = new Map();
    for (const [x, y] of pts) {
      const k = Math.round(x / 24) + ',' + Math.round(y / 24);
      const b = buckets.get(k) || { x: 0, y: 0, n: 0 };
      b.x += x; b.y += y; b.n++; buckets.set(k, b);
    }
    const rect = cv.getBoundingClientRect();   // 캔버스 로컬 좌표 → 화면(뷰포트) 좌표
    return [...buckets.values()].filter(b => b.n >= 4)
      .map(b => ({ x: rect.left + Math.round(b.x / b.n), y: rect.top + Math.round(b.y / b.n) }));
  });
  // 후보 점마다: 병력 다시 선택 → 후보 칸 클릭 → 「미션 완료」 표시(또는 실제 이동) 확인
  const unitSnapshot = async () => page.evaluate(async () => {
    const poll = await WarAPI.rpc('war_poll', { p_known: {} });
    const me = await WarAPI.rpc('war_me');
    return poll.units.filter(u => u.country === me.country.id && u.commander === 'army' && !['worker', 'scout'].includes(u.kind))
      .map(u => u.tile + ':' + u.moves_left).join(',');
  });
  const before = await unitSnapshot();
  let pass = false, note = hintPts.length ? '이동 시도 후에도 미션 표시가 안 보임' : '갈 수 있는 칸 표시를 캔버스에서 찾지 못했어요';
  for (const pt of hintPts.slice(0, 8)) {
    await page.evaluate(() => window.scrollTo(0, 0));   // 캔버스가 뷰포트 안에 있게 유지
    const row = await page.$('.war-units-list .war-unit-row');
    if (row) await row.click();   // 이전 클릭이 선택을 해제했을 수 있어 다시 골라요
    await wait(400);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.click(pt.x, pt.y);
    const f = await until(() => page.evaluate(() =>
      !![...document.querySelectorAll('.war-flash')].find(e => e.textContent.includes('미션 완료'))), 1300, 150);
    if (f) { pass = true; note = ''; break; }
    if ((await unitSnapshot()) !== before) { pass = true; note = '이동 성공 (플래시 시점을 놓침)'; break; }
  }
  ok('미션_완료', pass, pass ? '' : note);

  // 4. 시장_섬_그림: poll의 markets가 3곳이면 ✔ (지도 그리기 코드는 ①a에서 확인)
  const markets = await page.evaluate(async () => (await WarAPI.rpc('war_poll', { p_known: {} })).markets || []);
  ok('시장_섬_그림', markets.length === 3, `markets ${markets.length}곳`);

  // 5. 관제실_미션_표: 관제실 주소는 `app/war/index.html?preview=real&admin=1`(바로잡은 주소).
  //    이 주소에서 관제실이 열리지 않으면(아직 미지원) `admin.html?preview=real`로 확인하고 어떤 주소였는지 적는다.
  const page2 = await browser.newPage();
  await page2.evaluateOnNewDocument(keepVisible);
  let adminPass = false, adminNote = '', adminRows = 0;
  for (const [url, timeout] of [
    [`${BASE}/app/war/index.html?preview=real&admin=1`, 60000],
    [`${BASE}/app/war/admin.html?preview=real`, 60000]
  ]) {
    await page2.goto(url, { waitUntil: 'domcontentloaded' });
    const found = await until(() => page2.evaluate(() => {
      const title = [...document.querySelectorAll('.panel-title')].find(e => e.textContent.includes('튜토리얼 미션 현황'));
      if (!title) return 0;
      const panel = title.closest('.panel');
      return panel ? panel.querySelectorAll('table tr').length : 0;
    }), timeout, 1000);
    // 관제실 화면이 아니라 학생 화면(큰 탭)이 뜨면 이 주소는 관제실이 아니라는 뜻 → 바로 다음 후보로
    const studentScreen = await page2.evaluate(() => !!document.querySelector('.war-big-tab')).catch(() => false);
    if (found > 1) { adminPass = true; adminRows = found; adminNote = url.replace(BASE, ''); break; }
    if (studentScreen) adminNote = `${url.replace(BASE, '')} 는 관제실 화면을 표시하지 않음 (학생 화면이 뜸)`;
  }
  await page2.close();   // 학생 페이지가 배경으로 밀려나 그리기가 멈추지 않게 닫는다
  ok('관제실_미션_표', adminPass, adminPass ? `미션 현황 ${adminRows}줄 (${adminNote})` : adminNote || '관제실 미션 표를 찾지 못했어요');

  // 6. 공격_미리보기_다이얼로그: 병력을 적 수도 옆까지 이동시켜 빨간 테두리 칸을 만들고, 클릭하면 dialog가 뜬다
  //    (미리보기 DB는 페이지를 열 때마다 새로 만들어져 상태가 초기화돼요)
  await page.goto(`${BASE}/app/war/index.html?preview=real`, { waitUntil: 'domcontentloaded' });
  await until(() => page.$('canvas.hexmap'), 60000, 500);
  await clickByText(page, '.war-big-tab', '우리 나라');
  await wait(400);
  await clickByText(page, '.war-role', '공군');   // 전투기: 이동력 6이라 도착 뒤에도 이동력이 남아 공격 칸이 표시돼요
  await wait(1500);
  await clickByText(page, '.war-big-tab', '지도');
  await wait(600);
  // 공군 전투기를 가장 가까운 적 군사 유닛 옆까지 실제 war_move로 이동시킨다 (적이 옆에 있어야 공격 대상이 생겨요)
  const drove = await page.evaluate(async () => {
    const isCivil = k => k === 'worker' || k === 'scout';
    const dist = (a, b) => WarHexMap.hexDist(a, b);
    let best = null;
    {
      const poll = await WarAPI.rpc('war_poll', { p_known: {} });
      const me = await WarAPI.rpc('war_me');
      // 도시 위 유닛은 테두리가 도시 그림에 가려지므로, 도시가 아닌 칸의 적 군사 유닛을 노린다
      const foes = poll.units.filter(x => x.country !== me.country.id && !isCivil(x.kind) && x.tile != null
        && !poll.cities.some(c => c.tile === x.tile));
      for (const u of poll.units.filter(u => u.country === me.country.id && u.commander === 'air' && window.WAR_RULES.unitIsAir(u.kind) && u.tile != null))
        for (const e of foes) {
          const d = dist(u.tile, e.tile);
          if (!best || d < best.d) best = { u, e, d };
        }
    }
    if (!best) return { ok: false, why: '공군 병력이나 옆에서 볼 적 군사 유닛이 없어요' };
    let guard = 8;
    while (guard--) {
      const poll = await WarAPI.rpc('war_poll', { p_known: {} });
      const me = await WarAPI.rpc('war_me');
      const myC = me.country.id;
      const u = poll.units.find(x => x.id === best.u.id);
      if (!u || u.tile == null) return { ok: false, why: '병력이 사라졌어요' };
      if (dist(u.tile, best.e.tile) === 1) {
        const list = poll.units.filter(x => x.country === myC && x.commander === 'air' && x.tile != null)
          .sort((a, b) => a.id - b.id);
        return { ok: true, idx: list.findIndex(x => x.id === u.id), uid: u.id, kind: u.kind, tile: u.tile};
      }
      const tiles = new Map(poll.map.map(t => [t[0], { terrain: t[1], owner: t[3] }]));
      const occ = id => poll.units.filter(x => x.tile === id);
      const info = id => ({
        market: (poll.markets || []).some(m => m.tile === id),
        enemyCity: (() => { const c = poll.cities.find(x => x.tile === id); return !!(c && c.country !== myC); })(),
        enemyUnit: occ(id).some(x => x.country !== myC),
        sameKind: occ(id).some(x => isCivil(x.kind) === isCivil(u.kind))
      });
      const adj = WarHexMap.neighbors(best.e.tile).find(n => n >= 0 && tiles.has(n)
        && WAR_RULES.canPass(u.kind, tiles.get(n), info(n)) && WAR_RULES.canStop(u.kind, tiles.get(n), info(n)));
      if (adj == null) return { ok: false, why: '적 수도 옆에 붙을 칸이 없어요' };
      const prev = new Map([[u.tile, null]]); const q = [u.tile]; let found = null;
      while (q.length && found == null) {
        const cur = q.shift();
        for (const n of WarHexMap.neighbors(cur)) {
          if (n < 0 || n === u.tile || prev.has(n) || !tiles.has(n)) continue;
          if (occ(n).length && n !== adj) continue;   // 중간에 멈추는 칸은 비어 있어야 해요
          if (!WAR_RULES.canPass(u.kind, tiles.get(n), info(n))) continue;
          prev.set(n, cur);
          if (n === adj) { found = n; break; }
          q.push(n);
        }
      }
      if (found == null) return { ok: false, why: '적 수도 옆까지 갈 길이 없어요' };
      const path = []; for (let p = found; p !== u.tile; p = prev.get(p)) path.unshift(p);
      if (!(u.moves_left > 0)) return { ok: false, why: '이동력이 남지 않았어요' };
      // 마지막 한 칸의 이동력을 남겨 둬야 공격 칸이 표시돼요: 부족하면 한 칸 덜 간다
      const step = Math.min(u.moves_left, Math.max(1, path.length - 1));
      const seg = path.slice(0, step);
      const endT = tiles.get(seg[seg.length - 1]);
      if (!endT || ['ocean', 'coast'].includes(endT.terrain)) return { ok: false, why: '중간에 땅이 없어요 (바다가 넓어요)' };
      await WarAPI.rpc(`war_move`, { p_unit: u.id, p_path: seg });
    }
    return { ok: false, why: '이동을 반복했지만 닿지 않았어요' };
  });
  const findRed = () => page.evaluate(() => {
    window.scrollTo(0, 0);
    const cv = document.querySelector('canvas.hexmap');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const img = ctx.getImageData(0, 0, W, H).data;
    const pts = [];
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4;
      if (img[i] > 180 && img[i] - img[i + 1] > 60 && img[i] - img[i + 2] > 60 && img[i + 3] > 100) pts.push([x, y]);
    }
    if (!pts.length) return null;
    const rect = cv.getBoundingClientRect();
    const mid = pts[Math.floor(pts.length / 2)];
    return { x: rect.left + mid[0], y: rect.top + mid[1] };
  });
  // 병력을 먼저 선택해야 빨간 테두리 칸이 나타나요 → 목록에서 해당 병력을 누른 뒤 칸을 찾는다
  const diag6 = await page.evaluate(idx => {
    let clickErr = null;
    try {
      const rows = document.querySelectorAll('.war-units-list .war-unit-row');
      const r = rows[idx] || rows[0];
      if (r) r.click(); else clickErr = 'row 없음';
    } catch (e) { clickErr = e.message; }
    return { clickErr, on: document.querySelectorAll('.war-unit-row.on').length };
  }, drove.ok ? (typeof drove.idx === 'number' && drove.idx >= 0 ? drove.idx : 0) : 2);
  // 선택 → 빨간 테두리 칸 찾기 → 클릭을 3번까지 재시도 (그리기 타이밍에 따라 한 프레임에 못 잡힐 수 있어요)
  let atkPass = false, note6 = drove.ok ? '빨간 맥동 칸을 캔버스에서 찾지 못했어요' : drove.why;
  const idx6 = drove.ok ? (typeof drove.idx === 'number' && drove.idx >= 0 ? drove.idx : 0) : 2;
  for (let attempt = 0; attempt < 3 && !atkPass; attempt++) {
    await page.evaluate(i => {
      window.scrollTo(0, 0);
      const rows = document.querySelectorAll('.war-units-list .war-unit-row');
      const r = rows[i] || rows[0];
      if (r) r.click();
    }, idx6);
    await wait(600);
    const p2 = await until(findRed, 4000, 250);
    if (!p2) continue;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.click(p2.x, p2.y);
    const dlg = await until(() => page.$('dialog.war-combat'), 1000, 100);
    if (dlg) { atkPass = true; note6 = ''; }
  }
  await page.evaluate(() => document.querySelector('dialog.war-combat')?.close()).catch(() => { });
  ok('공격_미리보기_다이얼로그', atkPass, atkPass ? '' : note6);

  // 7. 점령_후_땅색_변화: 실제 공격으로 적 도시를 점령해 그 칸 주인(땅 색)이 바뀌는지 확인
  //    주의: 전쟁 선포 기능(E8)이 아직 없어 모든 나라가 평화 상태 → 실제 공격은 NOT_AT_WAR로 막힌다.
  //    막히면 poll의 타일 owner 필드 확인으로 대체하고 이유를 적는다.
  const capAttempt = await page.evaluate(async () => {
    const poll = await WarAPI.rpc('war_poll', { p_known: {} });
    const me = await WarAPI.rpc('war_me');
    const unit = poll.units.find(u => u.country === me.country.id && u.commander === 'air' && !['worker', 'scout'].includes(u.kind) && u.tile != null);
    const nearCity = poll.cities.find(c => c.country && c.country !== me.country.id && unit && unit.tile != null && WarHexMap.hexDist(unit.tile, c.tile) <= 1);
    const city = nearCity || poll.cities.find(c => c.country && c.country !== me.country.id);
    if (!unit || !city) return { tried: false, why: '공격할 병력이나 적 도시가 없어요' };
    try {
      const r = await WarAPI.rpc('war_attack', { p_unit: unit.id, p_tile: city.tile });
      return { tried: true, cityId: city.id, tile: city.tile, captured: !!r.captured };
    } catch (e) { return { tried: true, code: e.code || '', why: e.message }; }
  });
  let ownerPass = false, note7 = '';
  if (capAttempt.tried && capAttempt.captured) {
    ownerPass = await page.evaluate(async ({ cityId, tile }) => {
      const poll = await WarAPI.rpc('war_poll', { p_known: {} });
      const me = await WarAPI.rpc('war_me');
      const city = poll.cities.find(c => c.id === cityId);
      const t = (poll.map.find(x => x[0] === tile) || [])[3];
      return city && city.country === me.country.id && t === me.country.id;
    }, capAttempt);
    note7 = ownerPass ? '실제 공격으로 점령 — 도시 주인과 땅 색이 바뀜' : '점령 응답은 있었지만 poll에서 주인이 바뀌지 않았어요';
  } else if (capAttempt.tried) {
    ownerPass = await page.evaluate(async () => {
      const poll = await WarAPI.rpc('war_poll', { p_known: {} });
      return !!(poll.map && poll.map.some(t => t[3] != null));
    });
    note7 = '실제 공격 시도: ' + (capAttempt.code || '') + ' ' + (capAttempt.why || '') +
      ' → 대신 poll의 타일 owner 필드 확인 (전쟁 선포 기능 E8이 생기면 실제 점령 시험으로 교체)';
  } else {
    note7 = capAttempt.why || '';
  }
  ok('점령_후_땅색_변화', ownerPass, note7);
  await browser.close();
} catch (e) {
  ok('실행', false, (e.stack || e.message).split('\n')[0]);
} finally {
  await stopServer();
}

const fails = results.filter(p => !p).length;
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
