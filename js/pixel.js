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
    cheap:       { label: '저가', color: '#9AA0A6', look: 'plain' },
    shiny:       { label: '반짝', color: '#E866B5', look: 'flashy' },
    normal:      { label: '일반', color: '#6C8EBF', look: 'basic' },
    natural:     { label: '천연', color: '#9C7A45', look: 'natural' },
    eco:         { label: '친환경', color: '#4CAF50', look: 'natural' },
    premium:     { label: '고급 합성', color: '#B57BEA', look: 'flashy' },
    eco_premium: { label: '친환경 고급', color: '#2E7D32', look: 'eco_luxe' },
    limited:     { label: '한정판', color: '#D4961A', look: 'flashy' }
  };

  // 완성 신발의 느낌: 재료 느낌별 점수(몸체 2배)가 가장 높은 것, 같으면 몸체 느낌
  const LOOKS = ['plain', 'basic', 'natural', 'flashy', 'eco_luxe'];
  function shoeLook(parts, materials) {
    const w = { sole: 1, body: 2, insole: 0.5, lace: 1 };
    const score = {}; let bodyLook = 'basic';
    for (const k of Object.keys(w)) {
      const m = matOf(materials, (parts || {})[k]);
      const look = m && TIERS[m.tier] ? TIERS[m.tier].look : 'basic';
      score[look] = (score[look] || 0) + w[k];
      if (k === 'body') bodyLook = look;
    }
    let best = bodyLook;
    for (const l of LOOKS) if ((score[l] || 0) > (score[best] || 0)) best = l;
    return best;
  }

  const PART_LABEL = { sole: '밑창', body: '몸체', insole: '깔창', lace: '끈·포인트' };
  const SHAPES = [
    { id: 'lowtop', name: '운동화' },
    { id: 'hightop', name: '하이탑' },
    { id: 'clog', name: '클로그' },
    { id: 'oxford', name: '구두' }
  ];

  // 밑창·중창·깔창은 재료 등급에 따라 색이 정해짐
  const SOLE_COLOR = { cheap: '#5B5F66', shiny: '#F7A8DA', normal: '#34343A', natural: '#8C6A43', eco: '#7A5C3E', premium: '#E9F4FF', eco_premium: '#B88A52', limited: '#BFE6FF' };
  const TRIM_COLOR = { cheap: '#C9CCD1', shiny: '#FFE3F4', normal: '#F4F1EA', natural: '#EADBC0', eco: '#E6D5B3', premium: '#FFFFFF', eco_premium: '#F1E3BE', limited: '#FFF4C8' };
  const INSOLE_COLOR = { cheap: '#D9D2C5', shiny: '#FF8FCB', normal: '#4A4A52', natural: '#3A3A3A', eco: '#D8C7A3', premium: '#6FC8F5', eco_premium: '#C08A4E', limited: '#F4D35E' };
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
    return { sparkle: n('premium') + n('limited') >= 2, sparkleBig: n('premium') + n('limited') >= 4, leaf: n('eco_premium') >= 2, leafBig: n('eco_premium') >= 4, sprout: n('eco') >= 3 };
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

    const eyelet = mLace && ['premium', 'eco_premium', 'limited'].includes(mLace.tier) ? [232, 197, 71] : [52, 52, 60];
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

  // ---- 완성 신발: 부위 지도(GPT 밑그림) 위에 재료별 색 계단으로 칠하기 ----
  // 지도 PNG: R=부위(1 몸체 2 밑창 3 깔창 4 끈 5 금속·장식자리 6 배지자리 8 외곽선), G=명암, A=투명도
  const TIER_IDX = { cheap: 0, shiny: 1, normal: 2, natural: 3, eco: 4, premium: 5, eco_premium: 6, limited: 7 };
  const PAINT = {
    body: [
      { r: ['#5E5A55', '#76716B', '#8B8780', '#A19C95', '#B9B5AE'], fx: 'stain' },
      { r: ['#7B5CC9', '#9E7FE6', '#C2A8F5', '#E4D6FF', '#FFFFFF'], fx: 'holo' },
      { r: ['#8C97AE', '#AEB8CC', '#CED6E4', '#E9EEF6', '#FFFFFF'], fx: 'mesh', tint: true },
      { r: ['#B5A78C', '#CDBFA4', '#DFD3BC', '#EDE4D2', '#F7F1E4'], fx: 'weave', tint: true },
      { r: ['#A28F72', '#BBA98B', '#D0C1A4', '#E3D7BF', '#F2EAD8'], fx: 'speckle', tint: true },
      { r: ['#5B3A9E', '#7B54C8', '#A07CE6', '#C9B0F7', '#FFFFFF'], fx: 'glitter' },
      { r: ['#6E9C55', '#8DBB6E', '#B6D69B', '#DCEBCB', '#FAFCF5'], fx: 'knit' },
      { r: ['#6B4E10', '#9C7418', '#CFA233', '#EECB6A', '#FFF3C4'], fx: 'metal' }
    ],
    sole: [
      { r: ['#5F5F5C', '#73736F', '#878782', '#9A9A94'], fx: 'stain' },
      { r: ['#E0559A', '#F27DB6', '#FBA7CF', '#FFD2E8'], fx: 'glitter' },
      { r: ['#1E1E22', '#2E2E34', '#46464E', '#62626C'] },
      { r: ['#7A5232', '#966A44', '#B0855A', '#C9A27A'] },
      { r: ['#1E1E22', '#2E2E34', '#3E3E46', '#52525C'], fx: 'confetti' },
      { r: ['#9CC9EE', '#C2E0F7', '#E2F1FC', '#FFFFFF'], fx: 'bubble' },
      { r: ['#A88A5E', '#C2A577', '#D8BF94', '#EAD7B2'], fx: 'leafdot' },
      { r: ['#2F7FD8', '#58A8F0', '#93CDFA', '#D2EEFF'], fx: 'glow' }
    ],
    insole: [
      { r: ['#B3AC9C', '#C9C3B5', '#DCD7CC', '#ECE9E2'], fx: 'holes' },
      { r: ['#E77FB4', '#F4A3CB', '#C6B6F2', '#E7DDFC'], fx: 'holo' },
      { r: ['#2C2C32', '#3C3C44', '#4E4E58', '#62626E'] },
      { r: ['#141416', '#202024', '#2C2C32', '#3A3A42'], fx: 'holes' },
      { r: ['#CDBFA2', '#DED2BA', '#ECE3D2', '#F7F2E8'], fx: 'speckle' },
      { r: ['#1E5FC4', '#3A86E8', '#6FB0F7', '#A8D4FF'], fx: 'hex' },
      { r: ['#8A5A32', '#A8723F', '#C28E58', '#D9AC7A'], fx: 'cork' },
      { r: ['#C9C1E8', '#DCD6F2', '#EEEAFA', '#FFFFFF'] }
    ],
    lace: [
      { r: ['#8E8670', '#A69E86', '#BDB59C', '#D0C9B2'], fx: 'fuzz' },
      { r: ['#E86FAE', '#F59ACB', '#9FD3FF', '#FFFFFF'], fx: 'beads' },
      { r: ['#B9BFCA', '#D6DBE3', '#EDF0F5', '#FFFFFF'] },
      { r: ['#8A6A3E', '#A5834F', '#C09F68', '#D6BA86'], fx: 'twist' },
      { r: ['#A9A07E', '#C3BA98', '#D9D1B2', '#EBE5CC'], fx: 'greendot' },
      { r: ['#FF4FA3', '#FFC23D', '#4FE07A', '#4FC8FF'], fx: 'rainbow' },
      { r: ['#D8CDB0', '#E8DFC6', '#F3EDDD', '#FFFBF2'], fx: 'flower' },
      { r: ['#14142A', '#22223A', '#2E2E48', '#3A3A56'], fx: 'neon' }
    ]
  };
  const SHOE = { maps: {}, meta: null, deco: {} };
  function loadImg(src) { return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }); }
  const ready = (async () => {
    try { SHOE.meta = await (await fetch('img/shoe/meta.json')).json(); } catch (e) { SHOE.meta = { size: 209, shapes: {} }; }
    await Promise.all(SHAPES.map(async sh => {
      const im = await loadImg('img/shoe/' + sh.id + '.png');
      if (!im) return;
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      SHOE.maps[sh.id] = x.getImageData(0, 0, im.width, im.height);
    }));
    const kinds = ['badge', 'charm', 'orn'];
    await Promise.all(kinds.flatMap(k => [0, 1, 2, 3, 4, 5, 6, 7].map(async i => { SHOE.deco[k + i] = await loadImg('img/deco/' + k + i + '.png'); })));
  })();

  const hash = (x, y) => { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const rampOf = hexes => hexes.map(hexToRgb);
  const RAMPS = {};
  function rampPick(r, t) { return r[Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)))]; }
  function tintRamp(hex) {
    if (RAMPS[hex]) return RAMPS[hex];
    const b = hexToRgb(hex);
    return (RAMPS[hex] = [shade(b, -0.45), shade(b, -0.25), b, shade(b, 0.35), shade(b, 0.7)]);
  }
  const HOLO = rampOf(['#FFB3D9', '#C7B3FF', '#A8E6FF', '#B8FFD9', '#FFF2A8']);
  const SILVER = rampOf(['#5A5E66', '#8C929C', '#C4CAD2', '#EEF1F5', '#FFFFFF']);

  function paintPx(spec, ramp, L, x, y) {
    const n = hash(x, y);
    let c;
    switch (spec.fx) {
      case 'holo': {
        const h = ((x * 0.012 + y * 0.02 + L * 0.8) % 1 + 1) % 1;
        c = mix(HOLO[Math.floor(h * 5) % 5], rampPick(ramp, L), 0.45);
        if (L > 0.9) c = [255, 255, 255];
        return c;
      }
      case 'metal': {
        const band = (x * 0.025 + y * 0.04) % 1, sweep = band < 0.5 ? band : 1 - band;
        const t = Math.min(0.999, L * 0.75 + sweep * 0.5);
        c = rampPick(ramp, t);
        if (L > 0.86) c = rampPick(SILVER, 0.99);
        if (n > 0.985) c = [255, 255, 255];
        return c;
      }
      case 'beads': { const cols = [[255, 150, 200], [150, 210, 255], [255, 255, 255]]; return shade(cols[(Math.floor(x / 2) + Math.floor(y / 2)) % 3], (L - 0.6) * 0.5); }
      case 'rainbow': return shade(ramp[Math.floor((x + y) / 3) % 4], (L - 0.6) * 0.5);
      case 'neon': c = rampPick(ramp, L); if ((x + y) % 6 === 0) c = [255, 80, 180]; else if (((x - y) % 6 + 6) % 6 === 0) c = [80, 200, 255]; return c;
    }
    c = rampPick(ramp, L);
    switch (spec.fx) {
      case 'stain': { const b = hash(Math.floor(x / 5), Math.floor(y / 5)); if (b > 0.82) c = mix(c, [128, 104, 64], 0.35); else if (n > 0.97) c = shade(c, -0.18); break; }
      case 'weave': if ((x + y) % 2 === 0) c = shade(c, -0.05); break;
      case 'mesh': if (x % 3 === 0 && y % 3 === 0) c = shade(c, -0.15); break;
      case 'knit': if ((x + (Math.floor(y / 2) % 2)) % 3 === 0) c = shade(c, -0.1); break;
      case 'speckle': if (n > 0.93) c = [[214, 70, 70], [60, 140, 214], [70, 170, 90], [230, 180, 50]][Math.floor(n * 1000) % 4]; break;
      case 'confetti': if (n > 0.84) c = [[230, 80, 80], [80, 160, 240], [90, 200, 110], [245, 210, 70], [240, 240, 240]][Math.floor(n * 1000) % 5]; break;
      case 'glitter': if (n > 0.95) c = [255, 255, 255]; else if (n > 0.9) c = [255, 236, 160]; break;
      case 'glow': if (n > 0.93) c = [230, 250, 255]; break;
      case 'bubble': if (x % 5 === 2 && y % 4 === 1) c = [255, 255, 255]; break;
      case 'leafdot': if (n > 0.92) c = [120, 165, 80]; break;
      case 'holes': if (x % 4 === 0 && y % 4 === 0) c = shade(c, -0.4); break;
      case 'hex': if ((x + 2 * (y % 2)) % 4 === 0) c = shade(c, 0.35); break;
      case 'cork': if (n > 0.65) c = shade(c, -0.18); break;
      case 'fuzz': if (n > 0.9) c = shade(c, 0.25); break;
      case 'twist': if ((x + y) % 3 === 0) c = shade(c, -0.15); break;
      case 'greendot': if (n > 0.88) c = [90, 160, 80]; break;
      case 'flower': if (n > 0.95) c = [255, 160, 190]; break;
    }
    return c;
  }

  const PART_OF = { 1: 'body', 2: 'sole', 3: 'insole', 4: 'lace', 6: 'body' };
  function drawComposite(canvas, shoe, materials) {
    const map = SHOE.maps[shoe.shape] || SHOE.maps.lowtop;
    const N = map ? map.width : 209;
    canvas.width = N; canvas.height = N;
    const ctx = canvas.getContext('2d');
    if (!map) return canvas;
    const parts = shoe.parts || {}, colors = shoe.colors || {};
    const spec = {}, ramp = {};
    for (const part of ['body', 'sole', 'insole', 'lace']) {
      const m = matOf(materials, parts[part]);
      const idx = m && TIER_IDX[m.tier] !== undefined ? TIER_IDX[m.tier] : 2;
      spec[part] = PAINT[part][idx];
      ramp[part] = rampOf(spec[part].r);
      spec[part].idx = idx;
    }
    const bodyHex = (PALETTE.find(p => p.id === colors.body) || {}).hex;
    if (bodyHex && spec.body.tint && colors.body !== 'ivory') ramp.body = tintRamp(bodyHex);
    const isLaceShoe = shoe.shape === 'lowtop' || shoe.shape === 'hightop';
    const lux = spec.lace.idx >= 5;
    const out = ctx.createImageData(N, N), d = map.data, o = out.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      if (d[i + 3] < 128) continue;
      const lab = Math.round(d[i] / 20), L = Math.min(0.999, d[i + 1] / 255);
      let c;
      if (lab === 8) c = [34, 26, 62];
      else if (lab === 5) c = isLaceShoe ? (lux ? rampPick(rampOf(['#8A6510', '#C9971F', '#F2CC5A', '#FFF0B0']), L) : rampPick(rampOf(['#2E2E36', '#45454F', '#60606C', '#7C7C88']), L)) : paintPx(spec.body, ramp.body, L, x, y);
      else { const part = PART_OF[lab] || 'body'; c = paintPx(spec[part], ramp[part], L, x, y); }
      o[i] = clamp(c[0]); o[i + 1] = clamp(c[1]); o[i + 2] = clamp(c[2]); o[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    // 장식: 운동화·하이탑은 옆면 배지(몸체), 클로그는 지비츠, 로퍼는 발등 장식(끈)
    const mt = (SHOE.meta && SHOE.meta.shapes[shoe.shape]) || {};
    ctx.imageSmoothingEnabled = false;
    const put = (img, x, y, px) => { if (img) ctx.drawImage(img, Math.round(x - px / 2), Math.round(y - px / 2), px, px); };
    if (isLaceShoe) (mt.badge || []).forEach(([x, y]) => put(SHOE.deco['badge' + spec.body.idx], x, y, 20));
    else (mt.charm || []).forEach(([x, y]) => put(SHOE.deco[(shoe.shape === 'clog' ? 'charm' : 'orn') + spec.lace.idx], x, y, 24));
    return canvas;
  }

  const urlCache = new Map();
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  function shoeDataUrl(shoe, materials) {
    if (!Object.keys(SHOE.maps).length) return BLANK;
    const key = [shoe.shape, JSON.stringify(shoe.colors || {}), JSON.stringify(shoe.parts || {})].join('|');
    if (urlCache.has(key)) return urlCache.get(key);
    const u = drawComposite(document.createElement('canvas'), shoe, materials).toDataURL();
    if (urlCache.size > 500) urlCache.clear();
    urlCache.set(key, u);
    return u;
  }
  function shoeArt(shoe, materials, cls) {
    const el = document.createElement('div');
    el.className = 'shoe-art' + (cls ? ' ' + cls : '');
    const img = new Image(); img.alt = '신발'; img.draggable = false;
    img.src = shoeDataUrl(shoe, materials);
    if (img.src === BLANK) ready.then(() => { img.src = shoeDataUrl(shoe, materials); });
    el.appendChild(img);
    return el;
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

  window.Pixel = { PALETTE, TIERS, LOOKS, PART_LABEL, SHAPES, drawShoe, drawComposite, shoeDataUrl, shoeArt, shoeParts, shoeLook, drawAvatar, avatarDataUrl, matOf, auraOf, ready };
})();
