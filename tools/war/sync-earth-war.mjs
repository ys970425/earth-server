// earth-war(과제 사이트) 동기화: app/war 전체 + 화면이 쓰는 무역 앱 파일(css·글꼴·그림 사본)을 통째로 다시 복사해요.
// 사용: node tools/war/sync-earth-war.mjs [대상폴더] [--only-index] [--keep-ai]   (npm run war:sync 도 같아요)
//   기본 대상 C:\projects\earth-war. --only-index 는 첫 화면(index.html)과 안전 검사만 해요.
// 실제 학생 데이터(*-real*), private, .env, node_modules, 쓰지 않는 원본 큰 그림(app/war/img, 30MB)은 복사하지 않아요.
//
// 실제 모드(Supabase)로 열리는 배포본을 만들어요:
//  · 첫 화면 index.html: 주소 그대로 app/war/index.html 로 넘겨요. 기본 = 실제 모드, 주소 끝에 ?preview=1 = 가짜 체험판.
//  · 키 검사: Supabase 주소와 공개 키(anon/publishable)만 허용. 서비스 키(service_role·sb_secret_)가 하나라도 있으면 멈춰요.
//  · 질문봇: 학생 기기에서는 교사 PC의 localhost 프록시에 닿지 않으므로, 배포본의 AI 호출을 꺼요 (FAQ 키워드 답만).
//    (원본 app/war는 그대로 두고, 복사본만 바꿔요. --keep-ai 를 주면 바꾸지 않아요.)
import { cpSync, rmSync, existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--') && !a.startsWith('--config=')));
const dest = resolve(args.find(a => !a.startsWith('--')) || 'C:/projects/earth-war');   // 인자가 없으면 기본 위치
if (!existsSync(join(dest, '.git'))) { console.error('대상 폴더가 git 저장소가 아니에요:', dest); process.exit(1); }
const fail = msg => { console.error('❌ ' + msg); process.exit(1); };

// ---------- 1. 키 검사 (복사 전, 원본 설정) ----------
function jwtRole(tok) {
  try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8')).role || null; } catch { return null; }
}
// --config=경로: 검사만 다른 설정 파일로 해 볼 때 (시험용). 복사되는 것은 언제나 app/trade/js/config.js 예요.
const cfgArg = args.find(a => a.startsWith('--config='));
const cfgText = readFileSync(cfgArg ? resolve(cfgArg.slice(9)) : join(root, 'app/trade/js/config.js'), 'utf8');
const url = (cfgText.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/) || [])[1];
const key = (cfgText.match(/SUPABASE_KEY\s*:\s*['"]([^'"]+)['"]/) || [])[1];
if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) fail('app/trade/js/config.js 의 SUPABASE_URL 이 https://〈프로젝트〉.supabase.co 모양이 아니에요: ' + url);
if (!key) fail('app/trade/js/config.js 에 SUPABASE_KEY 가 없어요');
const keyKind = key.startsWith('sb_publishable_') ? 'publishable' : key.startsWith('sb_secret_') ? 'SECRET' : key.startsWith('eyJ') ? 'jwt:' + jwtRole(key) : 'unknown';
if (!(keyKind === 'publishable' || keyKind === 'jwt:anon')) fail(`SUPABASE_KEY 가 공개 키가 아니에요 (${keyKind}). 서비스 키·비밀 키는 절대 올리면 안 돼요. Project Settings > API 의 anon(또는 publishable) 키를 쓰세요.`);

// ---------- 2. 복사 ----------
const DIRS = ['app/war', 'app/trade/css', 'app/trade/fonts', 'app/trade/img/terrain', 'app/trade/assets/small', 'app/trade/assets/units'];
const FILES = ['app/trade/js/config.js', 'app/trade/js/rules.js'];
const BLOCK = [/-real/i, /(^|[\\/])private([\\/]|$)/, /(^|[\\/])\.env/, /node_modules/, /^app\/war\/img(\/|$)/, /(^|[\\/])qna[\\/]package\.json$/];
const blocked = p => BLOCK.some(r => r.test(relative(root, p).split(sep).join('/')) || r.test(p));

if (!flags.has('--only-index')) {
  for (const d of DIRS) {
    rmSync(join(dest, d), { recursive: true, force: true });
    cpSync(join(root, d), join(dest, d), { recursive: true, filter: s => !blocked(s) });
  }
  for (const f of FILES) {
    mkdirSync(join(dest, f, '..'), { recursive: true });
    cpSync(join(root, f), join(dest, f));
  }
}

// ---------- 3. 첫 화면 (실제 모드 기본, ?preview=1 은 가짜 체험판) ----------
writeFileSync(join(dest, 'index.html'), `<!doctype html>
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
`);

// ---------- 4. 질문봇 AI 끄기 (복사본만) ----------
const qnaPath = join(dest, 'app/war/js/war-qna.js');
let qnaNote = '변경 없음 (--only-index)';
if (!flags.has('--only-index')) {
  if (flags.has('--keep-ai')) qnaNote = 'AI 호출 그대로 (--keep-ai)';
  else {
    let s = readFileSync(qnaPath, 'utf8');
    const proxyRe = /const PROXY_URL\s*=\s*['"]http:\/\/localhost:\d+[^'"]*['"];?/;
    const fnRe = /async function askAI\(query\)\s*\{/;
    if (!proxyRe.test(s) || !fnRe.test(s)) fail('war-qna.js 모양이 바뀌어서 AI 끄기를 적용하지 못했어요 (PROXY_URL / askAI). 이 도구를 먼저 고쳐 주세요.');
    s = s.replace(proxyRe, "const PROXY_URL = null;   // 배포본: 학생 기기에서는 교사 PC의 로컬 프록시에 닿지 않아서 AI 호출을 껐어요 (sync-earth-war.mjs)")
      .replace(fnRe, m => m + "\n  if (!PROXY_URL) return { ok: false, error: 'NETWORK' };   // 배포본: FAQ 키워드 답만 써요");
    writeFileSync(qnaPath, s);
    qnaNote = 'AI 호출 끔 (FAQ 키워드 답만)';
  }
}

// ---------- 5. 검사: 실제 데이터·비밀 키·localhost ----------
const bad = [], secrets = [], locals = [];
const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.svg']);
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n === '.git') continue;
    const p = join(dir, n), rel = relative(dest, p).split(sep).join('/');
    if (/-real|^private$|^\.env/i.test(n)) bad.push(rel);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!TEXT.has(extname(n).toLowerCase())) continue;
    const t = readFileSync(p, 'utf8');
    if (/service_role|sb_secret_/.test(t)) secrets.push(rel);
    for (const m of t.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) if (jwtRole(m[0]) !== 'anon') secrets.push(rel + ' (JWT role=' + jwtRole(m[0]) + ')');
    if (!flags.has('--keep-ai') && /^app\/war\/.*\.(js|html)$/.test(rel) && /localhost:\d+/.test(t)) locals.push(rel);
  }
})(dest);
if (bad.length) fail('실제 데이터 파일이 들어 있어요:\n' + bad.join('\n'));
if (secrets.length) fail('서비스 키/비밀 키 흔적이 있어요:\n' + secrets.join('\n'));
if (locals.length) fail('배포본에 localhost 주소가 남아 있어요 (학생 기기에서 안 닿아요):\n' + locals.join('\n'));

console.log(`동기화 완료 → ${dest}`);
console.log(`  Supabase: ${url} · 키 종류 ${keyKind} (공개 키만 사용)`);
console.log(`  첫 화면: 기본 실제 모드 / ?preview=1 가짜 체험판 · 질문봇: ${qnaNote}`);
