// 전쟁의 시간 학생 화면 틀 (E2 H5): 접속 확인 → 역할 고르기 → 역할별 화면
// 이동·전투·생산 등 메뉴 안 내용은 다음 단계(E3~E9)에서 열려요.
(function () {
  const R = window.RULES, W = window.WAR_RULES;
  const root = document.getElementById('app');
  const S = { me: null, known: {}, map: null, tiles: new Map(), units: [], cities: [], markets: [], market_stock: {}, sel: null, tab: null, selUnit: null, reach: null, centered: false, msg: null, country: null };
  const $ = s => document.querySelector(s);
  let turnTimer = 0;
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
    // 미리보기 DB를 여는 동안 안내해요
    if (WarAPI.mode) root.textContent = '미리보기를 준비하고 있어요 (몇 초 걸려요)';
    try { S.me = await WarAPI.rpc('war_me'); }
    catch (e) {
      if (e.code === 'NO_AUTH') return needAuth();
      console.error(e); return showError(friendly(e));
    }
    // 역할이 없어도 새 화면(지도 / 우리 나라)으로. 역할 고르기는 「우리 나라」 탭 안에 있어요
    try { main(); }
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
    S.tab = null; S.selUnit = null; S.reach = null; S.view = 'map';   // 역할을 고르면 지도 탭으로 돌아가요
    S.missions = null; loadMissions();   // 역할이 생겼으니 내 미션 목록을 새로 불러와요
    renderTop(); renderBigTabs(); renderView();
  }

  // ================= 역할별 화면 틀: 위쪽 큰 탭 두 개 (지도 / 우리 나라) =================
  const NATION_MENUS = ['우리 나라', '내 예산', '첩보 정보'];   // 지도 조작 창이 아니라 「우리 나라」 탭에 나오는 메뉴
  function main() {
    root.innerHTML = '';
    if (WarAPI.mode) root.append(h('div', { class: 'war-banner' + (WarAPI.mode === 'real' ? ' real' : '') },
      WarAPI.mode === 'real' ? '실제 데이터 미리보기: 우리 반 무역 게임 기록이에요 (여기서 바꿔도 저장되지 않아요)' : '미리보기 모드: 가짜 데이터예요'));
    const top = h('div', { class: 'war-top', id: 'war-top' });
    root.append(top, h('div', { class: 'war-big-tabs', id: 'war-big-tabs' }), h('div', { class: 'war-view', id: 'war-view' }));
    renderTop(); renderBigTabs(); renderView();
    if (S.me.role) loadMissions();
    WarAPI.startPoll(applyPoll);
  }
  function renderBigTabs() {
    const el = $('#war-big-tabs'); if (!el) return;
    el.innerHTML = '';
    el.append(
      h('button', { class: 'war-big-tab' + (S.view !== 'nation' ? ' on' : ''), onclick: () => { S.view = 'map'; renderBigTabs(); renderView(); } }, '지도'),
      h('button', { class: 'war-big-tab' + (S.view === 'nation' ? ' on' : ''), onclick: () => { S.view = 'nation'; renderBigTabs(); renderView(); } }, '우리 나라'));
  }
  function renderView() {
    const view = $('#war-view'); if (!view) return;
    view.innerHTML = '';
    if (S.view === 'nation') return nationView(view);
    return mapView(view);
  }
  function mapView(view) {
    // 역할을 고르기 전에도 지도는 보이게 (병력은 고를 수 없고 칸 정보만)
    if (!S.me.role) view.append(h('div', { class: 'war-guide' }, '「우리 나라」 탭에서 역할을 골라요'));
    const canvas = h('canvas', { class: 'hexmap' });
    const wrap = h('div', { class: 'map-wrap' }, canvas,
      h('div', { class: 'map-tools' },
        h('button', { class: 'small', onclick: () => S.map.zoom(1.25), title: '크게 보기' }, '+'),
        h('button', { class: 'small', onclick: () => S.map.zoom(0.8), title: '작게 보기' }, '−'),
        h('button', { class: 'small', onclick: () => goCapital() }, '수도로')));
    view.append(h('div', { class: 'map-layout war-layout' }, wrap, h('div', { class: 'side panel', id: 'side' })));
    // 여섯 나라 모두를 지도에 넘긴다 (땅 색은 무역 앱 규칙의 나라 유형 색)
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
  // 지도 조작: 내 병력을 누르면 선택 + 갈 수 있는 칸 표시, 표시된 칸을 누르면 이동
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
    // 공격 대상 칸: 미리보기를 열어요 (E4 화면) — 이동 처리 직후, 내 병력 선택 직전
    if (sel && S.attacks && S.attacks.has(id)) {
      showAttackPreview(sel, id);
      return;
    }
    const mine = S.units.find(u => u.tile === id && W.isMyUnit(u, S.me.country.id, actingRole()));
    if (mine) { selectUnit(mine); return; }
    S.sel = S.sel === id ? null : id;
    S.map.select(S.sel); clearUnit(); renderTabs();
  }
  function renderTop() {
    window.WAR_ROLE = S.me?.role || 'common';
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
  const UNIT_NAMES = { worker: '노동자', scout: '정찰병' };
  const kindLabel = k => ((R.UNITS[k] || {}).name || (W.EXTRA_UNITS[k] || {}).name || UNIT_NAMES[k] || '병력');
  const ruleOf = k => R.UNITS[k] || W.EXTRA_UNITS[k] || {};
  const isCivil = k => k === 'worker' || k === 'scout';
  const actingRole = () => (typeof S.tab === 'string' && S.tab.startsWith('deputy:')) ? S.tab.slice(7) : S.me.role;
  function renderTabs() {
    window.WAR_ROLE = actingRole() || 'common';
    const side = $('#side'); if (!side) return;
    const me = S.me;
    side.innerHTML = '';
    // 조작 창 안 작은 탭: 역할 메뉴 중 게임 조작 것만 (우리 나라·예산·첩보 정보는 「우리 나라」 탭으로)
    const tabs = me.menus.filter(m => !NATION_MENUS.includes(m)).map(m => {
      const label = m === '도시국가 시장' ? '시장' : m;
      return { label, key: 'menu:' + label };
    });
    if (me.role === 'chief' && !tabs.some(t => t.key === 'menu:외교')) tabs.push({ label: '외교', key: 'menu:외교' });
    if (me.role === 'chief' && !tabs.some(t => t.key === 'menu:시장')) tabs.push({ label: '시장', key: 'menu:시장' });
    for (const d of me.deputy_roles) tabs.push({ label: d.name + ' 대신하는 중', key: 'deputy:' + d.key });
    if (!tabs.length) {
      side.append(h('p', { class: 'muted' }, '지도에서 바로 하는 일이 없어요. 「우리 나라」 탭을 봐요.'));
      return;
    }
    const active = S.tab && tabs.some(t => t.key === S.tab) ? S.tab : tabs[0].key;
    side.append(h('div', { class: 'war-tabs' }, tabs.map(t =>
      h('button', { class: 'war-tab' + (active === t.key ? ' on' : ''), onclick: () => { S.tab = t.key; S.selUnit = null; S.reach = null; S.map.selectUnit(null); S.map.setHint([]); renderTabs(); } }, t.label))));
    if (S.sel != null && !S.selUnit) side.append(tileInfo(S.sel));
    const label = (tabs.find(t => t.key === active) || {}).label || '';
    const body = h('div', { class: 'panel war-tab-body' });
    const role = actingRole();
    // 병력 이동 탭: 내 병력(참모총장·대행) / 노동자·정찰병(공병사령관·대행)
    const unitTab = (kinds, emptyMsg) => {
      const list = S.units.filter(u => W.isMyUnit(u, S.me.country.id, role) && kinds.includes(u.kind));
      body.append(h('div', { class: 'panel-title' }, label, h('small', {}, list.length + '부대 · 눌러서 고르고 지도에서 갈 칸을 골라요')));
      body.append(list.length ? h('div', { class: 'war-units-list' }, list.map(u =>
        h('button', { class: 'war-unit-row' + (S.selUnit === u.id ? ' on' : ''), onclick: () => selectUnit(u) },
          h('b', {}, kindLabel(u.kind)),
          h('span', {}, '체력 ' + u.hp),
          h('span', { class: 'muted' }, '남은 이동 ' + (u.moves_left ?? 0)))))
        : h('p', { class: 'muted' }, emptyMsg));
    };
    if (active === 'menu:생산' && ['army', 'navy', 'air'].includes(role) && me.role !== 'chief') {
      renderProduction(body, role);
    } else if (active === 'menu:예산' && me.role === 'chief') {
      renderBudget(body);
    } else if (active === 'menu:건물') {
      renderBuildings(body);
    } else if (active === 'menu:개발·수리') {
      renderRepairs(body);
    } else if (active === 'menu:시장' && me.role === 'chief') {
      renderMarket(body);
    } else if (active === 'menu:외교' && me.role === 'chief') {
      renderDiplomacy(body);
    } else if (role === 'engineer') {
      if (active === 'menu:노동자') unitTab(['worker'], '노동자가 없어요.');
      else if (active === 'menu:정찰병') unitTab(['scout'], '정찰병이 없어요.');
      else unitTab(['worker', 'scout'], '노동자·정찰병이 없어요.');
    } else if (active === 'menu:지휘권 넘기기') {
      const list = S.units.filter(u => W.isMyUnit(u, S.me.country.id, S.me.role) && !isCivil(u.kind));
      body.append(h('div', { class: 'panel-title' }, '지휘권 넘기기', h('small', {}, '병력 종류는 그대로, 조종하는 참모총장만 바뀌어요')));
      body.append(list.length ? h('div', { class: 'war-units-list' }, list.map(u =>
        h('div', { class: 'war-unit-row' },
          h('b', {}, kindLabel(u.kind)),
          h('span', { class: 'muted' }, '체력 ' + u.hp),
          h('div', { class: 'row' }, ['army', 'navy', 'air'].filter(b => b !== u.commander).map(b =>
            h('button', { class: 'small', onclick: () => doTransfer(u, b) }, { army: '육군', navy: '해군', air: '공군' }[b]))))))
        : h('p', { class: 'muted' }, '내가 조종하는 군사 병력이 없어요.'));
    } else if (active === 'menu:내 병력' || active.startsWith('deputy:')) {
      unitTab(['spear', 'catapult', 'knight', 'musket', 'cannon', 'infantry', 'artillery', 'tank',
        'trireme', 'frigate', 'battleship', 'destroyer', 'cruiser', 'fighter',
        'k_missile', 'j_patrol', 'c_jet', 'a_stealth', 'n_hyper', 't_marine'], '내가 조종하는 병력이 없어요.');
    } else {
      body.append(h('p', { class: 'muted' }, '「' + label + '」 내용은 다음 단계에서 열려요.'),
        h('p', { class: 'muted' }, '지도는 아래에서 바로 볼 수 있어요.'));
    }
    side.append(body);
    if (S.msg) side.append(h('div', { class: 'war-msg' }, S.msg));
  }
  const itemName = k => k === 'coin' ? '코인' : R.ITEMS[k]?.name || k;
  const costText = cost => Object.entries(cost || {}).map(([k, v]) => itemName(k) + ' ' + v).join(' · ');
  const facilityName = k => (R.BUILDINGS[k] || R.FACTORIES[k] || R.ADVANCED[k])?.name || k;
  function selectBox(id, entries, value, change) {
    const el = h('select', { id, 'aria-label': id, onchange: change }, entries.map(([key, name]) => h('option', { value: key }, name)));
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
    body.append(h('p', {}, '내 지갑: ' + costText(wallet)));
    const defs = Object.entries({ ...R.UNITS, ...W.EXTRA_UNITS }).filter(([k, d]) =>
      W.BRANCH[k] === role && (!d.boss || R.BOSS_UNIT[S.me.country.type]?.unit === k));
    body.append(h('table', {}, h('thead', {}, h('tr', {}, ['종류', '힘', '이동', '비용', '생산'].map(t => h('th', {}, t)))),
      h('tbody', {}, defs.map(([kind, def]) => {
        const needs = def.boss ? R.BOSS_UNIT[S.me.country.type]?.needs || [] : [];
        const locked = busy || S.game?.paused || S.economyBusy ||
          Object.entries(def.cost || {}).some(([k, n]) => (wallet[k] || 0) < n) ||
          needs.some(k => (country.inventory?.[k] || 0) < 1);
        return h('tr', {}, h('td', {}, def.name), h('td', {}, def.boss ? W.BOSS.str() : def.str),
          h('td', {}, W.MOVES_OF(kind)), h('td', {}, costText(def.cost)),
          h('td', {}, h('button', { disabled: locked || null, onclick: () =>
            economyAction('war_produce', { p_city: city.id, p_kind: kind }, role + '_build') }, locked ? '🔒 만들기' : '만들기')));
      }))));
  }
  function renderBudget(body) {
    const country = S.poll?.country || {}, roles = W.ROLES.filter(r => r.key !== 'chief');
    body.append(h('h3', {}, '국고'), h('p', {}, costText({ coin: country.coin ?? 0, ...country.inventory })));
    for (const take of [false, true]) {
      if (take) {
        body.append(h('h3', {}, '현재 지갑'), h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '역할'), h('th', {}, '코인 · 자원'))),
          h('tbody', {}, roles.map(r => h('tr', {}, h('td', {}, r.name), h('td', {}, costText({ coin: 0, ...country.wallets?.[r.key] })))))));
      }
      const prefix = take ? 'budget-take' : 'budget-give';
      const role = selectBox(prefix + '-role', roles.map(r => [r.key, r.name]));
      const item = selectBox(prefix + '-item', ['coin', ...Object.keys(R.ITEMS)].map(k => [k, itemName(k)]));
      const qty = h('input', { id: prefix + '-qty', 'aria-label': '양', type: 'number', min: 1, step: 1, value: 1 });
      body.append(h('h3', {}, take ? '회수' : '나눠 주기'), h('div', { class: 'row' }, role, item, qty,
        h('button', { onclick: () => {
          const n = Number(qty.value);
          if (!Number.isSafeInteger(n) || n <= 0) { S.msg = '양은 0보다 큰 정수로 써 주세요'; renderTabs(); return; }
          economyAction(take ? 'war_budget_take' : 'war_budget_give', {
            [take ? 'p_from_role' : 'p_to_role']: role.value, p_item: item.value, p_qty: n
          }, take ? null : 'chief_budget');
        } }, take ? '회수하기' : '나눠 주기')));
    }
  }
  function renderBuildings(body) {
    const cities = S.cities.filter(c => c.country === S.me.country.id);
    if (!cities.length) { body.append(h('p', {}, '우리 도시가 없어요')); return; }
    const city = cities.find(c => c.id === S.buildCity) || cities[0]; S.buildCity = city.id;
    body.append(h('label', {}, '도시 선택 ', selectBox('build-city', cities.map(c => [c.id, c.name || c.id]), city.id,
      e => { S.buildCity = e.target.value; renderTabs(); })), h('h3', {}, (city.name || city.id) + '의 건물'),
      h('p', {}, '현재 건물: ' + ((city.buildings || []).map(facilityName).join(', ') || '없음')));
    for (const f of S.poll?.country?.facilities || []) if (f.city === city.id)
      body.append(h('p', {}, facilityName(f.kind) + (f.ruined ? ' (파괴됨)' : ' (정상)')));
    const category = S.buildCategory || 'BUILDINGS';
    const defs = R[category], kind = defs[S.buildKind] ? S.buildKind : Object.keys(defs)[0]; S.buildKind = kind;
    let cost = defs[kind].cost || defs[kind].build;
    if (category === 'FACTORIES' && R.SPECIALTY[S.me.country.type]?.factory === kind) cost = R.SPECIALTY_BUILD;
    body.append(h('h3', {}, '짓기'), selectBox('build-category', [['BUILDINGS', '기본 건물'], ['FACTORIES', '공장'], ['ADVANCED', '고등 건물']], category,
      e => { S.buildCategory = e.target.value; S.buildKind = null; renderTabs(); }),
      selectBox('build-kind', Object.entries(defs).map(([k, d]) => [k, d.name]), kind, e => { S.buildKind = e.target.value; renderTabs(); }),
      h('p', {}, '비용: ' + costText(cost)), h('button', { onclick: () => economyAction('war_city_build', { p_city: city.id, p_kind: kind }, 'eng_build') }, '짓기'));
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
    const row = (text, target, tile, cost) => h('div', {}, h('p', {}, text + ' (파괴됨) · 비용: ' + costText(cost)),
      h('button', { disabled: !selected || selected.tile !== tile || selected.moves_left <= 0 || null,
        onclick: () => economyAction('war_repair', { p_unit: S.repairWorker, p_target: target }, 'eng_repair') }, '수리'));
    body.append(h('h3', {}, '파괴된 타일 시설'));
    const names = { farm: '농장', quarry: '채석장', lumber: '벌목장', mine: '광산', oilwell: '유정', plantation: '농원' };
    for (const [id, t] of S.tiles) if (t.owner === S.me.country.id && t.imp_ruined)
      body.append(row('칸 ' + id + ' - ' + (names[t.imp] || t.imp), 'tile:' + id, id,
        { coin: { farm: 5, quarry: 5, lumber: 5, mine: 8, oilwell: 8, plantation: 10 }[t.imp] }));
    body.append(h('h3', {}, '파괴된 도시 시설'));
    for (const f of S.poll?.country?.facilities || []) if (f.ruined) {
      const city = S.cities.find(c => c.id === f.city && c.country === S.me.country.id);
      if (city) body.append(row(f.city + ' ' + facilityName(f.kind), 'city:' + f.city + ':' + f.kind, city.tile, repairCost(f)));
    }
  }
  function renderMarket(body) {
    const country = S.poll?.country || {};
    const specialty = W.SPECIALTY_ITEM[S.me.country.id];
    const hasSpecialty = (country.inventory?.[specialty] || 0) >= 1;
    body.append(h('h3', {}, '도시국가 시장'), h('p', {}, '보유 코인: ' + (country.coin ?? 0)));
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
      body.append(h('div', { class: 'row' },
        h('span', {}, itemName(item) + ' · 창고 ' + qty + '개 · 기준가 ' + ref),
        h('span', {}, '비용: ' + (hasSpecialty ? itemName(specialty) + ' 1개 + ' : '') + cost + ' 코인'),
        h('button', { disabled: (S.economyBusy || qty < 1 || (country.coin ?? 0) < cost) || null,
          onclick: () => economyAction('war_market_buy', { p_market: market.id, p_item: item }, 'chief_market')
        }, '구매')));
    }
  }
  function renderDiplomacy(body) {
    const mine = S.me.country.id, turn = S.poll?.game?.turn ?? 0;
    const name = id => S.me.countries.find(c => c.id === id)?.name || id + '번 나라';
    for (const d of S.poll?.diplomacy || []) {
      if (d.a !== mine && d.b !== mine) continue;
      const other = d.a === mine ? d.b : d.a, war = d.status === 'war';
      body.append(h('div', { class: 'row' }, h('b', {}, name(other)),
        h('span', { class: war ? 'bad' : 'good' }, war ? '⚔ 전쟁 중' : '🕊 평화' + (d.no_war_until > turn ? ` (${d.no_war_until - turn}턴 선포 금지)` : '')),
        h('button', { class: 'small', onclick: () => {
          if (!war && !confirm('선전포고하면 바로 전쟁이 시작돼요. 계속할까요?')) return;
          diplomacyAction(war ? 'war_propose' : 'war_declare', war ? { p_other: other, p_kind: 'peace' } : { p_other: other });
        } }, war ? '평화 제안' : '선전포고')));
    }
    body.append(h('div', { class: 'panel-title' }, '받은 제안'));
    for (const o of S.poll?.offers || []) if (o.to_c === mine) body.append(h('div', { class: 'row' },
      name(o.from_c) + ' 평화 제안', h('button', { class: 'small', onclick: () => diplomacyAction('war_accept_offer', { p_offer: o.id }) }, '수락')));
  }
  async function diplomacyAction(fn, args) {
    try {
      await WarAPI.rpc(fn, args); S.msg = null;
      applyPoll(await WarAPI.rpc('war_poll', { p_known: {} }));
    } catch (e) { S.msg = friendly(e); }
    renderTabs();
  }
  async function doTransfer(u, to) {
    try { await WarAPI.rpc('war_transfer', { p_unit: u.id, p_to: to }); S.msg = null;
      if (actingRole() === 'army') mark('army_transfer');
      else if (actingRole() === 'air') mark('air_transfer');
    }
    catch (e) { console.error(e); S.msg = friendly(e); }
    renderTabs();
  }

  // ================= 「우리 나라」 탭: 역할 고르기 · 튜토리얼 미션 · 나라 정보 =================
  function nationView(view) {
    const me = S.me;
    const wrap = h('div', { class: 'war-nation' });
    view.append(wrap);
    if (!me.role) {
      const engNote = me.country.size <= 4 ? ' (4명 모둠은 공병사령관이 없어요. 합동참모의장이 함께 해요)' : '';
      wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '역할 고르기',
        h('small', {}, '내가 맡을 역할을 골라요.' + engNote)),
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
    if (me.role) {
      wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '튜토리얼 미션',
        h('small', {}, '해낼 때마다 여기에 기록해요')),
        h('div', { id: 'war-missions-body' }, h('p', { class: 'muted' }, '미션을 불러오는 중…'))));
      wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '내 예산',
        h('small', {}, '합동참모의장이 예산을 나눠 주면 여기에 보여요')),
        h('p', { class: 'muted' }, '다음 단계에서 열려요.')));
    }
    wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '나라 정보'),
      h('p', {}, h('i', { class: 'war-dot', style: { background: me.country.color } }), ' ' + me.country.name +
        ' · ' + ((R.TYPES[me.country.type] || {}).name || '')),
      h('p', {}, '코인 ' + (S.country && S.country.coin != null ? S.country.coin : '-'))));
    if (S.meCountryRoles) {
      wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '우리 나라 역할 현황'),
        h('div', { class: 'war-roles-list' }, S.meCountryRoles.map(r =>
          h('div', { class: 'war-row' }, h('small', { class: 'muted' }, r.name),
            h('b', {}, r.nick ? (r.absent ? r.nick + ' (결석)' : r.nick) : '빈 자리'))))));
    }
    wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '첩보 정보'),
      h('p', { class: 'muted' }, '정찰병이 다른 나라 도시 옆에서 본 정보는 다음 단계에서 열려요.')));
    if (me.role === 'chief') S.pendingMark = 'chief_info';   // 합동참모의장이 우리 나라 탭을 열 때
    loadMissions();
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
  // 행동이 성공한 뒤 화면이 미션을 기록해요 (실패해도 게임은 그대로, 오류는 콘솔에만)
  function mark(key) {
    if (!S.missions) { S.pendingMark = key; loadMissions(); return; }   // 목록을 아직 안 불러왔으면 불러온 뒤 기록
    const m = S.missions.find(x => x.key === key);
    if (!m || m.done || !m.open) return;   // 아직 열리지 않은 미션은 기록하지 않는다 (콘솔 소음 방지)
    WarAPI.rpc('war_mission_done', { p_mission: key })
      .then(() => { flash('미션 완료!'); return loadMissions(); })
      .catch(e => console.error(e));
  }
  function flash(text) {
    const el = h('div', { class: 'war-flash' }, text);
    document.body.append(el);
    setTimeout(() => el.remove(), 1000);
  }
  // 이동·지휘권 성공에 맞춘 미션 기록 (설계 2장 표의 행동)
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

  // 갈 수 있는 칸 (설계 4-4, war-rules.js의 canPass·canStop을 화면과 미리보기가 같이 씀)
  const tileAt = id => S.tiles.get(id);
  const occAt = id => S.units.filter(u => u.tile === id);
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
  // 칸 정보: 지형·주인·도시·병력. 남의 병력은 정보만 보여 주고 고를 수 없는 까닭을 알려 줘요
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
        why(u) ? h('small', { class: 'muted' }, ' — ' + why(u)) : null)) : h('p', { class: 'muted' }, '병력이 없어요.'));
  }
  function selectUnit(u) {
    // 남의 나라 병력·다른 참모총장 병력은 고르지 않고 그 칸 정보만 보여 줘요
    if (!W.isMyUnit(u, S.me.country.id, actingRole())) {
      clearUnit(); S.sel = u.tile; S.map.select(S.sel); renderTabs(); return;
    }
    S.selUnit = u.id; S.reach = computeReach(u);
    S.map.selectUnit(u.id); S.map.setHint(S.reach.stops);
    // 공격 가능 칸 (E4 화면): 이동력이 남아 있을 때, 근접은 이웃 · 원거리(range 2 이상)는 그 사거리까지
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
  function clearUnit() { S.selUnit = null; S.reach = null; S.attacks = new Map(); S.map.selectUnit(null); S.map.setHint([]); S.map.setAtk([]); }

  // 공격 미리보기 (E4 화면): 계산식은 체험 모드(war-student.js previewAttack)와 같아요
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
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: () => dialog.close() }, '취소'),
        h('button', { class: 'primary', onclick: async () => {
          dialog.close();
          try {
            const r = await WarAPI.rpc('war_attack', { p_unit: attacker.id, p_tile: targetTileId });
            S.msg = null; clearUnit();
            // 체력·쓰러진 병력·점령·포위·땅 주인을 바로 반영 (poll을 당겨 와서 전체 갱신)
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

  // ================= 4초마다 바뀐 것만 받기 =================
  // 지도·병력·도시 데이터를 먼저 적용하고, 화면 갱신(탭·위쪽 표시줄)은 그 뒤에 따로 해요.
  // 이렇게 나눠야 화면 갱신에서 문제가 생겨도 지도 데이터가 비지 않아요.
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
      S.map.setData({ tiles: S.tiles });
    }
    if (data.markets) { S.markets = data.markets; S.map.setData({ markets: S.markets }); }
    if (data.market_stock) S.market_stock = data.market_stock;
    if (data.units) {
      S.units = data.units;
      S.map.setData({ units: S.units });
      if (S.selUnit && !S.units.some(u => u.id === S.selUnit)) clearUnit();
    }
    if (data.cities) { S.cities = data.cities; S.map.setData({ cities: S.cities }); }
    // 처음 데이터가 오면 우리 나라 수도로 지도를 옮겨요
    if (!S.centered && S.cities.length) { S.centered = true; goCapital(); }
    if (data.game) { S.game = data.game; renderTop(); }
    if (data.market_stock || data.markets || data.diplomacy || data.offers || data.game ||
      ((data.map || data.units || data.cities) && ['menu:건물', 'menu:개발·수리', 'menu:생산'].includes(S.tab))) renderTabs();
    if (data.country) {
      if (data.country.roles) { S.meCountryRoles = data.country.roles; S.me.roles = data.country.roles; }
      if (data.country.coin != null) S.country = data.country;
      renderTabs();
    }
  }

  start();
})();
