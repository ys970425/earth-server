// 전쟁의 시간 학생 화면 틀 (E2 H5 파트3): 역할 바 + 역할별 메뉴
(function () {
  const R = window.RULES, W = window.WAR_RULES;
  const root = document.getElementById('app');
  const S = { me: null, known: {}, map: null, tiles: new Map(), units: [], cities: [], markets: [],
    market_stock: {}, sel: null, tab: null, selUnit: null, reach: null, centered: false,
    msg: null, country: null, view: 'map', deputy: null };
  const $ = s => document.querySelector(s);
  let turnTimer = 0;

  const ROLE_COLORS = { chief: '#D4A400', engineer: '#3A6B2F', army: '#7A1A1A', navy: '#1A4F7A', air: '#283593' };
  const ROLE_ICONS  = { chief: '⭐', engineer: '🏗', army: '⚔', navy: '⚓', air: '✈' };
  const ALL_ROLES = [
    { key: 'chief',    name: '합동참모의장' },
    { key: 'engineer', name: '공병' },
    { key: 'army',     name: '육군' },
    { key: 'navy',     name: '해군' },
    { key: 'air',      name: '공군' },
  ];
  const NAV = [
    { key: 'map',       label: '지도',  roles: null },
    { key: 'mission',   label: '미션',  roles: null },
    { key: 'budget',    label: '예산',  roles: ['chief'] },
    { key: 'requests',  label: '요청함', roles: ['chief'] },
    { key: 'diplomacy', label: '외교',  roles: ['chief'] },
    { key: 'trade',     label: '무역',  roles: ['chief'] },
    { key: 'market',    label: '시장',  roles: ['chief'] },
    { key: 'build',     label: '건설',  roles: ['engineer'] },
    { key: 'repair',    label: '수리',  roles: ['engineer'] },
    { key: 'request',   label: '요청',  roles: ['engineer', 'army', 'navy', 'air'] },
    { key: 'produce',   label: '생산',  roles: ['army', 'navy', 'air'] },
    { key: 'units',     label: '부대',  roles: ['army', 'navy', 'air'] },
  ];
  const COMBAT_KINDS = ['spear','catapult','knight','musket','cannon','infantry','artillery','tank',
    'trireme','frigate','battleship','destroyer','cruiser','fighter',
    'k_missile','j_patrol','c_jet','a_stealth','n_hyper','t_marine'];

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
    if (WarAPI.mode) root.textContent = '미리보기를 준비하고 있어요 (몇 초 걸려요)';
    try { S.me = await WarAPI.rpc('war_me'); }
    catch (e) {
      if (e.code === 'NO_AUTH') return needAuth();
      console.error(e); return showError(friendly(e));
    }
    try { main(); }
    catch (e) { console.error(e); showError(friendly(e)); }
  }
  const friendly = e => /^[A-Za-z0-9 .,:;'"()\-_[\]]+$/.test(e.message || '') ? '문제가 생겼어요. 새로고침해 주세요.' : e.message;
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

  // ================= 역할 고르기 / 역할 바 =================
  async function pick(role) {
    try { await WarAPI.rpc('war_choose_role', { p_role: role }); }
    catch (e) { console.error(e); return showError(friendly(e)); }
    try { S.me = await WarAPI.rpc('war_me'); } catch (e) { console.error(e); return showError(friendly(e)); }
    S.tab = null; S.selUnit = null; S.reach = null; S.view = 'map'; S.deputy = null;
    S.missions = null; loadMissions();
    renderRoleBar(); renderNav(); renderView();
  }
  function renderRoleBar() {
    const bar = $('#war-role-bar'); if (!bar) return;
    bar.innerHTML = '';
    window.WAR_ROLE = actingRole() || 'common';
    const me = S.me, myRole = me.role, acting = actingRole();
    for (const r of ALL_ROLES) {
      const info = (me.roles || []).find(x => x.key === r.key);
      const noSeat = !info;
      const taken = !myRole && !noSeat && !!info.nick;
      const isActing = acting === r.key;
      const isMe = myRole === r.key;
      let onclick = null;
      if (!myRole && !taken && !noSeat) onclick = () => pick(r.key);
      else if (myRole === 'chief') onclick = () => {
        S.deputy = r.key === myRole ? null : r.key;
        renderRoleBar(); renderNav(); renderView();
      };
      const disabled = (noSeat || (myRole && myRole !== 'chief') || (!myRole && taken)) ? '' : null;
      bar.append(h('button', {
        class: 'war-role-btn' + (isActing ? ' on' : '') + (isMe && !isActing ? ' my' : ''),
        style: { '--rc': ROLE_COLORS[r.key] || '#888' },
        disabled,
        onclick,
        title: !myRole && taken && info ? (info.nick + ' 님이 맡았어요') : null,
      }, h('span', { class: 'role-icon' }, ROLE_ICONS[r.key] || '?'),
         h('span', { class: 'role-name' }, r.name)));
    }
  }

  // ================= 메뉴 바 / 뷰 전환 =================
  function main() {
    root.innerHTML = '';
    if (WarAPI.mode) root.append(h('div', { class: 'war-banner' + (WarAPI.mode === 'real' ? ' real' : '') },
      WarAPI.mode === 'real' ? '실제 데이터 미리보기: 우리 반 무역 게임 기록이에요 (여기서 바꿔도 저장되지 않아요)' : '미리보기 모드: 가짜 데이터예요'));
    root.append(
      h('div', { class: 'war-role-bar', id: 'war-role-bar' }),
      h('div', { class: 'war-nav',      id: 'war-nav' }),
      h('div', { class: 'war-view',     id: 'war-view' })
    );
    renderRoleBar(); renderNav(); renderView();
    if (S.me.role) loadMissions();
    WarAPI.startPoll(applyPoll);
  }
  function goView(key) {
    S.view = key;
    if (key === 'mission') {
      loadMissions();
      if (S.me?.role === 'chief') S.pendingMark = 'chief_info';
    }
    renderNav(); renderView();
  }
  function renderNav() {
    const el = $('#war-nav'); if (!el) return;
    el.innerHTML = '';
    const role = actingRole();
    const is4Group = (S.me?.country?.size || 5) <= 4;
    const tabs = NAV.filter(n => {
      if (!n.roles) return true;
      if (role && n.roles.includes(role)) return true;
      if (role === 'chief' && is4Group && (n.key === 'build' || n.key === 'repair')) return true;
      return false;
    });
    if (!tabs.some(t => t.key === S.view)) S.view = tabs[0]?.key || 'map';
    tabs.forEach(t => el.append(
      h('button', { class: 'war-nav-btn' + (S.view === t.key ? ' on' : ''), onclick: () => goView(t.key) }, t.label)));
  }
  function renderView() {
    const view = $('#war-view'); if (!view) return;
    view.innerHTML = '';
    if (S.view === 'budget')    return renderBudgetView(view);
    if (S.view === 'requests')  return renderRequestsView(view);
    if (S.view === 'request')   return renderRequestView(view);
    if (S.view === 'diplomacy') return renderDiplomacyView(view);
    if (S.view === 'trade')     return renderTradeView(view);
    if (S.view === 'market')    return renderMarketView(view);
    if (S.view === 'mission')   return renderMissionView(view);
    if (S.view === 'build')     return renderBuildView(view);
    if (S.view === 'repair')    return renderRepairView(view);
    if (S.view === 'produce')   return renderProduceView(view);
    if (S.view === 'units')     return renderUnitsView(view);
    return mapView(view);
  }

  // ================= 지도 뷰 =================
  function mapView(view) {
    view.style.position = 'relative';
    const canvas = h('canvas', { class: 'hexmap' });
    const wrap = h('div', { class: 'map-wrap' }, canvas,
      h('div', { class: 'map-tools' },
        h('button', { class: 'small', onclick: () => S.map.zoom(1.25), title: '크게 보기' }, '+'),
        h('button', { class: 'small', onclick: () => S.map.zoom(0.8), title: '작게 보기' }, '−'),
        h('button', { class: 'small', onclick: () => goCapital() }, '수도로')));
    view.append(h('div', { class: 'map-layout war-layout' }, wrap, h('div', { class: 'side panel', id: 'side' })));
    const countries = Object.fromEntries(S.me.countries.map(c => [c.id,
      { color: (R.TYPES[c.type] || {}).color || '#888888', type: c.type, name: c.name, flag_url: null }]));
    S.map = WarHexMap.create(canvas, { onTile });
    S.map.setData({ tiles: S.tiles, cities: S.cities, units: S.units, countries, markets: S.markets, all: true, tintUnits: true });
    renderTabs();
  }
  function goCapital() {
    const cap = S.cities.find(x => x.kind === 'capital' && x.country === S.me.country.id);
    if (cap) S.map.centerOn(cap.tile, 0.6);
  }
  function onTile(id) {
    const sel = S.units.find(u => u.id === S.selUnit);
    if (sel && S.reach && S.reach.stops.includes(id)) {
      const path = []; for (let p = id; p !== sel.tile; p = S.reach.prev.get(p)) path.unshift(p);
      WarAPI.rpc('war_move', { p_unit: sel.id, p_path: path })
        .then(r => {
          S.msg = null; clearUnit();
          const u = S.units.find(x => x.id === sel.id);
          if (u) { u.tile = r.tile; u.moves_left = r.moves_left; S.map.setData({ units: S.units }); }
          markMoveMission(sel, path, r);
          renderTabs();
        })
        .catch(e => { console.error(e); S.msg = friendly(e); renderTabs(); });
      return;
    }
    if (sel && S.attacks && S.attacks.has(id)) { showAttackPreview(sel, id); return; }
    const mine = S.units.find(u => u.tile === id && W.isMyUnit(u, S.me.country.id, actingRole()));
    if (mine) { selectUnit(mine); return; }
    S.sel = S.sel === id ? null : id;
    S.map.select(S.sel); clearUnit(); renderTabs();
  }

  // ================= 지도 오른쪽 패널 (지도 뷰 전용) =================
  const UNIT_NAMES = { worker: '노동자', scout: '정찰병' };
  const kindLabel  = k => ((R.UNITS[k] || {}).name || (W.EXTRA_UNITS[k] || {}).name || UNIT_NAMES[k] || '병력');
  const ruleOf     = k => R.UNITS[k] || W.EXTRA_UNITS[k] || {};
  const isCivil    = k => k === 'worker' || k === 'scout';
  const actingRole = () => S.deputy || S.me?.role;
  function renderTabs() {
    if (S.view !== 'map') { renderView(); return; }
    window.WAR_ROLE = actingRole() || 'common';
    const side = $('#side'); if (!side) return;
    side.innerHTML = '';
    const role = actingRole();
    if (S.sel != null && !S.selUnit) side.append(tileInfo(S.sel));
    const body = h('div', { class: 'panel' });
    if (!role) {
      body.append(h('p', { class: 'muted' }, '역할 바에서 역할을 고른 뒤 지도를 써요.'));
    } else if (role === 'engineer') {
      const units = S.units.filter(u => W.isMyUnit(u, S.me.country.id, role) && (u.kind === 'worker' || u.kind === 'scout'));
      body.append(h('div', { class: 'panel-title' }, '공병 병력', h('small', {}, units.length + '부대')));
      body.append(units.length ? h('div', { class: 'war-units-list' }, units.map(u =>
        h('button', { class: 'war-unit-row' + (S.selUnit === u.id ? ' on' : ''), onclick: () => selectUnit(u) },
          h('b', {}, kindLabel(u.kind)), h('span', {}, '체력 ' + u.hp),
          h('span', { class: 'muted' }, '남은 이동 ' + (u.moves_left ?? 0)))))
        : h('p', { class: 'muted' }, '노동자·정찰병이 없어요.'));
    } else {
      const list = S.units.filter(u => W.isMyUnit(u, S.me.country.id, role) && COMBAT_KINDS.includes(u.kind));
      body.append(h('div', { class: 'panel-title' }, '내 병력', h('small', {}, list.length + '부대 · 눌러서 이동')));
      body.append(list.length ? h('div', { class: 'war-units-list' }, list.map(u =>
        h('button', { class: 'war-unit-row' + (S.selUnit === u.id ? ' on' : ''), onclick: () => selectUnit(u) },
          h('b', {}, kindLabel(u.kind)), h('span', {}, '체력 ' + u.hp),
          h('span', { class: 'muted' }, '남은 이동 ' + (u.moves_left ?? 0)))))
        : h('p', { class: 'muted' }, '내가 조종하는 병력이 없어요.'));
      if (['army', 'navy', 'air'].includes(role) && S.me.role === role && list.length) {
        body.append(h('div', { class: 'panel-title' }, '지휘권 넘기기'),
          h('div', { class: 'war-units-list' }, list.map(u =>
            h('div', { class: 'war-unit-row' },
              h('b', {}, kindLabel(u.kind)), h('span', { class: 'muted' }, '체력 ' + u.hp),
              h('div', { class: 'row' }, ['army', 'navy', 'air'].filter(b => b !== u.commander).map(b =>
                h('button', { class: 'small', onclick: () => doTransfer(u, b) },
                  { army: '육군', navy: '해군', air: '공군' }[b])))))));
      }
    }
    side.append(body);
    if (S.msg) side.append(h('div', { class: 'war-msg' }, S.msg));
  }

  // ================= 헬퍼 =================
  const itemName   = k => k === 'coin' ? '코인' : R.ITEMS[k]?.name || k;
  const costText   = cost => Object.entries(cost || {}).map(([k, v]) => itemName(k) + ' ' + v).join(' · ');
  const facName    = k => (R.BUILDINGS[k] || R.FACTORIES[k] || R.ADVANCED[k])?.name || k;
  function coinTile(qty) {
    return h('div', { class: 'war-res-tile coin' },
      h('span', { class: 'res-qty' }, String(qty ?? 0)),
      h('span', { class: 'res-name' }, '코인'));
  }
  function resTile(k, qty) {
    return h('div', { class: 'war-res-tile' },
      h('span', { class: 'res-qty' }, String(qty)),
      h('span', { class: 'res-name' }, itemName(k)));
  }
  function resShelf(coin, inventory) {
    const shelf = h('div', { class: 'war-res-shelf' });
    shelf.append(coinTile(coin));
    for (const [k, qty] of Object.entries(inventory || {})) if (qty > 0) shelf.append(resTile(k, qty));
    return shelf;
  }
  function selectBox(id, entries, value, change) {
    const el = h('select', { id, 'aria-label': id, onchange: change },
      entries.map(([key, name]) => h('option', { value: key }, name)));
    if (value != null) el.value = value;
    return el;
  }
  async function economyAction(fn, args, mission) {
    if (S.economyBusy) return;
    S.economyBusy = true;
    try {
      await WarAPI.rpc(fn, args); S.msg = null;
      if (mission) mark(mission);
      applyPoll(await WarAPI.rpc('war_poll', { p_known: {} }));
    } catch (e) { S.msg = friendly(e); }
    finally { S.economyBusy = false; renderTabs(); }
  }
  function appendMsg(wrap) { if (S.msg) wrap.append(h('div', { class: 'war-msg' }, S.msg)); }

  // ================= 역할별 콘텐츠 =================
  function renderProduction(body, role) {
    const turn = S.game?.turn;
    const cities = S.cities.filter(c => c.country === S.me.country.id &&
      (role === 'air' ? c.kind === 'capital' : (c.buildings || []).includes(role === 'army' ? 'barracks' : 'harbor')));
    if (!cities.length) { body.append(h('p', {}, '생산할 수 있는 도시가 없어요')); return; }
    const city = cities.find(c => c.id === S.produceCity) || cities[0]; S.produceCity = city.id;
    const busy = city.produced_turn === turn;
    body.append(h('label', {}, '도시 선택 ', selectBox('produce-city', cities.map(c =>
      [c.id, (c.produced_turn === turn ? '🔒 ' : '') + (c.name || c.id)]), city.id,
      e => { S.produceCity = e.target.value; renderTabs(); })));
    const country = S.poll?.country || {}, wallet = country.wallets?.[role] || {};
    body.append(h('p', {}, '내 재고: ' + costText(wallet)));
    const defs = Object.entries({ ...R.UNITS, ...W.EXTRA_UNITS }).filter(([k, d]) =>
      W.BRANCH[k] === role && (!d.boss || R.BOSS_UNIT[S.me.country.type]?.unit === k));
    body.append(h('table', {}, h('thead', {}, h('tr', {}, ['종류', '힘', '이동', '필요한 것', '생산'].map(t => h('th', {}, t)))),
      h('tbody', {}, defs.map(([kind, def]) => {
        const needs = def.boss ? R.BOSS_UNIT[S.me.country.type]?.needs || [] : [];
        const locked = busy || S.game?.paused || S.economyBusy ||
          Object.entries(def.cost || {}).some(([k, n]) => (wallet[k] || 0) < n) ||
          needs.some(k => (country.inventory?.[k] || 0) < 1);
        return h('tr', {},
          h('td', {}, def.name), h('td', {}, def.boss ? W.BOSS.str() : def.str),
          h('td', {}, W.MOVES_OF(kind)), h('td', {}, costText(def.cost)),
          h('td', {}, h('button', { disabled: locked || null,
            onclick: () => economyAction('war_produce', { p_city: city.id, p_kind: kind }, role + '_build')
          }, locked ? '🔒 만들기' : '만들기')));
      }))));
  }
  function renderBudget(body) {
    const country = S.poll?.country || {}, roles = W.ROLES.filter(r => r.key !== 'chief');
    body.append(h('div', { class: 'panel-title' }, '나라 금고'));
    body.append(resShelf(country.coin, country.inventory));
    body.append(h('div', { class: 'panel-title' }, '현재 재고'));
    body.append(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '역할'), h('th', {}, '코인 · 자원'))),
      h('tbody', {}, roles.map(r => h('tr', {},
        h('td', {}, r.name), h('td', {}, costText({ coin: 0, ...country.wallets?.[r.key] })))))));
    for (const [take, prefix, titleTxt, btnTxt, rparam] of [
      [false, 'budget-give', '나눠 주기', '나눠 주기', 'p_to_role'],
      [true,  'budget-take', '돌려받기',  '돌려받기',  'p_from_role'],
    ]) {
      const role = selectBox(prefix + '-role', roles.map(r => [r.key, r.name]));
      const item = selectBox(prefix + '-item', ['coin', ...Object.keys(R.ITEMS)].map(k => [k, itemName(k)]));
      const qty  = h('input', { id: prefix + '-qty', 'aria-label': '양', type: 'number', min: 1, step: 1, value: 1 });
      body.append(h('div', { class: 'panel-title' }, titleTxt),
        h('div', { class: 'row' }, role, item, qty,
          h('button', { onclick: () => {
            const n = Number(qty.value);
            if (!Number.isSafeInteger(n) || n <= 0) { S.msg = '양은 0보다 큰 정수로 써 주세요'; renderTabs(); return; }
            economyAction(take ? 'war_budget_take' : 'war_budget_give',
              { [rparam]: role.value, p_item: item.value, p_qty: n },
              take ? null : 'chief_budget');
          } }, btnTxt)));
    }
  }
  function renderBuildings(body) {
    const cities = S.cities.filter(c => c.country === S.me.country.id);
    if (!cities.length) { body.append(h('p', {}, '우리 도시가 없어요')); return; }
    const city = cities.find(c => c.id === S.buildCity) || cities[0]; S.buildCity = city.id;
    body.append(h('label', {}, '도시 선택 ', selectBox('build-city', cities.map(c => [c.id, c.name || c.id]), city.id,
      e => { S.buildCity = e.target.value; renderTabs(); })),
      h('h3', {}, (city.name || city.id) + '의 건물'),
      h('p', {}, '현재 건물: ' + ((city.buildings || []).map(facName).join(', ') || '없음')));
    for (const f of S.poll?.country?.facilities || []) if (f.city === city.id)
      body.append(h('p', {}, facName(f.kind) + (f.ruined ? ' (파괴됨)' : ' (정상)')));
    const category = S.buildCategory || 'BUILDINGS';
    const defs = R[category], kind = defs[S.buildKind] ? S.buildKind : Object.keys(defs)[0]; S.buildKind = kind;
    let cost = defs[kind].cost || defs[kind].build;
    if (category === 'FACTORIES' && R.SPECIALTY[S.me.country.type]?.factory === kind) cost = R.SPECIALTY_BUILD;
    body.append(h('h3', {}, '짓기'),
      selectBox('build-category', [['BUILDINGS', '기본 건물'], ['FACTORIES', '공장'], ['ADVANCED', '고등 건물']], category,
        e => { S.buildCategory = e.target.value; S.buildKind = null; renderTabs(); }),
      selectBox('build-kind', Object.entries(defs).map(([k, d]) => [k, d.name]), kind,
        e => { S.buildKind = e.target.value; renderTabs(); }),
      h('p', {}, '필요한 것: ' + costText(cost)),
      h('button', { onclick: () => economyAction('war_city_build', { p_city: city.id, p_kind: kind }, 'eng_build') }, '짓기'));
  }
  function repairCost(f) {
    const type = S.me.countries.find(c => c.id === f.origin_country)?.type;
    const specialty = f.class === 'factory' && R.SPECIALTY[type]?.factory === f.kind;
    const original = specialty ? R.SPECIALTY_BUILD : f.class === 'factory' ? R.FACTORIES[f.kind]?.build : R.ADVANCED[f.kind]?.cost;
    const cost = Object.fromEntries(Object.entries(original || {}).map(([k, n]) => [k, Math.floor(n / 2)]));
    if (specialty && R.STRAT_OF[type]) cost[R.STRAT_OF[type]] = (cost[R.STRAT_OF[type]] || 0) + 1;
    return cost;
  }
  function renderRepairs(body) {
    const workers = S.units.filter(u => u.kind === 'worker' && W.isMyUnit(u, S.me.country.id, 'engineer'));
    const selected = workers.find(u => u.id === S.repairWorker) || workers[0]; S.repairWorker = selected?.id;
    body.append(h('h3', {}, '수리 가능한 시설 목록'), h('label', {}, '노동자를 고르세요 ',
      selectBox('repair-worker', workers.map(u => [u.id, '노동자 ' + u.id + ' (칸 ' + u.tile + ')']), selected?.id,
        e => { S.repairWorker = Number(e.target.value); renderTabs(); })));
    if (!workers.length) body.append(h('p', {}, '공병 노동자가 없어요'));
    const tileNames = { farm: '농장', quarry: '채석장', lumber: '벌목장', mine: '광산', oilwell: '유정', plantation: '농원' };
    const repairRow = (text, target, tile, cost) => h('div', {},
      h('p', {}, text + ' (파괴됨) · 필요한 것: ' + costText(cost)),
      h('button', { disabled: !selected || selected.tile !== tile || selected.moves_left <= 0 || null,
        onclick: () => economyAction('war_repair', { p_unit: S.repairWorker, p_target: target }, 'eng_repair') }, '수리하기'));
    body.append(h('h3', {}, '파괴된 타일 시설'));
    for (const [id, t] of S.tiles) if (t.owner === S.me.country.id && t.imp_ruined)
      body.append(repairRow('칸 ' + id + ' - ' + (tileNames[t.imp] || t.imp), 'tile:' + id, id,
        { coin: { farm: 5, quarry: 5, lumber: 5, mine: 8, oilwell: 8, plantation: 10 }[t.imp] }));
    body.append(h('h3', {}, '파괴된 도시 시설'));
    for (const f of S.poll?.country?.facilities || []) if (f.ruined) {
      const city = S.cities.find(c => c.id === f.city && c.country === S.me.country.id);
      if (city) body.append(repairRow(f.city + ' ' + facName(f.kind), 'city:' + f.city + ':' + f.kind, city.tile, repairCost(f)));
    }
  }
  function renderMarket(body) {
    const country = S.poll?.country || {};
    const specialty = W.SPECIALTY_ITEM[S.me.country.id];
    const hasSpecialty = (country.inventory?.[specialty] || 0) >= 1;
    body.append(h('p', {}, '보유 코인: ' + (country.coin ?? 0)));
    if (!S.markets.length) { body.append(h('p', {}, '아직 시장이 없어요.')); return; }
    const market = S.markets.find(m => m.id === S.marketId) || S.markets[0];
    S.marketId = market.id;
    body.append(h('div', { class: 'row' }, S.markets.map(m => h('button', {
      class: m.id === market.id ? 'on' : '',
      onclick: () => { S.marketId = m.id; renderTabs(); }
    }, m.name))));
    for (const [key, qty] of Object.entries(S.market_stock)) {
      if (!key.startsWith(market.id + ':')) continue;
      const item = key.slice(key.indexOf(':') + 1), ref = R.ITEMS[item]?.ref;
      if (ref == null) continue;
      const tariff = W.MARKET.tariff(ref), cost = tariff * (hasSpecialty ? 1 : 2);
      body.append(h('div', { class: 'war-market-card' },
        h('div', { class: 'card-title' }, itemName(item)),
        h('div', { class: 'card-meta' }, '재고 ' + qty + '개 · 원래 값 ' + ref),
        h('div', { class: 'card-cost' }, '필요한 것: ' + (hasSpecialty ? itemName(specialty) + ' 1개 + ' : '') + cost + ' 코인'),
        h('button', { disabled: (S.economyBusy || qty < 1 || (country.coin ?? 0) < cost) || null,
          onclick: () => economyAction('war_market_buy', { p_market: market.id, p_item: item }, 'chief_market')
        }, '구매')));
    }
  }
  function renderDiplomacy(body) {
    const mine = S.me.country.id, turn = S.poll?.game?.turn ?? 0;
    const name  = id => S.me.countries.find(c => c.id === id)?.name || id + '번 나라';
    const color = id => { const c = S.me.countries.find(x => x.id === id); return (R.TYPES[c?.type] || {}).color || '#888'; };
    for (const d of S.poll?.diplomacy || []) {
      if (d.a !== mine && d.b !== mine) continue;
      const other = d.a === mine ? d.b : d.a, war = d.status === 'war', ally = d.status === 'ally';
      const statusEl = ally ? h('span', { class: 'good' }, '🤝 동맹')
        : war  ? h('span', { class: 'bad' }, '⚔ 전쟁 중')
        : h('span', { class: 'good' }, '🕊 평화' + (d.no_war_until > turn ? ` (${d.no_war_until - turn}턴 선포 금지)` : ''));
      body.append(
        h('div', { class: 'war-country-card' },
          h('i', { class: 'war-dot', style: { background: color(other), width: '20px', height: '20px' } }),
          h('span', { class: 'cc-name' }, name(other)),
          h('span', { class: 'cc-status' }, statusEl)),
        h('div', { class: 'row', style: { marginBottom: '10px' } },
          ...(!war && !ally ? [h('button', { class: 'small', onclick: () => {
            if (!confirm('동맹을 제안할까요?')) return;
            diplomacyAction('war_propose', { p_other: other, p_kind: 'ally' });
          } }, '동맹 제안')] : []),
          h('button', { class: 'small', onclick: () => {
            if (!war && !confirm('선전포고하면 바로 전쟁이 시작돼요. 계속할까요?')) return;
            diplomacyAction(war ? 'war_propose' : 'war_declare',
              war ? { p_other: other, p_kind: 'peace' } : { p_other: other });
          } }, war ? '평화 제안' : '선전포고')));
    }
    body.append(h('div', { class: 'panel-title' }, '받은 제안'));
    for (const o of S.poll?.offers || []) if (o.to_c === mine)
      body.append(h('div', { class: 'row' },
        name(o.from_c) + (o.kind === 'ally' ? ' 동맹 제안' : ' 평화 제안'),
        h('button', { class: 'small', onclick: () => diplomacyAction('war_accept_offer', { p_offer: o.id }) }, '수락')));
  }
  async function diplomacyAction(fn, args) {
    try { await WarAPI.rpc(fn, args); S.msg = null; applyPoll(await WarAPI.rpc('war_poll', { p_known: {} })); }
    catch (e) { S.msg = friendly(e); }
    renderTabs();
  }
  function renderTrade(body) {
    const mine = S.me.country.id;
    const name  = id => S.me.countries.find(c => c.id === id)?.name || id + '번 나라';
    const wallet = S.poll?.country?.wallets?.chief || {};
    const myItems = Object.keys(wallet).filter(k => wallet[k] > 0);
    const allItems = Object.keys(R.ITEMS);
    const iLabel   = k => (R.ITEMS[k] || {}).name || k;
    const wars = new Set((S.poll?.diplomacy || []).filter(d => d.status === 'war').map(d => d.a === mine ? d.b : d.a));
    const others = S.me.countries.filter(c => c.id !== mine);
    const toSel   = h('select', {}, others.map(c => h('option', { value: c.id, disabled: wars.has(c.id) ? '' : null },
      name(c.id) + (wars.has(c.id) ? ' (전쟁 중)' : ''))));
    const giveSel = h('select', {}, myItems.map(k => h('option', { value: k }, iLabel(k))));
    const giveQty = h('input', { type: 'number', min: 1, value: 1, style: { width: '70px' } });
    const wantSel = h('select', {}, allItems.map(k => h('option', { value: k }, iLabel(k))));
    const wantQty = h('input', { type: 'number', min: 1, value: 1, style: { width: '70px' } });
    body.append(h('div', { class: 'panel-title' }, '무역 제안', h('small', {}, '재고 물건을 다른 나라와 바꿔요')));
    body.append(h('div', { class: 'war-trade-card' },
      h('div', { class: 'row' }, h('label', {}, '상대 나라 ', toSel)),
      h('div', { class: 'row' },
        h('label', {}, '줄 것 ', giveSel, giveQty),
        h('label', {}, '받을 것 ', wantSel, wantQty)),
      h('button', { class: 'primary', onclick: () => {
        const other = +toSel.value;
        if (wars.has(other)) return;
        const give = { [giveSel.value]: +giveQty.value || 1 }, want = { [wantSel.value]: +wantQty.value || 1 };
        if (!giveSel.value || give[giveSel.value] > (wallet[giveSel.value] || 0)) {
          S.msg = '재고에 그 물건이 부족해요'; renderTabs(); return;
        }
        diplomacyAction('war_trade_propose', { p_other: other, p_give: give, p_want: want });
      } }, '무역 제안')));
    const tradeOffers = (S.poll?.offers || []).filter(o => o.kind === 'trade' && o.to_c === mine);
    body.append(h('div', { class: 'panel-title' }, '받은 무역 제안', h('small', {}, tradeOffers.length + '건')));
    for (const o of tradeOffers) {
      const give = Object.entries(o.data?.give || {}).map(([k, n]) => iLabel(k) + ' ' + n + '개').join(', ');
      const want = Object.entries(o.data?.want || {}).map(([k, n]) => iLabel(k) + ' ' + n + '개').join(', ');
      body.append(h('div', { class: 'war-trade-card row' },
        h('span', {}, name(o.from_c) + '가 ' + give + '을 주고 ' + want + '을 원해요'),
        h('button', { class: 'small', onclick: () => diplomacyAction('war_trade_accept', { p_offer: o.id }) }, '수락')));
    }
    if (!tradeOffers.length) body.append(h('p', { class: 'muted' }, '받은 무역 제안이 없어요.'));
  }

  // ================= 뷰 래퍼 =================
  function renderBudgetView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel' });
    renderBudget(body);
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderRequestsView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel' });
    body.append(h('div', { class: 'panel-title' }, '요청함'), h('p', { class: 'muted' }, '불러오는 중...'));
    wrap.append(body); view.append(wrap);
    WarAPI.rpc('war_budget_state', { p_country: S.me.country.id })
      .then(state => {
        body.innerHTML = '';
        body.append(h('div', { class: 'panel-title' }, '요청함', h('small', {}, '각 역할의 예산 요청')));
        const reqs = (state.requests || []).filter(r => r.status === 'pending');
        if (!reqs.length) {
          body.append(h('p', { class: 'muted' }, '대기 중인 요청이 없어요.'));
        } else {
          for (const req of reqs) {
            const roleName = (W.ROLES.find(r => r.key === req.role) || {}).name || req.role;
            const itemsText = Object.entries(req.items || {}).map(([k, n]) => itemName(k) + ' ' + n).join(', ');
            body.append(h('div', { class: 'war-trade-card' },
              h('b', {}, roleName + ' → ' + itemsText + (req.note ? ' (' + req.note + ')' : '')),
              h('div', { class: 'row', style: { marginTop: '8px' } },
                h('button', { class: 'primary small',
                  onclick: () => economyAction('war_budget_approve', { p_id: req.id, p_items: req.items }, 'chief_budget')
                }, '승인'),
                h('button', { class: 'small',
                  onclick: () => economyAction('war_budget_reject', { p_id: req.id, p_note: '거절' }, null)
                }, '거절'))));
          }
        }
      })
      .catch(e => { body.innerHTML = ''; body.append(h('p', { class: 'muted' }, '요청함을 불러오지 못했어요.')); console.error(e); });
  }
  function renderRequestView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel' });
    const role = S.me.role, country = S.poll?.country || {}, wallet = country.wallets?.[role] || {};
    body.append(h('div', { class: 'panel-title' }, '내 재고'));
    body.append(resShelf(wallet.coin, Object.fromEntries(Object.entries(wallet).filter(([k]) => k !== 'coin'))));
    body.append(h('div', { class: 'panel-title' }, '예산 요청'));
    const coinQty = h('input', { type: 'number', min: 0, value: 0, style: { width: '70px' } });
    const noteEl  = h('input', { type: 'text', placeholder: '요청 사유 (선택)', style: { flex: '1', marginTop: '8px' } });
    body.append(h('div', { class: 'row' }, h('label', {}, '코인 ', coinQty)), noteEl,
      h('button', { class: 'primary', onclick: () => {
        const items = {}, c = Number(coinQty.value);
        if (c > 0) items.coin = c;
        if (!Object.keys(items).length) { S.msg = '요청할 양을 입력해요'; renderView(); return; }
        economyAction('war_budget_request', { p_items: items, p_note: noteEl.value || null }, null);
      } }, '요청하기'));
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderDiplomacyView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel' });
    renderDiplomacy(body);
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderTradeView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel' });
    renderTrade(body);
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderMarketView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel' });
    renderMarket(body);
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderBuildView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel war-tab-body' });
    renderBuildings(body);
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderRepairView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel war-tab-body' });
    renderRepairs(body);
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderProduceView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel war-tab-body' });
    renderProduction(body, actingRole());
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  function renderUnitsView(view) {
    const wrap = h('div', { class: 'war-nation' }), body = h('div', { class: 'panel war-tab-body' });
    const role = actingRole();
    const list = S.units.filter(u => W.isMyUnit(u, S.me.country.id, role) && COMBAT_KINDS.includes(u.kind));
    body.append(h('div', { class: 'panel-title' }, '내 부대', h('small', {}, list.length + '부대 · 눌러서 지도로')));
    if (list.length) {
      body.append(h('div', { class: 'war-units-list' }, list.map(u =>
        h('button', { class: 'war-unit-row' + (S.selUnit === u.id ? ' on' : ''),
          onclick: () => { goView('map'); setTimeout(() => selectUnit(u), 50); } },
          h('b', {}, kindLabel(u.kind)), h('span', {}, '체력 ' + u.hp),
          h('span', { class: 'muted' }, '남은 이동 ' + (u.moves_left ?? 0))))));
    } else {
      body.append(h('p', { class: 'muted' }, '내가 조종하는 병력이 없어요.'));
    }
    wrap.append(body); appendMsg(wrap); view.append(wrap);
  }
  async function doTransfer(u, to) {
    try { await WarAPI.rpc('war_transfer', { p_unit: u.id, p_to: to }); S.msg = null;
      if (actingRole() === 'army') mark('army_transfer');
      else if (actingRole() === 'air') mark('air_transfer');
    }
    catch (e) { console.error(e); S.msg = friendly(e); }
    renderTabs();
  }

  // ================= 미션 뷰 =================
  function renderMissionView(view) {
    const me = S.me, wrap = h('div', { class: 'war-nation' });
    view.append(wrap);
    if (me.role) {
      wrap.append(h('div', { class: 'panel' },
        h('div', { class: 'panel-title' }, '튜토리얼 미션', h('small', {}, '해낼 때마다 여기에 기록해요')),
        h('div', { id: 'war-missions-body' }, S.missions ? missionList() : h('p', { class: 'muted' }, '미션을 불러오는 중…'))));
    }
    wrap.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, '나라 정보'),
      h('p', {}, h('i', { class: 'war-dot', style: { background: me.country.color } }), ' ' + me.country.name +
        ' · ' + ((R.TYPES[me.country.type] || {}).name || '')),
      h('p', {}, '코인 ' + (S.country && S.country.coin != null ? S.country.coin : '-'))));
    if (S.meCountryRoles) {
      wrap.append(h('div', { class: 'panel' },
        h('div', { class: 'panel-title' }, '우리 나라 역할 현황'),
        h('div', { class: 'war-roles-list' }, S.meCountryRoles.map(r =>
          h('div', { class: 'war-row' },
            h('small', { class: 'muted' }, r.name),
            h('b', {}, r.nick ? (r.absent ? r.nick + ' (결석)' : r.nick) : '빈 자리'))))));
    }
    wrap.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, '첩보 정보'),
      h('p', { class: 'muted' }, '정찰병이 다른 나라 도시 옆에서 본 정보는 다음 단계에서 열려요.')));
  }
  async function loadMissions() {
    try { S.missions = await WarAPI.rpc('war_missions'); }
    catch (e) { console.error(e); return; }
    const el = $('#war-missions-body');
    if (el) { el.innerHTML = ''; el.append(missionList()); }
    if (S.pendingMark) { const k = S.pendingMark; S.pendingMark = null; mark(k); }
  }
  function missionList() {
    const byRole = {};
    for (const m of S.missions || []) (byRole[m.role] = byRole[m.role] || []).push(m);
    return h('div', { class: 'war-missions' }, Object.keys(byRole).map(rk =>
      h('div', {}, h('b', {}, (W.ROLES.find(r => r.key === rk) || {}).name || rk),
        byRole[rk].map(m => h('div', { class: 'war-mission' + (m.done ? ' done' : '') },
          h('span', { class: 'war-mission-check' }, m.done ? '✔' : ''),
          h('span', {}, m.text),
          !m.open ? h('small', { class: 'muted' }, '곧 열려요') : null)))));
  }
  function mark(key) {
    if (!S.missions) { S.pendingMark = key; loadMissions(); return; }
    const m = S.missions.find(x => x.key === key);
    if (!m || m.done || !m.open) return;
    WarAPI.rpc('war_mission_done', { p_mission: key })
      .then(() => { flash('미션 완료!'); return loadMissions(); })
      .catch(e => console.error(e));
  }
  function flash(text) {
    const el = h('div', { class: 'war-flash' }, text);
    document.body.append(el);
    setTimeout(() => el.remove(), 1000);
  }
  function markMoveMission(u, path, r) {
    const role = actingRole();
    const near = (tile, want) => WarHexMap.neighbors(tile).some(n => want(n));
    const enemyCityNear = tile => S.cities.some(c => c.country != null && c.country !== S.me.country.id && near(tile, n => n === c.tile));
    if (u.kind === 'worker' && role === 'engineer') mark('eng_worker_move');
    else if (u.kind === 'scout' && role === 'engineer') { if (enemyCityNear(r.tile)) mark('eng_scout_enemy'); }
    else if (W.unitIsAir(u.kind) && role === 'air') {
      if (path.some(id => occAt(id).some(x => x.country !== S.me.country.id))) mark('air_fly_over');
    } else if (W.unitIsSea(u.kind) && role === 'navy') {
      mark('navy_move');
      const myCoast = S.cities.filter(c => c.country === S.me.country.id &&
        WarHexMap.neighbors(c.tile).some(n => { const t = tileAt(n); return t && (t.terrain === 'ocean' || t.terrain === 'coast'); }));
      if (myCoast.some(c => near(r.tile, n => n === c.tile))) mark('navy_coast');
    } else if (role === 'army' && !isCivil(u.kind)) mark('army_move');
  }

  // ================= 이동 계산 =================
  const tileAt = id => S.tiles.get(id);
  const occAt  = id => S.units.filter(u => u.tile === id);
  const infoAt = (id, u) => ({
    market: (S.markets || []).some(m => m.tile === id),
    enemyCity: (() => { const c = S.cities.find(x => x.tile === id); return !!(c && c.country !== S.me.country.id); })(),
    enemyUnit: occAt(id).some(x => x.country !== S.me.country.id),
    sameKind: occAt(id).some(x => isCivil(x.kind) === isCivil(u.kind))
  });
  function computeReach(u) {
    const dist = new Map([[u.tile, 0]]), prev = new Map(), q = [u.tile];
    while (q.length) {
      const cur = q.shift(), d = dist.get(cur);
      if (d >= (u.moves_left || 0)) continue;
      for (const n of WarHexMap.neighbors(cur)) {
        if (n < 0 || dist.has(n) || !tileAt(n)) continue;
        if (!W.canPass(u.kind, tileAt(n), infoAt(n, u))) continue;
        dist.set(n, d + 1); prev.set(n, cur); q.push(n);
      }
    }
    const stops = [...dist.keys()].filter(id => id !== u.tile && W.canStop(u.kind, tileAt(id), infoAt(id, u)));
    return { dist, prev, stops };
  }
  function tileInfo(id) {
    const t = S.tiles.get(id) || {};
    const cname = c => ((S.me.countries || []).find(x => x.id === c) || {}).name || (c + '번 나라');
    const city = S.cities.find(c => c.tile === id);
    const market = (S.markets || []).find(m => m.tile === id);
    const here = S.units.filter(u => u.tile === id);
    const why = u => u.country !== S.me.country.id ? '다른 나라 병력이라 고를 수 없어요'
      : u.commander !== actingRole() ? '다른 참모총장이 조종하는 병력이라 고를 수 없어요' : '';
    return h('div', { class: 'panel war-tile-info' },
      h('div', { class: 'panel-title' }, '칸 정보'),
      h('p', {}, (R.TERRAIN[t.terrain] || '땅') + ' · ' + (t.owner ? cname(t.owner) + ' 땅' : '빈 땅')),
      city ? h('p', {}, '도시: ' + city.name + ' (' + (city.country ? cname(city.country) : '주인 없음') + ', 체력 ' + city.hp + '/' + city.max_hp + ')') : null,
      market ? h('p', {}, '도시국가 시장 · ' + market.name + ' · 합동참모의장의 시장 탭에서 물물교환해요') : null,
      here.length ? here.map(u => h('p', {}, kindLabel(u.kind) + ' · ' + cname(u.country) + ' · 체력 ' + u.hp,
        why(u) ? h('small', { class: 'muted' }, ' — ' + why(u)) : null))
        : h('p', { class: 'muted' }, '병력이 없어요.'));
  }
  function selectUnit(u) {
    if (!W.isMyUnit(u, S.me.country.id, actingRole())) {
      clearUnit(); S.sel = u.tile; S.map.select(S.sel); renderTabs(); return;
    }
    S.selUnit = u.id; S.reach = computeReach(u);
    S.map.selectUnit(u.id); S.map.setHint(S.reach.stops);
    S.attacks = new Map();
    if ((u.moves_left ?? 0) > 0) {
      const range = Math.max(1, ruleOf(u.kind).range || 1);
      for (const x of S.units) {
        if (x.tile == null || x.country === S.me.country.id || isCivil(x.kind)) continue;
        if (WarHexMap.hexDist(u.tile, x.tile) <= range) S.attacks.set(x.tile, { unit: x.id });
      }
      for (const c of S.cities) {
        if (!c.country || c.country === S.me.country.id || S.attacks.has(c.tile)) continue;
        if (WarHexMap.hexDist(u.tile, c.tile) <= range) S.attacks.set(c.tile, { city: c });
      }
    }
    S.map.setAtk([...S.attacks.keys()]);
    S.map.centerOn(u.tile, Math.max(0.6, S.map.st.cam.z));
    renderTabs();
  }
  function clearUnit() {
    S.selUnit = null; S.reach = null; S.attacks = new Map();
    S.map?.selectUnit(null); S.map?.setHint([]); S.map?.setAtk([]);
  }

  // ================= 공격 미리보기 =================
  function showAttackPreview(attacker, targetTileId) {
    const atk = S.attacks.get(targetTileId) || {};
    const strength = u => (ruleOf(u.kind).str || 1) * (0.5 + 0.5 * (u.hp == null ? 100 : u.hp) / 100);
    const cityAttack = !!atk.city;
    const defender = cityAttack ? atk.city : S.units.find(x => x.id === atk.unit);
    if (!defender) return;
    const terrain = (S.tiles.get(targetTileId) || {}).terrain;
    const ratio = strength(attacker) /
      (cityAttack ? Math.max(1, defender.def) : strength(defender) * (['hills', 'forest', 'jungle'].includes(terrain) ? 1.25 : 1));
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const damage = clamp(Math.round(30 * ratio), 3, ruleOf(attacker.kind).boss ? 60 : 100);
    let counter = clamp(Math.round(30 * 0.6 / ratio), 1, 100);
    if ((ruleOf(attacker.kind).range || 1) >= 2 && WarHexMap.hexDist(attacker.tile, targetTileId) > 1) counter = Math.round(counter * 0.25);
    const dialog = h('dialog', { class: 'war-combat' },
      h('h3', {}, '공격 미리보기'),
      h('p', {}, '내가 줄 피해: ' + damage + ' / 반격 피해: ' + counter),
      h('small', { class: 'muted' }, '공격!을 누르면 서버에 실제 공격을 요청해요'),
      h('div', { class: 'war-combat-actions' },
        h('button', { class: 'small', onclick: () => dialog.close() }, '취소'),
        h('button', { class: 'primary', onclick: async () => {
          dialog.close();
          try {
            const r = await WarAPI.rpc('war_attack', { p_unit: attacker.id, p_tile: targetTileId });
            S.msg = null; clearUnit();
            applyPoll(await WarAPI.rpc('war_poll', { p_known: {} }));
            const role = actingRole();
            if (role === 'army') mark('army_attack_preview');
            else if (role === 'navy') mark('navy_attack_preview');
            else if (role === 'air') mark('air_attack_preview');
            if (r && r.captured) flash('도시를 점령했어요!');
            else if (r && r.besieged) flash('수도를 포위했어요!');
          } catch (e) { console.error(e); S.msg = friendly(e); renderTabs(); }
        } }, '공격!')));
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  // ================= 폴링 =================
  function applyPoll(data) {
    S.poll = { ...S.poll, ...data };
    if (data.game) {
      clearInterval(turnTimer);
      $('#war-turn-info')?.remove();
      const game = data.game, turn = game.turn ?? 0;
      if (turn !== 0 || game.turn_end) {
        const remaining = h('span', {}, '--:--');
        const tick = () => {
          const seconds = Math.max(0, Math.ceil((new Date(game.turn_end).getTime() - Date.now()) / 1000));
          remaining.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        };
        if (game.turn_end) { tick(); turnTimer = setInterval(tick, 1000); }
        root.prepend(h('div', { id: 'war-turn-info', style: {
          background: '#222', color: '#fff', fontSize: '0.9em', padding: '4px 12px',
          display: 'flex', gap: '12px', alignItems: 'center'
        } }, h('span', {}, '턴 ' + turn), h('span', {}, '남은 시간 ', remaining),
          game.paused ? h('span', {}, '⏸ 일시정지 중') : null));
      }
    }
    if (data.map) {
      for (const t of data.map) {
        const [id, terrain, res, owner, imp, impRuined] = t;
        S.tiles.set(id, { terrain, res, owner, imp, imp_ruined: impRuined });
      }
      if (S.map) S.map.setData({ tiles: S.tiles });
    }
    if (data.markets) { S.markets = data.markets; if (S.map) S.map.setData({ markets: S.markets }); }
    if (data.market_stock) S.market_stock = data.market_stock;
    if (data.units) {
      S.units = data.units;
      if (S.map) S.map.setData({ units: S.units });
      if (S.selUnit && !S.units.some(u => u.id === S.selUnit)) clearUnit();
    }
    if (data.cities) { S.cities = data.cities; if (S.map) S.map.setData({ cities: S.cities }); }
    if (!S.centered && S.cities.length) { S.centered = true; goCapital(); }
    if (data.game) { S.game = data.game; renderRoleBar(); }
    if (data.market_stock || data.markets || data.diplomacy || data.offers || data.game) renderTabs();
    if (data.country) {
      if (data.country.roles) { S.meCountryRoles = data.country.roles; S.me.roles = data.country.roles; renderRoleBar(); }
      if (data.country.coin != null) S.country = data.country;
      renderTabs();
    }
  }

  start();
})();
