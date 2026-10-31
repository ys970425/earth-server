// 지구 서버: 문명의 시대 — 게임 규칙 숫자 (서버와 화면이 같이 씀)
// 이 파일을 고친 뒤에는 `node tools/trade/build-sql.mjs`로 supabase/trade_setup.sql을 다시 만들어야 서버에 반영됩니다.
(function (root) {
  const R = {};
  R.W = 32; R.H = 22;
  R.START = { coin: 150, food: 4, wood: 5, iron: 1 };

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

  R.TECHS = {
    steelmaking: '제철', oil_drill: '석유 추출', refining: '석유 정제', munitions: '군수품 공장', nuclear: '원자력',
    chipmaking: '반도체 제조', rubberwork: '고무 가공', woodwork: '목재 가공', metalcraft: '금속 세공',
    textile: '섬유 가공', satellite: '인공위성', internet: '인터넷', tourism: '관광산업',
    shipbuilding: '조선', jungle: '밀림 개발'
  };

  R.TERRAIN = {
    plains: '평원', hills: '언덕', mountain: '산', forest: '숲', jungle: '정글',
    tundra: '툰드라', snow: '설원', desert: '사막', coast: '해안', ocean: '바다'
  };

  R.IMPROVE = {
    farm: { name: '농장', on: ['plains', 'tundra'], cost: { coin: 10, wood: 1 }, item: 'food', yield: 2 },
    lumber: { name: '벌목장', on: ['forest', 'jungle'], cost: { coin: 10 }, item: 'wood', yield: 2 },
    mine: { name: '광산', res: ['iron', 'copper', 'aluminum', 'gold', 'uranium'], cost: { coin: 15, wood: 1 }, yield: 2 },
    plantation: { name: '농원', res: ['cotton', 'spice', 'wine', 'rubber'], cost: { coin: 15, wood: 1 }, yield: 2 },
    oilwell: { name: '유정', res: ['oil'], tech: 'oil_drill', cost: { coin: 20, wood: 1 }, yield: 2 }
  };
  R.JUNGLE_MULT = 2;
  R.TUNDRA_FOOD = 1;

  R.BUILDINGS = {
    market: { name: '도시 시장', cost: { coin: 40, wood: 3 }, effect: '매 턴 코인 +12 (우리 도시 안의 시장)' },
    barracks: { name: '병영', cost: { coin: 30, wood: 2, iron: 1 }, effect: '이 도시에서 병력 훈련 (한 턴에 1부대)' },
    granary: { name: '곡물 창고', cost: { coin: 25, wood: 2 }, effect: '매 턴 식량 +2' },
    plaza: { name: '광장', cost: { coin: 30, wood: 2 }, effect: '행복도 +6' },
    harbor: { name: '항구', cost: { coin: 50, wood: 4 }, tech: 'shipbuilding', coastal: true, effect: '바다 건너 도시국가 공격, 매 턴 코인 +5' }
  };

  R.FACTORIES = {
    steelworks: { name: '제철소', tech: 'steelmaking', input: 'iron', output: 'steel', build: { coin: 50, wood: 2 }, perTurn: 2 },
    refinery: { name: '정유소', tech: 'refining', input: 'oil', output: 'fuel', build: { coin: 50, wood: 2 }, perTurn: 2 },
    chipfab: { name: '반도체 공장', tech: 'chipmaking', input: 'copper', output: 'chip', build: { coin: 60, wood: 2 }, perTurn: 2 },
    textilemill: { name: '섬유 공장', tech: 'textile', input: 'cotton', output: 'clothes', build: { coin: 50, wood: 2 }, perTurn: 2 },
    rubberplant: { name: '고무 공장', tech: 'rubberwork', input: 'rubber', output: 'tire', build: { coin: 50, wood: 2 }, perTurn: 2 },
    workshop: { name: '금 세공소', tech: 'metalcraft', input: 'gold', output: 'jewelry', build: { coin: 50, wood: 2 }, perTurn: 2 }
  };
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
    electronics: { name: '전자 상가', cost: { coin: 40, chip: 2 }, econ: 12, coinPerTurn: 15 },
    theater: { name: '극장', cost: { coin: 30, clothes: 2 }, culture: 10, happy: 6 },
    netcenter: { name: '인터넷 센터', tech: 'internet', cost: { coin: 40, chip: 2 }, culture: 15 },
    satcenter: { name: '인공위성 센터', tech: 'satellite', cost: { coin: 60, aluminum: 2, chip: 2 }, culture: 20 },
    arsenal: { name: '군수 공장', tech: 'munitions', cost: { coin: 60, steel: 2, aluminum: 1 }, unlock: 'cannon' }
  };

  R.HIRE_WORKER = { coin: 25, food: 2 };
  R.UNITS = {
    spear: { name: '창병', str: 5, cost: { coin: 20, food: 1 } },
    catapult: { name: '투석기', str: 9, cost: { coin: 30, wood: 2 } },
    ballista: { name: '발리스타', str: 14, cost: { coin: 40, wood: 2, iron: 1 } },
    cannon: { name: '대포', str: 24, cost: { coin: 60, steel: 1, fuel: 1 }, needs: 'arsenal' }
  };
  R.UNIT_UPKEEP = 2;
  R.SCOUT_MOVE = 5;
  R.SCOUT_SIGHT = 2;
  R.CITY_SIGHT = 2;

  R.INCOME = { capital: 20, city: 6, market: 12, harbor: 5, capitalFood: 3, cityFood: 1, workerFood: 1 };
  R.PRODUCTIVITY = { K: { market: 18, harbor: 8 }, J: { market: 18, harbor: 8 } };

  R.HAPPY = {
    base: 55, perLuxType: 6, perPlaza: 6, glory: 10, gloryDecay: 5, perCity: -3, hunger: -8, tariffPer: 8,
    crisis: { perCity: -2, fewLux: -8, fewLuxUnder: 2, armyNeedsSteel: 3, noSteel: -5, fuelCities: 4, noFuel: -6 },
    golden: 70, unhappy: 40, unrest: 25, revolt: 15
  };

  // 나라 유형 (모둠 번호 → 유형은 관제실에서 정함)
  R.TYPES = {
    K: { name: '반도의 나라', color: '#2F6FE0', techs: ['steelmaking', 'refining', 'chipmaking', 'shipbuilding', 'internet'],
         like: '한국', desc: '땅이 좁고 산이 많아요. 자원은 적지만 기술이 뛰어나요.' },
    J: { name: '섬의 나라', color: '#E0463C', techs: ['metalcraft', 'rubberwork', 'munitions', 'tourism', 'shipbuilding', 'chipmaking'],
         like: '일본', desc: '바다로 둘러싸인 섬나라예요. 소재·부품 기술이 좋아요.' },
    C: { name: '대륙의 공장', color: '#F29A2E', techs: ['textile', 'steelmaking', 'woodwork'],
         like: '중국', desc: '넓은 땅에 철광석·목화·구리가 많고, 많이 만드는 공장이 있어요.' },
    A: { name: '신대륙의 강국', color: '#8A4FD8', techs: ['oil_drill', 'refining', 'nuclear', 'satellite', 'internet', 'chipmaking', 'textile'],
         like: '미국', desc: '넓은 땅에 석유·곡물이 많고 과학 기술이 앞서요.' },
    N: { name: '북방의 대국', color: '#22A36A', techs: ['oil_drill', 'refining', 'nuclear', 'satellite'],
         like: '러시아', desc: '가장 넓지만 얼어붙은 땅이 많아요. 석유와 금이 나요.' },
    T: { name: '열대 해양국', color: '#EC5C9A', techs: ['textile'],
         like: '동남아시아 여러 나라', desc: '정글과 섬의 나라예요. 고무·향신료가 많고 일손이 많아요.' }
  };
  R.DEFAULT_TYPES = { 1: 'K', 2: 'J', 3: 'C', 4: 'A', 5: 'N', 6: 'T' };

  R.ROLES = ['국가 대표', '도시·내정', '군사·정찰', '자원·생산', '기록관'];

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
