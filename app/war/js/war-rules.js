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
      menus: ['우리 나라', '예산', '외교', '무역', '시장', '첩보 정보'] },
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

  // ---------- 병과 개편 (공격/방어 체계) ----------
  // 모든 나라 공통 병과 + 나라별 특수부대. atk=공격, def=방어. branch로 병과 구분
  W.UNITS = {
    // 육군
    spear:       { name: '창병', branch: 'army', atk: 4, def: 4, move: 2, cost: { coin: 5, wood: 2, iron: 1 }, img: 'spear' },
    catapult:    { name: '투석기', branch: 'army', atk: 5, def: 2, move: 1, range: 2, cost: { coin: 8, wood: 3, iron: 1 }, img: 'catapult' },
    mech_inf:    { name: '기계화 보병', branch: 'army', atk: 5, def: 6, move: 3, cost: { coin: 12, steel: 2, tire: 1, fuel: 1 }, img: 'infantry' },
    tank_modern: { name: '현대 전차', branch: 'army', atk: 7, def: 5, move: 3, cost: { coin: 18, steel: 3, rubber: 1, fuel: 2 }, img: 'tank' },
    // 해군
    destroyer:   { name: '구축함', branch: 'navy', atk: 6, def: 5, move: 4, sea: true, cost: { coin: 15, steel: 3, fuel: 2 }, img: 'destroyer' },
    battleship:  { name: '전함', branch: 'navy', atk: 7, def: 6, move: 3, range: 2, sea: true, cost: { coin: 22, steel: 4, fuel: 2, chip: 1 }, img: 'warship' },
    // 공군
    helicopter:  { name: '전투 헬기', branch: 'air', atk: 6, def: 4, move: 4, fly: true, cost: { coin: 16, engine: 1, fuel: 2 }, img: 'helicopter' },
    drone:       { name: '살상용 드론', branch: 'air', atk: 5, def: 2, move: 5, fly: true, cost: { coin: 10, rare: 1, fuel: 1 }, img: 'drone' },
    missile:     { name: '유도미사일', branch: 'air', atk: 4, def: 0, move: 0, range: 3, fly: true, oneTime: true, cost: { coin: 8, chip: 1, fuel: 1 }, img: 'missile' },
    // 특수부대 (나라별, 기존 유지 + 공격 7·방어 5)
    k_missile:  { name: '장거리 미사일 부대', boss: 'K', branch: 'army', atk: 7, def: 5, move: 5, range: 3, fly: true, img: 'boss_K' },
    j_patrol:   { name: '해상 초계기', boss: 'J', branch: 'navy', atk: 7, def: 5, move: 6, range: 3, fly: true, img: 'boss_J' },
    c_jet:      { name: '대형 전투기 편대', boss: 'C', branch: 'air', atk: 7, def: 5, move: 6, range: 3, fly: true, img: 'boss_C' },
    a_stealth:  { name: '스텔스 폭격기', boss: 'A', branch: 'air', atk: 7, def: 5, move: 6, range: 3, fly: true, img: 'boss_A' },
    n_hyper:    { name: '극초음속 미사일', boss: 'N', branch: 'air', atk: 7, def: 5, move: 5, range: 3, fly: true, img: 'boss_N' },
    t_marine:   { name: '상륙 기갑부대', boss: 'T', branch: 'army', atk: 7, def: 5, move: 5, range: 2, fly: true, img: 'boss_T' },
    // 민간
    worker:      { name: '노동자', branch: 'civil', move: 2, img: 'worker' },
    scout:       { name: '정찰병', branch: 'civil', move: 5, img: 'scout' }
  };

  // 기존 종류 → 새 종류 대응표 (가져오기 때 종류만 바꾸고 개수·위치 유지)
  W.KIND_MAP = {
    spear: 'spear', catapult: 'catapult', knight: 'mech_inf', musket: 'mech_inf',
    cannon: 'catapult', infantry: 'mech_inf', artillery: 'catapult', tank: 'tank_modern',
    trireme: 'destroyer', frigate: 'destroyer', battleship: 'battleship', cruiser: 'battleship',
    fighter: 'helicopter', k_missile: 'k_missile', j_patrol: 'j_patrol', c_jet: 'c_jet',
    a_stealth: 'a_stealth', n_hyper: 'n_hyper', t_marine: 't_marine',
    worker: 'worker', scout: 'scout'
  };

  // 병과별 유닛 목록 (생산 화면 등에서 사용)
  W.BRANCH_UNITS = {};
  for (const [k, u] of Object.entries(W.UNITS)) {
    (W.BRANCH_UNITS[u.branch] = W.BRANCH_UNITS[u.branch] || []).push(k);
  }

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
  W.SPECIALTY_ITEM = Object.fromEntries(Object.entries(R.DEFAULT_TYPES).map(([id, type]) => [id, R.STRAT_OF[type]]));

  // ---------- 턴·기본 숫자 (설계 1-2, 5-1, 5-3, 5-4, 6장, 11장) ----------
  W.TURN = { seconds: 180, min: 60, max: 600 };   // 기본 3분, 교사 조절 1~10분
  W.POLL_MS = 4000;                               // 화면 확인 주기 (3~5초)
  W.CAPITAL = { def: 20, hp: 200 };               // 수도 방어·체력
  W.REPAIR = { costMult: 0.5, specialtyExtra: 1 };// 수리 비용 = 처음 짓는 비용의 절반, 특산 공장은 특산 1개 더
  W.SHIELD_TURNS = 3;                             // 도시를 잃으면 3턴 보호막
  W.MAX_CITY_LOSS = 2;                            // 한 나라가 잃을 수 있는 도시 최대 2곳
  W.PEACE_TURNS = 3;                              // 평화 뒤 3턴 동안 재선포 금지

  // ---------- 이동 (설계 4-4, E3) ----------
  // 이동력은 W.UNITS의 move 값을 그대로 쓴다 (worker 2, scout 5 포함)
  W.MOVES_OF = k => (W.UNITS[k] || {}).move ?? 0;
  W.unitIsSea = k => (W.UNITS[k] || {}).sea === true;
  W.unitIsAir = k => (W.UNITS[k] || {}).fly === true;
  W.unitIsCivil = k => (W.UNITS[k] || {}).branch === 'civil';
  W.unitIsRanged = k => ((W.UNITS[k] || {}).range || 0) >= 2;
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

  // ---------- 미션 (2026-11-08 결정: 완료는 서버에 학생별로 기록) ----------
  // opens가 OPEN_STAGES에 있을 때 열리고, 화면이 알린 대로 서버에 기록해요. 단계가 끝날 때마다 OPEN_STAGES를 늘려요
  W.OPEN_STAGES = ['now', 'E4', 'E6', 'E7', 'E8', 'E9'];
  W.MISSIONS = [
    { key: 'chief_info', role: 'chief', order: 1, text: '「우리 나라」 탭에서 나라 정보를 살펴봐요', opens: 'now' },
    { key: 'chief_budget', role: 'chief', order: 2, text: '공병사령관에게 예산을 나눠 줘요', opens: 'E6' },
    { key: 'chief_ally', role: 'chief', order: 3, text: '다른 나라에 동맹을 제안해요', opens: 'E8' },
    { key: 'chief_market', role: 'chief', order: 4, text: '도시국가 시장에서 물물교환을 한 번 해요', opens: 'E9' },
    { key: 'eng_worker_move', role: 'engineer', order: 5, text: '노동자를 한 칸 옮겨요', opens: 'now' },
    { key: 'eng_scout_enemy', role: 'engineer', order: 6, text: '정찰병을 다른 나라 도시 바로 옆까지 보내요', opens: 'now' },
    { key: 'eng_build', role: 'engineer', order: 7, text: '건물을 하나 지어요', opens: 'E6' },
    { key: 'eng_repair', role: 'engineer', order: 8, text: '부서진 시설을 고쳐요', opens: 'E6' },
    { key: 'army_move', role: 'army', order: 9, text: '병력 하나를 옮겨 봐요', opens: 'now' },
    { key: 'army_transfer', role: 'army', order: 10, text: '병력 하나의 지휘권을 다른 참모총장에게 넘겨 봐요', opens: 'now' },
    { key: 'army_attack_preview', role: 'army', order: 11, text: '공격 미리보기를 확인해요', opens: 'E4' },
    { key: 'army_build', role: 'army', order: 12, text: '병력을 하나 만들어요', opens: 'E7' },
    { key: 'navy_move', role: 'navy', order: 13, text: '배 하나를 옮겨 봐요', opens: 'now' },
    { key: 'navy_coast', role: 'navy', order: 14, text: '배를 우리 해안 도시 옆으로 보내요', opens: 'now' },
    { key: 'navy_attack_preview', role: 'navy', order: 15, text: '공격 미리보기를 확인해요', opens: 'E4' },
    { key: 'navy_build', role: 'navy', order: 16, text: '배를 하나 만들어요', opens: 'E7' },
    { key: 'air_fly_over', role: 'air', order: 17, text: '공군을 다른 나라 병력 위로 날려 옮겨요', opens: 'now' },
    { key: 'air_transfer', role: 'air', order: 18, text: '공군 하나의 지휘권을 다른 참모총장에게 넘겨 봐요', opens: 'now' },
    { key: 'air_attack_preview', role: 'air', order: 19, text: '공격 미리보기를 확인해요', opens: 'E4' },
    { key: 'air_build', role: 'air', order: 20, text: '전투 헬기를 하나 만들어요', opens: 'E7' }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = W;
  root.WAR_RULES = W;
})(typeof window !== 'undefined' ? window : globalThis);
