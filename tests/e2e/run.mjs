// 브라우저 전체 흐름 점검 (npm i playwright @supabase/supabase-js@2.116.0 @electric-sql/pglite 후 node tests/e2e/run.mjs)
//: 교사 1 + 학생 2 (UI) + 학생 10 (직접 호출)
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
const { call } = await import('./server.mjs');
const SHOT = new URL('./shots/', import.meta.url).pathname; mkdirSync(SHOT, { recursive: true });
const BASE = 'http://localhost:8787';
const UMD = process.env.SUPABASE_UMD || new URL('../../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url).pathname;

const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function newPage(name, w = 1280, hgt = 800) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: UMD, contentType: 'text/javascript' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await ctx.route('**/fonts.gstatic.com/**', r => r.abort());
  await ctx.route('**/realtime/**', r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(name + ' PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_FAILED|404/.test(m.text())) errors.push(name + ' CONSOLE ' + m.text()); });
  p.on('dialog', d => d.accept());
  return p;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = (p, n) => p.screenshot({ path: SHOT + n + '.png', fullPage: false });

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
for (let g = 1; g <= 6; g++) for (let i = 0; i < 2; i++) roster.push(`${g},${n},학생${n++}`);
await adm.fill('textarea', roster.join('\n'));
await adm.click('text=명단 저장');
await wait(800);
await shot(adm, '01-admin-roster');

// 학생 A (1모둠), B (2모둠) UI로 입장
async function joinUI(name, groupLabel, studentName) {
  const p = await newPage(name, 1180, 820);
  await p.goto(BASE + '/');
  await p.waitForSelector('.group-btn');
  if (name === 'stuA') await shot(p, '00-entry');
  await p.click(`.group-btn >> text=${groupLabel}`);
  await p.click(`.roster button >> text=${studentName}`);
  await p.click('.avatar-pick button >> nth=1');
  if (name === 'stuA') await shot(p, '00b-avatar');
  await p.click('button.primary');
  await p.waitForSelector('.topbar');
  return p;
}
const A = await joinUI('stuA', '1모둠', '학생1');
await shot(A, '02-lobby');
const B = await joinUI('stuB', '2모둠', '학생3');

// 나머지 학생은 직접 호출
const bots = [];
const st = await call(ADMIN, 'admin_state', {});
for (const s of st.students) if (!s.bound) { const uid = randomUUID(); await call(uid, 'join_student', { p_student: s.id, p_avatar: 'boy' }); bots.push({ ...s, uid }); }
// 모둠장: A(학생1)와 각 모둠 봇
const st2 = await call(ADMIN, 'admin_state', {});
for (const s of st2.students) if (s.name === '학생1' || (s.group_id > 1 && s.name !== '학생3' && bots.find(b => b.id === s.id))) await call(ADMIN, 'admin_set_leader', { p_student: s.id, p_on: true });
const leaderOf = g => bots.find(b => b.group_id === g && g > 1);

// 0 → 1 (교사 UI 버튼)
await adm.click('.nav >> text=진행');
await adm.click('button.primary >> text=1차 제작 시작');
await wait(600);
await shot(adm, '03-admin-progress');

// A: 제작방에서 신발 저장
await A.reload(); await A.waitForSelector('.topbar');
await A.click('.nav >> text=제작방');
await A.waitForSelector('.mats');
await A.click('.part-row:nth-of-type(1) .mat >> nth=2');
await A.click('.part-row:nth-of-type(2) .mat >> nth=3');

await shot(A, '04-workshop');
await A.click('.workshop button.primary');
await wait(800);
await shot(A, '05-workshop-saved');

// 봇 신발
const cheap = { sole: 'M01', body: 'M06', insole: 'M11', lace: 'M16' };
const normal = { sole: 'M02', body: 'M07', insole: 'M12', lace: 'M17' };
const eco = { sole: 'M03', body: 'M08', insole: 'M13', lace: 'M18' };
for (let g = 2; g <= 6; g++) {
  const L = leaderOf(g);
  await call(L.uid, 'product_save', { p_slot: 1, p_shape: ['lowtop', 'hightop', 'clog', 'oxford'][g % 4], p_colors: { body: 'red', lace: 'ivory' }, p_parts: g % 2 || g === 6 ? cheap : normal });
  await call(L.uid, 'product_save', { p_slot: 2, p_shape: 'lowtop', p_colors: { body: 'green', lace: 'black' }, p_parts: g === 6 ? { sole: 'M03', body: 'M08', insole: 'M13', lace: 'M16' } : cheap });
}
await call(ADMIN, 'admin_flags', { p: { fast_travel: true } });
await call(ADMIN, 'admin_set_phase', { p_target: 2 });

// B: 마을 → 빠른 이동 → 1모둠 집 → 장바구니 → 구매 확정
await B.reload(); await B.waitForSelector('.topbar');
await B.click('.nav >> text=마을');
await B.waitForSelector('canvas.village');
await wait(500);
await shot(B, '06-village');
await B.keyboard.down('ArrowLeft'); await wait(560); await B.keyboard.up('ArrowLeft');
await B.keyboard.down('ArrowUp'); await wait(400); await shot(B, '06b-walking'); await wait(900); await B.keyboard.up('ArrowUp');
await wait(1200);
await shot(B, '06c-walked-in');
if (!(await B.$('.house-head'))) errors.push('걸어서 집에 들어가지 못함');
await B.click('text=마을로 나가기'); await wait(500);
await B.click('.fast button >> nth=0');
await wait(1200);
await shot(B, '07-house');
await B.hover('.stand .shoe >> nth=0');
await wait(400);
await shot(B, '07b-tooltip');
await B.click('.stand .shoe >> nth=0');
await wait(300);
await shot(B, '08-shoe-modal');
await B.click('text=장바구니에 담기');
await wait(300);
await B.click('.fast button >> nth=2').catch(() => {});
await B.click('.nav >> text=마을'); await wait(300);
await B.click('.fast button >> nth=2'); await wait(1100);
await B.click('.stand .shoe >> nth=0'); await wait(200);
await B.click('text=장바구니에 담기'); await wait(200);
await B.click('.fast button >> nth=3').catch(() => {});
await shot(B, '09-cart');
await B.click('#cart button.primary');
await wait(800);
await shot(B, '10-cart-done');

// 봇 투표
async function botVotes(round) {
  const m = await call(bots[0].uid, 'market', {});
  const qty = { 1: 3, 2: 4, 3: 5 }[round];
  for (const b of bots) {
    const others = m.groups.filter(g => g.id !== b.group_id && g.products.length);
    const items = []; let left = qty;
    for (const g of others) {
      if (!left) break;
      // 3차엔 별 신발 우선
      const ps = round === 3 ? [...g.products].sort((a, c) => (c.stars || 0) - (a.stars || 0)) : g.products;
      const q = Math.min(2, left); items.push({ product_id: ps[0].id, qty: q }); left -= q;
    }
    try { await call(b.uid, 'votes_submit', { p_items: items }); } catch (e) { console.log('vote fail', b.name, e.message); }
  }
}
await botVotes(1);
// A도 투표 (직접)
await adm.click('.nav >> text=판매'); await wait(700);
await shot(adm, '11-admin-sales');
await adm.click('.nav >> text=시장 개입'); await wait(500);
await shot(adm, '12-admin-events');
await call(ADMIN, 'admin_set_phase', { p_target: 4 });
await call(ADMIN, 'admin_grant', { p_group: null, p_amount: 700, p_reason: '테스트: 인원 보정' });
await A.reload(); await A.waitForSelector('.topbar');
await A.click('.nav >> text=성적표'); await wait(600);
await shot(A, '13-report-hidden');
await A.keyboard.press('Escape');

// 2차: A 연구 투자 (모둠장)
await A.reload(); await A.waitForSelector('.topbar');
await A.click('.nav >> text=제작방'); await wait(500);
await A.click('.invest >> nth=0'); await wait(800);
await shot(A, '14-invest');
for (let g = 2; g <= 6; g++) if (g % 2 === 0) await call(leaderOf(g).uid, 'invest', { p_kind: 'research' }).catch(e => console.log('invest', g, e.message));
await call(ADMIN, 'admin_set_phase', { p_target: 5 });
await botVotes(2);
await call(ADMIN, 'admin_set_phase', { p_target: 6 });

// 7: 경보 (학생·전자칠판)
const board = await newPage('board', 1600, 900);
await board.goto(BASE + '/board.html'); await wait(1200);
await shot(board, '15-board-before');
await adm.reload(); await adm.waitForSelector('text=관제실');
await adm.click('.nav >> text=진행');
await adm.click('button.primary >> text=환경점수 공개'); await wait(500);
await A.reload(); await wait(2500);
await shot(A, '16-alarm');
await board.evaluate(() => {}); await wait(9000);
await shot(board, '17-board-alarm');

// 8: 3차 경영, A가 재료 교체
await call(ADMIN, 'admin_set_phase', { p_target: 8 });
await call(ADMIN, 'admin_timer', { p_seconds: 600, p_label: '활동1' });
await A.reload(); await A.waitForSelector('.topbar');
await A.click('.nav >> text=제작방'); await wait(500);
if (!(await A.$('#timer-chip:not(.hidden)'))) errors.push('학생 화면에 타이머 없음');
await shot(A, '18-workshop-r3');
await wait(8500);
await board.evaluate(() => document.querySelectorAll('.alarm').forEach(x => x.remove()));
await shot(board, '18b-board-rank');
// 여성 구두 + 새 재료로 2번 칸 신발 바꾸기 시도는 3차엔 불가 → 미리보기만
await A.click('.shape-row button >> text=여성 구두'); await wait(300);
await A.click('.part-row:nth-of-type(2) .mat >> nth=5'); await wait(300);
await shot(A, '18c-maryjane-preview');
await A.click('.shape-row button >> text=운동화'); await wait(200);
for (let i = 1; i <= 4; i++) await A.click(`.part-row:nth-of-type(${i}) .mat >> nth=2`);
await A.click('.workshop button.primary'); await wait(800);
await shot(A, '19-workshop-r3-saved');
for (let g = 2; g <= 6; g++) {
  const L = leaderOf(g);
  if (g !== 3) await call(L.uid, 'product_save', { p_slot: 1, p_shape: null, p_colors: null, p_parts: eco }).catch(e => console.log('swap', g, e.message));
  if (g === 2 || g === 4) await call(L.uid, 'invest', { p_kind: 'purifier' }).catch(e => console.log('purifier', g, e.message));
}
await call(ADMIN, 'admin_set_phase', { p_target: 9 });
await B.reload(); await B.waitForSelector('.topbar');
await B.click('.nav >> text=마을'); await wait(400);
await B.click('.fast button >> nth=0'); await wait(1200);
await shot(B, '20-house-stars');
await botVotes(3);
await adm.reload(); await adm.waitForSelector('.nav'); await adm.click('.nav >> text=시장 개입'); await wait(800);
await shot(adm, '20b-admin-preview');
await call(ADMIN, 'admin_event', { p_kind: 'citizen', p_product: null, p_qty: 0, p_gauge: 15, p_message: '시민 운동' });
await call(ADMIN, 'admin_set_phase', { p_target: 10 });
await A.reload(); await wait(2500);
await shot(A, '21-final');
await A.click('.alarm button').catch(() => {}); await wait(600);
await shot(A, '22-final-report');
await call(ADMIN, 'admin_set_phase', { p_target: 11 });
await A.reload(); await wait(1500);
await A.keyboard.press('Escape').catch(() => {});
await A.click('.nav >> text=경영 원칙').catch(e => errors.push('no principle nav'));
await wait(600);
await A.click('.frames button >> nth=0'); await A.keyboard.type('환경');
await A.click('text=기업 원칙 등록'); await wait(500);
await A.click('.frames >> nth=1 >> button >> nth=0'); await A.keyboard.type('모두가 피해를 보기');
await A.click('text=내 문장 저장'); await wait(500);
await shot(A, '23-principle');
for (const b of bots.slice(0, 6)) await call(b.uid, 'principle_submit', { p_kind: 'personal', p_text: '기업이 환경을 해치면 모두가 피해를 보기 때문입니다.' });
await wait(9000);
await board.evaluate(() => document.querySelectorAll('.alarm').forEach(x => x.remove()));
await shot(board, '24-board-final');
await adm.reload(); await adm.waitForSelector('text=관제실');
await shot(adm, '25-admin-final');
await adm.click('.nav >> text=모둠'); await wait(500);
await shot(adm, '26-admin-groups');
await adm.click('.nav >> text=백업·복구'); await wait(500);
await shot(adm, '27-admin-backup');

// 나가기 → 처음 화면
await A.click('.modal-x').catch(() => {}); await wait(200);
await A.click('.nav >> text=나가기'); await wait(1500);
if (!(await A.$('.group-btn'))) errors.push('나가기 후 처음 화면이 아님');
await shot(A, '28-after-leave');

await adm.click('.nav >> text=나가기'); await wait(1500);
if (!adm.url().endsWith('index.html')) errors.push('관제실 나가기 실패');
await adm.goto(BASE + '/admin.html'); await wait(1200);
if (!(await adm.$('input[type=password]'))) errors.push('나간 뒤 비밀번호 화면이 아님');
await shot(adm, '29-admin-after-logout');
console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(0);
