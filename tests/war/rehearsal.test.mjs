// 밤샘 리허설 검증 (실제 수업 전, 읽기만): 서버 설치·코드 수정 없이 변수를 줄인다
//  1) 배포된 earth-war 사이트의 파일이 전부 200으로 내려와지는지 (fetch GET만, 브라우저로 열지 않음)
//  2) 배포 설정의 Supabase 주소 = 로컬 설정. 서비스 키·*-real* 파일이 배포본에 없음
//  3) C:\projects\earth-war 가 war:sync 결과(earth-server 기준)와 같은지 비교만
//  4) PGlite 수업 리허설 모의: 25명(4명 모둠 5 + 5명 모둠 1), 연습 3턴(5분, 전투 잠금) → 본 게임 50턴(3분) → 성찰 열기
//  5) docs/class 자료의 버튼 이름이 실제 앱 글자와 같은지
// 실행: npm run test:war:rehearsal   (실제 Supabase 접속·로그인·쓰기 없음)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, seedTradeState } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const p = (...s) => join(ROOT, ...s);
const WAR_DEST = 'C:/projects/earth-war';
const SITE = 'https://ys970425.github.io/earth-war/';

let fails = 0;
const line = (sec, ok, m, note = '') => {
  console.log(`  ${ok ? '✔' : '✘'} [${sec}] ${m}${note ? ' — ' + note : ''}`);
  if (!ok) fails++;
};

// ---------- war:sync 가 복사하는 파일 목록 (sync-earth-war.mjs 규칙 그대로) ----------
const DIRS = ['app/war', 'app/trade/css', 'app/trade/fonts', 'app/trade/img/terrain', 'app/trade/assets/small', 'app/trade/assets/units'];
const FILES = ['app/trade/js/config.js', 'app/trade/js/rules.js'];
const BLOCK = [/-real/i, /(^|[\\/])private([\\/]|$)/, /(^|[\\/])\.env/, /node_modules/, /^app\/war\/img(\/|$)/, /(^|[\\/])qna[\\/]package\.json$/];
function walkFiles(dir, rel0 = '') {
  const out = [];
  for (const n of readdirSync(dir)) {
    const full = join(dir, n);
    const rel = rel0 ? rel0 + '/' + n : n;
    if (BLOCK.some(r => r.test(rel))) continue;
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, rel));
    else out.push({ rel, full });
  }
  return out;
}
const syncSources = [];
for (const d of DIRS) syncSources.push(...walkFiles(p(d), d));
for (const f of FILES) syncSources.push({ rel: f, full: p(f) });
syncSources.push({ rel: 'index.html', full: null });           // sync가 생성
// war-qna.js는 폴더 순회에서 원본으로 잡히지만, sync가 AI 끔으로 바꿔 쓰므로 생성본 규칙으로 비교해요
for (const s of syncSources) if (s.rel === 'app/war/js/war-qna.js') { s.generated = true; s.full = p('app/war/js/war-qna.js'); }
syncSources.push({ rel: 'app/war/js/war-qna.js', full: p('app/war/js/war-qna.js'), generated: true }); // sync가 AI 끔으로 변경

// sync가 만드는 index.html (sync-earth-war.mjs 3단계 템플릿과 같은 글)
const EXPECT_INDEX = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<link rel="icon" type="image/png" href="app/war/favicon.png">
<title>지구 서버: 전쟁의 시간</title>
<!-- 기본: 실제 모드. 주소 끝에 ?preview=1 을 붙이면 가짜 데이터 체험판. (tools/war/sync-earth-war.mjs 가 만든 파일) -->
<script>location.replace('app/war/index.html' + location.search);</script>
<noscript><meta http-equiv="refresh" content="0; url=app/war/index.html"></noscript>
</head>
<body>
<p>잠깐만요, 이동하고 있어요… <a href="app/war/index.html">바로 가기</a> · <a href="app/war/index.html?preview=1">가짜 데이터 체험판</a></p>
</body>
</html>
`;
// sync가 만드는 war-qna.js (4단계 치환과 같은 글)
function expectQna() {
  let s = readFileSync(p('app/war/js/war-qna.js'), 'utf8');
  s = s.replace(/const PROXY_URL\s*=\s*['"]http:\/\/localhost:\d+[^'"]*['"];?/,
    "const PROXY_URL = null;   // 배포본: 학생 기기에서는 교사 PC의 로컬 프록시에 닿지 않아서 AI 호출을 껐어요 (sync-earth-war.mjs)")
    .replace(/async function askAI\(query\)\s*\{/, m => m + "\n  if (!PROXY_URL) return { ok: false, error: 'NETWORK' };   // 배포본: FAQ 키워드 답만 써요");
  return s;
}

// ---------- 공용 결과 ----------
const summary = { fetch404: [], fetchOther: [], diffFiles: [], softDiff: [], extraDest: [], unexpectedErrors: [], codeTally: {}, noSpace: {}, workerMove4: {}, engBuild4: {}, lockAttackSuccess: 0, negatives: [], reflect: {} };

// ---------- 1+2. 배포 확인 (fetch GET만) ----------
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}
async function checkDeployment() {
  console.log('— 1·2. 배포 확인 (fetch 내려받기만)');
  const localCfg = readFileSync(p('app/trade/js/config.js'), 'utf8');
  const localUrl = (localCfg.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';

  // 브라우저가 실제로 내려받는 대표 파일 + sync 복사 목록 전부
  const urls = ['app/war/index.html', 'app/war/admin.html', 'app/war/css/war.css', 'app/war/css/war-qna.css',
    'app/war/qna/qna-engine.js', 'app/war/qna/faq.json', 'app/war/preview/state.json', 'app/war/preview/db.tar.gz'];
  for (const s of syncSources) if (!s.generated && s.rel !== 'index.html') urls.push(s.rel);
  const seen = new Set();
  const list = urls.filter(u => (seen.has(u) ? false : (seen.add(u), true)));

  const results = new Map();
  await pool(list, 8, async rel => {
    try {
      const r = await fetch(SITE + rel.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(60000) });
      results.set(rel, r.status);
      if (r.ok) await r.arrayBuffer();   // 본문까지 내려받기 완료
    } catch (e) { results.set(rel, 'ERR:' + (e.message || e).split('\n')[0]); }
  });
  // 첫 화면(리디렉트 페이지)과 배포 설정 비교용 config.js
  try {
    const root = await fetch(SITE, { signal: AbortSignal.timeout(30000) });
    const rootText = root.ok ? await root.text() : '';
    line('배포', root.ok && rootText.includes("location.replace('app/war/index.html'"), '첫 화면 / (index.html) 내려받음');
  } catch (e) { line('배포', false, '첫 화면 / 내려받음', String(e.message).split('\n')[0]); }
  const cfgStatus = results.get('app/trade/js/config.js');
  if (cfgStatus === 200) {
    // 배포 경로: 저장소 app/trade/js/config.js → /earth-war/app/trade/js/config.js (앱 화면의 ../trade/... 참조와 같은 곳)
    const r = await fetch(SITE + 'app/trade/js/config.js', { signal: AbortSignal.timeout(30000) });
    const txt = r.ok ? await r.text() : '';
    const is404Page = /There isn't a GitHub Pages site here|default-src 'none'/.test(txt);
    const depUrl = (txt.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';
    line('설정', !is404Page && depUrl === localUrl, '배포 Supabase 주소 = 로컬 설정',
      is404Page ? '배포에 config.js가 없어요(404 안내 페이지)' : (depUrl || '(주소 없음)'));
    line('설정', !is404Page && !/service_role|sb_secret_/.test(txt), '배포 config에 서비스·비밀 키 흔적 없음');
  } else {
    line('설정', false, '배포 config.js 내려받음', '상태 ' + cfgStatus);
  }
  // *-real* 파일은 배포에 없어야 한다 (404가 정답)
  for (const rel of ['app/war/preview/db-real.tar.gz', 'app/war/preview/state-real.json']) {
    let st = 'ERR';
    try { st = (await fetch(SITE + rel, { signal: AbortSignal.timeout(30000) })).status; } catch { }
    line('설정', st === 404, `배포에 실제 데이터 파일 없음 (${rel})`, '상태 ' + st);
  }
  for (const [rel, st] of results) {
    if (st === 200) continue;
    if (st === 404) summary.fetch404.push(rel);
    else summary.fetchOther.push(rel + ' → ' + st);
  }
  line('배포', summary.fetch404.length === 0, `필요 파일 전부 200 (${list.length}개 중 404 ${summary.fetch404.length}건)`,
    summary.fetch404.length ? '404: ' + summary.fetch404.join(', ') : '');
  line('배포', summary.fetchOther.length === 0, '그 외 오류 상태 없음', summary.fetchOther.join(', ') || '');
}

// ---------- 3. earth-war 최신 비교 (sync 결과와 같은지, 쓰기 없음) ----------
function checkSync() {
  console.log('— 3. earth-war 복사본 최신 비교 (쓰기 없음)');
  if (!existsSync(WAR_DEST + '/.git')) { line('동기화', false, 'earth-war 폴더 확인', WAR_DEST + ' 가 없어요'); return; }
  const qna = expectQna();
  for (const s of syncSources) {
    const destPath = join(WAR_DEST, s.rel);
    if (!existsSync(destPath)) { summary.diffFiles.push(s.rel + ' (없음)'); continue; }
    const want = s.rel === 'index.html' ? Buffer.from(EXPECT_INDEX, 'utf8')
      : s.generated ? Buffer.from(qna, 'utf8') : readFileSync(s.full);
    const got = readFileSync(destPath);
    if (Buffer.compare(want, got) !== 0) {
      // sync가 만드는 파일(index.html·war-qna.js)은 줄바꿈 문자(CRLF/LF) 차이는 내용 차이가 아니에요
      const norm = b => s.generated ? Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : b;
      if (Buffer.compare(norm(want), norm(got)) !== 0) summary.diffFiles.push(s.rel + ' (다름)');
      else summary.softDiff.push(s.rel + ' (줄바꿈 문자만 다름)');
    }
  }
  // earth-war에 sync 목록에 없는 잉여 파일(새로 생긴 것)도 찾는다
  const have = new Set(syncSources.map(s => s.rel));
  for (const d of DIRS) {
    if (!existsSync(join(WAR_DEST, d))) continue;
    for (const f of walkFiles(join(WAR_DEST, d), d)) if (!have.has(f.rel)) summary.extraDest.push(f.rel);
  }
  line('동기화', summary.diffFiles.length === 0, `earth-war = war:sync 결과 (${syncSources.length}개 파일 비교${summary.softDiff.length ? ', 줄바꿈만 다른 파일 ' + summary.softDiff.length + '개' : ''})`,
    summary.diffFiles.length ? '다름: ' + summary.diffFiles.slice(0, 8).join(', ') + (summary.diffFiles.length > 8 ? ' 외 ' + (summary.diffFiles.length - 8) + '개' : '') : (summary.softDiff.join(', ') || ''));
  if (summary.diffFiles.some(f => f.includes('war-qna.js'))) {
    const dep = readFileSync(join(WAR_DEST, 'app/war/js/war-qna.js'), 'utf8');
    const want = expectQna();
    let i = 0; while (i < Math.min(dep.length, want.length) && dep[i] === want[i]) i++;
    console.log(`  (참고) 배포 war-qna.js: AI끔(${dep.includes('PROXY_URL = null')}) · 로컬프록시 남음(${dep.includes('localhost:3717')}) · 글자 수 배포 ${dep.length} vs 예상 ${want.length}`);
    if (i >= Math.min(dep.length, want.length) && dep.length === want.length) {
      console.log('  (참고) 글자는 완전히 같아요 — 바이트 차이는 줄바꿈(CRLF/LF)뿐일 가능성이 커요');
      const a = readFileSync(join(WAR_DEST, 'app/war/js/war-qna.js')), b = Buffer.from(want, 'utf8');
      let j = 0; while (j < Math.min(a.length, b.length) && a[j] === b[j]) j++;
      console.log(`  (참고) 처음 다른 바이트 위치 ${j}: 배포 ${a.slice(Math.max(0, j - 3), j + 4)} / 예상 ${b.slice(Math.max(0, j - 3), j + 4)}`);
    } else {
      console.log(`  (참고) 처음 다른 위치 ${i}: 배포 «${dep.slice(Math.max(0, i - 40), i + 60).replace(/\n/g, '⏎')}» / 오늘 sync 예상 «${want.slice(Math.max(0, i - 40), i + 60).replace(/\n/g, '⏎')}»`);
    }
  }
  line('동기화', summary.extraDest.length === 0, 'earth-war에 잉여 파일 없음', summary.extraDest.slice(0, 8).join(', ') || '');
}

// ---------- 4. PGlite 수업 리허설 모의 ----------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261117);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const chance = pr => rnd() < pr;

const BIZ = /^[A-Z][A-Z0-9_]{2,}: /;
async function rehearsal() {
  console.log('— 4. 수업 리허설 모의 (PGlite, 실제 서버 아님)');
  const ctx = await createDb();
  const { db, rpc } = ctx;
  const q1 = async (sql, ...a) => (await db.query(sql, a)).rows[0];
  const qs = async (sql, ...a) => (await db.query(sql, a)).rows;
  const seed = await seedTradeState(ctx);
  for (const f of ['schema', 'config', 'functions']) db.exec(readFileSync(p('supabase/war/' + f + '.sql'), 'utf8'));
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');

  // 역할: 1번 나라 5명(의장·공병·육·해·공), 2~6번 나라 4명(의장·육·해·공 — 의장이 공병 일도)
  const students = seed.students;
  const of = c => students.filter(s => s.country_id === c);
  const roles = {};
  const setRole = (s, r) => db.query(`insert into war.roles(student, country, role) values ($1,$2,$3) on conflict (student) do update set role=$3, absent=false`, [s.id, s.country_id, r]);
  const c1 = of(1);
  await setRole(c1[0], 'chief'); await setRole(c1[1], 'engineer'); await setRole(c1[2], 'army'); await setRole(c1[3], 'navy'); await setRole(c1[4], 'air');
  roles[1] = { chief: c1[0], engineer: c1[1], army: c1[2], navy: c1[3], air: c1[4] };
  for (let c = 2; c <= 6; c++) {
    const g = of(c);
    await setRole(g[0], 'chief'); await setRole(g[1], 'army'); await setRole(g[2], 'navy'); await setRole(g[3], 'air');
    roles[c] = { chief: g[0], army: g[1], navy: g[2], air: g[3] };
  }
  // 시작 상태: 연습 3턴 = 5분 턴 + 전투 잠금
  await db.exec(`update war.game set turn = 0, turn_seconds = 300, paused = false, combat_on = false where id = 1`);

  const UNITS = (await q1(`select data->'UNITS' u from war.config where id = 1`)).u;
  const WIDTH = (await q1(`select (priv.cfg()->>'W')::int w from priv.config where id = 1`)).w;
  const caps = Object.fromEntries((await qs(`select country, id from war.cities where kind = 'capital'`)).map(r => [r.country, r.id]));
  const capTile = Object.fromEntries((await qs(`select country, tile_id from war.cities where kind = 'capital'`)).map(r => [r.country, r.tile_id]));

  const record = code => { summary.codeTally[code] = (summary.codeTally[code] || 0) + 1; };
  const call = async (who, fn, ...args) => {
    try { const r = await rpc(who.uid, fn, ...args); return r; }
    catch (e) {
      const m = String(e.message || e);
      if (BIZ.test(m)) {
        const code = m.split(':')[0].trim();
        record(code);
        if (code === 'NO_SPACE') { const c = who.country || '?'; summary.noSpace[c] = (summary.noSpace[c] || 0) + 1; }
        return { __err: code };
      }
      summary.unexpectedErrors.push(`${fn}(${who.country}번): ${m.split('\n')[0]}`);
      return { __err: 'UNEXPECTED' };
    }
  };
  const err = r => (r && r.__err) || null;

  const militaryKinds = Object.keys(UNITS).filter(k => !['worker', 'scout'].includes(k));
  const kindsByBranch = b => Object.keys(UNITS).filter(k => (UNITS[k].branch || '') === b);

  // --- 행동 생성기 ---
  async function actBudget(c) {
    const R = roles[c];
    const who = pick([R.army, R.navy, R.air, R.engineer].filter(Boolean));
    if (chance(0.5)) await call(who, 'war_budget_request', { [pick(['coin', 'wood', 'iron', 'steel', 'fuel'])]: 1 + Math.floor(rnd() * 10) }, '리허설 요청');
    else if (chance(0.5)) {
      const pend = (await qs(`select id from war.budget_requests where country = $1 and status = 'pending' order by id`, c))[0];
      if (pend) await call(R.chief, chance(0.5) ? 'war_budget_approve' : 'war_budget_reject', pend.id);
    } else {
      const w = (await qs(`select role, item, qty from war.wallets where country = $1 and qty > 0 limit 5`, c));
      if (w.length && chance(0.5)) { const row = pick(w); await call(R.chief, 'war_budget_recall', row.role, { [row.item]: 1 }); }
      else if (w.length) { const row = pick(w); await call(roles[c][row.role] || R.chief, 'war_budget_return', { [row.item]: 1 }); }
    }
  }
  async function actProduce(c) {
    const R = roles[c];
    const branch = pick(['army', 'navy', 'air', 'engineer']);
    const who = R[branch] || R.chief;
    const kinds = kindsByBranch(branch === 'engineer' ? 'civil' : branch).filter(k => UNITS[k].cost);
    if (!kinds.length) return;
    await call(who, 'war_produce', caps[c], pick(kinds));
  }
  async function actBuild(c) {
    const R = roles[c];
    const who = R.engineer || R.chief;   // 4명 모둠은 의장이 공병 일 (act_start가 허용)
    const r = await call(who, 'war_city_build', caps[c], pick(['barracks', 'harbor']));
    if (!R.engineer && !err(r)) summary.engBuild4[c] = (summary.engBuild4[c] || 0) + 1;
  }
  async function actMove(c, isEngineerAsChief = false) {
    const R = roles[c];
    const who = isEngineerAsChief ? R.chief : pick([R.army, R.navy, R.air, R.engineer, R.chief].filter(Boolean));
    const rows = await qs(`select id, tile_id, kind from war.units where country = $1 and tile_id is not null order by random() limit 1`, c);
    if (!rows.length) return;
    const u = rows[0];
    if (isEngineerAsChief && u.kind !== 'worker') return;
    const nbs = (await q1(`select war.neighbors((select c from war.tiles where id = $1), (select r from war.tiles where id = $1), $2) n`, u.tile_id, WIDTH)).n || [];
    const goal = pick(nbs);
    if (goal == null) return;
    const r = await call(who, 'war_move', u.id, [goal]);
    if (isEngineerAsChief && !err(r)) summary.workerMove4[c] = (summary.workerMove4[c] || 0) + 1;
  }
  async function actAttack(c, locked) {
    const R = roles[c];
    const who = pick([R.army, R.navy, R.air].filter(Boolean));
    const rows = await qs(`select id, tile_id, kind from war.units where country = $1 and kind not in ('worker','scout') and tile_id is not null order by random() limit 1`, c);
    if (!rows.length) return;
    const u = rows[0];
    const range = Math.max(1, (UNITS[u.kind] && UNITS[u.kind].range) || 1);
    const t = (await q1(`select t.id from war.tiles t
      where priv.tdist(t.id, $1) <= $2
        and (exists (select 1 from war.units v where v.tile_id = t.id and v.country <> $3 and v.kind not in ('worker','scout'))
          or exists (select 1 from war.cities cc where cc.tile_id = t.id and cc.country is not null and cc.country <> $3))
      order by random() limit 1`, u.tile_id, range, c));
    if (!t) return;
    const r = await call(who, 'war_attack', u.id, t.id);
    if (!err(r) && locked) summary.lockAttackSuccess++;
  }
  async function actDiplo(c) {
    const R = roles[c];
    const other = 1 + Math.floor(rnd() * 6);
    if (other === c) return;
    if (chance(0.3)) await call(R.chief, 'war_declare', other);
    else if (chance(0.5)) await call(R.chief, 'war_propose', other, pick(['peace', 'ally']));
    else {
      const off = (await qs(`select id from war.offers where to_c = $1 and status = 'pending' order by id limit 1`, c))[0];
      if (off) await call(R.chief, 'war_accept_offer', off.id);
    }
  }
  async function actMarket(c) {
    const stock = (await qs(`select market, item from war.market_stock where qty > 0 order by random() limit 1`))[0];
    if (stock) await call(roles[c].chief, 'war_market_buy', stock.market, stock.item);
  }
  async function actTrade(c) {
    const R = roles[c];
    const other = 1 + Math.floor(rnd() * 6);
    if (other === c) return;
    if (chance(0.6)) await call(R.chief, 'war_trade_propose', other, { coin: 1 }, { wood: 1 });
    else {
      const off = (await qs(`select id from war.offers where kind = 'trade' and to_c = $1 and status = 'pending' order by id limit 1`, c))[0];
      if (off) await call(R.chief, 'war_trade_accept', off.id);
    }
  }

  // --- 한 턴 실행 ---
  async function playTurn(turnNo, locked) {
    const safe = async (name, fn) => {
      try { await fn(); }
      catch (e) { summary.unexpectedErrors.push(`턴 ${turnNo} ${name}: ${String(e.message || e).split('\n')[0]}`); }
    };
    for (let c = 1; c <= 6; c++) {
      const R = roles[c];
      if (!R) { summary.unexpectedErrors.push(`턴 ${turnNo}: ${c}번 나라 역할 없음`); continue; }
      const n = 1 + Math.floor(rnd() * 3);   // 나라당 턴에 1~3개 행동
      for (let k = 0; k < n; k++) {
        const menu = ['budget', 'produce', 'build', 'move', 'market', 'trade', 'diplo'];
        if (!locked) menu.splice(2, 0, 'attack');   // 본 게임(전투 켜짐)에만 공격
        const act = pick(menu);
        if (act === 'budget') await safe('budget', () => actBudget(c));
        else if (act === 'produce') await safe('produce', () => actProduce(c));
        else if (act === 'build') await safe('build', () => actBuild(c));
        else if (act === 'move') await safe('move', () => actMove(c));
        else if (act === 'attack') await safe('attack', () => actAttack(c, locked));
        else if (act === 'market') await safe('market', () => actMarket(c));
        else if (act === 'trade') await safe('trade', () => actTrade(c));
        else if (act === 'diplo') await safe('diplo', () => actDiplo(c));
      }
      // 지휘권 넘기기 (가끔)
      if (chance(0.1)) await safe('transfer', async () => {
        const rows = await qs(`select id, kind from war.units where country = $1 and kind not in ('worker','scout') order by random() limit 1`, c);
        if (rows.length) await call(R[pick(['army', 'navy', 'air'])], 'war_transfer', rows[0].id, pick(['army', 'navy', 'air']));
      });
      // 4명 모둠 의장의 공병 일: 노동자 이동 시도
      if (c >= 2 && chance(0.6)) await safe('chief-worker-move', () => actMove(c, true));
    }
    // 턴 넘김: 관제실 자동 넘김이 하는 것과 같은 호출(지금 턴 번호로). 두 번 부르면 서버가 두 번 처리하지 않아야 해요
    await safe('next-turn', async () => {
      const cur = (await q1(`select turn from war.game where id = 1`)).turn;
      const r1 = await rpc(seed.ADMIN, 'war_next_turn', cur);
      if (!r1 || r1.ok === false) summary.unexpectedErrors.push(`턴 ${turnNo}: 다음 턴 실패(${((r1 && r1.reason) || '').slice(0, 40)})`);
      const r2 = await rpc(seed.ADMIN, 'war_next_turn', cur);
      line('모의', r2 && r2.ok === false, `턴 ${cur}: 같은 턴 두 번 넘기면 두 번 처리 안 됨`);
      const g = await q1(`select turn from war.game where id = 1`);
      line('모의', g.turn === cur + 1, `턴 ${cur} → ${cur + 1} (정확히 한 번)`);
      // 자원 음수 검사
      const neg = await qs(`select 'wallet' k, country, role, item, qty from war.wallets where qty < 0
        union all select 'inventory', country, '', item, qty from war.inventory where qty < 0
        union all select 'coin', id, '', '', coin from war.countries where coin < 0`);
      if (neg.length) summary.negatives.push(`턴 ${turnNo}: ` + neg.map(r => `${r.k}/${r.country}/${r.item}:${r.qty}`).join(', '));
    });
  }

  // --- 연습 3턴 (전투 잠금, 공격 시도도 넣어 확인) ---
  for (let t = 1; t <= 3; t++) {
    for (let c = 1; c <= 6; c++) { await actMove(c); if (chance(0.8)) await actAttack(c, true); }
    await playTurn(t, true);
  }
  // 본 게임: 3분 턴 + 전투 켜짐
  await db.exec(`update war.game set turn_seconds = 180, combat_on = true where id = 1`);
  for (let t = 4; t <= 53; t++) await playTurn(t, false);
  // 성찰 열기 + 제출 몇 건
  const rs = await rpc(seed.ADMIN, 'war_admin_reflect_set', true);
  summary.reflect.open = rs && rs.open === true;
  const submitters = [roles[1].engineer, roles[2].army, roles[3].navy, roles[4].air, roles[5].chief];
  let submitted = 0;
  for (const s of submitters) {
    const r = await call(s, 'war_reflect_submit', 1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 4), '리허설 성찰 글이에요.');
    if (!err(r)) submitted++;
  }
  summary.reflect.submitted = submitted;

  // --- 수도 주변 정체 확인 (생산이 계속 NO_SPACE인 나라 기록) ---
  const stuck = [];
  for (let c = 1; c <= 6; c++) {
    const ct = capTile[c];
    const row = await q1(`select
      (select count(*) from unnest(war.neighbors((select c from war.tiles where id = $1), (select r from war.tiles where id = $1), $2)) nid
        join war.tiles t on t.id = nid
        where t.terrain not in ('ocean','coast') and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind not in ('worker','scout'))
          and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind in ('worker','scout'))
          and not exists (select 1 from war.markets m where m.tile_id = t.id)) free`, ct, WIDTH);
    if (row.free === 0) stuck.push(c);
  }
  summary.stuck = stuck;

  line('모의', summary.unexpectedErrors.length === 0, `예상 못한 오류 0건 (총행동 오류 분류: ${Object.values(summary.codeTally).reduce((a, b) => a + b, 0)}건은 규칙상 정상 거절)`,
    summary.unexpectedErrors.slice(0, 5).join(' | ') || '');
  line('모의', summary.negatives.length === 0, '자원이 음수가 된 적 없음', summary.negatives.slice(0, 3).join(' | '));
  line('모의', summary.lockAttackSuccess === 0, '전투 잠금(연습 3턴) 중 성공한 공격 0건', summary.lockAttackSuccess + '건');
  line('모의', Object.keys(summary.noSpace).length === 0, '생산 자리 없음(NO_SPACE) 기록', Object.keys(summary.noSpace).length ? '나라별: ' + JSON.stringify(summary.noSpace) : '0건');
  line('모의', stuck.length === 0, '수도 주변이 꽉 차 생산이 막힌 나라 없음', stuck.length ? stuck.join('번, ') + '번' : '');
  const fourOk = Object.keys(summary.workerMove4).length + Object.keys(summary.engBuild4).length;
  line('모의', fourOk > 0, '4명 모둠 의장이 공병 일(노동자 이동·건설) 성공', `노동자 이동 ${JSON.stringify(summary.workerMove4)} · 건설 ${JSON.stringify(summary.engBuild4)}`);
  line('모의', summary.reflect.open && summary.reflect.submitted === 5, '성찰 열기 + 제출', `열림 ${summary.reflect.open} · 제출 ${summary.reflect.submitted}/5`);
  const codes = Object.entries(summary.codeTally).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' ' + v).join(', ');
  console.log('  (참고) 규칙상 정상 거절 상위: ' + codes);
}

// ---------- 5. docs/class 자료와 앱 글자 대조 ----------
function checkDocs() {
  console.log('— 5. docs/class 자료 버튼 이름 대조');
  const NAV = ['지도', '미션', '예산', '요청함', '외교', '무역', '시장', '건설', '수리', '요청', '생산', '부대'];
  const ADMIN = ['다음 턴', '일시정지', '다시시작', '자동 넘김: 켜짐', '자동 넘김: 꺼짐', '전투 잠금', '전투 풀기',
    '무역 게임에서 가져오기', '성찰 열기', '성찰 닫기', '성찰 모아 보기', 'AI에게 넘기기'];
  const read = f => { try { return readFileSync(p('docs/class', f), 'utf8'); } catch { return ''; } };
  const roleCard = read('role-cards.html'), poster = read('rules-poster.html'), run = read('run-sheet.html'), join = read('join-card.html'), check = read('whalebook-check.html');
  for (const label of NAV) line('자료', roleCard.includes(label), `역할 카드 메뉴 글자 「${label}」 = 앱 nav 버튼`);
  for (const label of ['물어보기', '돌아보기']) line('자료', roleCard.includes(label) || poster.includes(label), `자료의 「${label}」 글자가 앱에도 있어요`);
  for (const label of ADMIN) {
    const where = run.includes(label) || check.includes(label);
    line('자료', where, `진행표·점검표의 관제실 버튼 「${label}」 = 앱 관제실 글자`);
  }
  line('자료', join.includes('https://ys970425.github.io/earth-war/'), '접속 카드 주소 정확');
  // 「물어보기」 버튼은 화면에 ❓ 물어보기로 있어요
  line('자료', readFileSync(p('app/war/js/war-qna.js'), 'utf8').includes("textContent = '❓ 물어보기'"), '앱에 「물어보기」 버튼 실제로 있음');
}

// ---------- 실행 ----------
try {
  await checkDeployment();
  checkSync();
  checkDocs();
  await rehearsal();
} catch (e) {
  fails++;
  console.log('  ✘ 예외: ' + (e.stack || e.message).split('\n')[0]);
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
