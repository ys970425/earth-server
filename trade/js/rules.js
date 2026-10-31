// 지구 서버: 문명의 시대 — 게임 규칙 숫자 (서버와 화면이 같이 씀)
// 이 파일을 고친 뒤에는 `node tools/trade/build-sql.mjs`로 supabase/trade_setup.sql을 다시 만들어야 서버에 반영됩니다.
(function (root) {
  const R = {};
  R.W = 40; R.H = 28;
  R.START = { coin: 150, food: 4, wood: 5, iron: 1 };
  // 나라별 시작 보너스 (반도·섬은 숲이 적어서 목재를 더 줌)
  R.START_BONUS = { K: { wood: 8 }, J: { wood: 4 } };

  R.ITEMS = {
    food: { name: '식량', kind: 'basic', ref: 5 },
    wood: { name: '목재', kind: 'basic', ref: 4 },
    iron: { name: '철광석', kind: 'ore', ref: 8 },
    copper: { name: '구리', kind: 'ore', ref: 8 },
    aluminum: { name: '알루미늄', kind: 'ore', ref: 12 },
    uranium: { name: '우라늄', kind: 'ore', ref: 15 },
    gold: { name: '금', kind: 'lux', ref: 12 },
    oil: { name: '석유', kind: 'oil', ref: 10 },
    cotton: { name: '목화', kind: 'lux', ref: 6 },
    rubber: { name: '고무', kind: 'plant', ref: 8 },
    spice: { name: '향신료', kind: 'lux', ref: 10 },
    wine: { name: '와인', kind: 'lux', ref: 10 },
    steel: { name: '강철', kind: 'product', ref: 15 },
    fuel: { name: '연료', kind: 'product', ref: 15 },
    chip: { name: '반도체', kind: 'product', ref: 25 },
    clothes: { name: '옷', kind: 'lux', ref: 15 },
    tire: { name: '타이어', kind: 'product', ref: 15 },
    jewelry: { name: '장신구', kind: 'lux', ref: 25 }
  };
  R.LUX = Object.keys(R.ITEMS).filter(k => R.ITEMS[k].kind === 'lux');
  R.FAIR_CAP = 2;

  // 기술 계통도 (문명 5 참고). 고대 기술(농업·목축·채광·도기·궁술·청동기·기초 항해·역법·문자·바퀴)은 모두 끝낸 상태로 시작해요.
  // era: 1 중세 · 2 르네상스 · 3 산업 · 4 현대. req: 먼저 배워야 하는 기술. cost: 연구비. 한 나라는 한 턴에 하나만 연구해요.
  R.ERAS = ['고대', '중세', '르네상스', '산업', '현대'];
  R.ANCIENT = ['농업', '목축', '채광', '도기', '궁술', '청동기', '기초 항해', '역법', '문자', '바퀴'];
  R.TECH_TREE = {
    engineering:  { name: '공학', era: 1, row: 0, req: [], cost: { coin: 30, food: 2 }, unlock: '투석기 · 곡물 창고' },
    chivalry:     { name: '기사도', era: 1, row: 1, req: [], cost: { coin: 30, food: 2 }, unlock: '기사 (빠른 기병)' },
    shipbuilding: { name: '조선', era: 1, row: 2, req: [], cost: { coin: 35, wood: 2 }, unlock: '항구 · 삼단노선' },
    economics:    { name: '경제학', era: 2, row: 0, req: ['engineering'], cost: { coin: 60, food: 3 }, unlock: '시장 코인 +6 · 섬유 공장 · 금 세공소 · 고무 공장 · 정글 개발비 절반' },
    gunpowder:    { name: '화약', era: 2, row: 1, req: ['engineering', 'chivalry'], cost: { coin: 60, iron: 1 }, unlock: '대포 · 머스킷 보병' },
    navigation:   { name: '항해술', era: 2, row: 2, req: ['shipbuilding'], cost: { coin: 60, wood: 3 }, unlock: '프리깃 · 정찰병 바다 이동 +2' },
    refining:     { name: '석유', era: 3, row: 0, req: ['economics'], cost: { coin: 90, wood: 3 }, unlock: '유정 · 정유소' },
    steelmaking:  { name: '제철', era: 3, row: 1, req: ['gunpowder'], cost: { coin: 90, iron: 2 }, unlock: '제철소 · 보병 · 포병 · 군수 공장' },
    warship:      { name: '강철 군함', era: 3, row: 2, req: ['navigation', 'steelmaking'], cost: { coin: 110, steel: 1 }, unlock: '전함' },
    combustion:   { name: '내연 기관', era: 4, row: 0, req: ['refining', 'steelmaking'], cost: { coin: 150, fuel: 1 }, unlock: '탱크' },
    chipmaking:   { name: '전자공학', era: 4, row: 1, req: ['steelmaking'], cost: { coin: 150, copper: 2 }, unlock: '반도체 공장 · 전자 상가 · 원자력 발전소' },
    radar:        { name: '레이더·통신', era: 4, row: 2, req: ['chipmaking'], cost: { coin: 170, aluminum: 1 }, unlock: '통신탑 · 방송국 · 인터넷 센터 · 인공위성 센터 (근미래)' },
    missile:      { name: '유도 미사일', era: 4, row: 3, req: ['radar', 'warship'], cost: { coin: 200, chip: 1 }, unlock: '미사일 순양함' }
  };
  // 예전 기술 이름 → 합친 기술 (공장·건물·도시국가 기술자에 씀)
  R.TECH_ALIAS = { textile: 'economics', metalcraft: 'economics', rubberwork: 'economics', woodwork: 'economics', jungle: 'economics',
    oil_drill: 'refining', munitions: 'steelmaking', electricity: 'chipmaking', internet: 'radar', satellite: 'radar', nuclear: 'chipmaking' };
  R.TECHS = Object.fromEntries(Object.entries(R.TECH_TREE).map(([k, t]) => [k, t.name]));

  R.TERRAIN = {
    plains: '평원', hills: '언덕', mountain: '산', forest: '숲', jungle: '정글',
    tundra: '툰드라', snow: '설원', desert: '사막', coast: '해안', ocean: '바다'
  };

  R.IMPROVE = {
    farm: { name: '농장', on: ['plains', 'tundra', 'desert'], cost: { coin: 10, wood: 1 }, item: 'food', yield: 2 },
    lumber: { name: '벌목장', on: ['forest', 'jungle'], cost: { coin: 10 }, item: 'wood', yield: 2 },
    mine: { name: '광산', res: ['iron', 'copper', 'aluminum', 'gold', 'uranium'], cost: { coin: 15, wood: 1 }, yield: 2 },
    quarry: { name: '채석장', on: ['hills'], noRes: true, cost: { coin: 15, wood: 1 }, coin: 10, yield: 0 },
    plantation: { name: '농원', res: ['cotton', 'spice', 'wine', 'rubber'], cost: { coin: 15, wood: 1 }, yield: 2 },
    oilwell: { name: '유정', res: ['oil'], tech: 'refining', cost: { coin: 20, wood: 1 }, yield: 2 }
  };
  R.JUNGLE_MULT = 2;
  // 채석장: 언덕(자원 없는 칸)에 지으면 매 턴 코인 +10
  R.QUARRY_COIN = 10;
  R.TUNDRA_FOOD = 1;

  R.BUILDINGS = {
    market: { name: '도시 시장', cost: { coin: 40, wood: 3 }, effect: '매 턴 코인 +12 (우리 도시 안의 시장)' },
    barracks: { name: '병영', cost: { coin: 30, wood: 2, iron: 1 }, effect: '이 도시에서 병력 훈련 (한 턴에 1부대)' },
    granary: { name: '곡물 창고', cost: { coin: 25, wood: 2 }, tech: 'engineering', effect: '매 턴 식량 +2' },
    plaza: { name: '광장', cost: { coin: 30, wood: 2 }, effect: '행복도 +6' },
    harbor: { name: '항구', cost: { coin: 50, wood: 4 }, tech: 'shipbuilding', coastal: true, effect: '배 만들기, 매 턴 코인 +5' }
  };

  R.FACTORIES = {
    steelworks: { name: '제철소', tech: 'steelmaking', input: 'iron', output: 'steel', build: { coin: 50, wood: 2 }, perTurn: 2 },
    refinery: { name: '정유소', tech: 'refining', input: 'oil', output: 'fuel', build: { coin: 50, wood: 2 }, perTurn: 2 },
    chipfab: { name: '반도체 공장', tech: 'chipmaking', input: 'copper', output: 'chip', build: { coin: 150, aluminum: 4, copper: 3 }, perTurn: 2 },
    textilemill: { name: '섬유 공장', tech: 'economics', input: 'cotton', output: 'clothes', build: { coin: 50, wood: 2 }, perTurn: 2 },
    rubberplant: { name: '고무 공장', tech: 'economics', input: 'rubber', output: 'tire', build: { coin: 50, wood: 2 }, perTurn: 2 },
    workshop: { name: '금 세공소', tech: 'economics', input: 'gold', output: 'jewelry', build: { coin: 50, wood: 2 }, perTurn: 2 }
  };
  // 나라별 공장 짓는 비용 (없으면 위 기본 비용). 반도는 반도체 공장을 싸게, 섬나라는 조금 비싸게, 나머지는 아주 비싸게
  // 나라마다 특산품 하나: 특산 공장은 싸게 짓고(코인 40·목재 2·식량 2), 원료 없이 매 턴 2개 만들어요 (가공비만 냄)
  R.SPECIALTY = {
    K: { factory: 'chipfab', why: '기술이 뛰어나 원료가 없어도 반도체를 만들어요' },
    J: { factory: 'rubberplant', why: '부품 기술이 좋아 타이어를 잘 만들어요' },
    C: { factory: 'steelworks', why: '큰 제철소가 많아 강철을 많이 만들어요' },
    A: { factory: 'refinery', why: '석유가 많아 연료를 넉넉히 만들어요' },
    N: { factory: 'workshop', why: '금과 보석이 많이 나서 장신구를 잘 만들어요' },
    T: { factory: 'textilemill', why: '일손이 많아 옷을 많이 만들어요' }
  };
  R.SPECIALTY_BUILD = { coin: 40, wood: 2, food: 2 };
  R.FACTORY_BUILD = { chipfab: { J: { coin: 90, aluminum: 2, copper: 2 } } };
  R.FACTORY_FREE = {};
  for (const [t, sp] of Object.entries(R.SPECIALTY)) {
    (R.FACTORY_BUILD[sp.factory] = R.FACTORY_BUILD[sp.factory] || {})[t] = R.SPECIALTY_BUILD;
    R.FACTORY_FREE[t] = { [sp.factory]: true };
  }
  // 나라별 가공비 (코인/개). 없으면 못 만듦
  R.PROC_COST = {
    K: { steel: 4, fuel: 3, chip: 5 },
    J: { chip: 15, tire: 4, jewelry: 5 },
    C: { steel: 4, clothes: 5, tire: 12, chip: 50, fuel: 15 },
    A: { chip: 20, clothes: 20, fuel: 6 },
    N: { jewelry: 12, fuel: 10 },
    T: { clothes: 4, tire: 8 }
  };

  R.ADVANCED = {
    industrial: { name: '공장 지대', cost: { coin: 40, steel: 2, tire: 1 }, econ: 12, coinPerTurn: 15 },
    electronics: { name: '전자 상가', tech: 'chipmaking', cost: { coin: 40, chip: 2 }, econ: 12, coinPerTurn: 15 },
    theater: { name: '극장', cost: { coin: 30, clothes: 2 }, culture: 10, happy: 6 },
    netcenter: { name: '인터넷 센터', tech: 'radar', cost: { coin: 40, chip: 2 }, culture: 15 },
    satcenter: { name: '인공위성 센터', tech: 'radar', cost: { coin: 60, aluminum: 2, chip: 2 }, culture: 20 },
    arsenal: { name: '군수 공장', tech: 'steelmaking', cost: { coin: 60, steel: 2 }, unlock: 'tank' },
    // 근미래 건물: 레이더 기술 + 대부분 나라에 없는 자원 → 무역이 꼭 필요해요
    commtower: { name: '통신탑', tech: 'radar', cost: { coin: 80, aluminum: 2, copper: 2 }, happy: 14, culture: 10 },
    broadcast: { name: '방송국', tech: 'radar', cost: { coin: 90, chip: 2, aluminum: 1 }, happy: 18, culture: 15 },
    nuclearplant: { name: '원자력 발전소', tech: 'chipmaking', cost: { coin: 100, uranium: 2, steel: 2 }, econ: 15, coinPerTurn: 25 }
  };

  R.HIRE_WORKER = { coin: 25, food: 2 };
  // 병력: str 힘, move 한 턴 이동 칸, range 원거리(2칸 밖에서 공격, 반격을 덜 받음), sea 배, img 그림
  R.UNITS = {
    spear:     { name: '창병', era: 0, str: 10, move: 3, cost: { coin: 20, food: 1 }, img: 'spear' },
    catapult:  { name: '투석기', era: 1, str: 11, move: 2, range: 2, tech: 'engineering', cost: { coin: 30, wood: 2 }, img: 'catapult' },
    knight:    { name: '기사', era: 1, str: 14, move: 4, tech: 'chivalry', cost: { coin: 40, food: 2, iron: 1 }, img: 'knight' },
    musket:    { name: '머스킷 보병', era: 2, str: 20, move: 3, tech: 'gunpowder', cost: { coin: 50, iron: 1 }, img: 'swordsman' },
    cannon:    { name: '대포', era: 2, str: 26, move: 2, range: 2, tech: 'gunpowder', cost: { coin: 60, iron: 2, wood: 2 }, img: 'cannon' },
    infantry:  { name: '보병', era: 3, str: 36, move: 3, tech: 'steelmaking', cost: { coin: 70, steel: 1, food: 2 }, img: 'infantry' },
    artillery: { name: '포병', era: 3, str: 48, move: 2, range: 3, tech: 'steelmaking', cost: { coin: 90, steel: 2 }, img: 'artillery' },
    tank:      { name: '탱크', era: 4, str: 75, move: 5, tech: 'combustion', cost: { coin: 130, steel: 2, fuel: 2, tire: 1 }, img: 'tank' },
    trireme:   { name: '삼단노선', era: 1, str: 10, move: 4, sea: true, tech: 'shipbuilding', cost: { coin: 30, wood: 3 }, img: 'trireme' },
    frigate:   { name: '프리깃', era: 2, str: 24, move: 5, range: 2, sea: true, tech: 'navigation', cost: { coin: 60, wood: 3, iron: 1 }, img: 'frigate' },
    battleship:{ name: '전함', era: 3, str: 55, move: 5, range: 2, sea: true, tech: 'warship', cost: { coin: 110, steel: 3, fuel: 1 }, img: 'warship' },
    cruiser:   { name: '미사일 순양함', era: 4, str: 90, move: 6, range: 3, sea: true, tech: 'missile', cost: { coin: 160, steel: 2, fuel: 2, chip: 2 }, img: 'cruiser' }
  };
  R.UNIT_UPKEEP = 1;
  // 기술 아이콘 (img/tech/*.png). 없는 기술은 글자만
  R.TECH_ICON = { engineering: 'engineering', economics: 'economics', gunpowder: 'gunpowder', navigation: 'astronomy', shipbuilding: 'shipbuilding',
    steelmaking: 'steelmaking', refining: 'oil', chipmaking: 'chipmaking', radar: 'radar', missile: 'missile', combustion: 'steam', warship: 'munitions', chivalry: 'chivalry' };
  R.START_UNITS = ['worker', 'scout', 'scout', 'scout', 'spear', 'spear', 'catapult'];
  // 전투: 피해 = 30 × (공격 힘 ÷ 방어력). 다친 병력은 힘이 줄어요. 원거리는 반격을 1/4만 받아요.
  R.COMBAT = { base: 30, counter: 0.7, min: 3, max: 100, rangedCounter: 0.25, healField: 10, healHome: 20 };
  R.TRAIN_PER_TURN = 3;   // 한 도시에서 한 턴에 훈련할 수 있는 부대 수
  // 도시국가 등급: 0 튜토리얼(바로 옆, 아주 약함) … 4 철옹성(탱크·전함 필요) · 5 최종 보스
  R.CS_TIERS = [
    { name: '마을', def: 6, hp: 60, coin: 100, heal: 6 },
    { name: '도시', def: 12, hp: 100, coin: 40, heal: 12 },
    { name: '성곽 도시', def: 22, hp: 150, coin: 60, heal: 18 },
    { name: '요새', def: 40, hp: 220, coin: 90, heal: 25 },
    { name: '철옹성', def: 70, hp: 320, coin: 150, heal: 35 },
    { name: '최종 보스', def: 110, hp: 1200, coin: 500, heal: 80 }
  ];
  R.SCOUT_MOVE = 5;
  R.WORKER_MOVE = 0;
  R.SCOUT_SIGHT = 2;
  R.CITY_SIGHT = 2;

  R.INCOME = { capital: 20, city: 6, market: 12, harbor: 5, capitalFood: 3, cityFood: 1, workerFood: 1 };
  R.PRODUCTIVITY = { K: { market: 18, harbor: 8 }, J: { market: 18, harbor: 8 } };

  R.HAPPY = {
    base: 55, perLuxType: 6, perPlaza: 6, glory: 10, gloryDecay: 5, perCity: -3, hunger: -8, tariffPer: 8,
    crisis: { perCity: -2, fewLux: -8, fewLuxUnder: 2, armyNeedsSteel: 8, noSteel: -5, fuelCities: 4, noFuel: -6 },
    golden: 70, unhappy: 40, unrest: 25, revolt: 15
  };

  // 나라 유형 (모둠 번호 → 유형은 관제실에서 정함). techs: 튜토리얼 도시국가를 차지하면 합류하는 핵심 기술
  R.TYPES = {
    K: { name: '반도의 용', color: '#2F6FE0', techs: ['shipbuilding', 'steelmaking', 'chipmaking'],
         like: '한국', desc: '땅이 좁고 산이 많아요. 자원은 적지만 기술이 뛰어나요.' },
    J: { name: '파도의 섬왕국', color: '#E0463C', techs: ['shipbuilding', 'navigation', 'economics'],
         like: '일본', desc: '바다로 둘러싸인 섬나라예요. 소재·부품 기술이 좋아요.' },
    C: { name: '대륙의 제국', color: '#F29A2E', techs: ['engineering', 'economics', 'steelmaking'],
         like: '중국', desc: '넓은 땅에 철광석·목화·구리가 많고, 많이 만드는 공장이 있어요.' },
    A: { name: '신대륙의 강국', color: '#8A4FD8', techs: ['engineering', 'refining', 'radar'],
         like: '미국', desc: '넓은 땅에 석유·곡물이 많고 과학 기술이 앞서요.' },
    N: { name: '북방의 대국', color: '#22A36A', techs: ['chivalry', 'refining', 'economics'],
         like: '러시아', desc: '가장 넓지만 얼어붙은 땅이 많아요. 석유와 금이 나요.' },
    T: { name: '열대 해양국', color: '#EC5C9A', techs: ['shipbuilding', 'economics', 'navigation'],
         like: '동남아시아 여러 나라', desc: '정글과 섬의 나라예요. 고무·향신료가 많고 일손이 많아요.' }
  };
  // 도시 그림 (img/city/*.png, 160×160, 기준점: 가로 50%, 세로 83%가 칸 중심)
  R.CITY_ART = { K: 'capital_peninsula', J: 'capital_island', C: 'capital_continental', A: 'capital_newworld', N: 'capital_northern', T: 'capital_tropical',
    village: 'neutral_village', fortress: 'neutral_fortress', harbor: 'neutral_harbor', boss: 'boss' };
  R.CITY_ANCHOR = 0.83;
  R.DEFAULT_TYPES = { 1: 'K', 2: 'J', 3: 'C', 4: 'A', 5: 'N', 6: 'T' };

  // 모둠 역할 5개 (한 사람이 3개까지, 국가 대표는 한 명). 맡은 친구가 있으면 그 친구만 그 버튼을 누를 수 있어요.
  R.ROLES = ['국가 대표', '국방부 장관', '기획부 장관', '국토부 장관', '과학기술부 장관'];
  R.ROLE_INFO = {
    '국가 대표': { icon: 'leader', now: '모든 장관의 일 + 나라 이름·국기, 모둠 회의, 「턴 끝내기」', later: '무역 제안 최종 승인, 조약 서명' },
    '국방부 장관': { icon: 'spear', now: '병력 훈련·이동, 도시국가 공격', later: '무역 사절: 다른 나라에 거래 제안 보내기' },
    '기획부 장관': { icon: 'market', now: '도시 건물·공장·근미래 건물 짓기', later: '공장 가동, 무엇을 만들어 팔지 정하기' },
    '국토부 장관': { icon: 'worker', now: '노동자로 땅 개발(농장·광산·채석장…), 노동자 고용', later: '창고 관리, 모자란 자원 찾아 수입 요청' },
    '과학기술부 장관': { icon: 'scout', now: '기술 연구, 정찰병으로 세계 탐험', later: '시장 조사: 기준가·생산비 비교' }
  };
  R.ROLE_KEY = { leader: '국가 대표', army: '국방부 장관', build: '기획부 장관', land: '국토부 장관', explore: '과학기술부 장관' };
  // 성장의 한계: 도시국가를 이만큼 차지하면 시민들이 더 많은 것을 원하기 시작해요 (나라마다 자동)
  R.GROWTH_LIMIT = { K: 4, J: 4, C: 5, A: 5, N: 5, T: 5 };

  R.PHASES = [
    { n: 0, name: '건국', desc: '나라 이름을 정하고 지도를 살펴봐요.' },
    { n: 1, name: '나라 키우기', desc: '노동자로 땅을 개발하고, 건물을 짓고, 도시국가를 차지해요.' },
    { n: 2, name: '성장의 한계', desc: '시민들이 더 다양한 물건을 원해요.' },
    { n: 3, name: '세계 시장 개방', desc: '다른 나라와 거래할 수 있어요.' },
    { n: 4, name: '무역 라운드', desc: '잘 만드는 것을 만들고 거래해요.' },
    { n: 5, name: '공급 차질', desc: '한 나라에 한파가 찾아왔어요.' },
    { n: 6, name: '가격 경쟁', desc: '세계 시장이 물건을 주문했어요.' },
    { n: 7, name: '실제 나라와 비교', desc: '우리 나라는 어느 나라와 닮았을까요?' },
    { n: 8, name: '협정 만료', desc: '세계 무역 협정이 끝났어요.' },
    { n: 9, name: '무역 갈등', desc: '거래 조건이 갑자기 바뀌었어요.' },
    { n: 10, name: '조약 회의', desc: '피해를 살펴보고 약속을 만들어요.' },
    { n: 11, name: '무역 헌장', desc: '함께 만든 약속으로 세계를 되살려요.' }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = R;
  root.RULES = R;
})(typeof window !== 'undefined' ? window : globalThis);
