// earth-war(과제 사이트) 동기화: app/war 전체 + 화면이 쓰는 무역 앱 파일(css·글꼴·그림 사본)을 통째로 다시 복사해요.
// 사용: npm run war:sync  (기본 대상 C:\projects\earth-war, 다른 곳은 인자로)
// 실제 학생 데이터(*-real*), private, .env, node_modules, 쓰지 않는 원본 큰 그림(app/war/img, 30MB)은 복사하지 않아요.
import { cpSync, rmSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const dest = resolve(process.argv[2] || 'C:/projects/earth-war');
if (!existsSync(join(dest, '.git'))) { console.error('대상 폴더가 git 저장소가 아니에요:', dest); process.exit(1); }

// 통째로 바꿀 폴더 (대상의 옛 파일은 지우고 새로 복사)
const DIRS = ['app/war', 'app/trade/css', 'app/trade/fonts', 'app/trade/img/terrain', 'app/trade/assets/small', 'app/trade/assets/units'];
// 한두 파일만 가져올 것
const FILES = ['app/trade/js/config.js', 'app/trade/js/rules.js'];

const BLOCK = [/-real/i, /(^|[\\/])private([\\/]|$)/, /(^|[\\/])\.env/, /node_modules/, /^app\/war\/img(\/|$)/, /(^|[\\/])qna[\\/]package\.json$/];
const blocked = p => BLOCK.some(r => r.test(relative(root, p).split(sep).join('/')) || r.test(p));

for (const d of DIRS) {
  rmSync(join(dest, d), { recursive: true, force: true });
  cpSync(join(root, d), join(dest, d), { recursive: true, filter: s => !blocked(s) });
}
for (const f of FILES) {
  mkdirSync(join(dest, f, '..'), { recursive: true });
  cpSync(join(root, f), join(dest, f));
}

// 검사: 대상 폴더에 실제 데이터가 하나라도 있으면 실패
const bad = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n === '.git') continue;
    const p = join(dir, n);
    if (/-real|^private$|^\.env/i.test(n)) bad.push(p);
    if (statSync(p).isDirectory()) walk(p);
  }
})(dest);
if (bad.length) { console.error('실제 데이터 파일이 들어 있어요:\n' + bad.join('\n')); process.exit(1); }
console.log('동기화 완료 →', dest);
