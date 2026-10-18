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

  // ---- 완성 신발: GPT가 그린 몸체 8종(모양별) + 밑창·깔창·끈 자리를 재료 색으로 칠하기 ----
  // 지도 PNG: R=부위×40 (2 밑창, 3 깔창, 4 끈, 5 끈구멍·장식 자리), G=명암, A=칠할 곳
  const TIER_IDX = { cheap: 0, shiny: 1, normal: 2, natural: 3, eco: 4, premium: 5, eco_premium: 6, limited: 7 };
  const RAMP = {
    sole: [
      ['#55575B', '#6A6C70', '#808286', '#96989B', '#ABADB0'],
      ['#D8478E', '#EC6AA8', '#F58FC0', '#FBB6D7', '#FFDDEE'],
      ['#1B1B20', '#26262C', '#33333A', '#45454D', '#5C5C66'],
      ['#6E4A2C', '#83593A', '#9A6C48', '#B3845C', '#C99E76'],
      ['#1B1B20', '#26262C', '#33333A', '#45454D', '#5C5C66'],
      ['#B9D3EA', '#CFE2F2', '#E2EEF8', '#F1F7FC', '#FFFFFF'],
      ['#B79A6B', '#C7AB7E', '#D6BD93', '#E3CFA9', '#EFDFC0'],
      ['#3D7FC4', '#5C9BDA', '#83B9EB', '#AED4F6', '#DDEFFF']
    ],
    insole: [
      ['#A9A291', '#BDB6A6', '#CEC8BA', '#DEDAD0', '#ECE9E2'],
      ['#E77FB4', '#EE98C3', '#F4B2D3', '#F9CCE2', '#FDE6F1'],
      ['#2E2E35', '#3A3A42', '#47474F', '#55555E', '#64646E'],
      ['#1C1C1F', '#26262A', '#303035', '#3B3B41', '#47474E'],
      ['#C9BB9C', '#D5C9AE', '#E1D7C1', '#ECE5D4', '#F6F1E6'],
      ['#2A63B8', '#3B78CC', '#5590DD', '#76AAEA', '#9CC4F4'],
      ['#8E5E34', '#A06D40', '#B47F4F', '#C79462', '#D8AA79'],
      ['#CFC8EA', '#DBD6F0', '#E6E2F5', '#F1EFFA', '#FBFAFE']
    ],
    lace: [
      ['#8A826B', '#9C947D', '#AFA790', '#C1BAA3', '#D2CCB6'],
      ['#E86FAE', '#F08CBF', '#F7AAD1', '#FCC8E2', '#FFE4F1'],
      ['#B4BBC6', '#C9CFD8', '#DCE1E8', '#EDF0F4', '#FFFFFF'],
      ['#7E613A', '#927247', '#A78556', '#BB9968', '#CFAE7E'],
      ['#A69D7D', '#B7AF91', '#C8C1A6', '#D9D3BC', '#E9E5D3'],
      ['#3B2A6E', '#4E3A8C', '#6650AD', '#8670C8', '#AA98DE'],
      ['#CDBF9C', '#D9CDB0', '#E4DAC3', '#EEE7D6', '#F8F4EA'],
      ['#1D1F2E', '#272A3D', '#33374E', '#40455F', '#4E5471']
    ]
  };
  const SHOE = { art: {}, map: {}, meta: null, deco: {} };
  function loadImg(src) { return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }); }
  const ready = (async () => {
    try { SHOE.meta = await (await fetch('img/shoe/meta.json')).json(); } catch (e) { SHOE.meta = null; }
    await Promise.all(SHAPES.map(async sh => {
      const [art, map] = await Promise.all([loadImg('img/shoe/' + sh.id + '-art.webp'), loadImg('img/shoe/' + sh.id + '-map.png')]);
      if (!art || !map) return;
      SHOE.art[sh.id] = art;
      const c = document.createElement('canvas'); c.width = map.width; c.height = map.height;
      const x = c.getContext('2d'); x.drawImage(map, 0, 0);
      SHOE.map[sh.id] = x.getImageData(0, 0, map.width, map.height);
    }));
    await Promise.all(['charm', 'orn'].flatMap(k => [0, 1, 2, 3, 4, 5, 6, 7].map(async i => { SHOE.deco[k + i] = await loadImg('img/deco/' + k + i + '.png'); })));
  })();

  const hash = (x, y) => { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const rampCache = {};
  const rampRgb = hexes => rampCache[hexes.join()] || (rampCache[hexes.join()] = hexes.map(hexToRgb));
  const step = (r, L) => r[Math.max(0, Math.min(r.length - 1, Math.floor(L * r.length)))];

  // 부위 하나의 한 칸 색 (무늬는 아주 드물게만)
  function partColor(part, idx, L, x, y) {
    const r = rampRgb(RAMP[part][idx]);
    let c = step(r, L);
    const n = hash(x, y);
    if (part === 'sole') {
      if (idx === 1 && n > 0.975) c = [255, 255, 255];                       // 젤리 반짝이
      if (idx === 4 && n > 0.94) c = [[226, 84, 84], [84, 156, 232], [96, 196, 112], [240, 204, 80]][Math.floor(n * 997) % 4]; // 재활용 알갱이
      if (idx === 7 && L > 0.55 && (x + y) % 9 === 0) c = [255, 255, 255];    // 에어 창 빛
    } else if (part === 'lace') {
      if (idx === 1) c = shade([[255, 140, 196], [140, 206, 255], [255, 255, 255]][Math.floor((x + y) / 3) % 3], (L - 0.6) * 0.5); // 구슬
      if (idx === 4 && n > 0.9) c = [96, 158, 84];                            // 초록 점
      if (idx === 5) c = shade([[255, 92, 168], [255, 196, 70], [86, 220, 130], [80, 196, 255]][Math.floor((x + y) / 4) % 4], (L - 0.6) * 0.4); // 형광
      if (idx === 7 && ((x + y) % 5 === 0 || ((x - y) % 5 + 5) % 5 === 0)) c = ((x + y) % 10 === 0) ? [255, 90, 190] : [90, 210, 255]; // LED
    } else if (part === 'insole') {
      if (idx === 0 && x % 4 === 0 && y % 3 === 0) c = shade(c, -0.25);       // 스펀지 구멍
      if (idx === 6 && n > 0.7) c = shade(c, -0.12);                          // 코르크
    }
    return c;
  }

  function idxOf(materials, id) { const m = matOf(materials, id); return m && TIER_IDX[m.tier] !== undefined ? TIER_IDX[m.tier] : 2; }

  function drawComposite(canvas, shoe, materials) {
    const shape = SHOE.art[shoe.shape] ? shoe.shape : 'lowtop';
    const art = SHOE.art[shape], map = SHOE.map[shape], meta = SHOE.meta;
    const [CW, CH] = meta ? meta.cell : [221, 236];
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');
    if (!art || !map) return canvas;
    const parts = shoe.parts || {};
    const bi = idxOf(materials, parts.body), si = idxOf(materials, parts.sole), ii = idxOf(materials, parts.insole), li = idxOf(materials, parts.lace);
    ctx.drawImage(art, bi * CW, 0, CW, CH, 0, 0, CW, CH);
    const img = ctx.getImageData(0, 0, CW, CH), o = img.data, d = map.data, MW = map.width;
    const isLaceShoe = shape === 'lowtop' || shape === 'hightop';
    const metal = rampRgb(li >= 5 ? ['#8A6A20', '#B08A32', '#D4AE52', '#EDD08A', '#FFF0C8'] : ['#5C5E66', '#787B84', '#969AA3', '#B6BAC2', '#D8DBE0']);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const mi = (y * MW + bi * CW + x) * 4;
      if (d[mi + 3] < 128) continue;
      const lab = Math.round(d[mi] / 40), L = Math.min(0.999, d[mi + 1] / 255);
      let c;
      if (lab === 2) c = partColor('sole', si, L, x, y);
      else if (lab === 3) c = partColor('insole', ii, L, x, y);
      else if (lab === 4) c = partColor('lace', li, L, x, y);
      else if (lab === 5) c = step(metal, L);
      else continue;
      const k = (y * CW + x) * 4;
      o[k] = clamp(c[0]); o[k + 1] = clamp(c[1]); o[k + 2] = clamp(c[2]);
    }
    ctx.putImageData(img, 0, 0);
    // 끈 대신: 클로그는 지비츠, 로퍼는 발등 장식
    if (!isLaceShoe && meta) {
      const all = meta.shapes[shape].spots;
      const spots = (all[bi] && all[bi].length ? all[bi] : all.find(s => s.length) || []);
      const deco = SHOE.deco[(shape === 'clog' ? 'charm' : 'orn') + li];
      const px = shape === 'clog' ? 38 : 30;
      if (deco) spots.forEach(([x, y]) => ctx.drawImage(deco, Math.round(x - px / 2), Math.round(y - px / 2), px, px));
    }
    return canvas;
  }

  const urlCache = new Map();
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  function shoeDataUrl(shoe, materials) {
    if (!Object.keys(SHOE.art).length) return BLANK;
    const key = [shoe.shape, JSON.stringify(shoe.parts || {})].join('|');
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
