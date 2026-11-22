// 무역 게임 백업 파일 점검 + 보관 (읽기 전용: 서버에 접속하지 않고, 무역 데이터를 바꾸지 않아요)
// 교사가 무역 관제실 > 「백업·복구」 > 「백업 파일 받기」 로 내려받은 JSON 파일을 확인해요.
// 실행: node tools/war/check-backup.mjs [파일경로] [--no-copy]
//   파일을 안 주면 다운로드 폴더·이 폴더·private 에서 가장 새 「지구서버-무역-백업-*.json」 을 찾아요.
//   확인이 끝나면 private/ 폴더에 복사해 보관해요 (private/ 는 깃허브에 올라가지 않아요). --no-copy 면 복사하지 않아요.
// 점검 내용: 필요한 항목이 다 있는지 · 25명/6나라 · 지도 버전이 이 저장소와 같은지 · 「가져오기」를 가짜 DB에서 미리 해 보고 개수가 맞는지
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from './make-real-preview.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const noCopy = args.includes('--no-copy');
let file = args.find(a => !a.startsWith('--'));
if (!file) {
  const dirs = [join(homedir(), 'Downloads'), join(homedir(), '다운로드'), ROOT, join(ROOT, 'private')].filter(existsSync);
  const found = dirs.flatMap(d => readdirSync(d).filter(n => /^지구서버-무역-백업-.*\.json$/.test(n)).map(n => ({ p: join(d, n), t: statSync(join(d, n)).mtimeMs })));
  if (!found.length) { console.error('❌ 「지구서버-무역-백업-…json」 파일을 못 찾았어요.\n   무역 관제실 > 백업·복구 > 「백업 파일 받기」 를 누른 뒤 다시 실행하세요. (파일 위치를 알면 뒤에 적어도 돼요)'); process.exit(1); }
  file = found.sort((a, b) => b.t - a.t)[0].p;
}
const text = readFileSync(file, 'utf8');
let data;
try { data = JSON.parse(text); } catch { console.error('❌ JSON 파일이 아니에요(열리지 않아요):', file); process.exit(1); }

let bad = 0, warn = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) bad++; };
const note = (c, m) => { if (!c) { console.log('  ⚠ ' + m); warn++; } };
console.log('백업 파일:', file);
console.log('  크기', (text.length / 1024).toFixed(0) + 'KB · 지문(sha256) ' + createHash('sha256').update(text).digest('hex').slice(0, 12));

// 공장·고등 건물·땅 주인은 아무도 안 지었으면 비어(null) 있을 수 있어요. 나머지는 꼭 내용이 있어야 해요.
const mustHave = ['game', 'countries', 'students', 'cities', 'units', 'inventory'];
const mayBeEmpty = ['tiles', 'factories', 'advanced'];
const missing = [...mustHave.filter(k => data[k] == null), ...mayBeEmpty.filter(k => !(k in data))];
ok(!missing.length, '필요한 항목이 모두 있음' + (missing.length ? ' — 빠진 것: ' + missing.join(', ') : ''));
for (const k of mayBeEmpty) if (data[k] == null) data[k] = [];
if (data.exported_at) {
  const age = (Date.now() - new Date(data.exported_at).getTime()) / 60000;
  note(age < 12 * 60, `백업이 ${Math.round(age / 60)}시간 전 것이에요. 수요일 저녁에 새로 받은 파일인지 확인하세요.`);
  console.log('  받은 때:', data.exported_at, '· 턴', data.game?.turn, '· 단계', data.game?.phase);
}
if (missing.length) { console.error('\n❌ 점검 실패: 무역 관제실에서 다시 받아 주세요.'); process.exit(1); }

ok(data.countries.length === 6, `나라 ${data.countries.length}개 (6개여야 해요)`);
const perCountry = {};
for (const s of data.students) perCountry[s.country_id] = (perCountry[s.country_id] || 0) + 1;
console.log('  모둠별 인원:', Object.entries(perCountry).map(([c, n]) => c + '모둠 ' + n + '명').join(' · '));
// 학생 수가 반 인원(25명)과 다른 것은 실패가 아니에요. 시험용 계정이 섞여 있을 수 있어서, 가져오기 때 뺄 학생을 고르면 돼요 (무역 데이터는 안 바뀌어요).
if (data.students.length === 25) ok(true, '학생 25명');
else note(false, `학생이 ${data.students.length}명이에요 (반은 25명). 가져오기 때 뺄 학생을 고르세요 — 전쟁 관제실 「무역 게임에서 가져오기」 위쪽 모둠별 체크 목록에서 시험용 계정 등의 체크를 풀면 그 학생은 전쟁판에 안 들어가요. 무역 데이터는 바뀌지 않아요.`);
ok(!data.students.some(s => s.uid), '백업에 로그인 정보(uid)가 없음 (내보낼 때 빠져 있어요)');
const joined = data.students.filter(s => s.nickname || s.nick).length;
note(joined >= 20, `닉네임이 있는 학생 ${joined}명 (수업 전에 다 접속해 봤다면 25명에 가까워요)`);
ok(data.cities.length > 0 && data.units.length > 0, `도시 ${data.cities.length}개 · 병력 ${data.units.length}개 · 주인 있는 땅 ${data.tiles.length}칸`);

// 가져오기 미리 해 보기: 이 파일로 war_admin_import 를 가짜 DB에서 실행해요. 지도 버전이 다르면 여기서 멈춰요.
try {
  const state = await convert(data);
  ok(state.countries.length === 6, `가져오기 시험: 나라 ${state.countries.length} · 칸 ${state.tiles.length} · 도시 ${state.cities.length} · 병력 ${state.units.length}`);
  ok(state.units.length >= data.units.length, `병력이 줄지 않음 (백업 ${data.units.length} → 가져온 뒤 ${state.units.length}, 병과 최소 지급으로 늘 수 있어요)`);
} catch (e) { ok(false, '가져오기 시험 실패: ' + e.message); }

if (bad) { console.error(`\n❌ 점검 실패 ${bad}개 — 이 파일로는 설치하지 마세요. 위 ✘ 를 Claude에게 알려 주세요.`); process.exit(1); }
if (!noCopy) {
  const dir = join(ROOT, 'private');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, basename(file));
  if (!existsSync(dest)) { copyFileSync(file, dest); console.log('  📦 private/ 에 보관했어요:', basename(file)); }
  else console.log('  📦 private/ 에 이미 있어요:', basename(file));
}
console.log(warn ? `\n✅ 쓸 수 있어요 (주의 ${warn}개 확인)` : '\n✅ 백업 파일 이상 없음');
