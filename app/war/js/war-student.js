// 체험 중 바뀐 내용은 이 화면의 메모리 안에만 두어요.
(function () {
  const R = { ...window.RULES, UNITS: Object.fromEntries(Object.entries(window.RULES.UNITS).map(([kind, rule]) => [kind, { ...rule }])) };
  if (!R.UNITS.destroyer) R.UNITS.destroyer = { name: '구축함', era: 4, str: 60, move: 6, sea: true, img: 'destroyer', cost: { coin: 100, steel: 2, fuel: 1, food: 2 } };
  const HexMap = window.WarHexMap;
  const root = document.getElementById('app');
  const S = { data: null, map: null, sel: null, country: 1, unit: null, moves: new Map(), hints: new Map(), attacks: new Map(), attacked: new Set(), besieged: new Set(), loading: false, turn: 1 };
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
  function loadTrialData(data) {
    const bossStrength = Math.max(0, ...Object.values(R.UNITS).filter(unit => !unit.boss).map(unit => unit.str || 0)) + 5;
    for (const unit of Object.values(R.UNITS)) {
      if (unit.boss) unit.str = bossStrength;
    }
    S.data = structuredClone(data);
    S.besieged.clear();
    for (const city of S.data.cities) {
      if (city.kind === 'capital') Object.assign(city, { def: 20, hp: 200, max_hp: 200 });
    }
  }

  async function start() {
    try {
      const data = await window.WarData.load();
      if (!data) return needPreview();
      main(data);
    } catch (e) {
      root.innerHTML = '';
      root.append(h('div', { class: 'entry' }, h('p', {}, e.message)));
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
    loadTrialData(data);
    // 맨 위 미리보기 띠 (미리보기일 때만). 실제 데이터는 색도 다르게 (war.css)
    const mode = window.WarData.mode();
    root.append(h('div', { class: 'war-banner' + (mode === 'real' ? ' real' : '') },
      mode === 'real'
        ? '실제 데이터 미리보기: 우리 반 무역 게임 기록이에요 (여기서 바꿔도 저장되지 않아요)'
        : '미리보기 모드: 가짜 데이터예요',
      ' · 체험 모드: 여기서 한 일은 저장되지 않아요'));
    // 지도 + 오른쪽 창 (무역 앱 학생 화면과 같은 모양)
    const canvas = h('canvas', { class: 'hexmap' });
    const wrap = h('div', { class: 'map-wrap' }, canvas,
      h('div', { class: 'map-tools' },
        h('button', { class: 'small', onclick: () => S.map.zoom(1.25), title: '크게 보기' }, '+'),
        h('button', { class: 'small', onclick: () => S.map.zoom(0.8), title: '작게 보기' }, '−'),
        h('button', { class: 'small', onclick: () => goCapital() }, '수도로'),
        h('button', { class: 'small', onclick: resetPlay }, '처음 상태로'),
        h('button', { class: 'small', onclick: nextTurn }, '턴 넘기기')));
    root.append(h('div', { class: 'map-layout' }, wrap, h('div', { class: 'side panel', id: 'side' })));
    // 지도 데이터: 무역 앱 「투명한 정찰병」이 넘기는 모양 그대로 (안개 없이 모든 땅)
    S.map = HexMap.create(canvas, { onTile });
    refreshMap();
    renderSide();
    goCapital();
  }

  function refreshMap() {
    const data = S.data;
    const tiles = new Map(data.tiles.map(([id, terrain, res, owner, imp]) => [id, { terrain, res, owner, imp }]));
    const countries = Object.fromEntries(data.countries.map(c => [c.id, { color: c.color, type: c.type, name: c.name, flag_url: c.flag_url }]));
    S.map.setData({ tiles, cities: data.cities, units: data.units, countries, all: true, tintUnits: true });
  }

  async function resetPlay(event) {
    if (!confirm('처음 상태로 되돌릴까요? 여기서 한 일이 모두 사라져요')) return;
    const button = event.currentTarget;
    button.disabled = true;
    S.loading = true;
    try {
      const data = await window.WarData.load();
      if (!data) throw new Error('처음 상태를 불러오지 못했어요.');
      loadTrialData(data);
      S.moves.clear();
      S.attacked.clear();
      S.turn = 1;
      clearUnit();
      S.sel = null;
      S.map.select(null);
      S.map.selectUnit(null);
      S.map.setHint([]);
      S.map.setAtk([]);
      refreshMap();
      renderSide();
    } catch (e) {
      alert('처음 상태를 불러오지 못했어요. 다시 해 주세요.');
      console.error(e);
    } finally { button.disabled = false; S.loading = false; }
  }

  function nextTurn() {
    if (S.loading) return;
    S.turn++;
    for (const city of S.data.cities) {
      if (S.besieged.has(city.tile)) city.hp = 20;
    }
    S.besieged.clear();
    refreshMap();
    S.moves.clear();
    S.attacked.clear();
    const u = selectedUnit();
    if (u) selectUnit(u);
    else renderSide();
  }

  // ================= 한글 이름표 =================
  // 규칙 파일(RULES)에 이름이 없는 것도 영어가 화면에 나오지 않게 이름표를 만들어요
  const UNIT_NAMES = { worker: '노동자', scout: '정찰병', ballista: '발리스타', archer: '궁수', swordsman: '검병', boat: '배', ship: '배' };
  const unitName = k => (R.UNITS[k] || {}).name || UNIT_NAMES[k] || '병력';
  const terrainName = k => R.TERRAIN[k] || '땅';
  const resName = k => (R.ITEMS[k] || {}).name || '자원';
  const impName = k => (R.IMPROVE[k] || {}).name || '시설';

  const myCountry = () => S.data.countries.find(c => c.id === S.country);
  const capitalTile = c => { const cap = S.data.cities.find(x => x.kind === 'capital' && x.country === c.id); return cap ? cap.tile : -1; };
  function goCapital() { const t = capitalTile(myCountry()); if (t >= 0) S.map.centerOn(t, 0.6); }
  const colorOf = id => (S.map.st.countries[id] || {}).color || '#888';

  const military = u => u.kind !== 'worker' && u.kind !== 'scout';
  const rule = u => R.UNITS[u.kind] || {};
  const fullMove = u => u.kind === 'worker' ? 0 : u.kind === 'scout' ? R.SCOUT_MOVE : (rule(u).move || 0);
  const movesLeft = u => S.moves.has(u.id) ? S.moves.get(u.id) : fullMove(u);
  const selectedUnit = () => S.data.units.find(u => u.id === S.unit);
  function clearUnit() {
    S.unit = null;
    S.hints.clear();
    S.attacks.clear();
    S.map.selectUnit(null);
    S.map.setHint([]);
    S.map.setAtk([]);
  }
  function passable(u, id) {
    const t = S.map.st.tiles.get(id);
    if (!t) return false;
    if (rule(u).sea ? !['ocean', 'coast'].includes(t.terrain) : ['ocean', 'coast', 'mountain'].includes(t.terrain)) return false;
    if (S.data.cities.some(c => c.tile === id && c.country !== u.country)) return false;
    return !S.data.units.some(other => other.tile === id && other.country !== u.country);
  }
  function canStop(u, id) {
    return !S.data.units.some(other => other.id !== u.id && other.tile === id && military(other) === military(u));
  }
  function selectUnit(u) {
    if (u.kind === 'worker') return;
    S.unit = u.id;
    S.sel = u.tile;
    S.map.select(u.tile);
    S.map.selectUnit(u.id);
    const reachable = HexMap.reachable(u.tile, id => passable(u, id), movesLeft(u));
    S.hints = new Map([...reachable].filter(([id]) => canStop(u, id)));
    S.map.setHint(S.hints.keys());
    S.attacks.clear();
    if (military(u) && !S.attacked.has(u.id)) {
      for (const other of S.data.units) {
        const distance = HexMap.hexDist(u.tile, other.tile);
        if (other.country !== u.country && military(other) && distance >= 1 && distance <= (rule(u).range || 1)) {
          S.attacks.set(other.tile, { unit: other.id });
        }
      }
    }
    if (military(u) && !S.attacked.has(u.id)) {
      for (const city of S.data.cities) {
        const distance = HexMap.hexDist(u.tile, city.tile);
        if (city.country && city.country !== u.country && distance >= 1 && distance <= (rule(u).range || 1)) {
          S.attacks.set(city.tile, { city });
        }
      }
    }
    S.map.setAtk(S.attacks.keys());
    renderSide();
  }

  const strength = u => (rule(u).str || 1) * (0.5 + 0.5 * (u.hp == null ? 100 : u.hp) / 100);
  function previewAttack(attacker, defender, cityAttack = false) {
    const terrain = S.map.st.tiles.get(defender.tile).terrain;
    const ratio = strength(attacker) / (cityAttack ? Math.max(1, defender.def) : strength(defender) * (['hills', 'forest', 'jungle'].includes(terrain) ? 1.25 : 1));
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const damage = cityAttack && defender.hp <= 0 ? 0 : clamp(Math.round(30 * ratio), 3, rule(attacker).boss ? 60 : 100);
    let counter = clamp(Math.round(30 * 0.6 / ratio), 1, 100);
    if (rule(attacker).range && HexMap.hexDist(attacker.tile, defender.tile) > 1) counter = Math.round(counter * 0.25);
    const dialog = h('dialog', { class: 'war-combat' },
      h('p', {}, '예상: ' + (cityAttack ? '도시' : '상대') + ' −' + damage + ', 우리 −' + counter),
      h('small', { class: 'muted' }, '체험용 계산'),
      h('div', { class: 'war-combat-actions' },
        h('button', { class: 'small', onclick: () => dialog.close() }, '그만둘래요'),
        h('button', { class: 'small', onclick: () => {
          defender.hp = Math.max(0, (defender.hp == null ? 100 : defender.hp) - damage);
          attacker.hp = (attacker.hp == null ? 100 : attacker.hp) - counter;
          S.moves.set(attacker.id, 0);
          S.attacked.add(attacker.id);
          S.data.units = S.data.units.filter(u => u.hp == null || u.hp > 0);
          const attackTile = attacker.tile;
          if (cityAttack && defender.hp === 0) resolveCity(attacker, defender);
          refreshMap();
          S.map.floatText(defender.tile, '상대 체력 −' + damage, '#FFB3B3');
          S.map.floatText(attackTile, '우리 체력 −' + counter);
          clearUnit();
          if (attacker.hp > 0) selectUnit(attacker);
          else { S.sel = attacker.tile; S.map.select(S.sel); renderSide(); }
          dialog.close();
        } }, '공격할래요')));
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  function resolveCity(attacker, city) {
    if (city.kind === 'capital') {
      S.besieged.add(city.tile);
      S.map.floatText(city.tile, '포위됨');
      return;
    }
    if (rule(attacker).range) {
      S.map.floatText(city.tile, '근접 병력이 들어가야 점령해요');
      return;
    }
    if (city.hp !== 0 || attacker.hp <= 0 || rule(attacker).fly) return;
    if (rule(attacker).sea && !HexMap.neighbors(city.tile).some(id =>
      ['ocean', 'coast'].includes(S.map.st.tiles.get(id)?.terrain))) return;
    if (S.data.units.some(u => u.id !== attacker.id && u.tile === city.tile && military(u))) {
      S.map.floatText(city.tile, '다른 병력이 있어 들어갈 수 없어요');
      return;
    }
    const terrain = S.map.st.tiles.get(city.tile).terrain;
    if (['ocean', 'coast'].includes(terrain)) return;
    attacker.tile = city.tile;
    city.country = attacker.country;
    const land = new Set([city.tile, ...HexMap.neighbors(city.tile)]);
    for (const tile of S.data.tiles) {
      if (land.has(tile[0]) && !['ocean', 'coast'].includes(tile[1]) &&
          !S.data.cities.some(c => c !== city && c.tile === tile[0])) tile[3] = attacker.country;
    }
    city.hp = city.max_hp / 2;
    S.map.floatText(city.tile, '점령!');
  }

  function onTile(id) {
    if (S.loading) return;
    const current = selectedUnit();
    if (current && S.attacks.has(id)) {
      const attack = S.attacks.get(id);
      const target = attack.city || S.data.units.find(u => u.id === attack.unit);
      if (target) previewAttack(current, target, !!attack.city);
      return;
    }
    if (current && S.hints.has(id)) {
      S.moves.set(current.id, movesLeft(current) - S.hints.get(id));
      current.tile = id;
      refreshMap();
      selectUnit(current);
      return;
    }
    clearUnit();
    const own = S.data.units.find(u => u.tile === id && u.country === S.country && military(u))
      || S.data.units.find(u => u.tile === id && u.country === S.country && u.kind === 'scout');
    if (own) return selectUnit(own);
    S.sel = S.sel === id ? null : id;   // 같은 칸을 다시 누르면 칸 선택 해제
    S.map.select(S.sel);
    renderSide();
  }

  // ================= 오른쪽 창 =================
  function renderSide() {
    const side = $('#side'); if (!side) return;
    const scrollTop = side.scrollTop;
    const armyScrollTop = side.querySelector('.war-army-list')?.scrollTop || 0;
    side.innerHTML = '';
    side.append(h('div', { class: 'war-turn', role: 'status' }, '체험 턴 ' + S.turn));
    side.append(picker());
    const u = selectedUnit();
    if (u) side.append(h('div', { class: 'panel' },
      h('div', { class: 'side-title' }, unitName(u.kind)),
      row('체력', (u.hp == null ? 100 : u.hp) + '/100'),
      row('남은 이동력', movesLeft(u)),
      h('p', { class: 'muted' }, u.kind === 'worker' ? '노동자는 움직이지 않아요' : '노란 칸을 누르면 이동해요.'),
      military(u) ? h('p', { class: 'muted' }, S.attacked.has(u.id) ? '이번 턴에는 공격을 마쳤어요.' : '빨간 칸을 누르면 공격을 미리 볼 수 있어요.') : null));
    if (S.sel != null && S.sel >= 0 && S.map.st.tiles.get(S.sel)) tileWindow(side, S.sel);
    side.append(countryWindow(), armyWindow());
    side.querySelector('.war-army-list').scrollTop = armyScrollTop;
    side.scrollTop = scrollTop;
  }
  function armyWindow() {
    const units = S.data.units.filter(u => u.country === S.country && u.kind !== 'worker');
    return h('div', { class: 'panel war-army' },
      h('div', { class: 'panel-title' }, '병력 목록'),
      h('div', { class: 'war-army-list', role: 'group', 'aria-label': '우리 나라 병력' },
        units.length ? units.map(u => h('button', {
          class: 'small war-army-row', type: 'button', 'aria-pressed': String(u.id === S.unit),
          onclick: () => {
            if (S.loading) return;
            S.map.centerOn(u.tile, S.map.st.cam.z || 0.8);
            selectUnit(u);
          }
        }, h('span', { class: 'war-army-name' }, unitName(u.kind)),
        h('span', {}, '체력 ' + (u.hp == null ? 100 : u.hp)),
        h('span', {}, movesLeft(u) < fullMove(u) || S.attacked.has(u.id) ? '움직였어요' : '쉬는 중')))
          : h('p', { class: 'muted' }, '병력이 없어요.')));
  }
  // 체험할 나라를 골라요.
  function picker() {
    return h('div', { class: 'panel war-pick' },
      h('div', { class: 'panel-title' }, '어느 나라로 볼까요?', h('small', {}, '체험할 나라를 골라요')),
      h('div', { class: 'war-pick-row' }, S.data.countries.map(c =>
        h('button', {
          class: 'small war-pick-btn' + (c.id === S.country ? ' on' : ''), style: { '--gc': c.color },
          onclick: () => { if (S.loading) return; clearUnit(); S.country = c.id; S.sel = null; S.map.select(null); renderSide(); }
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
        h('span', { class: 'stat' }, '코인 ', h('b', {}, c.coin)),
        h('span', { class: 'stat' }, '병력 ', h('b', {}, S.data.units.filter(u => u.country === c.id).length + '부대')),
        h('span', { class: 'stat' }, '도시 ', h('b', {}, S.data.cities.filter(city => city.country === c.id).length + '곳'))),
      inv.length ? h('div', { class: 'war-inv' }, h('small', { class: 'muted' }, '창고: '),
        inv.map(([k, n]) => h('span', { class: 'chip' }, resName(k) + ' ' + n + '개'))) : null);
  }
  // 칸을 누르면: 지형, 주인 나라, 도시 이름, 병력 종류와 체력
  function tileWindow(side, id) {
    const t = S.map.st.tiles.get(id);
    const city = S.data.cities.find(x => x.tile === id);
    const us = S.data.units.filter(u => u.tile === id);
    const owner = t.owner ? myCountryOf(t.owner) : null;
    side.append(h('div', { class: 'panel' },
      h('div', { class: 'side-head' },
        h('button', { class: 'small', onclick: () => { clearUnit(); S.sel = null; S.map.select(null); renderSide(); } }, '←'),
        h('div', {}, h('div', { class: 'side-title' }, '칸 정보'), h('div', { class: 'muted' }, '칸 번호 ' + id))),
      row('지형', terrainName(t.terrain)),
      t.res ? row('자원', resName(t.res)) : null,
      t.imp ? row('시설', impName(t.imp)) : null,
      row('주인', owner ? owner.name : '빈 땅 (주인 없어요)'),
      city ? row('도시', city.name + (city.kind === 'capital' ? ' (수도)' : '')) : null,
      city ? row('도시 체력', city.hp + '/' + city.max_hp) : null,
      city && S.besieged.has(city.tile) ? row('도시 상태', '포위됨') : null,
      h('div', { class: 'war-units' },
        h('b', {}, '이 칸의 병력'),
        us.length ? us.map(u => h('div', { class: 'war-unit' },
          h(u.country === S.country && u.kind !== 'worker' ? 'button' : 'span', u.country === S.country && u.kind !== 'worker' ? { class: 'small', onclick: () => { if (!S.loading) selectUnit(u); } } : {}, h('i', { class: 'war-dot', style: { background: colorOf(u.country) } }), ' ' + unitName(u.kind)),
          h('span', { class: 'muted' }, '체력 ' + (u.hp == null ? 100 : u.hp))))
          : h('p', { class: 'muted' }, '이 칸에는 병력이 없어요.'))));
  }
  const myCountryOf = id => S.data.countries.find(c => c.id === id);
  const row = (k, v) => h('div', { class: 'war-row' }, h('small', { class: 'muted' }, k), h('b', {}, v));

  start();
})();
