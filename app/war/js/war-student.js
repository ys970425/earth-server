// 전쟁 버전 학생 화면 뼈대 (W2): 미리보기 데이터로 지도·나라 정보를 보여 줘요
// 이동·전투는 W3~W4에서 만들어요. 지금은 보기만 해요.
(function () {
  const R = window.RULES;
  const HexMap = window.WarHexMap;
  const root = document.getElementById('app');
  const S = { data: null, map: null, sel: null, country: 1 };
  const $ = s => document.querySelector(s);
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v != null) e.setAttribute(k, v);
    }
    kids.flat().forEach(c => c != null && e.append(c));
    return e;
  }

  // ================= 시작 =================
  async function start() {
    try {
      const data = await window.WarData.load();
      if (!data) return needPreview();
      main(data);
    } catch (e) {
      root.innerHTML = '';
      root.append(h('div', { class: 'entry' }, h('p', {}, '미리보기를 열지 못했어요: ' + e.message)));
      console.error(e);
    }
  }
  // 미리보기가 아니면: 아직 서버 연결 전이라는 안내
  function needPreview() {
    root.innerHTML = '';
    root.append(h('div', { class: 'entry' },
      h('h1', {}, '지구 서버: 전쟁 버전'),
      h('p', {}, '아직 서버에 연결하기 전이에요. 주소 끝에 ?preview=1 을 붙여 미리보기로 볼 수 있어요.')));
  }

  // ================= 화면 =================
  function main(data) {
    S.data = data;
    // 맨 위 미리보기 띠 (미리보기일 때만)
    root.append(h('div', { class: 'war-banner' }, '미리보기 모드: 가짜 데이터예요'));
    // 지도 + 오른쪽 창 (무역 앱 학생 화면과 같은 모양)
    const canvas = h('canvas', { class: 'hexmap' });
    const wrap = h('div', { class: 'map-wrap' }, canvas,
      h('div', { class: 'map-tools' },
        h('button', { class: 'small', onclick: () => S.map.zoom(1.25), title: '크게 보기' }, '+'),
        h('button', { class: 'small', onclick: () => S.map.zoom(0.8), title: '작게 보기' }, '−'),
        h('button', { class: 'small', onclick: () => goCapital() }, '수도로')));
    root.append(h('div', { class: 'map-layout' }, wrap, h('div', { class: 'side panel', id: 'side' })));
    // 지도 데이터: 무역 앱 「투명한 정찰병」이 넘기는 모양 그대로 (안개 없이 모든 땅)
    const tiles = new Map(data.tiles.map(([id, terrain, res, owner, imp]) => [id, { terrain, res, owner, imp }]));
    const countries = Object.fromEntries(data.countries.map(c => [c.id, { color: c.color, type: c.type, name: c.name, flag_url: c.flag_url }]));
    S.map = HexMap.create(canvas, { onTile });
    S.map.setData({ tiles, cities: data.cities, units: data.units, countries, all: true, tintUnits: true });
    renderSide();
    goCapital();
  }

  const myCountry = () => S.data.countries.find(c => c.id === S.country);
  const capitalTile = c => { const cap = S.data.cities.find(x => x.kind === 'capital' && x.country === c.id); return cap ? cap.tile : -1; };
  function goCapital() { const t = capitalTile(myCountry()); if (t >= 0) S.map.centerOn(t, 0.6); }
  const colorOf = id => (S.map.st.countries[id] || {}).color || '#888';

  function onTile(id) {
    S.sel = S.sel === id ? null : id;   // 같은 칸을 다시 누르면 칸 선택 해제
    S.map.select(S.sel);
    renderSide();
  }

  // ================= 오른쪽 창 =================
  function renderSide() {
    const side = $('#side'); if (!side) return;
    side.innerHTML = '';
    side.append(picker());
    if (S.sel != null && S.sel >= 0 && S.map.st.tiles.get(S.sel)) return tileWindow(side, S.sel);
    side.append(countryWindow());
  }
  // 「어느 나라로 볼까요?」: 여섯 나라 중 하나 (미리보기에서만). 고르면 그 나라 수도로 지도가 이동해요
  function picker() {
    return h('div', { class: 'panel war-pick' },
      h('div', { class: 'panel-title' }, '어느 나라로 볼까요?', h('small', {}, '고르면 그 나라 수도로 이동해요')),
      h('div', { class: 'war-pick-row' }, S.data.countries.map(c =>
        h('button', {
          class: 'small war-pick-btn' + (c.id === S.country ? ' on' : ''), style: { '--gc': c.color },
          onclick: () => { S.country = c.id; S.sel = null; S.map.select(null); goCapital(); renderSide(); }
        }, c.id + '. ' + c.name))));
  }
  // 우리 나라: 이름·색·코인·병력 수·도시 수 (+창고)
  function countryWindow() {
    const c = myCountry();
    const inv = Object.entries(c.inventory || {}).filter(([, n]) => n > 0);
    return h('div', { class: 'panel' },
      h('div', { class: 'side-head' },
        h('div', {},
          h('div', { class: 'side-title' }, h('i', { class: 'war-dot', style: { background: c.color } }), ' ' + c.name),
          h('div', { class: 'muted' }, (R.TYPES[c.type] || {}).name || ''))),
      h('div', { class: 'war-stats' },
        h('span', { class: 'stat' }, h('span', { class: 'ico coin' }, 'C'), '코인 ', h('b', {}, c.coin)),
        h('span', { class: 'stat' }, '병력 ', h('b', {}, c.units + '부대')),
        h('span', { class: 'stat' }, '도시 ', h('b', {}, c.cities + '곳'))),
      inv.length ? h('div', { class: 'war-inv' }, h('small', { class: 'muted' }, '창고: '),
        inv.map(([k, n]) => h('span', { class: 'chip' }, ((R.ITEMS[k] || {}).name || k) + ' ' + n + '개'))) : null);
  }
  // 칸을 누르면: 지형, 주인 나라, 도시 이름, 병력 종류와 체력
  function tileWindow(side, id) {
    const t = S.map.st.tiles.get(id);
    const city = S.data.cities.find(x => x.tile === id);
    const us = S.data.units.filter(u => u.tile === id);
    const owner = t.owner ? myCountryOf(t.owner) : null;
    side.append(h('div', { class: 'panel' },
      h('div', { class: 'side-head' },
        h('button', { class: 'small', onclick: () => { S.sel = null; S.map.select(null); renderSide(); } }, '←'),
        h('div', {}, h('div', { class: 'side-title' }, '칸 정보'), h('div', { class: 'muted' }, '칸 번호 ' + id))),
      row('지형', R.TERRAIN[t.terrain] || t.terrain),
      t.res ? row('자원', (R.ITEMS[t.res] || {}).name || t.res) : null,
      t.imp ? row('시설', (R.IMPROVE[t.imp] || {}).name || t.imp) : null,
      row('주인', owner ? owner.name : '빈 땅 (주인 없어요)'),
      city ? row('도시', city.name + (city.kind === 'capital' ? ' (수도)' : '')) : null,
      city && !city.country && city.def != null ? row('도시국가', '방어 ' + city.def + ' · 체력 ' + city.hp + '/' + city.max_hp) : null,
      h('div', { class: 'war-units' },
        h('b', {}, '이 칸의 병력'),
        us.length ? us.map(u => h('div', { class: 'war-unit' },
          h('span', {}, h('i', { class: 'war-dot', style: { background: colorOf(u.country) } }), ' ' + ((R.UNITS[u.kind] || {}).name || u.kind)),
          h('span', { class: 'muted' }, '체력 ' + (u.hp == null ? 100 : u.hp))))
          : h('p', { class: 'muted' }, '이 칸에는 병력이 없어요.'))));
  }
  const myCountryOf = id => S.data.countries.find(c => c.id === id);
  const row = (k, v) => h('div', { class: 'war-row' }, h('small', { class: 'muted' }, k), h('b', {}, v));

  start();
})();
