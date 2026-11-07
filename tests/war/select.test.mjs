// 「내 병력」 선택 규칙 시험 (2026-11-08 미리보기에서 남의 나라·다른 참모총장 병력이 선택·이동되던 버그)
// 1) 내 병력 목록 = 우리 나라 + 내 조종 역할 병력만  2) 다른 나라 병력은 못 고름  3) 우리 해군은 육군 참모총장이 못 고름
// 화면(war-app.js)과 같은 함수 WAR_RULES.isMyUnit을 시험하고, 미리보기 가짜 서버(war-api.js)의 war_move 거절도 확인한다.
// 실행: node tests/war/select.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };

// 브라우저 흉내 (war-api.js는 브라우저용 IIFE)
globalThis.window = globalThis;
globalThis.RULES = require('../../app/trade/js/rules.js');
const W = require('../../app/war/js/war-rules.js');
globalThis.WAR_RULES = W;
globalThis.location = { search: '?preview=1&as=1:army' };
globalThis.document = { hidden: false, addEventListener() {} };
const state = JSON.parse(readFileSync(new URL('../../app/war/preview/state.json', import.meta.url), 'utf8'));
globalThis.WarData = { load: async () => structuredClone(state), mode: () => 'fake' };
(0, eval)(readFileSync(new URL('../../app/war/js/war-api.js', import.meta.url), 'utf8'));
const API = globalThis.WarAPI;

try {
  const units = state.units;
  const myArmy = units.filter(u => u.country === 1 && u.commander === 'army' && u.tile != null);
  const list = units.filter(u => W.isMyUnit(u, 1, 'army'));
  ok(list.length === myArmy.length && list.length > 0, `1) 육군 참모총장 내 병력 목록 = 1번 나라 육군 수 (${list.length} = ${myArmy.length})`);
  ok(list.every(u => u.country === 1 && u.commander === 'army'), '1) 목록에 다른 나라·다른 병과 병력이 없음');

  const enemy = units.find(u => u.country !== 1 && u.commander === 'army');
  ok(enemy && !W.isMyUnit(enemy, 1, 'army'), '2) 다른 나라 육군은 고를 수 없음');
  const navy = units.find(u => u.country === 1 && u.commander === 'navy');
  ok(navy && !W.isMyUnit(navy, 1, 'army'), '3) 우리 해군은 육군 참모총장이 고를 수 없음');
  ok(navy && W.isMyUnit(navy, 1, 'navy'), '3) 우리 해군은 해군 참모총장은 고를 수 있음');

  // 가짜 서버도 진짜 서버처럼 거절
  const code = async (args) => { try { await API.rpc('war_move', args); return 'OK'; } catch (e) { return e.code; } };
  ok(await code({ p_unit: enemy.id, p_path: [enemy.tile] }) === 'NOT_MINE', '2) 가짜 서버 war_move: 다른 나라 병력 → NOT_MINE');
  ok(await code({ p_unit: navy.id, p_path: [navy.tile] }) === 'ROLE_ONLY', '3) 가짜 서버 war_move: 우리 해군을 육군 참모총장이 → ROLE_ONLY');

  // 화면 코드가 목록·지도 선택에서 isMyUnit을 쓰는지 (조종 역할만 보던 예전 코드가 돌아오지 않게)
  const app = readFileSync(new URL('../../app/war/js/war-app.js', import.meta.url), 'utf8');
  ok((app.match(/W\.isMyUnit\(/g) || []).length >= 4, '화면: 내 병력 목록·지휘권 목록·지도 선택·selectUnit 모두 isMyUnit 사용');
  ok(!/u\.commander === role && u\.tile != null/.test(app) && !/u\.commander === S\.me\.role && !isCivil/.test(app), '화면: 나라를 확인하지 않던 예전 목록 코드가 없음');
} catch (e) {
  ok(false, '예외: ' + e.message);
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
