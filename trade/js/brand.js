// 그리드 링크(GRID LINK) 세계무역중계: 로고와 폭주 연출 (학생 화면 · 전자칠판 · 관제실이 같이 씀)
//  grid  : 13~16차시, 친절한 무역 중계 회사
//  greed : 17차시 폭주 (흘러내리고 긁힌 GREED LINK)
//  wto   : 세계무역기구(WTO) 탄생 뒤 (규칙을 지키는 중계 회사)
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  function el(tag, attrs, kids) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    (kids || []).forEach(c => c && e.appendChild(c));
    return e;
  }
  const FONT = "'Black Han Sans', 'Arial Black', 'Noto Sans KR', sans-serif";

  function mode(g) {
    if (!g) return 'grid';
    if (g.alliance || g.phase >= 7) return 'wto';
    if (g.phase >= 4) return 'greed';
    return 'grid';
  }

  // 지구 + 그물망 + 고리 아이콘
  function globe(x, y, r, bad, id) {
    const stroke = bad ? '#1A0B0E' : '#FFFFFF', fill = bad ? '#C21E32' : '#1E6FD9';
    const g = el('g', bad ? { filter: 'url(#rough' + id + ')' } : {}, [
      el('circle', { cx: x, cy: y, r: r, fill: fill, stroke: bad ? '#1A0B0E' : '#0F3F86', 'stroke-width': 4 }),
      el('ellipse', { cx: x, cy: y, rx: r * 0.45, ry: r, fill: 'none', stroke: stroke, 'stroke-width': 3, opacity: .9 }),
      el('line', { x1: x - r, y1: y, x2: x + r, y2: y, stroke: stroke, 'stroke-width': 3, opacity: .9 }),
      el('path', { d: `M${x - r * 0.86} ${y - r * 0.5} Q${x} ${y - r * 0.68} ${x + r * 0.86} ${y - r * 0.5}`, fill: 'none', stroke: stroke, 'stroke-width': 2.5, opacity: .85 }),
      el('path', { d: `M${x - r * 0.86} ${y + r * 0.5} Q${x} ${y + r * 0.68} ${x + r * 0.86} ${y + r * 0.5}`, fill: 'none', stroke: stroke, 'stroke-width': 2.5, opacity: .85 }),
      // 고리 (세계를 잇는 연결)
      el('circle', { cx: x + r * 0.72, cy: y - r * 0.72, r: r * 0.26, fill: bad ? '#1A0B0E' : '#FFC83D', stroke: bad ? '#C21E32' : '#0F3F86', 'stroke-width': 3 }),
      el('circle', { cx: x - r * 0.72, cy: y + r * 0.72, r: r * 0.2, fill: bad ? '#1A0B0E' : '#3DCB6C', stroke: bad ? '#C21E32' : '#0F3F86', 'stroke-width': 3 })
    ]);
    if (bad) {   // 금 간 지구
      g.appendChild(el('path', { d: `M${x - 6} ${y - r} L${x + 4} ${y - r * 0.4} L${x - 8} ${y - r * 0.05} L${x + 6} ${y + r * 0.45} L${x - 2} ${y + r}`, fill: 'none', stroke: '#1A0B0E', 'stroke-width': 4 }));
      g.appendChild(el('path', { d: `M${x + 4} ${y - r * 0.4} L${x + r * 0.55} ${y - r * 0.2}`, fill: 'none', stroke: '#1A0B0E', 'stroke-width': 3 }));
    }
    return g;
  }

  // 로고 (SVG). opt.sub: 아래 작은 글씨를 바꿀 때
  function logo(m, opt) {
    opt = opt || {};
    const id = ++uid, bad = m === 'greed', wto = m === 'wto';
    const svg = el('svg', { viewBox: '0 0 440 130', class: 'gl-logo gl-' + m, role: 'img', 'aria-label': bad ? 'GREED LINK' : 'GRID LINK 세계무역중계' });
    const defs = el('defs', {}, [
      // 거친 가장자리 (긁힌 느낌)
      el('filter', { id: 'rough' + id, x: '-5%', y: '-5%', width: '110%', height: '120%' }, [
        el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2', seed: '7', result: 'n' }),
        el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: '4' })
      ]),
      // 긁힌 자국: 글자에서 사선으로 파낸 줄
      el('mask', { id: 'scr' + id }, [
        el('rect', { x: 0, y: 0, width: 440, height: 130, fill: '#fff' }),
        ...[[128, 18, 196, 92, 3], [150, 30, 238, 108, 2], [262, 16, 300, 84, 4], [318, 40, 404, 98, 2.5], [356, 14, 380, 60, 3], [200, 70, 270, 30, 2], [98, 64, 140, 40, 2]]
          .map(([a, b, c, d, w]) => el('line', { x1: a, y1: b, x2: c, y2: d, stroke: '#000', 'stroke-width': w, 'stroke-linecap': 'round' }))
      ])
    ]);
    svg.appendChild(defs);
    svg.appendChild(globe(58, 62, 42, bad, id));
    if (!bad) {
      svg.appendChild(el('text', { x: 116, y: 74, textLength: 300, lengthAdjust: 'spacingAndGlyphs', 'font-family': FONT, 'font-size': 54, fill: wto ? '#5D6B7A' : '#123F7A', 'letter-spacing': 1 }, [document.createTextNode('GRID LINK')]));
      svg.appendChild(el('text', { x: 119, y: 106, 'font-family': "'Noto Sans KR', sans-serif", 'font-weight': 700, 'font-size': 21, fill: wto ? '#7A8794' : '#3B6FB5', 'letter-spacing': 4 }, [document.createTextNode(opt.sub || '세계무역중계')]));
      if (wto) {
        const st = el('g', { transform: 'rotate(-8 372 92)' }, [
          el('rect', { x: 312, y: 74, width: 122, height: 38, rx: 6, fill: 'none', stroke: '#2E9E5B', 'stroke-width': 4 }),
          el('text', { x: 373, y: 100, 'text-anchor': 'middle', 'font-family': "'Noto Sans KR', sans-serif", 'font-weight': 700, 'font-size': 17, fill: '#2E9E5B' }, [document.createTextNode('WTO 규칙 준수')])
        ]);
        svg.appendChild(st);
      }
    } else {
      // 흘러내리는 핏빛 물감
      const drips = el('g', { class: 'gl-drips', fill: '#C21E32' });
      [[128, 70, 26], [152, 70, 44], [196, 72, 18], [232, 70, 52], [262, 72, 30], [306, 70, 22], [338, 72, 60], [372, 70, 34], [410, 72, 40]].forEach(([x, y, len], i) => {
        drips.appendChild(el('path', { d: `M${x - 4} ${y} L${x + 4} ${y} L${x + 3} ${y + len} Q${x} ${y + len + 9} ${x - 3} ${y + len} Z`, style: `animation-delay:${(i % 5) * 0.35}s` }));
      });
      svg.appendChild(drips);
      const word = el('g', { mask: 'url(#scr' + id + ')', filter: 'url(#rough' + id + ')' }, [
        el('text', { x: 113, y: 77, textLength: 318, lengthAdjust: 'spacingAndGlyphs', 'font-family': FONT, 'font-size': 58, fill: '#1A0B0E', 'letter-spacing': 1 }, [document.createTextNode('GREED LINK')]),
        el('text', { x: 110, y: 74, textLength: 318, lengthAdjust: 'spacingAndGlyphs', 'font-family': FONT, 'font-size': 58, fill: '#E3263D', 'letter-spacing': 1 }, [document.createTextNode('GREED LINK')])
      ]);
      svg.appendChild(word);
      svg.appendChild(el('text', { x: 116, y: 124, 'font-family': "'Noto Sans KR', sans-serif", 'font-weight': 700, 'font-size': 18, fill: '#FF8A95', 'letter-spacing': 2 }, [document.createTextNode(opt.sub || '모든 거래는 우리가 정한다')]));
    }
    return svg;
  }

  // 무역 탭 위쪽 띠: 지금 누가 거래를 중계하는지
  function bar(g, extra) {
    const m = mode(g), d = document.createElement('div');
    d.className = 'gl-bar gl-bar-' + m;
    d.appendChild(logo(m));
    const t = document.createElement('div'); t.className = 'gl-bar-text';
    const lines = {
      grid: ['모든 나라 사이의 거래는 그리드 링크가 안전하게 이어 드립니다.', '중계 수수료 0코인 · 세계 1위 무역 중계 회사'],
      greed: ['GREED LINK가 세계 무역을 쥐고 마음대로 하고 있어요!', '관세를 멋대로 올리고, 사치품과 핵심 전략 자원은 독점해 거래를 막아요'],
      wto: ['세계무역기구(WTO)의 규칙에 따라 공정하게 중계합니다.', '관세는 미리 알리고 · 독점 금지 · 다툼은 WTO가 조정 · 환경을 지키는 무역']
    }[m];
    t.innerHTML = '<b></b><small></small>';
    t.firstChild.textContent = lines[0]; t.lastChild.textContent = extra || lines[1];
    d.appendChild(t);
    return d;
  }

  // 폭주 연출: 멀쩡한 로고 → 화면이 치지직 → 흘러내리는 GREED LINK
  function glitch(done, opt) {
    opt = opt || {};
    document.querySelectorAll('.gl-ov').forEach(x => x.remove());
    const ov = document.createElement('div'); ov.className = 'gl-ov' + (opt.big ? ' big' : '');
    const stage = document.createElement('div'); stage.className = 'gl-stage';
    const layers = ['main', 'r', 'c'].map(k => { const l = document.createElement('div'); l.className = 'gl-layer gl-' + k; l.appendChild(logo('grid')); return l; });
    layers.forEach(l => stage.appendChild(l));
    const cap = document.createElement('div'); cap.className = 'gl-cap'; cap.textContent = '세계의 모든 거래를 안전하게 이어 드립니다';
    const noise = document.createElement('div'); noise.className = 'gl-noise';
    const scan = document.createElement('div'); scan.className = 'gl-scan';
    ov.append(stage, cap, noise, scan);
    document.body.appendChild(ov);
    const T = opt.fast ? 0.4 : 1;
    setTimeout(() => { ov.classList.add('on'); cap.textContent = '세계의 모든 거래를 안전하게 이어 드…드…드립…'; }, 1100 * T);
    setTimeout(() => { layers.forEach(l => { l.innerHTML = ''; l.appendChild(logo('greed')); }); }, 1900 * T);
    setTimeout(() => { ov.classList.add('swap'); }, 2150 * T);
    setTimeout(() => { ov.classList.remove('on'); ov.classList.add('evil'); cap.textContent = '"이제 우리 없이는 아무도 거래 못 하지. 값도, 관세도, 누가 사고팔지도 우리가 정한다!"'; }, 2700 * T);
    const end = () => { if (!ov.isConnected) return; ov.classList.add('out'); setTimeout(() => ov.remove(), 500); if (done) { const f = done; done = null; f(); } };
    setTimeout(end, (opt.hold || 5200) * T);
    ov.addEventListener('click', () => { if (ov.classList.contains('evil')) end(); });
    return ov;
  }

  window.Brand = { mode, logo, bar, glitch };
})();
