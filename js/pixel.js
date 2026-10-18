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

  const PART_LABEL = { sole: '밑창', body: '몸체', insole: '깔창', lace: '끈·포인트' };
  const SHAPES = [
    { id: 'lowtop', name: '운동화' },
    { id: 'hightop', name: '하이탑' },
    { id: 'clog', name: '클로그' },
    { id: 'oxford', name: '구두' }
  ];

  // 밑창·중창·깔창은 재료 등급에 따라 색이 정해짐
  const SOLE_COLOR = { cheap: '#5B5F66', normal: '#34343A', eco: '#7A5C3E', premium: '#E9F4FF', eco_premium: '#B88A52' };
  const TRIM_COLOR = { cheap: '#C9CCD1', normal: '#F4F1EA', eco: '#E6D5B3', premium: '#FFFFFF', eco_premium: '#F1E3BE' };
  const INSOLE_COLOR = { cheap: '#D9D2C5', normal: '#4A4A52', eco: '#D8C7A3', premium: '#6FC8F5', eco_premium: '#C08A4E' };
  const PAD_X = 6, PAD_Y = 5; // 반짝이·잎 효과가 들어갈 여백

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
        let c = grayish(base, 0.4);
        if ((x * 7 + y * 3) % 11 === 0) c = shade(c, -0.22);
        return c;
      }
      case 'speckle': {
        let c = mix(base, [150, 125, 92], 0.14);
        if ((x + y * 3) % 5 === 0) c = shade(c, 0.24);
        else if ((x * 3 + y) % 7 === 0) c = shade(c, -0.16);
        return c;
      }
      case 'sparkle': {
        let c = shade(base, 0.1);
        const k = (x * 5 + y * 7) % 13;
        if (k === 0) c = [255, 255, 255];
        else if (k === 6) c = mix(c, [170, 120, 255], 0.35);
        else if (k === 9) c = mix(c, [110, 220, 255], 0.35);
        return c;
      }
      case 'knit': {
        let c = mix(base, [120, 175, 110], 0.12);
        c = ((x + (y % 2)) % 2 === 0) ? shade(c, 0.1) : shade(c, -0.07);
        return c;
      }
      default:
        return base;
    }
  }

  function matOf(materials, id) {
    return (materials || []).find(m => m.id === id) || null;
  }

  // 재료 등급 → 신발 등급 효과
  function auraOf(ms) {
    const n = t => ms.filter(m => m && m.tier === t).length;
    return { sparkle: n('premium') >= 2, sparkleBig: n('premium') >= 4, leaf: n('eco_premium') >= 2, leafBig: n('eco_premium') >= 4, sprout: n('eco') >= 3 };
  }

  const SPARK = ['..w..', '..w..', 'wwWww', '..w..', '..w..'];
  const SPARK_S = ['.w.', 'wWw', '.w.'];
  const LEAF = ['..gg', '.gGg', 'gGg.', 'gg..'];

  function stamp(put, pat, x0, y0, pal) {
    pat.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') put(x0 + x, y0 + y, pal[ch]); }));
  }

  // 신발을 canvas에 그림 (가장자리 여백 포함)
  function drawShoe(canvas, shoe, materials, scale) {
    const rows = S.shoes[shoe.shape] || S.shoes.lowtop;
    const w = rows[0].length, h = rows.length;
    const CW = w + PAD_X * 2, CH = h + PAD_Y * 2;
    scale = scale || 4;
    canvas.width = CW * scale; canvas.height = CH * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const put = (x, y, c, a) => {
      if (x < 0 || y < 0 || x >= CW || y >= CH) return;
      ctx.fillStyle = a === undefined ? `rgb(${clamp(c[0])},${clamp(c[1])},${clamp(c[2])})` : `rgba(${clamp(c[0])},${clamp(c[1])},${clamp(c[2])},${a})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    };
    const parts = shoe.parts || {};
    const colors = shoe.colors || {};
    const bodyRgb = hexToRgb((PALETTE.find(p => p.id === colors.body) || PALETTE[3]).hex);
    const laceRgb = hexToRgb((PALETTE.find(p => p.id === colors.lace) || PALETTE[0]).hex);
    const mSole = matOf(materials, parts.sole), mBody = matOf(materials, parts.body);
    const mIns = matOf(materials, parts.insole), mLace = matOf(materials, parts.lace);
    const fx = auraOf([mSole, mBody, mIns, mLace]);
    const at = (x, y) => (y < 0 || y >= h || x < 0 || x >= w) ? '.' : rows[y][x];
    const solid = (x, y) => at(x, y) !== '.';

    // 바닥 그림자
    let minX = w, maxX = 0;
    rows.forEach(r => { for (let x = 0; x < w; x++) if (r[x] !== '.') { minX = Math.min(minX, x); maxX = Math.max(maxX, x); } });
    let bottom = 0; rows.forEach((r, y) => { if (r.includes('o')) bottom = y; });
    for (let x = minX + 2; x <= maxX - 2; x++) put(x + PAD_X, bottom + PAD_Y + 1, [20, 20, 40], 0.22);
    for (let x = minX + 5; x <= maxX - 5; x++) put(x + PAD_X, bottom + PAD_Y + 2, [20, 20, 40], 0.12);

    // 고급 재료 후광
    if (fx.sparkle || fx.leaf) {
      const glow = fx.leaf && !fx.sparkle ? [255, 214, 90] : fx.leaf ? [190, 255, 170] : [130, 210, 255];
      for (let y = -2; y < h + 2; y++) for (let x = -2; x < w + 2; x++) {
        if (solid(x, y)) continue;
        let d = 9;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (solid(x + dx, y + dy)) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
        if (d === 1) put(x + PAD_X, y + PAD_Y, glow, 0.55);
        else if (d === 2) put(x + PAD_X, y + PAD_Y, glow, 0.22);
      }
    }

    const eyelet = mLace && (mLace.tier === 'premium' || mLace.tier === 'eco_premium') ? [232, 197, 71] : [52, 52, 60];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        let c;
        if (ch === 'o') c = [28, 24, 40];
        else if (ch === 'e') c = eyelet;
        else {
          let base, tex;
          if (ch === 's') { base = hexToRgb(SOLE_COLOR[mSole ? mSole.tier : 'normal']); tex = mSole ? mSole.texture : 'flat'; }
          else if (ch === 't') { base = hexToRgb(TRIM_COLOR[mSole ? mSole.tier : 'normal']); tex = mSole ? mSole.texture : 'flat'; }
          else if (ch === 'b') { base = bodyRgb; tex = mBody ? mBody.texture : 'flat'; }
          else if (ch === 'p') { base = shade(bodyRgb, -0.22); tex = mBody ? mBody.texture : 'flat'; }
          else if (ch === 'i') { base = hexToRgb(INSOLE_COLOR[mIns ? mIns.tier : 'normal']); tex = mIns ? mIns.texture : 'flat'; }
          else if (ch === 'l') { base = laceRgb; tex = mLace ? mLace.texture : 'flat'; }
          else base = [255, 0, 255];
          c = texture(tex, base, x, y);
          // 입체감: 위는 밝게, 아래·경계는 어둡게
          const up = at(x, y - 1), dn = at(x, y + 1);
          if (up === 'o' || up === '.') c = shade(c, 0.22);
          else if (up !== ch && up !== 'e') c = shade(c, 0.08);
          if (dn === 'o') c = shade(c, -0.14);
          else if (dn !== ch && dn !== '.' && dn !== 'e' && ch !== 'l') c = shade(c, -0.1);
        }
        put(x + PAD_X, y + PAD_Y, c);
      }
    }

    // 반짝이·잎 장식 (같은 신발은 같은 자리)
    const W2 = '#FFFFFF', Y2 = [255, 236, 140];
    if (fx.sparkle) {
      const pal = { w: hexToRgb('#BFEAFF'), W: hexToRgb(W2) };
      stamp(put, SPARK, PAD_X - 4, PAD_Y + 1, pal);
      stamp(put, SPARK_S, PAD_X + w - 6, PAD_Y + 4, pal);
      stamp(put, SPARK_S, PAD_X + 24, 0, pal);
      if (fx.sparkleBig) { stamp(put, SPARK, PAD_X + w - 1, PAD_Y + 10, { w: Y2, W: hexToRgb(W2) }); stamp(put, SPARK_S, PAD_X + 2, PAD_Y + 16, { w: Y2, W: hexToRgb(W2) }); }
    }
    if (fx.leaf) {
      const pal = { g: [74, 160, 70], G: [140, 214, 100] };
      stamp(put, LEAF, PAD_X - 5, PAD_Y + 8, pal);
      stamp(put, LEAF, PAD_X + w + 1, PAD_Y + 2, pal);
      stamp(put, SPARK_S, PAD_X + 30, 1, { w: Y2, W: hexToRgb(W2) });
      if (fx.leafBig) { stamp(put, LEAF, PAD_X + 14, 0, pal); stamp(put, SPARK, PAD_X + w - 2, PAD_Y + 12, { w: Y2, W: hexToRgb(W2) }); }
    } else if (fx.sprout) {
      stamp(put, ['.g', 'gG', 'G.'], PAD_X + w - 2, PAD_Y + 6, { g: [74, 160, 70], G: [120, 200, 90] });
    }
    return canvas;
  }

  const urlCache = new Map();
  function shoeDataUrl(shoe, materials, scale) {
    const key = [shoe.shape, JSON.stringify(shoe.colors || {}), JSON.stringify(shoe.parts || {}), scale].join('|');
    if (urlCache.has(key)) return urlCache.get(key);
    const u = drawShoe(document.createElement('canvas'), shoe, materials, scale).toDataURL();
    if (urlCache.size > 400) urlCache.clear();
    urlCache.set(key, u);
    return u;
  }

  // 신발 설명(재료 목록)
  function shoeParts(shoe, materials) {
    return ['sole', 'body', 'insole', 'lace'].map(k => ({ part: k, label: PART_LABEL[k], mat: matOf(materials, (shoe.parts || {})[k]) }));
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

  window.Pixel = { PALETTE, TIERS, PART_LABEL, SHAPES, drawShoe, shoeDataUrl, shoeParts, drawAvatar, avatarDataUrl, matOf, auraOf };
})();
