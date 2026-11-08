// 전쟁의 시간 규칙 파일 시험 (E0): app/war/js/war-rules.js가 무역 앱 규칙을 빠뜨리지 않았는지 확인
// 실행: node tests/war/rules.test.mjs  (또는 npm run test:war:rules)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../app/trade/js/rules.js');
const W = require('../../app/war/js/war-rules.js');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };

try {
  // 병과 분류: 무역 앱 UNITS 전부 + 구축함·전투기. 상륙 기갑부대는 육군
  const kinds = [...Object.keys(R.UNITS), 'destroyer', 'fighter'];
  ok(kinds.every(k => W.BRANCH[k]), '모든 병력 종류(' + kinds.length + '개)가 병과 분류에 있음');
  ok(W.BRANCH.t_marine === 'army', '상륙 기갑부대(t_marine)는 육군');
  ok(W.BRANCH.destroyer === 'navy' && W.BRANCH.fighter === 'air', '구축함은 해군, 전투기는 공군');
  ok(W.BRANCH.worker === 'civil' && W.BRANCH.scout === 'civil', '노동자·정찰병은 민간');
  ok(['spear', 'tank', 'trireme', 'battleship', 'k_missile', 'n_hyper'].every(k => W.BRANCH[k] === (['trireme', 'battleship'].includes(k) ? 'navy' : ['k_missile', 'n_hyper'].includes(k) ? 'air' : 'army')),
    '일반 병력·특수 부대 분류 예시가 설계 4-1과 같음');

  // 건물 분류: 무역 앱의 모든 건물이 꼭 한 번 들어 있음
  const buildings = [...Object.keys(R.BUILDINGS), ...Object.keys(R.FACTORIES), ...Object.keys(R.ADVANCED)];
  const classified = [...W.BUILDING_CLASS.basic, ...W.BUILDING_CLASS.factory, ...W.BUILDING_CLASS.advanced];
  ok(buildings.every(k => classified.includes(k)) && buildings.length === classified.length && new Set(classified).size === classified.length,
    '무역 앱 건물 ' + buildings.length + '개가 기본/공장/고등에 꼭 한 번씩 들어 있음');

  // 타일 시설: 무역 앱 IMPROVE 전부가 파괴/그대로 중 하나에 꼭 한 번
  const imps = Object.keys(R.IMPROVE);
  const tileImps = [...W.TILE_IMP.destroy, ...W.TILE_IMP.keep];
  ok(imps.every(k => tileImps.includes(k)) && imps.length === tileImps.length && new Set(tileImps).size === tileImps.length,
    '타일 시설 ' + imps.length + '개가 파괴/그대로 중 꼭 한 번씩 들어 있음');
  ok(W.TILE_IMP.destroy.join() === 'mine,oilwell,plantation' && W.TILE_IMP.keep.join() === 'farm,lumber,quarry',
    '파괴(광산·유정·농원)/그대로(농장·벌목장·채석장)가 설계 5-2와 같음');

  // 특수 부대 힘 95 (미사일 순양함 90 + 5), 역할 5개
  ok(W.BOSS.str() === 95, '특수 부대 힘 = ' + W.BOSS.str() + ' (일반 병력 최대 힘 90 + 5)');
  ok(W.BOSS.damageMax === 60, '특수 부대 피해 상한 60');
  ok(W.ROLES.length === 5 && ['chief', 'engineer', 'army', 'navy', 'air'].every(k => W.ROLES.some(r => r.key === k)),
    '역할 5개 (합동참모의장·공병사령관·육해공 참모총장)');
  ok(W.ROLES.find(r => r.key === 'chief').menus4.length === 12, '4명 모둠 표시: 합동참모의장 메뉴에 공병 메뉴 6개가 더해짐');

  // 새 병력 수치 (설계 4-1)
  ok(W.EXTRA_UNITS.destroyer.str === 60 && W.EXTRA_UNITS.destroyer.move === 6 && W.EXTRA_UNITS.destroyer.sea,
    '구축함: 힘 60·이동 6·바다');
  ok(W.EXTRA_UNITS.fighter.str === 40 && W.EXTRA_UNITS.fighter.move === 6 && W.EXTRA_UNITS.fighter.range === 2,
    '전투기: 힘 40·이동 6·사거리 2');

  // 기본 숫자 (설계 11장)
  ok(W.MOVES.worker === 2 && W.MOVES.scout === 5, '노동자 이동력 2 (무역 앱은 0), 정찰병 이동력 5');
  ok(Array.isArray(W.MISSIONS) && W.MISSIONS.length === 20 && W.OPEN_STAGES.join() === 'now' &&
    W.MISSIONS.every(m => m.key && m.role && m.order && m.text && m.opens),
    '미션 목록 20개, 열리는 단계는 지금(now)만');
  ok(W.canPass('spear', { terrain: 'mountain' }, {}) === false && W.canPass('spear', { terrain: 'plains' }, {}) === true,
    'canPass: 땅 유닛은 산을 못 지나가고 평원은 지나감');
  ok(W.canPass('fighter', { terrain: 'mountain' }, { enemyUnit: true }) === true &&
    W.canStop('fighter', { terrain: 'ocean' }, {}) === false,
    'canPass/canStop: 공군은 병력 위를 지나가지만 바다 위에 못 멈춤');
  ok(W.TURN.seconds === 180 && W.TURN.min === 60 && W.TURN.max === 600 && W.POLL_MS === 4000,
    '턴 180초(1~10분 조절)·확인 주기 4초');
  ok(W.CAPITAL.def === 20 && W.CAPITAL.hp === 200 && W.SHIELD_TURNS === 3 && W.MAX_CITY_LOSS === 2 && W.PEACE_TURNS === 3,
    '수도 방어 20·체력 200, 보호막 3턴, 도시 상실 2곳, 평화 뒤 3턴');
  ok(W.MARKET.stock === 4 && W.MARKET.tariff(15) === 7 && W.MARKET.tariffNoSpecialtyMult === 2,
    '시장: 시작 재고 4개, 관세 = 기준가 절반 버림 (우라늄 15 → 7), 특산 없으면 2배');
} catch (e) { ok(false, '예외: ' + e.message); }

console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
