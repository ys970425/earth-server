// 전자칠판: 세계 지도 전체, 나라 카드, 안정도, 거래량, 큰 사건 연출
(function () {
  const R = window.RULES;
  const { rpc, ensureSession, subscribe, PHASES } = window.API;
  const { h, fmt, debounce, typeColor, gaugeColor, happyWord } = window.UI;
  const root = document.getElementById('app');
  let last = null, map = null, offset = 0;

  async function load() {
    let b; try { b = await rpc('get_board'); } catch (e) { return; }
    const prev = last; last = b;
    offset = new Date(b.now).getTime() - Date.now();
    render(b);
    if (prev) {
      if (!prev.game.world_first && b.game.world_first) overlay('세계 외교의 시대', name(b, b.game.world_first) + '의 정찰대가 세계의 모든 나라를 발견했습니다!', b.countries);
      else if (prev.game.phase < 2 && b.game.phase >= 2) overlay('성장의 한계', '나라가 커지자 시민들이 더 다양한 물건을 원합니다.');
      else if (prev.game.phase < 3 && b.game.phase >= 3) overlay('세계 시장 개방', '이제 다른 나라와 물건을 사고팔 수 있어요.', b.countries);
      else if (prev.game.phase < 8 && b.game.phase >= 8) overlay('세계 무역 협정 만료', '공정 거래 규칙이 사라졌습니다.', null, 'alarm');
    }
  }
  const loadSoon = debounce(load, 500);
  const name = (b, id) => (b.countries.find(c => c.id === id) || {}).name;

  function render(b) {
    const g = b.game;
    if (!root.querySelector('.tb')) {
      root.innerHTML = '';
      root.className = 'board tb';
      root.append(h('div', { class: 'b-head' }, h('div', {}, h('div', { class: 'b-kicker' }, '지구 서버: 문명의 시대 · 제작 조영산'), h('div', { class: 'title b-title', id: 'b-title' }), h('div', { class: 'b-desc', id: 'b-desc' })),
          h('div', { class: 'b-side' }, h('div', { id: 'b-timer', class: 'b-timer' }), h('div', { id: 'b-turn' }))),
        h('div', { class: 'tb-main' }, h('div', { class: 'tb-map', id: 'tb-map' }, h('canvas', { class: 'hexmap', id: 'tb-canvas' })), h('div', { class: 'tb-right', id: 'tb-right' })));
      map = HexMap.create(document.getElementById('tb-canvas'), {});
      setTimeout(() => map.fitAll(), 50);
    }
    document.getElementById('b-title').textContent = PHASES[g.phase].name;
    document.getElementById('b-desc').textContent = PHASES[g.phase].desc;
    document.getElementById('b-turn').textContent = g.turn ? '턴 ' + g.turn : '';
    const tiles = new Map(b.tiles.map(([id, terrain, res, owner, imp]) => [id, { terrain, res, owner, imp }]));
    const countries = Object.fromEntries(b.countries.map(c => [c.id, { color: typeColor(c.type), type: c.type, name: c.name, flag_url: c.flag_url }]));
    map.setData({ tiles, cities: b.cities.map(c => ({ ...c, def: null })), units: [], countries, all: true });
    const right = document.getElementById('tb-right'); right.innerHTML = '';
    right.append(h('div', { class: 'panel b-gauge' }, h('div', { class: 'b-gauge-label' }, '지구 서버 안정도 ', h('b', {}, b.gauge + '%')),
      h('div', { class: 'big-gauge', style: { width: '100%', maxWidth: 'none', margin: '6px 0 0' } }, h('i', { style: { width: b.gauge + '%', background: gaugeColor(b.gauge) } }))));
    if (g.phase >= 10 && b.treaties.length) {
      right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '지구 서버 무역 헌장'),
        b.treaties.map(t => h('div', { class: 'b-sentence', style: { borderLeftColor: typeColor((b.countries.find(c => c.id === t.country) || {}).type) } },
          h('b', {}, name(b, t.country) + ' '), t.promise || '', h('div', { class: 'muted' }, t.reason || ''), h('small', {}, '동의 ' + t.agreed.length + '/6')))));
    } else {
      right.append(h('div', { class: 'tb-cards' }, b.countries.map(c => h('div', { class: 'panel tb-card', style: { '--gc': typeColor(c.type) } },
        c.flag_url ? h('img', { src: c.flag_url, class: 'tb-flag' }) : h('div', { class: 'tb-flag none' }, c.id),
        h('div', { class: 'tb-info' }, h('b', {}, c.name), (c.name !== c.type_name || c.title) ? h('small', {}, (c.name !== c.type_name ? c.type_name : '') + (c.title ? (c.name !== c.type_name ? ' · ' : '') + c.title : '')) : null,
          h('div', { class: 'tb-nums' }, h('span', {}, '도시 ' + c.cities), h('span', { class: c.happy < 0 ? 'bad' : '' }, '행복 ' + c.happy), h('span', {}, '발견 ' + c.discovered + '/5'),
            g.market_open ? h('span', {}, '수출 ' + c.exports + ' · 수입 ' + c.imports) : null))))));
      if (g.market_open) {
        const max = Math.max(1, ...b.volume.map(v => v.qty));
        right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '턴별 거래량'),
          h('div', { class: 'vol' }, b.volume.map(v => h('div', { class: 'vol-bar' }, h('i', { style: { height: (v.qty / max * 100) + '%' } }), h('small', {}, v.qty), h('span', {}, v.turn))))));
      }
    }
    tick();
  }
  function tick() {
    const el = document.getElementById('b-timer'); if (!el || !last) return;
    const g = last.game, end = g.timer_end || g.turn_end;
    if (!end) { el.style.display = 'none'; return; }
    const left = Math.round((new Date(end).getTime() - (Date.now() + offset)) / 1000);
    el.style.display = '';
    el.className = 'b-timer' + (left <= 0 ? ' over' : left <= 30 ? ' soon' : '');
    el.textContent = (g.timer_end ? (g.timer_label || '활동') : '다음 턴까지') + ' ' + (left <= 0 ? '0:00' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
  }
  setInterval(tick, 1000);

  function overlay(title, msg, countries, kind) {
    document.querySelectorAll('.alarm').forEach(x => x.remove());
    const ov = h('div', { class: 'alarm ' + (kind === 'alarm' ? '' : 'calm'), onclick: () => ov.remove() },
      h('h2', {}, title), h('p', { style: { fontSize: '30px' } }, msg),
      countries ? h('div', { class: 'ov-flags' }, countries.map((c, i) => h('div', { class: 'ov-flag', style: { animationDelay: (i * 0.25) + 's', '--gc': typeColor(c.type) } },
        c.flag_url ? h('img', { src: c.flag_url }) : h('div', { class: 'none' }, c.id), h('span', {}, c.name)))) : null,
      h('div', { style: { fontSize: '18px', marginTop: '20px', opacity: .8 } }, '(화면을 누르면 닫혀요)'));
    document.body.appendChild(ov);
  }

  (async function start() {
    try { await ensureSession(); } catch (e) { root.textContent = e.message; return; }
    await load();
    subscribe({ game: loadSoon, tick: loadSoon });
    setInterval(load, 8000);
    document.addEventListener('keydown', e => { if (e.key === 'f' && map) map.fitAll(); if (e.key === 'Escape') document.querySelectorAll('.alarm').forEach(x => x.remove()); });
  })();
})();
