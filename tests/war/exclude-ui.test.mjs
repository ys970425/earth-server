// 관제실 「가져올 학생 고르기」 화면 시험 (가짜 미리보기 관제실, 1366×768)
// 체크 목록 기본값(전부 체크) · 해제한 학생은 가져오지 않음 · 모둠 인원 안내 · 새로고침해도 유지 · 가로 스크롤 없음
// 실행: npm run test:war:exclude-ui
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 5593, BASE = `http://localhost:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout, step = 300) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { } await wait(step); }
  return null;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.gz': 'application/gzip', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, BASE).pathname)).replace(/^([/\\])+/, '');
  const f = join(ROOT, rel);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(PORT);

let fails = 0;
const ok = (c, m, note = '') => { console.log(`  ${c ? '✔' : '✘'} ${m}${note ? ' — ' + note : ''}`); if (!c) fails++; };

const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { if (d.type() === 'prompt') await d.accept('초기화'); else { errors.push('alert: ' + d.message()); await d.dismiss(); } });
  await page.evaluateOnNewDocument(() => { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); });
  const boxes = () => page.$$eval('#import-students input[type=checkbox]', b => b.map(x => ({ id: Number(x.value), c: Number(x.dataset.country), on: x.checked })));
  const text = sel => page.$eval(sel, e => e.textContent).catch(() => '');
  const students = () => page.evaluate(async () => (await WarAPI.rpc('war_admin_students')).students);
  const roleRows = () => page.$$eval('.war-role-sel', r => r.length);

  await page.goto(`${BASE}/app/war/index.html?preview=1&admin=1`, { waitUntil: 'domcontentloaded' });
  ok(!!await until(() => page.$('#import-students'), 90000, 500), '가져오기 칸에 학생 체크 목록이 보임');
  let list = await boxes();
  ok(list.length === 25 && list.every(b => b.on), `기본값: 전체 ${list.length}명 모두 체크`);
  const groups = await page.$$eval('.war-exclude-group', g => g.length);
  ok(groups === 6, `모둠(나라)별 칸 ${groups}개`);
  ok(/가져올 학생 25명 \/ 무역 데이터 25명/.test(await text('#import-summary')), '요약: 가져올 학생 25명 / 무역 데이터 25명');
  ok((await text('#grp-note-1')).startsWith('5명') && !(await text('#grp-note-1')).includes('4명 모둠'), '1번 나라 5명: 4명 모둠 안내 없음');
  ok((await text('#grp-note-2')).includes('4명 모둠 규칙'), '2번 나라 4명: 「4명 모둠 규칙」 안내');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '가로 스크롤 없음 (1366×768)');
  await page.screenshot({ path: join(process.env.TEMP || '.', 'exclude-ui.png') });

  // 1번 나라(5명)에서 한 명을 해제 → 4명 모둠 안내가 나타나고 요약이 바뀜
  const target = list.find(b => b.c === 1);
  await page.evaluate(id => document.querySelector(`#import-students input[value="${id}"]`).click(), target.id);
  ok(/뺄 학생 1명/.test(await text('#import-summary')) && /가져올 학생 24명/.test(await text('#import-summary')), '한 명 해제 → 요약 「가져올 학생 24명 · 뺄 학생 1명」');
  ok((await text('#grp-note-1')).includes('4명 모둠 규칙'), '5명이던 1번 나라가 4명이 되면 「4명 모둠 규칙」 안내가 뜸');
  ok((await students()).every(s => !s.excluded), '체크만 해제해서는 서버에 아무것도 저장되지 않음 (가져오기를 눌러야 저장)');

  // 가져오기 (prompt 에 「초기화」 입력)
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '무역 게임에서 가져오기' && b.className.includes('primary')).click());
  ok(!!await until(async () => /뺀 학생 1명/.test(await text('#import-result')), 60000, 500), '가져오기 결과에 「뺀 학생 1명」이 나옴');
  await until(() => page.$('#import-students'), 30000);
  const after = await students();
  ok(after.filter(s => s.excluded).length === 1 && after.find(s => s.id === target.id).excluded, '서버에 그 학생이 「뺌」으로 저장됨 (무역 데이터 25명 → 전쟁판 24명)');
  ok(after.length === 25, '목록에는 25명 모두 그대로 있음 (무역 데이터는 안 바뀜)');
  ok((await roleRows()) === 24, `역할 현황 표에는 24명만 나옴 (${await roleRows()}명)`);

  // 가져온 뒤 화면을 다시 그려도(서버에 저장된 값으로) 해제 상태가 그대로다
  // (미리보기 DB는 페이지를 열 때마다 새로 만들어져서 새로고침으로는 확인할 수 없어요. 진짜 서버에서는 저장된 채로 남아요.)
  list = await boxes();
  ok(list.filter(b => !b.on).length === 1 && !list.find(b => b.id === target.id).on, '가져온 뒤 다시 그린 목록에서도 그 학생은 체크 해제 상태');
  ok(/뺄 학생 1명/.test(await text('#import-summary')), '요약도 그대로');
  ok(/가져왔어요/.test(await text('#import-result')), '가져오기 결과 문구가 화면을 다시 그려도 남아 있음 (예전에는 지워졌어요)');

  // 모두 선택 → 다시 가져오기 → 모두 포함
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '모두 선택').click());
  ok(/가져올 학생 25명/.test(await text('#import-summary')), '「모두 선택」 → 25명');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '무역 게임에서 가져오기' && b.className.includes('primary')).click());
  ok(!!await until(async () => (await students()).every(s => !s.excluded) && /가져왔어요/.test(await text('#import-result')), 60000, 500), '다시 가져오면 모두 포함으로 돌아감');
  await until(async () => (await roleRows()) === 25, 20000);
  ok((await roleRows()) === 25, '역할 현황 표 25명');
  ok(errors.length === 0, '콘솔·페이지 오류·경고창 없음', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close(); server.close();
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
