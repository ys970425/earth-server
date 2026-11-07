// 전쟁의 시간 규칙 (설계 docs/war-design.md 2~7장, 11장 기준)
// 무역 앱 rules.js(window.RULES)는 고치지 않고, 필요한 값은 그 파일에서 읽어 계산해요.
// 브라우저에서는 window.WAR_RULES, Node에서는 module.exports로 씁니다.
(function (root) {
  let R = root.RULES;
  if (typeof R === 'undefined' && typeof require === 'function') R = require('../../trade/js/rules.js');

  const W = {};

  // ---------- 역할 (설계 2장) ----------
  // 이름, 할 수 있는 일, 화면 메뉴. 한 역할은 한 명만. 4명 모둠은 chief가 engineer 메뉴를 함께 봐요
  W.ROLES = [
    { key: 'chief', name: '합동참모의장',
      can: ['동맹·선전포고·평화 조약', '나라 간 무역', '도시국가 물물교환', '예산 나눠 주기·회수', '비어 있는 역할의 일 대신하기'],
      menus: ['우리 나라', '예산', '외교', '무역', '도시국가 시장', '첩보 정보'] },
    { key: 'engineer', name: '공병사령관',
      can: ['노동자 생산·이동', '타일 개발', '파괴된 시설 수리', '건물 짓기', '정찰병 조종'],
      menus: ['노동자', '개발·수리', '건물', '정찰병', '내 예산', '첩보 정보'] },
    { key: 'army', name: '육군 참모총장',
      can: ['육군 생산·조종', '지휘권 넘기기'],
      menus: ['내 병력', '생산', '지휘권 넘기기', '내 예산', '첩보 정보'] },
    { key: 'navy', name: '해군 참모총장',
      can: ['해군 생산·조종', '지휘권 넘기기'],
      menus: ['내 병력', '생산', '지휘권 넘기기', '내 예산', '첩보 정보'] },
    { key: 'air', name: '공군 참모총장',
      can: ['공군 생산·조종', '지휘권 넘기기'],
      menus: ['내 병력', '생산', '지휘권 넘기기', '내 예산', '첩보 정보'] }
  ];
  // 4명 모둠: 공병사령관이 없어서 합동참모의장 화면에 공병 메뉴가 더해져요
  const chief = W.ROLES.find(r => r.key === 'chief'), engineer = W.ROLES.find(r => r.key === 'engineer');
  chief.menus4 = chief.menus.concat(engineer.menus);

  // ---------- 병과 분류 (설계 4-1) ----------
  // 무역 앱 UNITS 전부 + 구축함·전투기. worker·scout는 민간(civil)
  // 특수 부대는 상륙 기갑부대(t_marine)만 육군, 나머지는 공군 (설계 3-4, Q6)
  W.BRANCH = {};
  for (const [k, u] of Object.entries(R.UNITS)) {
    W.BRANCH[k] = k === 'worker' || k === 'scout' ? 'civil'
      : k === 't_marine' ? 'army'
      : u.boss ? 'air'
      : u.sea ? 'navy' : 'army';
  }
  W.BRANCH.worker = 'civil'; W.BRANCH.scout = 'civil';
  W.BRANCH.destroyer = 'navy'; W.BRANCH.fighter = 'air';

  // ---------- 새 병력 (설계 4-1) ----------
  // 무역 앱에 없는 병력. 힘(str)·이동(move)·사거리(range)는 전쟁의 시간 규칙 숫자
  W.EXTRA_UNITS = {
    destroyer: { name: '구축함', str: 60, move: 6, sea: true, cost: { coin: 100, steel: 2, fuel: 1, food: 2 }, img: 'destroyer' },
    fighter: { name: '전투기', str: 40, move: 6, range: 2, fly: true, cost: { coin: 70, aluminum: 1, fuel: 1 }, img: 'fighter' }
  };

  // ---------- 특수 부대 (설계 3-4) ----------
  // 힘 = 특수 부대가 아닌 병력 힘 최댓값 + 5 (지금 규칙으로 95: 미사일 순양함 90). 피해 상한 60
  W.BOSS = {
    str() {
      const all = [...Object.values(R.UNITS), ...Object.values(W.EXTRA_UNITS)].filter(u => !u.boss);
      return Math.max(...all.map(u => u.str)) + 5;
    },
    damageMax: 60
  };

  // ---------- 건물 분류 (설계 5-2) ----------
  // 기본 건물은 점령되어도 남고, 공장·고등 건물은 파괴돼요. 특산 공장은 나라별로 (SPECIALTY에서 읽기)
  W.BUILDING_CLASS = {
    basic: Object.keys(R.BUILDINGS),
    factory: Object.keys(R.FACTORIES),
    advanced: Object.keys(R.ADVANCED)
  };
  W.SPECIALTY = Object.fromEntries(Object.entries(R.SPECIALTY).map(([t, s]) => [t, s.factory || null]));

  // ---------- 타일 시설 분류 (설계 5-2, Q9) ----------
  // 점령되면 파괴 = 사치·전략 자원을 만드는 시설 / 그대로 = 기본 시설
  W.TILE_IMP = {
    destroy: ['mine', 'oilwell', 'plantation'],
    keep: ['farm', 'lumber', 'quarry']
  };

  // ---------- 도시국가 물물교환 시장 (설계 7장) ----------
  // 특산 = 무역 앱 STRAT_OF. 관세 = 기준가의 0.5배(버림), 특산이 없으면 2배. 시작 재고 4개씩
  W.MARKET = {
    cities: [
      { name: '북서 마을', c: 15, r: 9, art: 'village' },     // 위치 후보 (col,row) — 지도에 찍어 보고 확정
      { name: '남쪽 항구', c: 17, r: 16, art: 'harbor' },
      { name: '동쪽 성곽', c: 26, r: 6, art: 'fortress' }
    ],
    stock: 4,
    tariff: ref => Math.floor(ref * 0.5),
    tariffNoSpecialtyMult: 2
  };
  W.SPECIALTY_ITEM = { ...R.STRAT_OF };

  // ---------- 턴·기본 숫자 (설계 1-2, 5-1, 5-3, 5-4, 6장, 11장) ----------
  W.TURN = { seconds: 180, min: 60, max: 600 };   // 기본 3분, 교사 조절 1~10분
  W.POLL_MS = 4000;                               // 화면 확인 주기 (3~5초)
  W.CAPITAL = { def: 20, hp: 200 };               // 수도 방어·체력
  W.REPAIR = { costMult: 0.5, specialtyExtra: 1 };// 수리 비용 = 처음 짓는 비용의 절반, 특산 공장은 특산 1개 더
  W.SHIELD_TURNS = 3;                             // 도시를 잃으면 3턴 보호막
  W.MAX_CITY_LOSS = 2;                            // 한 나라가 잃을 수 있는 도시 최대 2곳
  W.PEACE_TURNS = 3;                              // 평화 뒤 3턴 동안 재선포 금지

  // ---------- 이동 (설계 4-4, E3) ----------
  // 노동자 이동력 2 (무역 앱은 0), 정찰병은 SCOUT_MOVE(5). 나머지는 무역 규칙·구축함·전투기 순서로
  W.MOVES = { worker: 2, scout: R.SCOUT_MOVE };
  W.MOVES_OF = k => k === 'worker' ? W.MOVES.worker
    : k === 'scout' ? W.MOVES.scout
    : ((W.EXTRA_UNITS[k] || {}).move ?? (R.UNITS[k] || {}).move ?? 0);
  W.unitIsSea = k => !!(W.EXTRA_UNITS[k] || {}).sea || !!(R.UNITS[k] || {}).sea;
  W.unitIsAir = k => W.BRANCH[k] === 'air' || !!(W.EXTRA_UNITS[k] || {}).fly;
  // 칸을 지나갈 수 있는지. t: 칸 정보({terrain}), o: 주변 정보({market, enemyCity, enemyUnit})
  // 화면(갈 수 있는 칸 표시)과 미리보기 가짜 서버가 같은 규칙으로 쓴다
  W.canPass = (kind, t, o) => {
    if (o.market || o.enemyCity) return false;      // 시장 섬과 다른 나라 도시는 누구도 들어갈 수 없어요
    if (W.unitIsAir(kind)) return true;             // 공군: 지형과 다른 나라 병력 위를 지나가요
    if (W.unitIsSea(kind)) return t.terrain === 'ocean' || t.terrain === 'coast';
    if (['ocean', 'coast', 'mountain'].includes(t.terrain)) return false;
    return !o.enemyUnit;                            // 땅·바다 유닛: 다른 나라 병력이 있는 칸은 못 지나가요
  };
  // 그 칸에 멈출 수 있는지. o: {market, enemyCity, sameKind}
  W.canStop = (kind, t, o) => {
    if (o.market || o.enemyCity) return false;
    if (W.unitIsAir(kind) && (t.terrain === 'ocean' || t.terrain === 'coast')) return false;   // 공군은 바다 위에 못 멈춰요
    return !o.sameKind;                             // 같은 종류(군사/민간) 병력이 있으면 못 멈춰요 (최종 판정은 DB 유일 조건)
  };

  // 내가 고르고 움직일 수 있는 병력: 우리 나라 + 지금 역할(대행 포함)이 조종하는 병력만.
  // 화면의 「내 병력」 목록·지도 선택과 시험이 모두 이 함수를 쓴다 (2026-11-08 남의 병력이 선택되던 버그)
  W.isMyUnit = (u, myCountry, role) => !!u && u.tile != null && u.country === myCountry && u.commander === role;

  if (typeof module !== 'undefined' && module.exports) module.exports = W;
  root.WAR_RULES = W;
})(typeof window !== 'undefined' ? window : globalThis);
