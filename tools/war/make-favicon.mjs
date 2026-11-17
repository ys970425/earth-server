// myoLab 도트 파비콘 만들기: 16×16 도트 그림(실험 플라스크)을 2배로 키워 32×32 PNG로 저장해요.
// 실행: node tools/war/make-favicon.mjs  → app/war/favicon.png (외부 도구 없이 PNG를 직접 만들어요)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 16, SCALE = 2;
const C = { bg: [27, 34, 48], rim: [226, 184, 92], glass: [60, 76, 104], liq: [61, 220, 132], hi: [155, 245, 193], bub: [255, 240, 184] };
const px = Array.from({ length: N }, () => Array(N).fill('bg'));
const set = (x, y, k) => { if (x >= 0 && x < N && y >= 0 && y < N) px[y][x] = k; };
// 둥근 모서리 테두리 틀
for (let i = 0; i < N; i++) for (const [x, y] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) set(x, y, 'rim');
for (const [x, y] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) set(x, y, 'bg');
// 플라스크: 입구(2줄) → 목(4줄) → 퍼지는 몸통
for (const x of [6, 7, 8, 9]) set(x, 2, 'rim');
for (let y = 3; y <= 6; y++) { set(6, y, 'rim'); set(9, y, 'rim'); set(7, y, 'glass'); set(8, y, 'glass'); }
for (let y = 7; y <= 12; y++) {
  const w = y - 5;                      // 몸통 반폭 2..7 → 위가 좁고 아래가 넓어요
  const l = 8 - Math.min(w, 6), r = 7 + Math.min(w, 6);
  for (let x = l; x <= r; x++) set(x, y, y >= 9 ? 'liq' : 'glass');
  set(l, y, 'rim'); set(r, y, 'rim');
}
for (let x = 2; x <= 13; x++) set(x, 13, 'rim');
set(7, 9, 'hi'); set(8, 9, 'hi'); set(5, 11, 'hi');          // 액체 윗면 반짝임
set(7, 4, 'bub'); set(8, 6, 'bub'); set(9, 8, 'bub');          // 거품

const W = N * SCALE;
const raw = Buffer.alloc((W * 3 + 1) * W);
for (let y = 0; y < W; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = C[px[Math.floor(y / SCALE)][Math.floor(x / SCALE)]];
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../../app/war/favicon.png', import.meta.url), png);
console.log(`app/war/favicon.png 저장: ${W}×${W}, ${png.length} bytes`);
