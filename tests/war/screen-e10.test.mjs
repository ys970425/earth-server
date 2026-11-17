// E10·E11 화면 시험: 1366×768로 열어 첩보 정보 카드와 돌아보기 양식을 확인한다
// screen.test.mjs와 같은 방식: 정적 서버 + headless Chrome + 가짜 미리보기 DB(db.tar.gz에는
// 예시 첩보 1건과 성찰 열기가 들어 있어요 — make-preview.mjs가 넣어요)
// 실행: npm run test:war:screen-e10
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 5596;
const BASE = `http://localhost:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout, step = 500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { } await wait(step); }
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.gz': 'application/gzip', '.woff2': 'font/woff2' };
const nodeServer = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, BASE).pathname)).replace(/^([/\\])+/, '');
  const f = join(ROOT, rel);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
nodeServer.listen(PORT);

const results = [];
const ok = (name, pass, note = '') => {
  results.push(pass);
  console.log(`  ${pass ? '✔' : '✘'} ${name}${note ? ' — ' + note : ''}`);
};

try {
  const up = await until(async () => (await fetch(`${BASE}/app/war/index.html`)).ok, 10000, 300);
  const browser = up ? await puppeteer.launch({ channel: 'chrome', headless: true }) : null;
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  const keepVisible = () => { try { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); } catch { } };
  await page.evaluateOnNewDocument(keepVisible);
  await page.goto(`${BASE}/app/war/index.html?preview=1&as=1:chief`, { waitUntil: 'domcontentloaded' });

  // 1. 첩보 정보: 미션 화면의 첩보 패널에 나라별 카드(2번 나라 예시 첩보)가 그려진다
  await until(() => page.$('canvas.hexmap'), 60000, 500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.war-nav-btn')].find(x => x.textContent.includes('미션')); if (b) b.click(); });
  await wait(800);
  const intelCards = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.panel-title')].find(e => e.textContent.includes('첩보 정보'));
    if (!t) return { found: false };
    const panel = t.closest('.panel');
    return { found: true, cards: panel.querySelectorAll('.war-intel-list .panel').length };
  });
  ok('첩보_정보_나라별_카드', intelCards.found && intelCards.cards > 0,
    intelCards.found ? `카드 ${intelCards.cards}장` : '첩보 패널을 찾지 못했어요');

  // 2. 돌아보기: 성찰이 열려 있으니 nav에 「돌아보기」가 보이고, 누르면 질문 4개·큰 버튼·보내기
  const navBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('.war-nav-btn')].find(x => x.textContent.includes('돌아보기')); if (b) { b.click(); return true; } return false; });
  await wait(1200);
  const reflect = await page.evaluate(() => ({
    btns: document.querySelectorAll('.war-reflect-btn').length,
    text: !!document.querySelector('.war-reflect-text'),
    warn: [...document.querySelectorAll('.war-reflect-warn')].some(e => e.textContent.includes('친구 이름은 쓰지 마세요')),
    count: [...document.querySelectorAll('.muted')].some(e => e.textContent.includes('/ 200')),
    send: !!document.querySelector('.war-reflect-send'),
    sendDisabled: (document.querySelector('.war-reflect-send') || {}).disabled === true,
    hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  ok('돌아보기_양식', navBtn && reflect.btns === 12 && reflect.text && reflect.send,
    `버튼 ${reflect.btns}개 · 글칸 ${reflect.text} · 보내기 ${reflect.send}`);
  ok('돌아보기_안내와_글자수', reflect.warn && reflect.count, `안내 ${reflect.warn} · 글자수 ${reflect.count}`);
  // 전부 답아야 보내기가 눌린다
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.war-reflect-btns')];
    for (const r of rows) r.querySelector('.war-reflect-btn')?.click();
    const t = document.querySelector('.war-reflect-text');
    t.value = '자원을 나눌 때 제일 고민했어요.';
    t.dispatchEvent(new Event('input'));
  });
  await wait(300);
  const sendEnabled = await page.evaluate(() => (document.querySelector('.war-reflect-send') || {}).disabled === false);
  ok('돌아보기_전부답면_보내기열림', sendEnabled, sendEnabled ? '' : '전부 골라도 보내기가 안 눌려요');
  ok('1366_가로스크롤_없음', !reflect.hscroll);
  await browser.close();
} catch (e) {
  ok('실행', false, (e.stack || e.message).split('\n')[0]);
} finally {
  nodeServer.close();
}
const fails = results.filter(p => !p).length;
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
