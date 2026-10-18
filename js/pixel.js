// 도트 신발·캐릭터 그리기
(function () {
  const S = window.SPRITES;

  const PALETTE = [
    { id: 'ivory', name: '아이보리', hex: '#F4EBD0' },
    { id: 'black', name: '검정', hex: '#2E2E33' },
    { id: 'red', name: '빨강', hex: '#E04848' },
    { id: 'blue', name: '파랑', hex: '#3B7DDD' },
    { id: 'green', name: '초록', hex: '#3FAF6A' },
    { id: 'purple', name: '보라', hex: '#8E5BD6' },
    { id: 'yellow', name: '노랑', hex: '#F2C230' },
    { id: 'pink', name: '분홍', hex: '#F28DB2' }
  ];

  const TIERS = {
    cheap:       { label: '저가', color: '#9AA0A6' },
    normal:      { label: '일반', color: '#6C8EBF' },
    eco:         { label: '친환경', color: '#4CAF50' },
    premium:     { label: '고급 합성', color: '#C58AF9' },
    eco_premium: { label: '친환경 고급', color: '#2E7D32' }
  };

  const PART_LABEL = { sole: '밑창', body: '몸체', insole: '깔창', lace: '끈·스트랩' };
  const SHAPES = [
    { id: 'lowtop', name: '운동화' },
    { id: 'hightop', name: '하이탑' },
    { id: 'clog', name: '클로그' },
    { id: 'oxford', name: '구두' }
  ];

  // 밑창·깔창은 재료 등급에 따라 색이 정해짐
  const SOLE_COLOR = { cheap: '#5B5F66', normal: '#3A3A40', eco: '#7A5C3E', premium: '#F5F5F5', eco_premium: '#C9B48A' };
  const INSOLE_COLOR = { cheap: '#D9D2C5', normal: '#B98E62', eco: '#8E7A5E', premium: '#7FD3F7', eco_premium: '#B5803F' };

  function hexToRgb(h) {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const shade = (c, t) => t >= 0 ? mix(c, [255, 255, 255], t) : mix(c, [0, 0, 0], -t);
  const grayish = (c, t) => { const g = (c[0] + c[1] + c[2]) / 3; return mix(c, [g, g, g], t); };

  // 재료 무늬 (같은 신발은 항상 같은 무늬)
  function texture(tex, base, x, y) {
    switch (tex) {
      case 'dull': {
        let c = grayish(base, 0.35);
        if ((x * 7 + y * 3) % 11 === 0) c = shade(c, -0.25);
        return c;
      }
      case 'speckle': {
        let c = mix(base, [139, 115, 85], 0.18);
        if ((x + y * 3) % 5 === 0) c = shade(c, 0.22);
        else if ((x * 3 + y) % 7 === 0) c = shade(c, -0.18);
        return c;
      }
      case 'sparkle': {
        let c = shade(base, 0.12);
        if ((x * 5 + y * 7) % 9 === 0) c = [255, 255, 255];
        else if ((x * 3 + y * 5) % 13 === 0) c = [255, 240, 150];
        return c;
      }
      case 'knit': {
        let c = mix(base, [90, 170, 100], 0.15);
        c = ((x + (y % 2)) % 2 === 0) ? shade(c, 0.1) : shade(c, -0.08);
        return c;
      }
      default:
        return base;
    }
  }

  function matOf(materials, id) {
    return (materials || []).find(m => m.id === id) || null;
  }

  // 신발을 canvas에 그림
  function drawShoe(canvas, shoe, materials, scale) {
    const rows = S.shoes[shoe.shape] || S.shoes.lowtop;
    const w = rows[0].length, h = rows.length;
    scale = scale || 4;
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const parts = shoe.parts || {};
    const colors = shoe.colors || {};
    const bodyHex = (PALETTE.find(p => p.id === colors.body) || PALETTE[3]).hex;
    const laceHex = (PALETTE.find(p => p.id === colors.lace) || PALETTE[0]).hex;
    const mSole = matOf(materials, parts.sole), mBody = matOf(materials, parts.body);
    const mIns = matOf(materials, parts.insole), mLace = matOf(materials, parts.lace);
    const at = (x, y) => (y < 0 || y >= h || x < 0 || x >= w) ? '.' : rows[y][x];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        let c;
        if (ch === 'o') c = [24, 24, 28];
        else {
          let base, tex;
          if (ch === 's') { base = hexToRgb(SOLE_COLOR[mSole ? mSole.tier : 'normal']); tex = mSole ? mSole.texture : 'flat'; }
          else if (ch === 'b') { base = hexToRgb(bodyHex); tex = mBody ? mBody.texture : 'flat'; }
          else if (ch === 'i') { base = hexToRgb(INSOLE_COLOR[mIns ? mIns.tier : 'normal']); tex = mIns ? mIns.texture : 'flat'; }
          else if (ch === 'l') { base = hexToRgb(laceHex); tex = mLace ? mLace.texture : 'flat'; }
          else base = [255, 0, 255];
          c = texture(tex, base, x, y);
          // 입체감: 위쪽은 밝게, 아래쪽은 어둡게
          if (at(x, y - 1) === 'o' || at(x, y - 1) === '.') c = shade(c, 0.18);
          else if (at(x, y + 1) === 'o') c = shade(c, -0.15);
        }
        ctx.fillStyle = `rgb(${clamp(c[0])},${clamp(c[1])},${clamp(c[2])})`;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return canvas;
  }

  function shoeDataUrl(shoe, materials, scale) {
    return drawShoe(document.createElement('canvas'), shoe, materials, scale).toDataURL();
  }

  const AV_PAL = {
    boy:  { k: '#1E1E24', h: '#5A3A22', f: '#F6D2AE', e: '#1E1E24', m: '#E58C8C', c: '#3B7DDD', p: '#2F3A5A', w: '#F0F0F0', r: '#EB5A82' },
    girl: { k: '#1E1E24', h: '#7A4A2A', f: '#F6D2AE', e: '#1E1E24', m: '#E58C8C', c: '#F28DB2', p: '#2F3A5A', w: '#F0F0F0', r: '#EB5A82' }
  };

  // 캐릭터: dir = down|up|left|right, frame = 0|1
  function drawAvatar(ctx, kind, px, py, scale, dir, frame) {
    const rows = S.avatars[kind] || S.avatars.boy;
    const pal = AV_PAL[kind] || AV_PAL.boy;
    const w = rows[0].length, h = rows.length;
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      const bob = frame === 1 ? -scale : 0; // 걷기: 한 칸 통통 튀기
      for (let x = 0; x < w; x++) {
        const sx = dir === 'left' ? w - 1 - x : x;
        let ch = row[sx];
        if (ch === '.') continue;
        if (dir === 'up' && (ch === 'f' || ch === 'e' || ch === 'm') && y < 8) ch = 'h';
        ctx.fillStyle = pal[ch] || '#f0f';
        ctx.fillRect(px + x * scale, py + y * scale + bob, scale, scale);
      }
    }
  }

  function avatarDataUrl(kind, scale) {
    const rows = S.avatars[kind] || S.avatars.boy;
    const c = document.createElement('canvas');
    c.width = rows[0].length * scale; c.height = rows.length * scale;
    const ctx = c.getContext('2d');
    drawAvatar(ctx, kind, 0, 0, scale, 'down', 0);
    return c.toDataURL();
  }

  window.Pixel = { PALETTE, TIERS, PART_LABEL, SHAPES, drawShoe, shoeDataUrl, drawAvatar, avatarDataUrl, matOf };
})();
