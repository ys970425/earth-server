// 전쟁의 시간 학생 화면 틀 (E2 H5): 접속 확인 → 역할 고르기 → 역할별 화면
// 이동·전투·생산 등 메뉴 안 내용은 다음 단계(E3~E9)에서 열려요.
(function () {
  const R = window.RULES, W = window.WAR_RULES;
  const root = document.getElementById('app');
  const S = { me: null, known: {}, map: null, tiles: new Map(), units: [], cities: [], sel: null, tab: null };
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

  async function start() {
    // 미리보기 모드면 가짜 서버를 먼저 준비해요
    if (WarAPI.mode) {
      try { const state = await window.WarData.load(); WarAPI.makeFake(state); }
      catch (e) { console.error(e); return showError(friendly(e)); }
    }
    try { S.me = await WarAPI.rpc('war_me'); }
    catch (e) {
      if (e.code === 'NO_AUTH') return needAuth();
      console.error(e); return showError(friendly(e));
    }
    try { if (S.me.role) main(); else chooseRole(); }
    catch (e) { console.error(e); showError(friendly(e)); }
  }
  // 자바스크립트 영어 오류 문구는 그대로 보여 주지 않아요 (원문은 콘솔에만)
  const friendly = e => /^[A-Za-z0-9 .,:;'"()\-_[\]]+$/.test(e.message || '') ? '문제가 생겼어요. 새로고침해 주세요.' : e.message;
  // 무역 앱 로그인이 없으면: 무역 앱으로 가는 버튼을 보여 줘요 (새 로그인을 만들지 않아요)
  function needAuth() {
    root.innerHTML = '';
    root.append(h('div', { class: 'entry' },
      h('h1', {}, '지구 서버: 전쟁의 시간'),
      h('p', {}, '무역 앱에서 먼저 접속해 주세요. 같은 브라우저에서 접속하면 바로 이어져요.'),
      h('a', { href: '../trade/index.html' }, h('button', { class: 'primary big' }, '무역 앱으로 가기'))));
  }
  function showError(msg) {
    root.innerHTML = '';
    root.append(h('div', { class: 'entry' }, h('p', {}, msg)));
  }

  // ================= 역할 고르기 =================
  function chooseRole() {
    root.innerHTML = '';
    if (WarAPI.mode) root.append(h('div', { class: 'war-banner' + (WarAPI.mode === 'real' ? ' real' : '') },
      WarAPI.mode === 'real' ? '실제 데이터 미리보기: 우리 반 무역 게임 기록이에요 (여기서 바꿔도 저장되지 않아요)' : '미리보기 모드: 가짜 데이터예요'));
    const me = S.me;
    const engNote = me.country.size <= 4 ? ' (4명 모둠은 공병사령관이 없어요. 합동참모의장이 함께 해요)' : '';
    root.append(h('div', { class: 'entry' },
      h('h1', {}, h('i', { class: 'war-dot', style: { background: me.country.color } }), ' ' + me.country.name),
      h('p', { class: 'sub' }, '내가 맡을 역할을 골라요.' + engNote),
      h('div', { class: 'war-role-grid' }, me.roles.map(r => {
        const taken = !!r.nick;
        return h('button', {
          class: 'war-role' + (taken ? ' taken' : ''),
          style: { '--gc': me.country.color },
          disabled: taken || null,
          onclick: () => pick(r.key)
        },
          h('b', {}, r.name),
          taken ? h('small', {}, r.absent ? r.nick + ' (결석)' : r.nick + ' 님이 맡았어요') : h('small', {}, '빈 자리'));
      })),
      h('p', { class: 'muted' }, '역할 바꾸기는 선생님만 할 수 있어요.')));
  }
  async function pick(role) {
    try { await WarAPI.rpc('war_choose_role', { p_role: role }); }
    catch (e) { console.error(e); return showError(friendly(e)); }
    try { S.me = await WarAPI.rpc('war_me'); } catch (e) { console.error(e); return showError(friendly(e)); }
    main();
  }

  // ================= 역할별 화면 틀 =================
  function main() {
    root.innerHTML = '';
    if (WarAPI.mode) root.append(h('div', { class: 'war-banner' + (WarAPI.mode === 'real' ? ' real' : '') },
      WarAPI.mode === 'real' ? '실제 데이터 미리보기: 우리 반 무역 게임 기록이에요 (여기서 바꿔도 저장되지 않아요)' : '미리보기 모드: 가짜 데이터예요'));
    // 위쪽: 나라 · 내 역할 · 턴
    const top = h('div', { class: 'war-top', id: 'war-top' });
    // 지도 + 오른쪽 메뉴
    const canvas = h('canvas', { class: 'hexmap' });
    const wrap = h('div', { class: 'map-wrap' }, canvas,
      h('div', { class: 'map-tools' },
        h('button', { class: 'small', onclick: () => S.map.zoom(1.25), title: '크게 보기' }, '+'),
        h('button', { class: 'small', onclick: () => S.map.zoom(0.8), title: '작게 보기' }, '−'),
        h('button', { class: 'small', onclick: () => goCapital() }, '수도로')));
    root.append(top, h('div', { class: 'map-layout war-layout' }, wrap, h('div', { class: 'side panel', id: 'side' })));
    // 여섯 나라 모두를 지도에 넘긴다 (땅 색은 무역 앱 규칙의 나라 유형 색)
    const countries = Object.fromEntries(S.me.countries.map(c => [c.id,
      { color: (R.TYPES[c.type] || {}).color || '#888888', type: c.type, name: c.name, flag_url: null }]));
    S.map = WarHexMap.create(canvas, { onTile: id => { S.sel = S.sel === id ? null : id; S.map.select(S.sel); } });
    S.map.setData({ tiles: S.tiles, cities: S.cities, units: S.units, countries, all: true, tintUnits: true });
    renderTabs(); renderTop();
    WarAPI.startPoll(applyPoll);
  }
  function goCapital() {
    const cap = S.cities.find(x => x.kind === 'capital' && x.country === S.me.country.id);
    if (cap) S.map.centerOn(cap.tile, 0.6);
  }
  function renderTop() {
    const top = $('#war-top'); if (!top) return;
    const g = S.game || {};
    top.innerHTML = '';
    top.append(h('div', { class: 'war-top-in' },
      h('span', { class: 'war-top-name' }, h('i', { class: 'war-dot', style: { background: S.me.country.color } }), ' ' + S.me.country.name),
      h('span', { class: 'chip lead' }, S.me.role ? (W.ROLES.find(r => r.key === S.me.role) || {}).name : ''),
      h('span', { class: 'war-top-turn' }, '턴 ' + (g.turn ?? '-') + (g.turn_seconds ? ' · ' + Math.round(g.turn_seconds / 60) + '분' : '')),
      g.paused ? h('span', { class: 'chip' }, '일시정지') : null,
      g.combat_on === false ? h('span', { class: 'chip' }, '전투 끈 시간') : null));
  }
  // 메뉴 탭: 내 역할 메뉴 + 대행 중인 역할 탭 (설계 2장 표 그대로)
  function renderTabs() {
    const side = $('#side'); if (!side) return;
    const me = S.me;
    side.innerHTML = '';
    const tabs = me.menus.map(m => ({ label: m, key: 'menu:' + m }));
    for (const d of me.deputy_roles) tabs.push({ label: d.name + ' 대신하는 중', key: 'deputy:' + d.key, menus: d.menus });
    const active = S.tab || tabs[0].key;
    side.append(h('div', { class: 'war-tabs' }, tabs.map(t =>
      h('button', { class: 'war-tab' + (active === t.key ? ' on' : ''), onclick: () => { S.tab = t.key; renderTabs(); } }, t.label))));
    const body = h('div', { class: 'panel war-tab-body' },
      h('p', { class: 'muted' }, '「' + (tabs.find(t => t.key === active) || {}).label + '」 내용은 다음 단계에서 열려요.'),
      h('p', { class: 'muted' }, '지도는 아래에서 바로 볼 수 있어요.'));
    side.append(body);
    // 역할 현황 (우리 나라, 닉네임만)
    if (S.meCountryRoles) {
      side.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '우리 나라 역할'),
        h('div', { class: 'war-roles-list' }, S.meCountryRoles.map(r =>
          h('div', { class: 'war-row' }, h('small', { class: 'muted' }, r.name),
            h('b', {}, r.nick ? (r.absent ? r.nick + ' (결석)' : r.nick) : '빈 자리'))))));
    }
  }

  // ================= 4초마다 바뀐 것만 받기 =================
  // 지도·병력·도시 데이터를 먼저 적용하고, 화면 갱신(탭·위쪽 표시줄)은 그 뒤에 따로 해요.
  // 이렇게 나눠야 화면 갱신에서 문제가 생겨도 지도 데이터가 비지 않아요.
  function applyPoll(data) {
    if (data.map) {
      for (const t of data.map) {
        const [id, terrain, res, owner, imp, impRuined] = t;
        S.tiles.set(id, { terrain, res, owner, imp, imp_ruined: impRuined });
      }
      S.map.setData({ tiles: S.tiles });
    }
    if (data.units) { S.units = data.units; S.map.setData({ units: S.units }); }
    if (data.cities) { S.cities = data.cities; S.map.setData({ cities: S.cities }); }
    // 처음 데이터가 오면 우리 나라 수도로 지도를 옮겨요
    if (!S.centered && S.cities.length) { S.centered = true; goCapital(); }
    if (data.game) { S.game = data.game; renderTop(); }
    if (data.country) {
      if (data.country.roles) { S.meCountryRoles = data.country.roles; S.me.roles = data.country.roles; }
      if (data.country.coin != null) S.country = data.country;
      renderTabs();
    }
  }

  start();
})();
