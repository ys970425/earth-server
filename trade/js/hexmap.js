// 육각 지도 그리기 (pointy-top, odd-r). 학생 화면과 전자칠판이 같이 씀
(function () {
  const R = window.RULES;
  const TW = 128, SIDE = TW / Math.sqrt(3), ROW = SIDE * 1.5, HALF_H = SIDE;   // 칸 가로 128, 위아래 꼭짓점 사이 148
  const BAND = 4;   // 흙 두께

  // ---------- 그림 불러오기 ----------
  const IMG = {};
  function load(key, src) {
    return new Promise(res => { const im = new Image(); im.onload = () => { IMG[key] = im; res(); }; im.onerror = () => res(); im.src = src; });
  }
  const ready = Promise.all([
    document.fonts ? document.fonts.load('700 16px Galmuri11').catch(() => null) : null,
    ...Object.keys(R.TERRAIN).map(t => load('t:' + t, 'img/terrain/' + t + '.png')),
    ...Object.keys(R.ITEMS).map(i => load('r:' + i, 'img/res/' + i + '.png')),
    ...['worker', 'scout', 'spear', 'catapult', 'ballista', 'ship', 'knight', 'archer', 'artillery', 'swordsman', 'infantry', 'tank', 'cannon', 'trireme', 'frigate', 'warship', 'cruiser', 'boat'].map(u => load('u:' + u, 'img/unit/' + u + '.png')),
    // 나라 색 병력 (K는 원래 파랑)
    ...['worker', 'scout', 'spear', 'catapult', 'ballista', 'ship', 'artillery', 'knight', 'swordsman', 'cannon', 'trireme', 'frigate', 'warship', 'cruiser', 'boat'].flatMap(u => ['J', 'C', 'A', 'N', 'T'].map(t => load('u:' + u + '_' + t, 'img/unit/' + u + '_' + t + '.png'))),
    ...['K', 'J', 'C', 'A', 'N', 'T'].map(t => load('u:boss_' + t, 'img/unit/boss_' + t + '.png')),   // 특수 부대 (나라마다 하나)
    ...['capital', 'port', 'farm', 'lumber', 'mine', 'market', 'barracks', 'steelworks'].map(b => load('b:' + b, 'img/bld/' + b + '.png')),
    ...Object.entries(R.CITY_ART).map(([k, f]) => load('c:' + k, 'img/city/' + f + '.png'))
  ]);

  // ---------- 좌표 ----------
  const W = R.W, H = R.H;
  const tc = id => id % W, tr = id => Math.floor(id / W);
  function center(id) { const c = tc(id), r = tr(id); return [c * TW + (r & 1) * TW / 2 + TW / 2, r * ROW + HALF_H]; }
  function neighbors(id) {
    const c = tc(id), r = tr(id), odd = r & 1;
    // 순서: 동, 북동, 북서, 서, 남서, 남동 (변 번호와 같음)
    const d = odd ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]] : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
    return d.map(([dc, dr]) => { const x = c + dc, y = r + dr; return x >= 0 && y >= 0 && x < W && y < H ? y * W + x : -1; });
  }
  function hexDist(a, b) {
    const cube = id => { const c = tc(id), r = tr(id); const q = c - (r - (r & 1)) / 2; return [q, r, -q - r]; };
    const A = cube(a), B = cube(b);
    return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
  }
  // 꼭짓점 (pointy-top): 각도 -90, -30, 30, 90, 150, 210
  const ANG = [-90, -30, 30, 90, 150, 210].map(a => a * Math.PI / 180);
  function hexPath(ctx, x, y, s) { s = s || SIDE; ctx.beginPath(); ANG.forEach((a, i) => { const px = x + s * Math.cos(a), py = y + s * Math.sin(a); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
  // 변 k (동=0, 북동=1, 북서=2, 서=3, 남서=4, 남동=5)의 두 꼭짓점 번호
  const EDGE = [[1, 2], [0, 1], [5, 0], [4, 5], [3, 4], [2, 3]];

  // 길찾기 (BFS, 통과 가능한 칸만)
  function path(from, to, passable, maxLen) {
    if (from === to) return [];
    const prev = new Map([[from, -1]]); const q = [from];
    while (q.length) {
      const cur = q.shift();
      for (const n of neighbors(cur)) {
        if (n < 0 || prev.has(n) || !passable(n)) continue;
        prev.set(n, cur);
        if (n === to) { const p = []; for (let x = to; x !== from; x = prev.get(x)) p.unshift(x); return maxLen && p.length > maxLen ? null : p; }
        q.push(n);
      }
    }
    return null;
  }
  function reachable(from, passable, maxLen) {
    const dist = new Map([[from, 0]]); const q = [from];
    while (q.length) { const cur = q.shift(); const d = dist.get(cur); if (d >= maxLen) continue;
      for (const n of neighbors(cur)) { if (n < 0 || dist.has(n) || !passable(n)) continue; dist.set(n, d + 1); q.push(n); } }
    dist.delete(from); return dist;
  }

  // ---------- 지도 객체 ----------
  function create(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const st = {
      tiles: new Map(), cities: [], units: [], countries: {}, me: null, all: false,
      sel: null, hint: new Set(), atk: new Set(), pathPrev: [], fx: [], cam: { x: 0, y: 0, z: 0.5 }, flags: {}
    };
    let dirty = true, raf = 0;
    const worldW = W * TW + TW / 2, worldH = (H - 1) * ROW + 2 * HALF_H + BAND;

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(10, Math.round(r.width * dpr)); canvas.height = Math.max(10, Math.round(r.height * dpr));
      st.dpr = dpr; clampCam(); mark();
    }
    function clampCam() {
      const vw = canvas.width / st.dpr / st.cam.z, vh = canvas.height / st.dpr / st.cam.z;
      st.cam.x = Math.max(-vw * 0.3, Math.min(worldW - vw * 0.7, st.cam.x));
      st.cam.y = Math.max(-vh * 0.3, Math.min(worldH - vh * 0.7, st.cam.y));
    }
    function mark() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
    function frame(t) {
      raf = 0;
      if (dirty || st.fx.length) { dirty = false; draw(t); }
      if (st.fx.length) raf = requestAnimationFrame(frame);
    }
    const toWorld = (sx, sy) => [sx / st.cam.z + st.cam.x, sy / st.cam.z + st.cam.y];
    function pick(sx, sy) {
      const [x, y] = toWorld(sx, sy);
      const r0 = Math.round((y - HALF_H) / ROW);
      let best = -1, bd = 1e9;
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        if (r < 0 || r >= H) continue;
        const c0 = Math.round((x - (r & 1) * TW / 2 - TW / 2) / TW);
        for (let c = c0 - 1; c <= c0 + 1; c++) {
          if (c < 0 || c >= W) continue;
          const id = r * W + c, [cx, cy] = center(id), d = (cx - x) ** 2 + (cy - y) ** 2;
          if (d < bd) { bd = d; best = id; }
        }
      }
      return bd <= SIDE * SIDE ? best : -1;
    }
    const visible = id => st.all || st.tiles.has(id);
    const colorOf = c => (st.countries[c] && st.countries[c].color) || '#888';

    function drawImgBottom(im, cx, by, w) {
      if (!im) return;
      const h = im.height * w / im.width;
      ctx.drawImage(im, cx - w / 2, by - h, w, h);
    }
    // 이름판: 나라 색 바탕 + 어두운 테두리 + 금색 속선 (도트 게임 느낌의 각진 판)
    function plate(px, py, w, hh, fill, gold) {
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px + 2, py + 3, w, hh);
      ctx.fillStyle = '#1B130A'; ctx.fillRect(px - 2, py - 2, w + 4, hh + 4);
      ctx.fillStyle = fill; ctx.fillRect(px, py, w, hh);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(px, py, w, Math.max(2, hh * 0.18));
      ctx.strokeStyle = gold ? '#E2B85C' : 'rgba(255,230,170,.45)'; ctx.lineWidth = gold ? 2 : 1.5; ctx.strokeRect(px + 2, py + 2, w - 4, hh - 4);
    }
    function hpBar(px, py, w, hh, k) {
      k = Math.max(0, Math.min(1, k));
      ctx.fillStyle = '#120C06'; ctx.fillRect(px - 1, py - 1, w + 2, hh + 2);
      ctx.fillStyle = '#3A2A20'; ctx.fillRect(px, py, w, hh);
      ctx.fillStyle = k > 0.6 ? '#4FD06A' : k > 0.3 ? '#F2B530' : '#E8443C'; ctx.fillRect(px, py, w * k, hh);
    }
    function drawImgAnchor(im, cx, cy, w) {
      if (!im) return;
      const h = im.height * w / im.width;
      ctx.drawImage(im, cx - w / 2, cy - h * R.CITY_ANCHOR, w, h);
    }
    function flagFor(c) {
      const co = st.countries[c]; if (!co || !co.flag_url) return null;
      if (!st.flags[co.flag_url]) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = mark; im.src = co.flag_url; st.flags[co.flag_url] = im; }
      const im = st.flags[co.flag_url]; return im.complete && im.naturalWidth ? im : null;
    }
    function drawFlag(c, x, y, s) {
      s = s || 1;
      ctx.save();
      ctx.fillStyle = '#5A3A1A'; ctx.fillRect(x - 2 * s, y - 34 * s, 3 * s, 36 * s);
      const im = flagFor(c);
      if (im) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y - 34 * s, 33 * s, 22 * s); ctx.drawImage(im, x + 1 * s, y - 33 * s, 31 * s, 20 * s); }
      else {
        ctx.fillStyle = colorOf(c); ctx.beginPath(); ctx.moveTo(x, y - 34 * s); ctx.lineTo(x + 30 * s, y - 27 * s); ctx.lineTo(x, y - 18 * s); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    }

    function draw(time) {
      const z = st.cam.z, dpr = st.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const far = !st.all ? z < 0.4 : z < 0.3;   // 멀리서 볼 때는 자잘한 그림을 줄여 눈이 편하게
      ctx.fillStyle = '#0B0F17'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * z, 0, 0, dpr * z, -st.cam.x * z * dpr, -st.cam.y * z * dpr);
      const vw = canvas.width / dpr / z, vh = canvas.height / dpr / z;
      const r1 = Math.max(0, Math.floor((st.cam.y - TW) / ROW)), r2 = Math.min(H - 1, Math.ceil((st.cam.y + vh + TW) / ROW));
      const c1 = Math.max(0, Math.floor(st.cam.x / TW) - 1), c2 = Math.min(W - 1, Math.ceil((st.cam.x + vw) / TW));
      // 1) 지형
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const id = r * W + c, [x, y] = center(id), t = st.tiles.get(id);
        if (!visible(id) || !t) {
          hexPath(ctx, x, y, SIDE + 0.5); ctx.fillStyle = (c + r) % 2 ? '#161C28' : '#131925'; ctx.fill(); hexPath(ctx, x, y, SIDE - 3); ctx.strokeStyle = 'rgba(226,184,92,.07)'; ctx.lineWidth = 2; ctx.stroke();
          continue;
        }
        const im = IMG['t:' + t.terrain];
        if (im) ctx.drawImage(im, x - TW / 2, y + HALF_H + BAND - im.height, TW, im.height);
        else { hexPath(ctx, x, y); ctx.fillStyle = '#5C8A3A'; ctx.fill(); }
        if (t.owner) { hexPath(ctx, x, y, SIDE - 2); ctx.fillStyle = colorOf(t.owner) + '30'; ctx.fill(); }
      }
      // 안개 경계를 부드럽게: 본 칸 테두리에 그림자
      // 2) 국경선
      ctx.lineCap = 'round';
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const id = r * W + c, t = st.tiles.get(id);
        if (!t || !t.owner || !visible(id)) continue;
        const [x, y] = center(id), nb = neighbors(id);
        nb.forEach((n, k) => {
          const o = n >= 0 && st.tiles.get(n) ? st.tiles.get(n).owner : null;
          if (o === t.owner) return;
          const [a, b] = EDGE[k], s = SIDE - 3;
          ctx.beginPath(); ctx.moveTo(x + s * Math.cos(ANG[a]), y + s * Math.sin(ANG[a])); ctx.lineTo(x + s * Math.cos(ANG[b]), y + s * Math.sin(ANG[b]));
          ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 9; ctx.stroke();
          ctx.strokeStyle = colorOf(t.owner); ctx.lineWidth = 6; ctx.stroke();
        });
      }
      // 3) 선택·안내 표시
      for (const id of st.hint) { const [x, y] = center(id); hexPath(ctx, x, y, SIDE - 6); ctx.fillStyle = 'rgba(255,224,122,.28)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,224,122,.9)'; ctx.lineWidth = 3; ctx.stroke(); }
      // 공격할 수 있는 도시국가: 붉은 고리 (깜빡임)
      if (st.atk.size) { const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 220);
        for (const id of st.atk) { const [x, y] = center(id); hexPath(ctx, x, y, SIDE - 4); ctx.fillStyle = `rgba(224,60,60,${0.18 + 0.15 * pulse})`; ctx.fill(); ctx.strokeStyle = `rgba(255,90,80,${0.6 + 0.4 * pulse})`; ctx.lineWidth = 6; ctx.stroke(); } }
      if (st.pathPrev.length) {
        ctx.strokeStyle = '#FFE07A'; ctx.lineWidth = 6; ctx.setLineDash([10, 8]); ctx.beginPath();
        st.pathPrev.forEach((id, i) => { const [x, y] = center(id); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
      }
      if (st.sel !== null && st.sel >= 0) { const [x, y] = center(st.sel); hexPath(ctx, x, y, SIDE - 4); ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = '#FFC83D'; ctx.lineWidth = 3; ctx.stroke(); }
      // 4) 위에 올리는 것 (줄 순서): 자원·시설·도시·병력
      const cityAt = new Map(st.cities.map(c => [c.tile, c]));
      const unitsAt = new Map(); for (const u of st.units) { if (!unitsAt.has(u.tile)) unitsAt.set(u.tile, []); unitsAt.get(u.tile).push(u); }
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const id = r * W + c; if (!visible(id)) continue;
        const t = st.tiles.get(id); if (!t) continue;
        const [x, y] = center(id), city = cityAt.get(id);
        if (city) {
          const big = city.kind === 'capital';
          const im = IMG['c:' + city.art] || IMG[big ? 'b:capital' : (t.terrain === 'coast' || city.sea ? 'b:port' : 'b:capital')];
          ctx.save();
          if (!city.country) ctx.filter = 'saturate(.55) brightness(.95)';
          else if (city.unrest) ctx.filter = 'sepia(1) saturate(4) hue-rotate(-40deg) brightness(.85)';   // 행정 마비: 붉게
          if (IMG['c:' + city.art]) drawImgAnchor(im, x, y, city.boss ? 230 : city.rebel ? 200 : city.art === 'final' ? 190 : big ? 150 : 140);   // GPT 도시 그림: 기준점(가로 50%, 세로 83%)을 칸 중심에
          else drawImgBottom(im, x, y + HALF_H * 0.75, big ? 132 : 104);
          ctx.restore();
          if (city.country) drawFlag(city.country, x + 26, y - 30, big ? 1.2 : 0.9);
          // 이름표
          const label = big ? (st.countries[city.country] ? st.countries[city.country].name : city.name) : city.name;
          if (!far || big) {   // 멀리서는 수도 이름만 크게
            const k = far ? Math.min(2.6, 0.5 / z) : 1, fs = Math.round((big ? 20 : 17) * k);
            ctx.font = `700 ${fs}px Galmuri11, Jua, sans-serif`; const tw = ctx.measureText(label).width + 20 * k, th = fs + 12 * k, ly = y + 30;
            plate(x - tw / 2, ly, tw, th, city.country ? colorOf(city.country) : '#2A2433', big);
            ctx.fillStyle = '#FFF4D6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(label, x, ly + th / 2 + 1); ctx.fillText(label, x, ly + th / 2 + 1);
          }
          if (!far && !city.country && city.def != null) {
            const bw = city.boss || city.rebel ? 120 : 76;
            plate(x - bw / 2, y - 112, bw, 24, city.boss ? '#4A0E5C' : city.tier >= 4 ? '#5A0F18' : '#8E1F2F', city.tier >= 4);
            ctx.fillStyle = '#FFE9C2'; ctx.font = '700 14px Galmuri11, Jua, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText((city.boss ? '최종 보스 · ' : city.rebel ? '잊힌 제국 · ' : '') + '방어 ' + city.def, x, y - 99);
            if (city.max_hp) hpBar(x - bw / 2, y - 86, bw, 7, city.hp / city.max_hp);
          }
          if (city.unrest && !far) {   // 행정 마비 표시
            ctx.font = '700 16px Galmuri11, Jua, sans-serif'; const tw = ctx.measureText('행정 마비').width + 18;
            plate(x - tw / 2, y - 92, tw, 24, '#B8263A', true);
            ctx.fillStyle = '#FFF0E0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('행정 마비', x, y - 79);
          }
        } else {
          if (t.imp) {
            const k = { farm: 'b:farm', lumber: 'b:lumber', mine: 'b:mine', quarry: 'b:mine' }[t.imp];
            ctx.globalAlpha = 0.62;
            if (k) drawImgBottom(IMG[k], x, y + HALF_H * 0.7, 96);
            else { // 농원·유정: 자원 그림을 크게 + 울타리
              ctx.fillStyle = 'rgba(90,58,26,.85)'; roundRect(ctx, x - 34, y + 10, 68, 10, 4); ctx.fill();
              drawImgBottom(IMG['r:' + t.res], x, y + 16, 70);
            }
            ctx.globalAlpha = 1;
          }
          if (t.res && !t.imp && !far) drawImgBottom(IMG['r:' + t.res], x + 20, y + 30, 44);
        }
        const us = far ? null : unitsAt.get(id);
        if (us && us.length) {
          if (st.tintUnits) {   // 관전: 나라별로 나눠 그리고 발밑에 나라 색
            const by = new Map(); for (const u of us) { if (!by.has(u.country)) by.set(u.country, []); by.get(u.country).push(u); }
            [...by.entries()].forEach(([c, g], i) => drawUnits(g, x + i * 22, y - i * 10, t, !!city, colorOf(c)));
          } else drawUnits(us, x, y, t, !!city);
        }
      }
      // 5) 효과
      const now = performance.now();
      st.fx = st.fx.filter(f => f.draw(ctx, now) !== false);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    function drawUnits(us, x, y, t, onCity, tint) {
      const sea = t.terrain === 'ocean' || t.terrain === 'coast';
      const order = ['k_missile', 'j_patrol', 'c_jet', 'a_stealth', 'n_hyper', 't_marine', 'cruiser', 'battleship', 'tank', 'artillery', 'frigate', 'infantry', 'cannon', 'musket', 'knight', 'trireme', 'catapult', 'spear'];
      const mil = us.filter(u => u.kind !== 'worker' && u.kind !== 'scout');
      const others = us.filter(u => !mil.includes(u));
      const list = [];
      if (mil.length) { const top = order.find(k => mil.some(u => u.kind === k)) || mil[0].kind; const pick = mil.find(u => u.kind === top) || mil[0];
        list.push({ kind: top, n: mil.length, country: mil[0].country, hp: Math.min(...mil.map(u => u.hp == null ? 100 : u.hp)), sel: mil.some(u => u.id === st.selUnit), done: mil.every(u => u.done) }); }
      for (const u of others) list.push({ kind: u.kind, n: 1, anim: u.anim, country: u.country, hp: u.hp, sel: u.id === st.selUnit, done: u.done });
      const sx = onCity ? -38 : -18;
      list.slice(0, 3).forEach((u, i) => {
        const img = (R.UNITS[u.kind] || {}).img || u.kind;
        let key = u.kind === 'scout' && sea ? 'u:boat' : 'u:' + img;   // 정찰병이 바다에 있으면 배로 (탑승)
        const tp = u.country ? (st.countries[u.country] || {}).type : st.myType;
        if (tp && IMG[key + '_' + tp]) key = key + '_' + tp;
        const px = x + sx + i * 30, py = y + (onCity ? 22 : 34);
        const tc = u.country ? colorOf(u.country) : (st.myType && R.TYPES[st.myType] ? R.TYPES[st.myType].color : '#E2B85C');
        ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(px, py, 24, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = tc; ctx.lineWidth = 3; ctx.stroke();
        if (tint) { ctx.globalAlpha = .9; ctx.strokeStyle = tint; ctx.lineWidth = 4; ctx.stroke(); }
        ctx.restore();
        const big = (R.UNITS[u.kind] || {}).boss ? 86 : ['catapult', 'cannon', 'artillery', 'tank', 'trireme', 'frigate', 'battleship', 'cruiser'].includes(u.kind) ? 72 : 60;
        if (u.sel) {   // 고른 병력: 금색으로 환하게 빛남
          const pl = 0.6 + 0.4 * Math.sin(performance.now() / 250);
          ctx.save(); ctx.strokeStyle = '#FFE07A'; ctx.lineWidth = 5; ctx.shadowColor = '#FFE07A'; ctx.shadowBlur = 18 * pl; ctx.beginPath(); ctx.ellipse(px, py, 30, 12, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
          ctx.save(); ctx.shadowColor = '#FFF0B8'; ctx.shadowBlur = 22 * pl; drawImgBottom(IMG[key], px, py, big + 6); ctx.restore();
        } else {
          if (u.done) ctx.globalAlpha = 0.55;
          drawImgBottom(IMG[key], px, py, big);
          ctx.globalAlpha = 1;
        }
        if (u.hp != null && u.hp < 100) hpBar(px - 18, py + 6, 36, 5, u.hp / 100);
        if (u.n > 1) {
          ctx.fillStyle = '#FFC83D'; ctx.beginPath(); ctx.arc(px + 18, py - 46, 12, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#3A2600'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#3A2600'; ctx.font = '600 15px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(u.n, px + 18, py - 45);
        }
      });
    }

    // ---------- 효과 ----------
    function floatText(id, text, color) {
      const [x, y] = center(id), t0 = performance.now();
      st.fx.push({ draw(c, now) { const k = (now - t0) / 1400; if (k > 1) return false;
        c.save(); c.globalAlpha = 1 - k * k; c.font = '600 30px Jua, sans-serif'; c.textAlign = 'center'; c.lineWidth = 6; c.strokeStyle = '#1A1440';
        c.strokeText(text, x, y - 40 - k * 60); c.fillStyle = color || '#FFE07A'; c.fillText(text, x, y - 40 - k * 60); c.restore(); } });
      mark();
    }
    // 공성: 투석기 돌이 포물선으로 날아가 성벽에 부딪힘
    function siege(fromId, toId, shots, done) {
      const [x1, y1] = center(fromId), [x2, y2] = center(toId), t0 = performance.now(), dur = 700;
      for (let i = 0; i < shots; i++) {
        const st0 = t0 + i * 420;
        st.fx.push({ draw(c, now) {
          const k = (now - st0) / dur; if (k < 0) return; if (k > 1.6) return false;
          if (k <= 1) {
            const x = x1 + (x2 - x1) * k, y = y1 + (y2 - y1) * k - Math.sin(Math.PI * k) * (180 + hexDist(fromId, toId) * 30);
            c.fillStyle = '#5B5146'; c.beginPath(); c.arc(x, y - 30, 9, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#1A1440'; c.lineWidth = 3; c.stroke();
          } else {
            const e = (k - 1) / 0.6; c.save(); c.globalAlpha = 1 - e;
            c.fillStyle = '#FFB13D'; c.beginPath(); c.arc(x2, y2 - 30, 20 + e * 50, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#FFF2A8'; c.beginPath(); c.arc(x2, y2 - 30, 10 + e * 26, 0, Math.PI * 2); c.fill(); c.restore();
          }
        } });
      }
      mark();
      setTimeout(() => { done && done(); }, shots * 420 + dur + 400);
    }
    // 근접 공격: 칼날 번쩍임 + 흔들림
    function strike(fromId, toId, done) {
      const [x1, y1] = center(fromId), [x2, y2] = center(toId), t0 = performance.now();
      st.fx.push({ draw(c, now) { const k = (now - t0) / 650; if (k > 1) return false;
        const m = Math.sin(Math.PI * Math.min(1, k * 1.6));
        const x = x1 + (x2 - x1) * 0.55 * m, y = y1 + (y2 - y1) * 0.55 * m;
        c.save(); c.globalAlpha = 1 - k; c.strokeStyle = '#FFF2A8'; c.lineWidth = 7; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x - 22, y - 60); c.lineTo(x + 22, y - 18); c.moveTo(x + 22, y - 60); c.lineTo(x - 22, y - 18); c.stroke();
        if (k > 0.45) { c.fillStyle = '#FF6A4A'; c.beginPath(); c.arc(x2, y2 - 34, 14 + (k - 0.45) * 60, 0, Math.PI * 2); c.globalAlpha = (1 - k) * 0.8; c.fill(); }
        c.restore(); } });
      mark(); setTimeout(() => done && done(), 700);
    }
    // 고른 병력·공격 대상 깜빡임: 1초에 5번만 다시 그림 (가볍게)
    let pulseT = 0;
    function pulseLoop() {
      if ((st.atk.size || st.selUnit) && !pulseT) pulseT = setInterval(() => { if (!st.atk.size && !st.selUnit) { clearInterval(pulseT); pulseT = 0; return; } mark(); }, 200);
    }
    function moveUnit(unitId, pathIds, done) {
      const u = st.units.find(x => x.id === unitId); if (!u || !pathIds.length) { done && done(); return; }
      let i = 0;
      const step = () => { if (i >= pathIds.length) { done && done(); return; } u.tile = pathIds[i++]; mark(); setTimeout(step, 160); };
      step();
    }

    // ---------- 조작 ----------
    let drag = null, pinch = null;
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, cx: st.cam.x, cy: st.cam.y, moved: false }; });
    canvas.addEventListener('pointermove', e => {
      if (!drag) { if (opts.onHover) { const r = canvas.getBoundingClientRect(); opts.onHover(pick(e.clientX - r.left, e.clientY - r.top)); } return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) { st.cam.x = drag.cx - dx / st.cam.z; st.cam.y = drag.cy - dy / st.cam.z; clampCam(); mark(); }
    });
    canvas.addEventListener('pointerup', e => {
      if (drag && !drag.moved && opts.onTile) { const r = canvas.getBoundingClientRect(); const id = pick(e.clientX - r.left, e.clientY - r.top); if (id >= 0) opts.onTile(id); }
      drag = null;
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    function zoomAt(f, sx, sy) {
      const [wx, wy] = toWorld(sx, sy);
      st.cam.z = Math.max(0.22, Math.min(1.1, st.cam.z * f));
      st.cam.x = wx - sx / st.cam.z; st.cam.y = wy - sy / st.cam.z; clampCam(); mark();
    }
    function centerOn(id, z) {
      if (z) st.cam.z = z;
      const [x, y] = center(id), rr = canvas.getBoundingClientRect();
      st.cam.x = x - rr.width / 2 / st.cam.z; st.cam.y = y - rr.height / 2 / st.cam.z; clampCam(); mark();
    }
    function fitAll() {
      const rr = canvas.getBoundingClientRect();
      st.cam.z = Math.min(rr.width / worldW, rr.height / worldH);
      st.cam.x = -(rr.width / st.cam.z - worldW) / 2; st.cam.y = -(rr.height / st.cam.z - worldH) / 2; mark();
    }
    new ResizeObserver(resize).observe(canvas);
    resize();
    ready.then(mark);

    return {
      st, mark, center, centerOn, fitAll, floatText, siege, strike, moveUnit, pick,
      zoom: f => { const r = canvas.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); },
      setData(d) { Object.assign(st, d); mark(); },
      select(id) { st.sel = id; mark(); },
      setHint(ids) { st.hint = new Set(ids || []); mark(); },
      setAtk(ids) { st.atk = new Set(ids || []); pulseLoop(); mark(); },
      selectUnit(id) { st.selUnit = id; pulseLoop(); mark(); },
      setPath(p) { st.pathPrev = p || []; mark(); }
    };
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  window.HexMap = { create, ready, neighbors, hexDist, path, reachable, center, IMG };
})();
