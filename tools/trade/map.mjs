// 지구 서버 세계 지도 (육각, pointy-top, odd-r 오프셋 좌표 col,row) — 40×28
// 도시국가는 나라 땅 안에 자동으로 흩어 놓고, 수도에서 가까울수록 약하게(맨 앞은 튜토리얼), 먼 곳 1~2개는 철옹성.
export const W = 40, H = 28;

export const COUNTRIES = {
  K: { capital: [20, 11], capitalRes: [] },
  J: { capital: [26, 11], capitalRes: [] },
  C: { capital: [10, 13], capitalRes: ['iron', 'cotton'] },
  A: { capital: [35, 13], capitalRes: ['oil', 'cotton'] },
  N: { capital: [16, 2], capitalRes: ['oil'] },
  T: { capital: [14, 22], capitalRes: ['spice'] }
};

// 땅 모양 (뒤에 오는 것이 앞의 것을 덮음). X는 주인 없는 땅(강한 도시국가·최종 보스)
const LAND = [
  { z: 'N', e: [16.5, 2.2, 15.5, 3.8] },
  { z: 'C', e: [9.5, 13.5, 8, 5.8] },
  { z: 'C', r: [12, 6, 17, 8] },            // 대륙과 북방 사이 땅
  { z: 'K', r: [19, 8, 21, 14] }, { z: 'K', r: [18, 8, 18, 9] }, { z: 'K', r: [16, 7, 17, 7] },
  { z: 'K', r: [23, 17, 23, 17] },          // 반도 앞바다 섬
  { z: 'J', e: [26.5, 11.5, 1.7, 4.2] }, { z: 'J', r: [30, 17, 30, 17] },   // 섬나라 + 앞바다 섬
  { z: 'T', e: [14, 22.5, 6.5, 3.4] }, { z: 'T', r: [19, 24, 20, 25] },
  { z: 'A', e: [35, 13.5, 4, 9] },
  { z: 'X', e: [25.5, 23, 2.6, 1.7] },      // 남쪽 바다 한가운데: 최종 보스 섬
  { z: 'X', e: [31.5, 3.5, 2.6, 1.6] },     // 북동쪽 폭풍 군도
  { z: 'X', e: [2.6, 24, 2, 1.6] }          // 남서쪽 해적 섬
];
const TERRAIN = {
  N: [['tundra', 50], ['forest', 30], ['snow', 12], ['hills', 8]],
  C: [['plains', 42], ['hills', 15], ['forest', 15], ['mountain', 10], ['desert', 18]],
  K: [['mountain', 28], ['hills', 25], ['plains', 32], ['forest', 15]],
  J: [['hills', 30], ['forest', 35], ['plains', 25], ['mountain', 10]],
  T: [['jungle', 55], ['plains', 25], ['hills', 10], ['forest', 10]],
  A: [['plains', 45], ['desert', 20], ['forest', 20], ['hills', 10], ['mountain', 5]],
  X: [['hills', 40], ['plains', 30], ['forest', 20], ['mountain', 10]]
};

// 나라별 도시국가 수, 등급(가까운 순), 이름, 자원, 합류 기술
const ZONES = {
  K: { n: 5, tiers: [0, 1, 2, 3, 4], names: ['소나무골', '푸른나루', '솔바람재', '물새섬', '단풍고개', '매화마을', '은하포구'],
       res: [[], [], ['iron'], [], ['copper']], tech: [null, null, 'navigation', 'economics', null] },
  J: { n: 5, tiers: [0, 1, 2, 3, 4], names: ['안개곶', '붉은항', '벚꽃마을', '등대섬', '파도곶', '달빛섬', '소금포구'],
       res: [[], ['copper'], [], [], ['gold']], tech: [null, null, 'navigation', 'economics', null] },
  C: { n: 8, tiers: [0, 1, 1, 2, 2, 3, 3, 4], names: ['황토성', '붉은강', '비단마을', '철산성', '모래성', '옥수마을', '대나무성', '황하나루', '서쪽관문', '만리관'],
       res: [['iron'], ['copper'], ['cotton'], ['aluminum'], ['iron'], ['copper'], ['cotton'], ['aluminum', 'copper']], tech: [null, 'engineering', null, 'gunpowder', null, 'economics', null, 'chipmaking'] },
  A: { n: 8, tiers: [0, 1, 1, 2, 2, 3, 4, 4], names: ['들판마을', '큰강나루', '검은샘', '포도골', '바위성', '은빛고원', '독수리봉', '황금평원', '협곡성'],
       res: [['wine'], ['oil'], ['aluminum'], ['wine', 'uranium'], ['iron'], ['aluminum', 'copper'], ['oil'], ['uranium']], tech: [null, 'engineering', null, 'chipmaking', null, 'combustion', null, null] },
  N: { n: 8, tiers: [0, 1, 1, 2, 2, 3, 4, 4], names: ['눈꽃마을', '얼음항', '금빛골', '자작나무골', '서리성', '북극성', '오로라성', '늑대고개', '백야마을'],
       res: [['oil'], ['gold'], ['aluminum'], ['oil'], ['uranium'], ['gold', 'aluminum'], ['oil'], ['uranium']], tech: [null, 'chivalry', null, 'steelmaking', null, 'chipmaking', null, null] },
  T: { n: 7, tiers: [0, 1, 1, 2, 2, 3, 4], names: ['야자마을', '고무나무골', '향기섬', '구리곶', '산호섬', '망고나루', '코코넛만', '맹그로브숲'],
       res: [['rubber'], ['spice'], ['copper'], ['rubber'], ['cotton'], ['copper', 'spice'], ['gold']], tech: [null, 'navigation', null, 'economics', null, 'economics', null] }
};
// 주인 없는 땅의 도시국가 (누구나 차지할 수 있고, 최종 보스는 여러 나라가 힘을 합쳐야 해요)
const NEUTRAL = [
  { id: 'X1', name: '잊힌 제국 아르카', at: [25, 23], tier: 5, res: ['gold', 'uranium', 'aluminum'], boss: true },
  { id: 'X2', name: '수호자의 탑', at: [27, 22], tier: 4, res: [] },
  { id: 'X3', name: '폭풍섬', at: [31, 3], tier: 3, res: ['aluminum'] },
  { id: 'X4', name: '천둥 요새', at: [33, 4], tier: 4, res: ['uranium'] },
  { id: 'X5', name: '해적만', at: [2, 24], tier: 3, res: ['gold'] }
];

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

export let CITYSTATES = [];

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
  for (const t of Object.values(tiles)) if (t.terrain === 'ocean' && neighbors(t.c, t.r).some(([x, y]) => tiles[key(x, y)].zone)) t.terrain = 'coast';

  const land = (c, r) => tiles[key(c, r)] && tiles[key(c, r)].zone;
  const T = (c, r) => tiles[key(c, r)];
  const placeRes = (center, list, rad, zone) => {
    for (const res of list) {
      let cand = within(center[0], center[1], rad).filter(([x, y]) => land(x, y) && T(x, y).zone === zone && !T(x, y).res && !T(x, y).city && !(x === center[0] && y === center[1]));
      if (!cand.length) cand = within(center[0], center[1], rad + 1).filter(([x, y]) => land(x, y) && !T(x, y).res && !T(x, y).city);
      if (!cand.length) throw new Error('자원 자리 없음 ' + res + ' @' + center);
      const [x, y] = cand[Math.floor(rand() * cand.length)];
      T(x, y).res = res;
      if (res === 'oil' && T(x, y).terrain === 'mountain') T(x, y).terrain = 'plains';
      if (['iron', 'copper', 'aluminum', 'gold', 'uranium'].includes(res) && ['plains', 'tundra', 'jungle', 'desert', 'snow'].includes(T(x, y).terrain)) T(x, y).terrain = 'hills';
      if (['cotton', 'spice', 'wine', 'rubber'].includes(res) && ['mountain', 'snow'].includes(T(x, y).terrain)) T(x, y).terrain = 'plains';
    }
  };
  const flat = (c, r, tundra) => { const t = T(c, r); t.terrain = tundra ? 'tundra' : (['mountain', 'snow'].includes(t.terrain) ? 'hills' : t.terrain); };

  for (const [id, co] of Object.entries(COUNTRIES)) {
    const [c, r] = co.capital;
    if (!land(c, r) || T(c, r).zone !== id) throw new Error('수도 자리 ' + id);
    Object.assign(T(c, r), { terrain: 'plains', city: id });
    const ring = within(c, r, 1).filter(([x, y]) => land(x, y) && !(x === c && y === r));
    T(...ring[0]).terrain = id === 'N' ? 'tundra' : 'plains';
    T(...ring[1]).terrain = id === 'T' ? 'jungle' : 'forest';
    T(...ring[2]).terrain = 'plains';
    placeRes(co.capital, co.capitalRes, 2, id);
  }

  // 도시국가 자리: 튜토리얼은 수도에서 2칸(땅으로 이어진 곳), 나머지는 서로 멀리 떨어지게
  const cs = [];
  const cities = () => [...Object.values(COUNTRIES).map(co => co.capital), ...cs.map(x => x.at)];
  for (const [id, Z] of Object.entries(ZONES)) {
    const cap = COUNTRIES[id].capital;
    const zoneTiles = Object.values(tiles).filter(t => t.zone === id && !t.city).map(t => [t.c, t.r]);
    const landN = ([x, y]) => neighbors(x, y).filter(([a, b]) => land(a, b)).length;
    const tut = zoneTiles.filter(p => dist(p, cap) === 2).sort((a, b) => landN(b) - landN(a))[0];
    if (!tut) throw new Error('튜토리얼 자리 없음 ' + id);
    const picked = [tut];
    while (picked.length < Z.n) {
      const all = [...cities(), ...picked];
      let best = null, bestD = -1;
      for (const p of zoneTiles) {
        if (picked.some(q => q[0] === p[0] && q[1] === p[1])) continue;
        if (dist(p, cap) < 3) continue;
        const d = Math.min(...all.map(q => dist(p, q))) + rand() * 0.6;
        if (d > bestD) { bestD = d; best = p; }
      }
      if (!best || bestD < 2) throw new Error('도시국가 자리 부족 ' + id);
      picked.push(best);
    }
    // 수도에서 가까운 순 → 약한 순
    const order = [picked[0], ...picked.slice(1).sort((a, b) => dist(a, cap) - dist(b, cap))];
    order.forEach((at, i) => {
      const sea = neighbors(...at).every(([x, y]) => !land(x, y) || T(x, y).zone !== id || dist([x, y], cap) > 20) && false;
      cs.push({ id: id + (i + 1), name: Z.names[i], owner: id, at, tier: Z.tiers[i], res: Z.res[i] || [], tech: Z.tech[i] || null, tutorial: i === 0,
        island: !landPath(tiles, cap, at) });
    });
  }
  for (const x of NEUTRAL) cs.push({ ...x, owner: 'X', tech: null, island: true });
  for (const x of cs) {
    const [c, r] = x.at;
    if (!land(c, r)) throw new Error('도시국가가 바다 ' + x.id);
    flat(c, r, x.owner === 'N'); T(c, r).city = x.id;
  }
  for (const x of cs) placeRes(x.at, x.res, x.boss ? 2 : 1, x.owner);
  CITYSTATES = cs;
  return tiles;
}

// 수도에서 땅으로만 걸어서 갈 수 있는지
function landPath(tiles, from, to) {
  const seen = new Set([key(...from)]); const q = [from];
  while (q.length) {
    const [c, r] = q.shift();
    if (c === to[0] && r === to[1]) return true;
    for (const [x, y] of neighbors(c, r)) { const k = key(x, y); if (seen.has(k) || !tiles[k].zone) continue; seen.add(k); q.push([x, y]); }
  }
  return false;
}

// 미리보기용 글자 지도
export function ascii(tiles) {
  const ch = { ocean: ' ', coast: '~', plains: '.', hills: 'n', mountain: '^', forest: 'f', jungle: 'j', tundra: '_', snow: '*', desert: ':' };
  const lines = [];
  for (let r = 0; r < H; r++) {
    let s = (r & 1) ? ' ' : '';
    for (let c = 0; c < W; c++) {
      const t = tiles[key(c, r)];
      let x = ch[t.terrain] || '?';
      if (t.res) x = { iron: 'I', copper: 'U', aluminum: 'L', uranium: 'R', gold: 'G', oil: 'O', cotton: 'M', rubber: 'B', spice: 'S', wine: 'V' }[t.res];
      if (t.city) { const cs = CITYSTATES.find(z => z.id === t.city); x = cs ? String(cs.tier) : '@'; }
      s += x + ' ';
    }
    lines.push(s);
  }
  return lines.join('\n');
}
