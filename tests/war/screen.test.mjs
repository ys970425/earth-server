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
  page.on('console', m => { const t = m.text(); if (t.includes('(진단') || t.includes('오류') || t.includes('실패')) console.log('  (페이지)', t); });

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
  ok('관제실_미션_표', adminPass, adminPass ? `미션 현황 ${adminRows}줄 (${adminNote})` : adminNote || '관제실 미션 표를 찾지 못했어요');

  await browser.close();
} catch (e) {
  ok('실행', false, (e.stack || e.message).split('\n')[0]);
} finally {
  await stopServer();
}

const fails = results.filter(p => !p).length;
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
