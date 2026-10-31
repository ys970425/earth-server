// 지구 서버 세계 지도 (육각, pointy-top, odd-r 오프셋 좌표 col,row)
export const W = 32, H = 22;

// 나라 6유형 (화면에는 학생이 정한 이름이 나옴)
export const COUNTRIES = {
  K: { type: '반도의 용', model: '한국', capital: [16, 9], techs: ['steelmaking', 'refining', 'chipmaking', 'shipbuilding', 'internet'],
       capitalRes: [] },
  J: { type: '파도의 섬왕국', model: '일본', capital: [21, 9], techs: ['metalcraft', 'rubberwork', 'munitions', 'tourism', 'shipbuilding', 'chipmaking'],
       capitalRes: [] },
  C: { type: '대륙의 제국', model: '중국', capital: [8, 10], techs: ['textile', 'steelmaking', 'woodwork'],
       capitalRes: ['iron', 'cotton'] },
  A: { type: '신대륙의 강국', model: '미국', capital: [28, 10], techs: ['oil_drill', 'refining', 'nuclear', 'satellite', 'internet', 'chipmaking', 'textile'],
       capitalRes: ['oil', 'cotton'] },
  N: { type: '북방의 대국', model: '러시아', capital: [13, 2], techs: ['oil_drill', 'refining', 'nuclear', 'satellite'],
       capitalRes: ['oil'] },
  T: { type: '열대 해양국', model: '동남아 여러 나라', capital: [11, 17], techs: ['textile'],
       capitalRes: ['spice'] }
};

// 중립 도시국가: 확장 대상 나라, 방어력, 가진 자원, 합류하는 기술자(기술), 바다 건너 여부
export const CITYSTATES = [
  { id: 'K1', name: '소나무골', owner: 'K', at: [16, 7], def: 5, res: [] },
  { id: 'K2', name: '푸른나루', owner: 'K', at: [16, 11], def: 10, res: [] },
  { id: 'K4', name: '솔바람재', owner: 'K', at: [12, 6], def: 12, res: [] },   // 대륙과 북방 사이 고갯마루
  { id: 'K3', name: '물새섬', owner: 'K', at: [18, 13], def: 15, res: [], sea: true },
  { id: 'J1', name: '안개곶', owner: 'J', at: [21, 7], def: 5, res: ['copper'] },
  { id: 'J2', name: '붉은항', owner: 'J', at: [21, 11], def: 10, res: [] },
  { id: 'J3', name: '등대섬', owner: 'J', at: [24, 13], def: 15, res: [], sea: true },
  { id: 'C1', name: '황토성', owner: 'C', at: [6, 8], def: 5, res: ['iron'] },
  { id: 'C2', name: '붉은강', owner: 'C', at: [10, 8], def: 9, res: ['copper'] },
  { id: 'C3', name: '비단마을', owner: 'C', at: [5, 11], def: 13, res: ['cotton'], tech: 'chipmaking' },
  { id: 'C4', name: '철산성', owner: 'C', at: [11, 12], def: 17, res: ['aluminum'], tech: 'rubberwork' },
  { id: 'C5', name: '모래성', owner: 'C', at: [8, 13], def: 21, res: ['iron'], tech: 'refining' },
  { id: 'C6', name: '서쪽관문', owner: 'C', at: [3, 9], def: 24, res: ['aluminum', 'copper'] },
  { id: 'A1', name: '들판마을', owner: 'A', at: [28, 7], def: 5, res: ['wine'] },
  { id: 'A2', name: '큰강나루', owner: 'A', at: [27, 12], def: 9, res: [] },
  { id: 'A3', name: '검은샘', owner: 'A', at: [29, 5], def: 13, res: ['oil'] },
  { id: 'A4', name: '포도골', owner: 'A', at: [26, 14], def: 17, res: ['wine', 'uranium'] },
  { id: 'A5', name: '바위성', owner: 'A', at: [29, 15], def: 21, res: ['iron'] },
  { id: 'A6', name: '은빛고원', owner: 'A', at: [26, 6], def: 24, res: ['aluminum'] },
  { id: 'N1', name: '눈꽃마을', owner: 'N', at: [10, 2], def: 5, res: [] },
  { id: 'N2', name: '얼음항', owner: 'N', at: [16, 2], def: 9, res: ['oil'] },
  { id: 'N3', name: '금빛골', owner: 'N', at: [7, 1], def: 13, res: ['gold'], tundra: true, tech: 'metalcraft' },
  { id: 'N4', name: '북극성', owner: 'N', at: [19, 1], def: 17, res: ['uranium'], tundra: true },
  { id: 'N5', name: '서리성', owner: 'N', at: [4, 3], def: 21, res: ['oil'], tundra: true },
  { id: 'N6', name: '오로라성', owner: 'N', at: [22, 3], def: 24, res: ['gold'], tundra: true },
  { id: 'T1', name: '야자마을', owner: 'T', at: [9, 16], def: 5, res: ['rubber'], tech: 'jungle' },
  { id: 'T2', name: '고무나무골', owner: 'T', at: [13, 16], def: 9, res: ['rubber'], tech: 'rubberwork' },
  { id: 'T3', name: '향기섬', owner: 'T', at: [8, 18], def: 13, res: ['spice'] },
  { id: 'T4', name: '구리곶', owner: 'T', at: [14, 19], def: 17, res: ['copper'] },
  { id: 'T5', name: '산호섬', owner: 'T', at: [16, 18], def: 21, res: ['rubber'], sea: false }
];

// 땅 모양 (오프셋 좌표 기준 타원 + 사각형)
const LAND = [
  { z: 'N', e: [13, 1.6, 12.5, 3.2] },
  { z: 'C', e: [7.5, 10.5, 6.5, 4.6] },
  { z: 'C', r: [10, 5, 14, 6] },          // 대륙과 북방 사이 땅
  { z: 'K', r: [15, 6, 17, 11] }, { z: 'K', r: [14, 6, 14, 7] },
  { z: 'K', r: [18, 13, 18, 13] },        // 반도 앞바다 섬
  { z: 'K', r: [11, 6, 13, 6] },          // 솔바람재 고개 (반도 북서쪽 땅)
  { z: 'J', e: [21.3, 9, 1.4, 3.3] }, { z: 'J', r: [24, 13, 24, 13] },
  { z: 'T', e: [11, 17.6, 5.2, 2.8] }, { z: 'T', r: [15, 18, 16, 19] },
  { z: 'A', e: [28, 10.5, 3.2, 7.2] }
];
const TERRAIN = {
  N: [['tundra', 55], ['forest', 30], ['snow', 10], ['hills', 5]],
  C: [['plains', 45], ['hills', 15], ['forest', 15], ['mountain', 10], ['desert', 15]],
  K: [['mountain', 30], ['hills', 25], ['plains', 30], ['forest', 15]],
  J: [['hills', 30], ['forest', 35], ['plains', 25], ['mountain', 10]],
  T: [['jungle', 55], ['plains', 25], ['hills', 10], ['forest', 10]],
  A: [['plains', 45], ['desert', 20], ['forest', 20], ['hills', 10], ['mountain', 5]]
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export const key = (c, r) => c + ',' + r;
export function neighbors(c, r) {
  const odd = r & 1;
  const d = odd ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d.map(([dc, dr]) => [c + dc, r + dr]).filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H);
}
function toCube(c, r) { const q = c - (r - (r & 1)) / 2; return [q, r, -q - r]; }
export function dist(a, b) { const A = toCube(...a), B = toCube(...b); return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])); }
export function within(c, r, rad) {
  const out = [];
  for (let y = Math.max(0, r - rad); y <= Math.min(H - 1, r + rad); y++) for (let x = Math.max(0, c - rad - 1); x <= Math.min(W - 1, c + rad + 1); x++)
    if (dist([c, r], [x, y]) <= rad) out.push([x, y]);
  return out;
}

export function buildMap(seed = 7) {
  const rand = rng(seed);
  const tiles = {};
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let zone = null;
    for (const L of LAND) {
      if (L.e) { const [cx, cy, rx, ry] = L.e; if (((c - cx) / rx) ** 2 + ((r - cy) / ry) ** 2 <= 1) zone = L.z; }
      else { const [x1, y1, x2, y2] = L.r; if (c >= x1 && c <= x2 && r >= y1 && r <= y2) zone = L.z; }
    }
    let terrain = 'ocean';
    if (zone) {
      const t = TERRAIN[zone]; let roll = rand() * 100;
      terrain = t[t.length - 1][0];
      for (const [name, p] of t) { if (roll < p) { terrain = name; break; } roll -= p; }
    }
    tiles[key(c, r)] = { c, r, zone, terrain, res: null, owner: null, city: null, imp: null };
  }
  // 바다 중 땅 옆은 해안
  for (const t of Object.values(tiles)) if (t.terrain === 'ocean' && neighbors(t.c, t.r).some(([x, y]) => tiles[key(x, y)].zone)) t.terrain = 'coast';

  const land = (c, r) => tiles[key(c, r)] && tiles[key(c, r)].zone;
  // 수도·도시국가 칸은 평원으로, 자원 배치
  const placeRes = (center, list, rad, zone) => {
    for (const res of list) {
      const cand = within(center[0], center[1], rad).filter(([x, y]) => land(x, y) && tiles[key(x, y)].zone === zone && !tiles[key(x, y)].res && !tiles[key(x, y)].city && !(x === center[0] && y === center[1]));
      if (!cand.length) throw new Error('자원 자리 없음 ' + res + ' @' + center);
      const [x, y] = cand[Math.floor(rand() * cand.length)];
      tiles[key(x, y)].res = res;
      if (res === 'oil' && tiles[key(x, y)].terrain === 'mountain') tiles[key(x, y)].terrain = 'plains';
      if (['iron', 'copper', 'aluminum', 'gold', 'uranium'].includes(res) && ['plains', 'tundra', 'jungle', 'desert', 'snow'].includes(tiles[key(x, y)].terrain)) tiles[key(x, y)].terrain = 'hills';
    }
  };
  for (const [id, co] of Object.entries(COUNTRIES)) {
    const [c, r] = co.capital;
    if (!land(c, r)) throw new Error('수도가 바다 ' + id);
    Object.assign(tiles[key(c, r)], { terrain: 'plains', city: id });
    // 수도 주변에 농사지을 평원과 숲을 최소 하나씩 보장
    const ring = within(c, r, 1).filter(([x, y]) => land(x, y) && !(x === c && y === r));
    tiles[key(...ring[0])].terrain = id === 'N' ? 'tundra' : 'plains';
    tiles[key(...ring[1])].terrain = id === 'T' ? 'jungle' : 'forest';
    placeRes(co.capital, co.capitalRes, 2, id);
  }
  for (const cs of CITYSTATES) {
    const [c, r] = cs.at;
    if (!land(c, r)) throw new Error('도시국가가 바다 ' + cs.id);
    if (tiles[key(c, r)].zone !== cs.owner) throw new Error('도시국가가 다른 영역 ' + cs.id);
    Object.assign(tiles[key(c, r)], { terrain: cs.tundra ? 'tundra' : (tiles[key(c, r)].terrain === 'mountain' ? 'hills' : tiles[key(c, r)].terrain), city: cs.id });
    placeRes(cs.at, cs.res, 1, cs.owner);
  }
  return tiles;
}

// 미리보기용 글자 지도
export function ascii(tiles, owners) {
  const ch = { ocean: ' ', coast: '~', plains: '.', grass: ',', hills: 'n', mountain: '^', forest: 'f', jungle: 'j', tundra: '_', snow: '*', desert: ':' };
  const lines = [];
  for (let r = 0; r < H; r++) {
    let s = (r & 1) ? ' ' : '';
    for (let c = 0; c < W; c++) {
      const t = tiles[key(c, r)];
      let x = ch[t.terrain] || '?';
      if (t.res) x = { iron: 'I', copper: 'U', aluminum: 'L', uranium: 'R', gold: 'G', oil: 'O', cotton: 'M', rubber: 'B', spice: 'S', wine: 'V' }[t.res];
      if (t.city) x = t.city.length === 1 ? t.city : '#';
      s += x + ' ';
    }
    lines.push(s);
  }
  return lines.join('\n');
}
