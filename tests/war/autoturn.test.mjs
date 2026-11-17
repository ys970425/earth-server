// 관제실 자동 턴 넘김 · 전투 잠금 버튼 화면 시험 (가짜 미리보기 관제실을 headless Chrome으로 열어 확인)
// 시간이 흐르는 것은 브라우저의 Date.now() 를 앞당겨서 흉내 내요 (서버는 시간을 검사하지 않고 교사가 누를 때만 넘겨요).
// 실행: npm run test:war:autoturn
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 5595, BASE = `http://localhost:${PORT}`;
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
  page.on('dialog', d => { errors.push('alert: ' + d.message()); d.dismiss(); });
  await page.evaluateOnNewDocument(() => {
    // 시간 앞당기기: 시험이 window.__skew 를 바꾸면 이 화면의 「지금」이 그만큼 앞서가요
    window.__skew = 0; const real = Date.now.bind(Date);
    Date.now = () => real() + window.__skew;
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  });
  const turnText = () => page.$eval('#admin-turn', el => el.textContent).catch(() => '');
  const turnNo = async () => Number(((await turnText()).match(/턴\s*(\d+)/) || [])[1] || NaN);
  const clickBtn = (text) => page.evaluate(t => { const b = [...document.querySelectorAll('#admin-turn button')].find(e => e.textContent.includes(t)); if (b) { b.click(); return true; } return false; }, text);

  await page.goto(`${BASE}/app/war/index.html?preview=1&admin=1`, { waitUntil: 'domcontentloaded' });
  ok(!!await until(() => page.$('#admin-turn'), 90000, 500), '관제실이 열리고 턴 패널이 보임');
  await until(async () => (await turnNo()) >= 0, 20000);

  // ---- 순수 판단 함수 ----
  const logic = await page.evaluate(() => {
    const f = window.WarAdminAuto.shouldAutoAdvance, past = new Date(Date.now() - 1000).toISOString(), future = new Date(Date.now() + 60000).toISOString();
    const g = o => ({ turn: 5, paused: false, turn_end: past, ...o }), n = Date.now();
    return {
      due: f(g({}), true, n, null, false, 0),
      off: f(g({}), false, n, null, false, 0),
      paused: f(g({ paused: true }), true, n, null, false, 0),
      noTimer: f(g({ turn_end: null }), true, n, null, false, 0),
      future: f(g({ turn_end: future }), true, n, null, false, 0),
      sameTurn: f(g({}), true, n, 5, false, 0),
      otherTurn: f(g({}), true, n, 4, false, 0),
      busy: f(g({}), true, n, null, true, 0),
      blocked: f(g({}), true, n, null, false, n + 5000),
    };
  });
  ok(logic.due === true, '판단: 시간이 지났고 켜짐·정지 아님 → 넘김');
  ok(!logic.off && !logic.paused && !logic.noTimer && !logic.future, '판단: 꺼짐·일시정지·타이머 없음·시간 남음 → 안 넘김');
  ok(!logic.sameTurn && logic.otherTurn && !logic.busy && !logic.blocked, '판단: 같은 턴은 한 번만, 진행 중·실패 직후에는 안 넘김');

  // ---- 켜기 기본값 + 실제 자동 넘김 ----
  const btnText = () => page.$eval('#auto-turn-btn', b => b.textContent).catch(() => '');
  ok((await btnText()).includes('켜짐'), '자동 넘김 기본 켜짐');
  const t0 = await turnNo();
  await clickBtn('다음 턴');
  ok(await until(async () => (await turnNo()) === t0 + 1, 10000), `「다음 턴」 수동: ${t0} → ${t0 + 1}`);
  ok(!!await until(async () => /남은 시간\s*\d+:\d\d/.test(await turnText()) && !/--:--/.test(await turnText()), 8000), '타이머가 돌기 시작함');

  // 시간을 앞당긴다 → 자동으로 정확히 한 번 넘어가야 한다 (한 번 째깍하는 동안만 앞당긴 뒤 되돌려요)
  await page.evaluate(() => { window.__skew = 400000; });
  await wait(1600);
  await page.evaluate(() => { window.__skew = 0; });
  ok(await until(async () => (await turnNo()) === t0 + 2, 10000), `시간이 0:00이 되자 자동으로 넘어감: ${t0 + 1} → ${t0 + 2}`);
  await wait(6500);
  ok((await turnNo()) === t0 + 2, '두 번 넘어가지 않음 (중복 방지) — 6초 뒤에도 ' + (t0 + 2) + '턴');

  // ---- 끄기 ----
  await clickBtn('자동 넘김');
  ok((await btnText()).includes('꺼짐'), '토글을 누르면 「꺼짐」');
  await clickBtn('다음 턴');
  ok(await until(async () => (await turnNo()) === t0 + 3, 10000), '수동 「다음 턴」은 꺼져 있어도 됨');
  await page.evaluate(() => { window.__skew = 400000; });
  await wait(3500);
  await page.evaluate(() => { window.__skew = 0; });
  ok((await turnNo()) === t0 + 3, '꺼져 있으면 시간이 지나도 자동으로 안 넘어감');
  const saved = await page.evaluate(() => localStorage.getItem('war_admin_auto_turn'));
  ok(saved === 'off', '끈 상태를 이 브라우저에 기억함');

  // ---- 다시 켜기 + 일시정지 ----
  await clickBtn('자동 넘김');
  ok((await btnText()).includes('켜짐'), '다시 켜짐');
  await clickBtn('일시정지');
  ok(!!await until(async () => (await turnText()).includes('일시정지 중'), 8000), '일시정지 표시');
  await page.evaluate(() => { window.__skew = 400000; });
  await wait(3500);
  await page.evaluate(() => { window.__skew = 0; });
  ok((await turnNo()) === t0 + 3, '일시정지 중에는 시간이 지나도 안 넘어감');
  await clickBtn('다시시작');
  ok(!!await until(async () => !(await turnText()).includes('일시정지 중'), 8000), '재개');
  await wait(2500);
  ok((await turnNo()) === t0 + 3, '재개 직후에도 곧바로 넘어가지 않음 (쉬는 동안 시간이 흐르지 않았어요)');
  ok(!/--:--/.test(await turnText()), '재개하면 남은 시간이 다시 보임');

  // ---- 전투 잠금 버튼 ----
  const combatState = () => page.$eval('#combat-state', e => e.textContent).catch(() => '');
  ok((await combatState()).includes('전투 가능'), '전투: 처음엔 「전투 가능」');
  await clickBtn('전투 잠금');
  ok(!!await until(async () => (await combatState()).includes('전투 잠금 중'), 8000), '「전투 잠금」을 누르면 「전투 잠금 중」');
  ok((await page.$eval('#combat-btn', b => b.textContent)).includes('전투 풀기'), '버튼이 「전투 풀기」로 바뀜');
  await clickBtn('전투 풀기');
  ok(!!await until(async () => (await combatState()).includes('전투 가능'), 8000), '「전투 풀기」를 누르면 다시 「전투 가능」');

  // ---- 새로고침해도 끈 상태 기억 (끄고 → 새로고침) ----
  await clickBtn('자동 넘김');   // 지금 켜짐 → 꺼짐
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(() => page.$('#auto-turn-btn'), 90000, 500);
  ok((await btnText()).includes('꺼짐'), '새로고침해도 「꺼짐」이 유지됨');
  ok(errors.length === 0, '콘솔·페이지 오류·경고창 없음', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close(); server.close();
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
