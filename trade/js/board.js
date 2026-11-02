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
      else if (prev.game.phase < 8 && b.game.phase >= 8) overlay('세계 무역 협정 만료!', '나라 사이의 무역 약속이 끝났어요. 일부 수입품에 관세가 붙고, 나라마다 핵심 재료 하나의 수출을 막았어요.', null, 'alarm');
      else if (prev.game.phase < 9 && b.game.phase >= 9 && b.game.phase < 10) overlay('피해 보고서', '우리 나라는 무역에서 어떤 어려움을 겪었나요?');
      else if (prev.game.phase < 11 && b.game.phase >= 11) overlay('세계 무역 헌장 체결', '수출 제한이 풀리고 관세가 사라졌어요. 약속을 지키며 다시 거래해요!', b.countries);
      // 최종 도시국가 정복 · 도시 재건 소식은 위쪽 띠로
      b.countries.forEach(c => { const p = prev.countries.find(x => x.id === c.id) || {};
        if (c.final_done && !p.final_done) banner(c.name + ' — 최종 도전 성공!', '무역으로 모은 자원으로 특수 부대를 만들었어요', typeColor(c.type));
        if (c.rebuilt && !p.rebuilt) banner(c.name + ' — 새 도시 재건!', '다시 이어진 무역 덕분이에요', typeColor(c.type)); });
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
    if (g.phase >= 8 && g.phase < 10) {
      const bans = Object.entries(g.banned || {}), tars = Object.keys(g.tariffs || {});
      right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, g.phase === 8 ? '무역 위기 상황' : '나라별 무역 피해'),
        bans.length ? h('div', { class: 'b-crisis' }, h('b', {}, '수출 제한 '), bans.map(([c, its]) => name(b, +c) + ': ' + its.map(UI.itemName).join(', ')).join(' · ')) : null,
        tars.length ? h('div', { class: 'b-crisis tariff' }, h('b', {}, '관세 50% '), tars.map(UI.itemName).join(' · ')) : null,
        h('table', { class: 'tbl b-dmg' }, h('tr', {}, h('th', {}, '나라'), h('th', {}, '막힌 거래'), h('th', {}, '낸 관세'), h('th', {}, '행복')),
          b.countries.map(c => h('tr', {}, h('td', {}, h('b', { style: { color: typeColor(c.type) } }, c.name)), h('td', { class: c.fails ? 'bad' : '' }, c.fails + '번'), h('td', {}, c.tariff_paid + '코인'), h('td', { class: c.happy < 0 ? 'bad' : '' }, c.happy))))));
    } else if (g.phase >= 10 && b.treaties.length) {
      right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '지구 서버 무역 헌장'),
        b.treaties.map(t => h('div', { class: 'b-sentence', style: { borderLeftColor: typeColor((b.countries.find(c => c.id === t.country) || {}).type) } },
          h('b', {}, name(b, t.country) + ' '), t.promise || '', g.phase >= 11 && (b.countries.find(c => c.id === t.country) || {}).rebuilt ? h('span', { class: 'b-ok' }, ' 재건 완료') : null, h('div', { class: 'muted' }, t.reason || ''), h('small', {}, '동의 ' + t.agreed.length + '/6')))));
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

  function banner(title, sub, color) {
    let box = document.getElementById('b-banners');
    if (!box) { box = h('div', { id: 'b-banners' }); document.body.appendChild(box); }
    const el = h('div', { class: 'b-banner', style: { '--gc': color } }, h('b', {}, title), h('span', {}, sub));
    box.appendChild(el); setTimeout(() => el.classList.add('out'), 6000); setTimeout(() => el.remove(), 6800);
  }
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
