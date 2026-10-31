// 학생 화면: 입장 → 지도·도시·우리 나라·외교·무역·소식
(function () {
  const R = window.RULES;
  const { rpc, ensureSession, subscribe, uploadImage, PHASES } = window.API;
  const { $, $$, h, toast, modal, fmt, debounce, typeColor, itemName, itemImg, costText, happyWord } = window.UI;
  const root = document.getElementById('app');
  const S = { me: null, st: null, mv: null, view: 'map', sel: null, mode: null, scout: null, busy: false, offset: 0, cityTab: 'build' };
  const MIL = Object.keys(R.UNITS);
  let map = null;

  // ================= 입장 =================
  async function start() {
    root.innerHTML = '<div class="entry"><p>지구 서버에 접속하는 중…</p></div>';
    try { await ensureSession(); } catch (e) { root.innerHTML = ''; root.appendChild(h('div', { class: 'entry' }, h('p', {}, e.message))); return; }
    // 선생님 관전 모드: index.html?observe (관제실에서 로그인한 기기만)
    const q = new URLSearchParams(location.search);
    if (q.has('observe')) {
      const a = await rpc('admin_check').catch(() => ({ admin: false }));
      if (a.admin && a.control) await rpc('admin_control', null);
      if (!a.admin) { entryShell(h('h1', {}, '관전 모드'), h('p', { class: 'sub' }, '관제실에서 먼저 로그인해 주세요.'), h('a', { href: 'admin.html' }, h('button', { class: 'primary' }, '관제실로'))); return; }
      S.obs = +q.get('observe') || 1; S.me = { status: 'observer' };
      document.body.classList.add('observer');
      return main();
    }
    const me = await rpc('get_me');
    if (me.status === 'joined') { S.me = me; return main(); }
    if (me.status === 'pending') return waiting();
    pickCountry();
  }
  function entryShell(...kids) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'entry-bg trade' }));
    root.appendChild(h('a', { href: 'admin.html', class: 'teacher-link' }, h('button', { class: 'small ghost' }, '교사')));
    root.appendChild(h('div', { class: 'entry wide' }, h('div', { class: 'title' }, '지구 서버'), h('div', { class: 'title-sub' }, h('span', {}, '문명의 시대')), ...kids));
  }
  const orn = text => h('div', { class: 'orn-head' }, h('i'), h('span', {}, text), h('i'));
  async function pickCountry() {
    const pub = await rpc('get_public');
    entryShell(orn('시작할 나라를 고르세요'), h('p', { class: 'sub' }, '우리 모둠 번호의 나라를 누르세요.'),
      h('div', { class: 'np-grid' }, pub.countries.map(c => natCard(c, () => pickName(c)))));
    HexMap.ready.then(() => document.querySelectorAll('canvas.np-scene').forEach(cv => drawScene(cv, cv.dataset.type)));
  }
  // 나라 고르기 카드: 육각 풍경 + 국기 자리 + 이름
  function natCard(c, onclick) {
    const T = R.TYPES[c.type] || {};
    return h('button', { class: 'npick', style: { '--gc': typeColor(c.type) }, onclick },
      h('div', { class: 'np-hex' }, h('canvas', { class: 'np-scene', width: 360, height: 400, 'data-type': c.type })),
      h('div', { class: 'np-flag' }, c.flag_url ? h('img', { src: c.flag_url, alt: '국기' }) : h('span', {}, '국기 자리'),
        c.emblem_url ? h('img', { class: 'np-emblem', src: c.emblem_url, alt: '문장' }) : null),
      h('div', { class: 'np-group' }, c.id + '모둠'),
      h('div', { class: 'np-name' }, c.name),
      c.name !== T.name ? h('div', { class: 'np-type' }, T.name) : null,
      h('div', { class: 'np-desc' }, T.desc || ''));
  }
  // 나라 유형별 작은 풍경 (반지름 2인 육각 섬 19칸). P평원 F숲 H언덕 M산 C해안 O바다 D사막 J정글 T툰드라 S눈 X수도
  const SCENES = {
    K: ['MFM', 'HFMC', 'CFXCO', 'OCPC', 'OCO'],
    J: ['OCO', 'OCMC', 'OFXCO', 'OCFO', 'OOO'],
    C: ['HPD', 'PHPD', 'FPXHD', 'PPHP', 'HPF'],
    A: ['FPF', 'PFPC', 'HPXPC', 'FPPC', 'PFC'],
    N: ['SST', 'TSTS', 'FTXTS', 'TFTT', 'FTF'],
    T: ['OCO', 'CJJC', 'OJXJC', 'CJCO', 'OCO']
  };
  const TER = { P: 'plains', F: 'forest', H: 'hills', M: 'mountain', C: 'coast', O: 'ocean', D: 'desert', J: 'jungle', T: 'tundra', S: 'snow' };
  function drawScene(cv, type) {
    const g = cv.getContext('2d'), I = HexMap.IMG, rows = SCENES[type] || SCENES.K;
    const w = 76, rowH = w / Math.sqrt(3) * 1.5, cx = cv.width / 2, cy = cv.height / 2 + 6;
    const sea = g.createRadialGradient(cx, cy, 20, cx, cy, 260); sea.addColorStop(0, '#3E7FA6'); sea.addColorStop(1, '#14324A');
    g.fillStyle = sea; g.fillRect(0, 0, cv.width, cv.height);
    let capital = null;
    rows.forEach((row, ri) => {
      const r = ri - 2, n = row.length;
      [...row].forEach((ch, i) => {
        const x = cx + (i - (n - 1) / 2) * w, y = cy + r * rowH;
        const key = ch === 'X' ? (type === 'N' ? 'tundra' : type === 'T' ? 'jungle' : 'plains') : TER[ch];
        const im = I['t:' + key]; if (!im) return;
        const hh = im.height * w / im.width;
        g.drawImage(im, x - w / 2, y + w / Math.sqrt(3) + 3 - hh, w, hh);
        if (ch === 'X') capital = [x, y];
      });
    });
    const art = I['c:' + type];
    if (art && capital) { const aw = 150, ah = art.height * aw / art.width; g.drawImage(art, capital[0] - aw / 2, capital[1] - ah * R.CITY_ANCHOR, aw, ah); }
    const vg = g.createRadialGradient(cx, cy, 120, cx, cy, 250); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = vg; g.fillRect(0, 0, cv.width, cv.height);
  }
  async function pickName(c) {
    const list = await rpc('get_roster', c.id);
    entryShell(orn(c.name), h('p', { class: 'sub' }, '내 이름을 누르세요.'),
      h('div', { class: 'roster' }, list.map(s => h('button', { disabled: s.taken, onclick: () => join(s) }, s.name, s.taken ? h('small', {}, '이미 들어옴') : null))),
      h('button', { class: 'ghost', onclick: pickCountry }, '← 나라 다시 고르기'));
  }
  async function join(s) {
    try {
      const r = await rpc('join_student', s.id);
      if (r.status === 'pending') return waiting();
      S.me = await rpc('get_me'); main();
    } catch (e) { toast(e.message, 'error'); }
  }
  function waiting() {
    entryShell(h('h1', {}, '선생님 승인을 기다려요'), h('p', { class: 'sub' }, '선생님이 확인하면 바로 들어가요.'), h('div', { class: 'waiting-dots' }, h('i'), h('i'), h('i')));
    const t = setInterval(async () => { const me = await rpc('get_me'); if (me.status === 'joined') { clearInterval(t); S.me = me; main(); } else if (me.status === 'none') { clearInterval(t); pickCountry(); } }, 3000);
  }

  // ================= 본 화면 =================
  async function main() {
    root.innerHTML = '';
    await refresh(true);
    subscribe({ game: refreshSoon, tick: t => { if (S.obs || !S.st || t.country_id === S.st.country.id) refreshSoon(); }, notice: n => { if (!n.country || S.obs || (S.st && n.country === S.st.country.id)) noticeToast(n); } });
    setInterval(() => refresh(false), 15000);
    setInterval(tickClock, 1000);
  }
  const refreshSoon = debounce(() => refresh(false), 350);
  async function refresh(first) {
    try {
      let st, mv;
      if (S.obs && !S.ctl) { const r = await rpc('admin_observe', S.obs); st = r.state; mv = r.map; S.world = r.world; }
      else [st, mv] = await Promise.all([rpc('my_state'), rpc('map_view')]);
      const prevPhase = S.st && S.st.game.phase;
      S.st = st; S.mv = mv;
      if (st.now) S.offset = new Date(st.now).getTime() - Date.now();
      if (first || !$('.topbar')) shell(); else { renderTop(); renderNav(); }
      updateMap();
      if (S.view !== 'map' || first || prevPhase !== st.game.phase) renderPage(); else renderSide();
    } catch (e) {
      if (e.code === 'NOT_JOINED') { S.me = null; pickCountry(); return; }
      console.warn(e);
    }
  }
  function noticeToast(n) {
    const kind = ['crisis', 'alert', 'unrest', 'revolt', 'short'].includes(n.kind) ? 'alert' : '';
    if (n.kind === 'turn') return;
    toast(n.message, kind);
  }

  // ---------- 위쪽 띠 ----------
  function shell() {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'topbar', id: 'top' }));
    root.appendChild(h('div', { class: 'nav', id: 'nav' }));
    root.appendChild(h('div', { class: 'page', id: 'page' }));
    renderTop(); renderNav();
  }
  function renderTop() {
    const st = S.st, co = st.country, inv = st.inventory, g = st.game;
    const top = $('#top'); top.innerHTML = '';
    top.style.setProperty('--gc', typeColor(co.type));
    top.append(...[
      h('div', { class: 'brand' }, co.flag_url ? h('img', { class: 'logo flag', src: co.flag_url }) : h('div', { class: 'logo-empty' }, co.id),
        h('div', { class: 'company' }, co.name, h('small', {}, R.TYPES[co.type].name + (co.title ? ' · ' + co.title : '')))),
      stat('coin', '국고', fmt(co.coin)),
      stat('res', '식량', fmt(inv.food || 0), 'food'),
      stat('res', '목재', fmt(inv.wood || 0), 'wood'),
      S.obs ? null : stat('res', '철광석', fmt(inv.iron || 0), 'iron'),
      h('span', { class: 'stat happy ' + happyClass(co.happy) }, h('span', { class: 'ico face' }), '행복도', h('b', {}, co.happy), h('small', {}, happyWord(co.happy))),
      S.obs ? obsChip() : h('span', { class: 'me-chip' }, S.st.me.name, myRoles().length ? myRoles().map(r => h('span', { class: 'lead' + (r === R.ROLES[0] ? '' : ' role') }, r)) : h('span', { class: 'lead role nohold', onclick: () => go('nation') }, '역할 고르기 →')),
      readyBtn(),
      h('span', { class: 'phase-badge' }, h('span', { class: 'n' }, g.turn ? '턴 ' + g.turn : PHASES[g.phase].name), h('span', { id: 'clock' }, PHASES[g.phase].name))].filter(Boolean));
    tickClock();
  }
  // 턴 끝내기 (국가 대표): 여섯 나라가 모두 누르면 바로 다음 턴
  function readyBtn() {
    const st = S.st, g = st.game; if (g.phase < 1 || g.turn < 1 || (S.obs && !S.ctl)) return null;
    const waiting = st.countries.filter(c => !c.ready).length;
    const lead = canRole(R.ROLES[0]);
    return h('button', { id: 'btn-ready', class: 'small ' + (st.country.ready ? 'ghost' : 'primary'), disabled: !lead || S.busy, title: lead ? '' : '국가 대표가 눌러요',
      onclick: () => act('turn_ready', [], r => r.next ? toast('모든 나라가 준비 완료! 턴 ' + r.turn + ' 시작') : toast(r.ready ? '턴 끝내기! 다른 나라를 기다려요 (' + r.waiting + '나라 남음)' : '턴 끝내기를 취소했어요')) },
      st.country.ready ? '기다리는 중 · ' + waiting + '나라' : '턴 끝내기');
  }
  // 관전: 어느 나라 화면을 볼지 고르기 (지도는 언제나 온 세상)
  function obsChip() {
    const sel = h('select', { class: 'obs-sel', onchange: async () => { S.obs = +sel.value; S.sel = null; unpick(); history.replaceState(null, '', '?observe=' + S.obs);
        if (S.ctl) await rpc('admin_control', S.obs); refresh(true); } },
      (S.world ? S.world.countries : S.st.countries).map(c => h('option', { value: c.id, selected: c.id === S.obs }, c.id + '. ' + c.name)));
    return h('span', { class: 'me-chip obs' }, h('span', { class: 'lead' }, S.ctl ? '체험 조작' : '관전'), sel,
      h('button', { class: 'small ' + (S.ctl ? 'danger' : 'gold'), title: '이 나라를 모든 역할로 직접 움직여 봐요', onclick: async () => {
        S.ctl = !S.ctl; await rpc('admin_control', S.ctl ? S.obs : null); unpick(); toast(S.ctl ? '체험 모드: 이 나라를 직접 조작해요 (안개도 학생과 똑같이 보여요)' : '관전 모드로 돌아왔어요'); refresh(true); } },
        S.ctl ? '관전으로' : '직접 조작'));
  }
  // 관전 모드에서는 볼 수만 있음 (체험 조작이면 모두 가능)
  function viewOnly() { if (!S.obs || S.ctl) return false; toast('관전 모드에서는 볼 수만 있어요. 「직접 조작」을 누르면 움직일 수 있어요.', 'error'); return true; }
  // 역할: 맡은 친구가 있으면 그 친구만, 아무도 안 맡았으면 누구나
  const myRoles = () => (S.st.me.roles || []);
  const canRole = r => S.ctl || (!S.obs && (myRoles().includes(r) || !S.st.members.some(m => m.bound && (m.roles || []).includes(r))));
  const roleWhy = r => canRole(r) ? '' : (S.obs ? '관전 중' : '「' + r + '」 담당 친구가 해요');
  const ROLE_IMG = { leader: 'img/city/capital_peninsula.png', spear: 'img/unit/spear.png', market: 'img/bld/market.png', worker: 'img/unit/worker.png', scout: 'img/unit/scout.png' };
  const roleImg = r => { const k = (R.ROLE_INFO[r] || {}).icon; return k === 'leader' ? 'img/city/' + (R.CITY_ART[S.st ? S.st.country.type : 'K'] || 'capital_peninsula') + '.png' : ROLE_IMG[k]; };
  function stat(kind, label, val, item) {
    const ico = kind === 'coin' ? h('span', { class: 'ico coin' }, 'C') : h('img', { class: 'ico img', src: itemImg(item), alt: '' });
    return h('span', { class: 'stat' }, ico, label, h('b', {}, val));
  }
  const happyClass = v => v >= 70 ? 'golden' : v >= 40 ? 'ok' : v >= 25 ? 'bad1' : 'bad2';
  function tickClock() {
    const el = $('#clock'); if (!el || !S.st) return;
    const g = S.st.game, end = g.timer_end || g.turn_end;
    if (!end) { el.textContent = PHASES[g.phase].name; return; }
    const left = Math.round((new Date(end).getTime() - (Date.now() + S.offset)) / 1000);
    el.textContent = (g.timer_end && g.timer_label ? g.timer_label + ' ' : PHASES[g.phase].name + ' · ') + (left <= 0 ? '곧 다음 턴!' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
  }
  function renderNav() {
    const g = S.st.game;
    const tabs = [['map', '지도'], ['nation', '우리 나라'], ['tech', '기술'], ['diplo', '외교'], ['trade', '무역'], ['news', '소식']];
    if (g.phase >= 10) tabs.splice(1, 0, ['treaty', '조약 회의']);
    const nav = $('#nav'); nav.innerHTML = '';
    nav.append(...tabs.map(([k, label]) => h('button', { class: S.view === k ? 'on' : '', 'data-v': k, onclick: () => go(k) }, h('span', { class: 'dot' }), label,
      k === 'trade' && pendingIn() ? h('span', { class: 'badge' }, pendingIn()) : null,
      k === 'diplo' && g.diplomacy_open ? null : null)),
      S.obs ? h('a', { href: 'admin.html', class: 'leave' }, h('button', { class: 'ghost small' }, '관제실로')) : h('button', { class: 'ghost small leave', onclick: leave }, '나가기'));
  }
  const pendingIn = () => S.st.offers.filter(o => o.to_c === S.st.country.id && o.status === 'pending').length;
  function go(v) { S.view = v; S.mode = null; S.unit = null; renderNav(); renderPage(); }
  async function leave() {
    if (!confirm('이 기기에서 나갈까요? 다시 들어오려면 이름을 골라야 해요.')) return;
    await rpc('leave_student'); location.reload();
  }

  // ================= 지도 =================
  function renderPage() {
    const page = $('#page'); page.innerHTML = '';
    page.className = 'page ' + (S.view === 'map' ? 'page-map' : '');
    if (S.view === 'map') return mapView(page);
    if (S.view === 'nation') return nationView(page);
    if (S.view === 'tech') return techView(page);
    if (S.view === 'diplo') return diploView(page);
    if (S.view === 'trade') return tradeView(page);
    if (S.view === 'news') return newsView(page);
    if (S.view === 'treaty') return treatyView(page);
  }
  function mapView(page) {
    const canvas = h('canvas', { class: 'hexmap' });
    const wrap = h('div', { class: 'map-wrap' }, canvas,
      h('div', { class: 'map-tools' },
        h('button', { class: 'small', onclick: () => map.zoom(1.25), title: '크게' }, '+'),
        h('button', { class: 'small', onclick: () => map.zoom(0.8), title: '작게' }, '−'),
        h('button', { class: 'small', onclick: () => capitalTile() >= 0 && map.centerOn(capitalTile(), 0.6) }, '수도로')),
      h('div', { id: 'mode-bar', class: 'mode-bar hidden' }), h('div', { id: 'quest', class: 'quest' }));
    page.append(h('div', { class: 'map-layout' }, wrap, h('div', { class: 'side panel', id: 'side' })));
    const keep = map && map.st.cam;
    map = HexMap.create(canvas, { onTile }); window.__map = map;
    updateMap(); renderQuest();
    if (keep) { Object.assign(map.st.cam, keep); map.mark(); } else setTimeout(() => capitalTile() >= 0 && map.centerOn(capitalTile(), 0.6), 30);
    renderSide();
  }
  const capitalTile = () => { const c = S.st.cities.find(x => x.kind === 'capital'); return c ? c.tile : -1; };
  function updateMap() {
    if (!map || !S.mv) return;
    if (S.obs && S.world) {   // 투명한 정찰병: 안개 없이 모든 땅·도시·병력
      const w = S.world;
      const tiles = new Map(w.tiles.map(([id, terrain, res, owner, imp]) => [id, { terrain, res, owner, imp }]));
      const countries = Object.fromEntries(w.countries.map(c => [c.id, { color: typeColor(c.type), type: c.type, name: c.name, flag_url: c.flag_url }]));
      map.setData({ tiles, cities: w.cities, units: w.units.map(u => ({ ...u })), countries, all: true, tintUnits: true });
      return;
    }
    const tiles = new Map(S.mv.tiles.map(([id, terrain, res, owner, imp]) => [id, { terrain, res, owner, imp }]));
    const countries = Object.fromEntries(S.st.countries.map(c => [c.id, { color: typeColor(c.type), type: c.type, name: c.name, flag_url: c.flag_url }]));
    const cities = S.mv.cities.map(c => ({ ...c, sea: (S.st.targets.find(t => t.id === c.id) || {}).sea }));
    map.setData({ tiles, cities, units: S.st.units.map(u => ({ ...u, done: u.kind !== 'worker' && u.moves === 0 })), countries, myType: S.st.country.type });
    if (S.unit) { const u = S.st.units.find(x => x.id === S.unit); if (u) showUnitHints(u); else unpick(); }
    renderQuest();
  }
  function tileInfo(id) { const t = map.st.tiles.get(id); return t ? { id, ...t } : null; }
  const cityOn = id => S.mv.cities.find(c => c.tile === id);
  const myCity = id => S.st.cities.find(c => c.tile === id);

  function onTile(id) {
    if (S.unit) return unitTap(id);
    S.sel = id; map.select(id); map.setHint([]); map.setPath([]);
    // 우리 병력이 있는 칸을 누르면 그 병력을 골라요
    const us = myUnitsOn(id).filter(u => u.kind !== 'worker');
    if (us.length && !myCity(id)) { pickUnit(us.find(u => u.moves > 0) || us[0]); return; }
    renderSide();
  }
  const myUnitsOn = id => S.st.units.filter(u => u.tile === id);

  // ---------- 오른쪽 창 ----------
  function renderSide() {
    const side = $('#side'); if (!side) return;
    side.innerHTML = '';
    if (S.unit) { const u = S.st.units.find(x => x.id === S.unit); if (u) return unitWindow(side, u); }
    const id = S.sel;
    if (id === null || id === undefined || !tileInfo(id)) return overview(side);
    const t = tileInfo(id), city = cityOn(id);
    if (city && myCity(id)) return cityWindow(side, myCity(id));
    if (city && city.kind === 'cs' && !city.country) return csWindow(side, city);
    tileWindow(side, t, city);
  }
  function sideHead(title, sub, onBack) {
    return h('div', { class: 'side-head' }, onBack ? h('button', { class: 'small', onclick: onBack }, '←') : null,
      h('div', {}, h('div', { class: 'side-title' }, title), sub ? h('div', { class: 'muted' }, sub) : null));
  }
  const back = () => { S.sel = null; map.select(null); renderSide(); };

  function overview(side) {
    const st = S.st, g = st.game, ready = st.units.filter(u => u.kind === 'worker' && !u.acted).length;
    const workers = st.units.filter(u => u.kind === 'worker').length;
    const scout = st.units.find(u => u.kind === 'scout');
    const army = st.units.filter(u => u.kind !== 'worker' && u.kind !== 'scout');
    const mine = st.targets.filter(t => t.mine), taken = mine.filter(t => t.owner === st.country.id).length;
    side.append(sideHead(S.obs ? st.country.name + ' 한눈에' + (S.ctl ? ' (체험 조작)' : ' (관전)') : '우리 나라 한눈에', R.TYPES[st.country.type].desc));
    if (g.phase === 0 || g.turn === 0) side.append(h('div', { class: 'hint' }, '아직 시작 전이에요. 「우리 나라」에서 역할을 나누고, 국가 대표는 나라 이름을 정해요.'));
    if (!S.obs) side.append(myRoles().length
      ? h('div', { class: 'my-mission' }, h('b', {}, '내 임무'), myRoles().map(r => h('div', { class: 'mm-row' }, h('img', { src: roleImg(r), alt: '' }), h('span', {}, h('i', {}, r), ' ' + R.ROLE_INFO[r].now))))
      : h('div', { class: 'warn-box' }, '아직 역할이 없어요. 「우리 나라」 탭에서 역할을 골라요.'));
    side.append(h('div', { class: 'todo' },
      todo('노동자', `일할 수 있는 노동자 ${ready} / ${workers}명`, '우리 땅(색칠된 칸)을 눌러 농장·벌목장·광산을 지어요.'),
      todo('도시', `도시 ${st.cities.length}곳`, '도시를 눌러 시장·병영 같은 건물을 지어요. 한 도시는 한 턴에 하나.'),
      todo('병력', `병력 ${army.length}부대 · 움직일 수 있는 ${army.filter(u => u.moves > 0).length}부대`, '지도에서 병력을 눌러 골라요 → 노란 칸으로 이동, 붉은 도시국가를 공격.'),
      todo('확장', `우리 쪽 도시국가 ${taken} / ${mine.length}곳 차지`, '다른 나라 쪽 도시국가와 바다 건너 요새도 차지할 수 있어요.'),
      scout ? todo('정찰', `이번 턴 이동 ${scout.moves}칸`, '정찰병으로 안개를 걷고 다른 나라를 찾아요. 바다에선 배로 바뀌어요.') : null));
    side.append(h('div', { class: 'row' },
      scout ? h('button', { id: 'btn-scout', class: 'sky', disabled: !scout.moves || g.turn < 1 || !canRole('별빛 탐험가'), title: roleWhy('별빛 탐험가'), onclick: () => pickUnit(scout) }, '정찰병 움직이기') : null,
      army.length ? h('button', { id: 'btn-army', class: 'danger', disabled: g.turn < 1, onclick: () => pickUnit(army.find(u => u.moves > 0) || army[0]) }, '병력 고르기') : null,
      h('button', { id: 'btn-capital', onclick: () => { const t = capitalTile(); S.sel = t; S.opened = true; map.select(t); map.centerOn(t); renderSide(); renderQuest(); } }, '수도 열기')));
    if (st.country.short && st.country.short.length) side.append(h('div', { class: 'warn-box' }, '부족해요: ' + st.country.short.join(', ')));
  }
  const TODO_ROLE = { '노동자': '대지 개척자', '도시': '수석 건축가', '병력': '총사령관', '확장': '총사령관', '정찰': '별빛 탐험가' };
  const todo = (k, a, b) => h('div', { class: 'todo-item' + (TODO_ROLE[k] && myRoles().includes(TODO_ROLE[k]) ? ' mine' : '') }, h('b', {}, k),
    h('div', {}, h('div', {}, a, TODO_ROLE[k] ? h('span', { class: 'role-tag' }, TODO_ROLE[k]) : null), h('small', { class: 'muted' }, b)));

  function tileWindow(side, t, city) {
    const st = S.st, mine = t.owner === st.country.id;
    const ownerName = t.owner ? (st.countries.find(c => c.id === t.owner) || {}).name : null;
    side.append(sideHead(R.TERRAIN[t.terrain] + (t.res ? ' · ' + itemName(t.res) : ''), mine ? '우리 나라 땅' : ownerName ? ownerName + '의 땅 (국경 안은 볼 수 없어요)' : '주인 없는 땅', back));
    if (city && !mine) side.append(h('p', {}, city.kind === 'capital' ? (ownerName || '') + '의 수도예요.' : city.name + (city.country ? '' : ' (다른 나라 쪽 도시국가)')));
    if (t.res) side.append(h('div', { class: 'res-line' }, h('img', { src: itemImg(t.res) }), itemName(t.res), mine ? '' : ' — 우리 땅이 되어야 개발할 수 있어요.'));
    if (!mine) return;
    if (t.imp) { side.append(h('div', { class: 'done-box' }, R.IMPROVE[t.imp].name + ' 완성! 매 턴 ' + yieldText(t))); return; }
    const opts = Object.entries(R.IMPROVE).filter(([k, v]) => v.res ? (t.res && v.res.includes(t.res)) : v.on.includes(t.terrain));
    if (!opts.length) { side.append(h('p', { class: 'muted' }, '이 칸에는 지을 수 있는 시설이 없어요.')); return; }
    const ready = st.units.some(u => u.kind === 'worker' && !u.acted);
    side.append(h('div', { class: 'card-list' }, opts.map(([k, v]) => {
      const mult = t.terrain === 'jungle' && !st.country.techs.includes('jungle') ? R.JUNGLE_MULT : 1;
      const cost = Object.fromEntries(Object.entries(v.cost).map(([a, b]) => [a, b * mult]));
      const why = roleWhy('대지 개척자') || (!ready ? '일할 노동자가 없어요' : v.tech && !st.country.techs.includes(v.tech) ? '「' + R.TECHS[v.tech] + '」 기술 필요' : short(cost));
      return h('div', { class: 'bcard' }, h('div', { class: 'bcard-img' }, impImg(k, t)),
        h('div', { class: 'bcard-body' }, h('b', {}, v.name), h('small', {}, '비용: ' + costText(cost) + (mult > 1 ? ' (정글이라 2배)' : '')),
          h('small', {}, '매 턴 ' + (v.item ? itemName(v.item) + ' +' + (t.terrain === 'tundra' && k === 'farm' ? R.TUNDRA_FOOD : v.yield) : itemName(t.res) + ' +' + v.yield)),
          why ? h('small', { class: 'bad' }, why) : null),
        h('button', { class: 'primary small', disabled: !!why || S.busy, onclick: () => act('worker_build', [t.id, k], r => { map.moveUnit(r.unit, [r.to]); map.floatText(t.id, v.name + ' 완성!'); }) }, '짓기'));
    })));
    if (!ready) side.append(h('button', { class: 'small', onclick: () => { const c = S.st.cities.find(x => x.kind === 'capital'); S.sel = c.tile; renderSide(); } }, '수도에서 노동자 고용하기 →'));
  }
  const yieldText = t => t.imp === 'farm' ? '식량 +' + (t.terrain === 'tundra' ? 1 : 2) : t.imp === 'lumber' ? '목재 +2' : itemName(t.res) + ' +' + (R.IMPROVE[t.imp] || {}).yield;
  function impImg(k, t) {
    const src = { farm: 'img/bld/farm.png', lumber: 'img/bld/lumber.png', mine: 'img/bld/mine.png' }[k] || (t && t.res ? itemImg(t.res) : '');
    return src ? h('img', { src, alt: '' }) : null;
  }
  function short(cost) {
    const st = S.st, miss = [];
    for (const [k, v] of Object.entries(cost)) { const have = k === 'coin' ? st.country.coin : (st.inventory[k] || 0); if (have < v) miss.push(itemName(k) + ' ' + (v - have)); }
    return miss.length ? miss.join(', ') + ' 모자라요' : '';
  }

  // 도시 그림: GPT 도시 그림(img/city)이 있으면 그것, 없으면 예전 건물 그림
  const cityArt = (c, fb) => R.CITY_ART[c.art] ? 'img/city/' + R.CITY_ART[c.art] + '.png' : 'img/bld/' + fb + '.png';

  // ---------- 도시 창 ----------
  function cityWindow(side, c) {
    const st = S.st, cap = c.kind === 'capital';
    side.append(sideHead(cap ? st.country.name + ' 수도' : c.name, (cap ? '수도' : '도시') + (c.unrest ? ' · 불안 (생산 멈춤)' : ''), back));
    side.append(h('div', { class: 'city-pic' }, h('img', { src: cityArt(c, cap ? 'capital' : 'port') }),
      h('div', { class: 'city-blds' }, c.buildings.map(b => h('span', { class: 'bld-mini', title: R.BUILDINGS[b].name }, bldImg(b, R.BUILDINGS[b].name), h('small', {}, R.BUILDINGS[b].name))))));
    const tabs = h('div', { class: 'subtabs' }, [['build', '건설'], ['train', '병력 훈련'], ['info', '도시 정보']].map(([k, l]) =>
      h('button', { class: 'small ' + (S.cityTab === k ? 'gold' : ''), onclick: () => { S.cityTab = k; renderSide(); } }, l)));
    side.append(tabs);
    if (S.cityTab === 'build') {
      if (c.built) side.append(h('div', { class: 'hint' }, '이 도시는 이번 턴에 건물을 지었어요. 다음 턴에 또 지을 수 있어요.'));
      side.append(h('div', { class: 'card-list' }, Object.entries(R.BUILDINGS).map(([k, b]) => {
        const has = c.buildings.includes(k);
        const why = has ? '' : roleWhy('수석 건축가') ? roleWhy('수석 건축가') : c.built ? '이번 턴 건설 끝' : b.tech && !st.country.techs.includes(b.tech) ? '「' + R.TECHS[b.tech] + '」 기술 필요'
          : b.coastal && !c.coastal ? '바닷가 도시만' : short(b.cost);
        const eff = k === 'market' && R.PRODUCTIVITY[st.country.type] ? '매 턴 코인 +' + R.PRODUCTIVITY[st.country.type].market + ' (우리 도시 안의 시장)' : b.effect;
        return h('div', { class: 'bcard' + (has ? ' have' : '') }, h('div', { class: 'bcard-img' }, bldImg(k)),
          h('div', { class: 'bcard-body' }, h('b', {}, b.name), h('small', {}, eff), has ? h('small', { class: 'good' }, '지었어요') : h('small', {}, '비용: ' + costText(b.cost)),
            !has && why ? h('small', { class: 'bad' }, why) : null),
          has ? null : h('button', { class: 'primary small', disabled: !!why || S.busy, onclick: () => act('city_build', [c.id, k], () => map.floatText(c.tile, b.name + '!')) }, '짓기'));
      })));
      side.append(h('div', { class: 'bcard' }, h('div', { class: 'bcard-img' }, h('img', { src: 'img/unit/worker.png' })),
        h('div', { class: 'bcard-body' }, h('b', {}, '노동자 고용'), h('small', {}, '비용: ' + costText(R.HIRE_WORKER)), h('small', {}, '땅을 개발할 일꾼이 늘어나요. 매 턴 식량 1을 먹어요.'),
          (roleWhy('대지 개척자') || short(R.HIRE_WORKER)) ? h('small', { class: 'bad' }, roleWhy('대지 개척자') || short(R.HIRE_WORKER)) : null),
        h('button', { class: 'primary small', disabled: !!(roleWhy('대지 개척자') || short(R.HIRE_WORKER)) || S.busy, onclick: () => act('hire_worker', [c.id], () => map.floatText(c.tile, '노동자 +1')) }, '고용')));
    } else if (S.cityTab === 'train') {
      if (!c.buildings.includes('barracks') && !c.buildings.includes('harbor')) side.append(h('div', { class: 'hint' }, '병영(육군)이나 항구(배)가 있어야 훈련할 수 있어요. 「건설」에서 지어요.'));
      else if (c.trained) side.append(h('div', { class: 'hint' }, '이 도시는 이번 턴에 이미 훈련했어요.'));
      const techs = st.country.techs;
      side.append(h('div', { class: 'card-list' }, Object.entries(R.UNITS).filter(([, u]) => !u.tech || techs.includes(u.tech) || R.TECH_TREE[u.tech].era <= 2).map(([k, u]) => {
        const need = u.sea ? 'harbor' : 'barracks';
        const why = roleWhy('총사령관') || (u.tech && !techs.includes(u.tech) ? '「' + R.TECHS[u.tech] + '」 기술 필요' : !c.buildings.includes(need) ? (u.sea ? '항구 필요' : '병영 필요') : c.trained ? '이번 턴 훈련 끝' : short(u.cost));
        return h('div', { class: 'bcard' + (why && why.includes('기술') ? ' locked' : '') }, h('div', { class: 'bcard-img' }, h('img', { src: unitImg(k) })),
          h('div', { class: 'bcard-body' }, h('b', {}, u.name), h('small', {}, '힘 ' + u.str + ' · 이동 ' + u.move + '칸' + (u.range ? ' · 사거리 ' + u.range : '') + (u.sea ? ' · 배' : '')),
            h('small', {}, '비용: ' + costText(u.cost)), why ? h('small', { class: 'bad' }, why) : null),
          h('button', { class: 'primary small', disabled: !!why || S.busy, onclick: () => act('train_unit', [c.id, k], () => map.floatText(c.tile, u.name + ' 훈련!')) }, '훈련'));
      })));
      side.append(h('small', { class: 'muted' }, '더 강한 병력은 「기술」 탭에서 연구하면 나타나요. 병력 유지비: 한 부대에 매 턴 ' + R.UNIT_UPKEEP + '코인.'));
    } else {
      const army = st.units.filter(u => MIL.includes(u.kind));
      side.append(h('div', { class: 'col' },
        h('div', {}, '이 도시 건물: ' + (c.buildings.map(b => R.BUILDINGS[b].name).join(', ') || '없음')),
        h('div', {}, '우리 나라 병력: ' + (Object.entries(count(army.map(u => u.kind))).map(([k, n]) => (R.UNITS[k] || { name: k }).name + ' ' + n).join(', ') || '없음')),
        h('div', {}, '노동자 ' + st.units.filter(u => u.kind === 'worker').length + '명'),
        h('small', { class: 'muted' }, '도시가 늘면 수입이 늘지만, 시민들이 원하는 것도 많아져요.')));
    }
  }
  // 건물 그림 (GPT 그림): 도시 건물·공장·발전 건물
  const BLD_ART = { market: 'market', barracks: 'barracks', harbor: 'harbor', granary: 'granary', plaza: 'plaza',
    steelworks: 'steelworks', refinery: 'refinery', chipfab: 'chipfab', textilemill: 'textilemill', rubberplant: 'rubberplant', workshop: 'goldsmith',
    industrial: 'shipyard', electronics: 'market2', theater: 'palace', netcenter: 'lab', satcenter: 'airfield', arsenal: 'barracks2',
    commtower: 'lab', broadcast: 'palace', nuclearplant: 'steelmill' };
  function bldImg(k, alt) {
    return BLD_ART[k] ? h('img', { src: 'img/bld/' + BLD_ART[k] + '.png', alt: alt || '' }) : null;
  }
  const count = arr => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});

  // ---------- 병력·정찰병: 고르기 → 노란 칸 이동 → 붉은 도시국가 공격 ----------
  const unitImg = k => 'img/unit/' + ((R.UNITS[k] || {}).img || k) + '.png';
  const unitName = k => k === 'scout' ? '정찰병' : k === 'worker' ? '노동자' : (R.UNITS[k] || { name: k }).name;
  const isSea = k => !!(R.UNITS[k] || {}).sea;
  function passFor(u) {
    const sea = isSea(u.kind), scout = u.kind === 'scout';
    const cityTiles = new Set(S.mv.cities.filter(c => c.country !== S.st.country.id).map(c => c.tile));
    return id => {
      const t = map.st.tiles.get(id);
      if (!t) return scout;   // 안 본 칸은 정찰병만 (서버가 다시 검사)
      const water = t.terrain === 'ocean' || t.terrain === 'coast';
      if (cityTiles.has(id)) return false;
      if (!scout && sea !== water) return false;
      return water || !t.owner || t.owner === S.st.country.id;
    };
  }
  function attackable(u) {
    if (u.kind === 'scout' || u.kind === 'worker' || u.attacked) return [];
    const rng = (R.UNITS[u.kind] || {}).range || 1;
    return S.mv.cities.filter(c => c.kind === 'cs' && !c.country && !(c.tutorial && !mineCs(c)) && HexMap.hexDist(u.tile, c.tile) <= rng);
  }
  const mineCs = c => (S.st.targets.find(t => t.id === c.id) || {}).mine;
  function showUnitHints(u) {
    const canAct = u.kind === 'scout' ? canRole('별빛 탐험가') : canRole('총사령관');
    map.selectUnit(u.id); map.select(u.tile);
    map.setHint(canAct && u.moves > 0 ? [...HexMap.reachable(u.tile, passFor(u), u.moves).keys()] : []);
    map.setAtk(canAct ? attackable(u).map(c => c.tile) : []);
  }
  function pickUnit(u) {
    if (!u) return;
    S.unit = u.id; S.sel = null; S.picked = true;
    map.centerOn(u.tile); showUnitHints(u); renderSide(); renderQuest();
  }
  function unpick() { S.unit = null; if (map) { map.selectUnit(null); map.setHint([]); map.setAtk([]); map.setPath([]); } }
  function unitWindow(side, u) {
    const st = S.st, info = R.UNITS[u.kind] || {}, role = u.kind === 'scout' ? '별빛 탐험가' : '총사령관';
    side.append(sideHead(unitName(u.kind), u.kind === 'scout' ? '안개를 걷고 다른 나라를 찾아요 · 바다에선 배로 바뀌어요' : '노란 칸: 이동 · 붉은 칸: 공격', () => { unpick(); renderSide(); }));
    side.append(h('div', { class: 'unit-card' }, h('img', { src: unitImg(u.kind) }),
      h('div', { class: 'col', style: { gap: '4px', flex: 1 } },
        u.kind !== 'scout' ? h('div', {}, '힘 ', h('b', {}, info.str), info.range ? ' · 사거리 ' + info.range : '', info.sea ? ' · 배' : '') : null,
        h('div', { class: 'meter' }, h('i', { style: { width: u.hp + '%', background: u.hp > 60 ? '#4FD06A' : u.hp > 30 ? '#F2B530' : '#E8443C' } })),
        h('small', {}, '체력 ' + u.hp + ' / 100 · 남은 이동 ' + u.moves + ' / ' + u.max_moves + '칸' + (u.attacked ? ' · 이번 턴 공격 끝' : '')))));
    if (roleWhy(role)) side.append(h('div', { class: 'warn-box' }, roleWhy(role)));
    // 같은 칸의 다른 병력
    const others = myUnitsOn(u.tile).filter(x => x.id !== u.id && x.kind !== 'worker');
    if (others.length) side.append(h('div', { class: 'row' }, h('small', { class: 'muted' }, '같은 칸:'), others.map(x => h('button', { class: 'small', onclick: () => pickUnit(x) }, unitName(x.kind) + (x.moves ? '' : ' (끝)')))));
    const targets = attackable(u);
    if (targets.length) side.append(h('div', { class: 'card-list' }, targets.map(c => {
      const pv = preview(u, c);
      return h('div', { class: 'bcard atk' }, h('div', { class: 'bcard-img' }, h('img', { src: cityArt(c, 'capital') })),
        h('div', { class: 'bcard-body' }, h('b', {}, c.name + (c.boss ? ' (최종 보스)' : '')), h('small', {}, '방어 ' + c.def + ' · 체력 ' + c.hp + '/' + c.max_hp),
          h('small', { class: pv.dies ? 'bad' : '' }, '예상: 도시 -' + pv.dc + ' · 우리 -' + pv.du + (pv.dies ? ' (쓰러질 수 있어요!)' : pv.capture ? ' → 점령!' : ''))),
        h('button', { class: 'danger small', disabled: !!roleWhy(role) || S.busy, onclick: () => attack(u, c) }, '공격'));
    })));
    else if (u.kind !== 'scout') side.append(h('small', { class: 'muted' }, '도시국가 바로 옆 칸(원거리 병력은 사거리 안)까지 움직이면 공격할 수 있어요.'));
    // 다음 병력
    const next = st.units.filter(x => x.kind !== 'worker' && x.kind !== 'scout' && x.moves > 0 && x.id !== u.id);
    if (next.length && u.kind !== 'scout') side.append(h('button', { class: 'small', onclick: () => pickUnit(next[0]) }, '다음 병력 →'));
  }
  // 전투 미리보기 (서버와 같은 식)
  function preview(u, c) {
    const C = R.COMBAT, str = (R.UNITS[u.kind] || {}).str || 1, ranged = !!(R.UNITS[u.kind] || {}).range && HexMap.hexDist(u.tile, c.tile) > 1;
    const ratio = str * (0.5 + 0.5 * u.hp / 100) / Math.max(1, c.def);
    const dc = Math.max(C.min, Math.min(C.max, Math.round(C.base * ratio)));
    let du = Math.max(1, Math.min(150, Math.round(C.base / ratio))); if (ranged) du = Math.round(du * C.rangedCounter);
    return { dc, du, dies: du >= u.hp, capture: dc >= c.hp };
  }
  async function unitTap(id) {
    const u = S.st.units.find(x => x.id === S.unit); if (!u) { unpick(); return; }
    const city = S.mv.cities.find(c => c.tile === id && c.kind === 'cs' && !c.country);
    if (city && attackable(u).some(c => c.id === city.id)) return attack(u, city);
    if (map.st.hint.has(id)) return moveTo(u, id);
    // 다른 우리 병력을 누르면 그 병력으로
    const us = myUnitsOn(id).filter(x => x.kind !== 'worker');
    if (us.length) return pickUnit(us.find(x => x.moves > 0) || us[0]);
    unpick(); S.sel = id; map.select(id); renderSide();
  }
  async function moveTo(u, id) {
    if (viewOnly() || S.busy) return;
    const p = HexMap.path(u.tile, id, passFor(u), u.moves);
    if (!p || !p.length) { toast('그곳은 이번 턴에 갈 수 없어요.', 'error'); return; }
    S.busy = true; map.setHint([]); map.setAtk([]); map.setPath(p);
    try {
      const r = await rpc('unit_move', u.id, p);
      map.moveUnit(u.id, p, async () => {
        map.setPath([]); S.busy = false;
        await refresh(false);
        if (r.new_tiles) map.floatText(id, '새로 본 칸 ' + r.new_tiles);
        if (r.discovered && r.discovered.length) {
          const names = r.discovered.map(c => (S.st.countries.find(x => x.id === c) || {}).name).join(', ');
          modal(h('div', { class: 'center' }, h('h2', {}, '새로운 나라 발견!'), h('p', {}, names + '을(를) 발견했어요. 국경 너머에 다른 나라가 있어요.')));
        }
      });
    } catch (e) { S.busy = false; map.setPath([]); toast(e.message, 'error'); showUnitHints(u); }
  }
  async function attack(u, city) {
    if (viewOnly() || S.busy) return;
    S.busy = true; renderSide();
    let res = null, err = null;
    const p = rpc('unit_attack', u.id, city.id).then(r => res = r).catch(e => err = e);
    const ranged = !!(R.UNITS[u.kind] || {}).range && HexMap.hexDist(u.tile, city.tile) > 1;
    const after = async () => {
      await p; S.busy = false;
      if (err) { toast(err.message, 'error'); renderSide(); return; }
      map.floatText(city.tile, '-' + res.city_dmg, '#FFB13D');
      setTimeout(() => map.floatText(u.tile, res.died ? '쓰러짐' : '-' + res.unit_dmg, '#FF6A6A'), 250);
      if (res.died) toast(unitName(u.kind) + '이(가) 반격에 쓰러졌어요. 더 강한 병력이 필요해요!', 'alert');
      if (res.captured) {
        unpick();
        const kids = [h('img', { src: cityArt(city, 'capital'), class: 'capture-pic' }), h('h2', {}, res.name + ' 점령!'), h('p', {}, '시민들이 환호합니다! (행복도 +' + R.HAPPY.glory + ')')];
        if (res.coin) kids.push(h('p', {}, '보물 창고에서 코인 +' + res.coin));
        if (res.res && res.res.length) kids.push(h('p', {}, '새 자원: ', res.res.map(r => h('span', { class: 'res-chip' }, h('img', { src: itemImg(r) }), itemName(r)))));
        if (res.techs && res.techs.length) kids.push(h('p', {}, '기술자들이 합류했어요: ', res.techs.map(t => h('span', { class: 'chip tech' }, t))));
        setTimeout(() => modal(h('div', { class: 'center capture' }, ...kids)), 500);
      } else if (!res.died) map.floatText(city.tile, '성벽 ' + res.city_hp + '/' + res.max_hp, '#FFE9C2');
      await refresh(false);
    };
    map.centerOn(city.tile);
    if (ranged) map.siege(u.tile, city.tile, 1, after); else map.strike(u.tile, city.tile, after);
  }
  // 도시국가 정보 창 (병력을 안 고르고 눌렀을 때)
  function csWindow(side, city) {
    const st = S.st, tg = st.targets.find(t => t.id === city.id) || city;
    const tier = R.CS_TIERS[city.tier || 0];
    side.append(sideHead(city.name, (city.boss ? '최종 보스 · ' : '') + tier.name + (tg.mine ? ' · 우리 나라 쪽' : ' · 누구나 차지할 수 있어요'), back));
    side.append(h('div', { class: 'city-pic' }, h('img', { src: cityArt(city, 'capital'), class: 'neutral' })));
    side.append(h('div', { class: 'vs' }, h('div', {}, h('small', {}, '방어력'), h('b', {}, city.def)), h('span', {}, '성벽'), h('div', {}, h('small', {}, '체력'), h('b', {}, city.hp + '/' + city.max_hp))));
    const gain = [];
    if (tg.res && tg.res.length) gain.push(h('div', { class: 'res-line' }, '주변 자원: ', tg.res.map(r => h('span', { class: 'res-chip' }, h('img', { src: itemImg(r) }), itemName(r)))));
    if (tg.tech) gain.push(h('div', {}, '기술자 합류: ', tg.tech.split(',').map(t => h('span', { class: 'chip tech' }, R.TECHS[t]))));
    if (tg.bonus) gain.push(h('div', {}, '보물 창고 코인 +' + tg.bonus));
    gain.push(h('div', {}, '매 턴 코인 +' + R.INCOME.city + ', 주변 땅이 우리 영토로'));
    side.append(h('div', { class: 'gain' }, h('b', {}, '차지하면'), ...gain));
    if (city.tutorial && !tg.mine) side.append(h('div', { class: 'warn-box' }, '각 나라의 첫 도시국가는 그 나라만 차지할 수 있어요.'));
    side.append(h('small', { class: 'muted' }, '병력을 골라 바로 옆 칸까지 움직인 뒤 공격해요. 도시는 반격하고, 한 턴마다 성벽이 ' + tier.heal + ' 회복돼요. 여러 병력으로 한 턴에 몰아쳐요!'));
    const near = st.units.filter(u => attackable(u).some(c => c.id === city.id));
    if (near.length) side.append(h('div', { class: 'row' }, near.map(u => h('button', { class: 'danger small', onclick: () => pickUnit(u) }, unitName(u.kind) + '로 공격'))));
  }

  // ---------- 공통 행동 ----------
  async function act(fn, args, after) {
    if (viewOnly() || S.busy) return;
    S.busy = true;
    try {
      const r = await rpc(fn, ...args);
      after && after(r);
    } catch (e) { toast(e.message, 'error'); }
    S.busy = false;
    await refresh(false);
  }

  // ================= 우리 나라 =================
  function nationView(page) {
    const st = S.st, co = st.country, g = st.game;
    const inv = Object.entries(st.inventory).filter(([k, v]) => v > 0 && R.ITEMS[k]);
    const rolesFirst = !S.obs && (g.phase === 0 || !myRoles().length);   // 처음에는 역할 나누기가 맨 위
    if (rolesFirst) page.append(membersPanel());
    page.append(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '창고', h('small', {}, '매 턴 생산하고, 사치품은 종류마다 1개씩 써요')),
        inv.length ? h('div', { class: 'inv-grid' }, inv.map(([k, v]) => h('div', { class: 'inv' + (R.LUX.includes(k) ? ' lux' : '') }, h('img', { src: itemImg(k) }), h('b', {}, v), h('small', {}, itemName(k))))) : h('p', { class: 'muted' }, '아직 비어 있어요.')),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '행복도 ' + co.happy, h('small', {}, happyWord(co.happy))),
        h('div', { class: 'meter' }, h('i', { style: { width: co.happy + '%', background: co.happy >= 70 ? '#3DCB6C' : co.happy >= 40 ? '#F2B530' : '#E0465C' } })),
        h('ul', { class: 'why' },
          h('li', {}, '사치품 종류 ' + co.lux_types + '가지 (종류마다 +' + R.HAPPY.perLuxType + ')'),
          h('li', {}, '점령 환호 +' + co.glory),
          h('li', {}, '도시 ' + (st.cities.length - 1) + '곳 관리 (도시마다 ' + (R.HAPPY.perCity + (g.crisis ? R.HAPPY.crisis.perCity : 0)) + ')'),
          g.crisis ? h('li', {}, '시민 요구: 사치품 2종류 이상, 병력 3부대 이상이면 강철 1, 도시 4곳 이상이면 연료 1') : null,
          co.short.length ? h('li', { class: 'bad' }, '지난 턴 부족: ' + co.short.join(', ')) : null),
        h('small', { class: 'muted' }, '70 이상 황금기(수입 +25%) · 40 아래 불만 · 25 아래 도시 불안'))));
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '기술', h('small', {}, '도시국가를 차지하면 기술자가 합류하기도 해요')),
      h('div', { class: 'row' }, co.techs.map(t => h('span', { class: 'chip tech' }, R.TECHS[t])), h('button', { class: 'small gold', onclick: () => go('tech') }, '기술 계통도 보기 →'))));
    if (g.phase >= 2) page.append(industryPanel());
    if (rolesFirst) page.append(setupPanel()); else page.append(membersPanel(), setupPanel());
  }
  function industryPanel() {
    const st = S.st, tp = st.country.type;
    const facts = Object.entries(R.FACTORIES).filter(([, f]) => st.country.techs.includes(f.tech) && R.PROC_COST[tp][f.output] !== undefined);
    return h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '공장과 발전 건물', h('small', {}, '원료 1개 + 가공비 → 제품 1개 (매 턴 2개까지)')),
      h('div', { class: 'card-list wide' },
        facts.length ? facts.map(([k, f]) => {
          const has = st.factories.includes(k);
          return h('div', { class: 'bcard' + (has ? ' have' : '') }, h('div', { class: 'bcard-img' }, bldImg(k, f.name)),
            h('div', { class: 'bcard-body' }, h('b', {}, f.name), h('small', {}, itemName(f.input) + ' → ' + itemName(f.output) + ' · 가공비 ' + R.PROC_COST[tp][f.output] + '코인/개'),
              has ? h('small', { class: 'good' }, '가동 중') : h('small', {}, '짓는 비용: ' + costText(f.build))),
            has ? null : h('button', { class: 'primary small', disabled: !!short(f.build) || !canRole('수석 건축가') || S.busy, title: roleWhy('수석 건축가'), onclick: () => act('factory_build', [k]) }, '짓기'));
        }) : h('p', { class: 'muted' }, '우리 나라 기술로 지을 수 있는 공장이 없어요. 제품은 다른 나라에서 사 와야 해요.'),
        Object.entries(R.ADVANCED).filter(([, a]) => !a.tech || st.country.techs.includes(a.tech)).map(([k, a]) => {
          const has = st.advanced.includes(k);
          return h('div', { class: 'bcard' + (has ? ' have' : '') }, h('div', { class: 'bcard-img' }, bldImg(k, a.name)),
            h('div', { class: 'bcard-body' }, h('b', {}, a.name), h('small', {}, (a.econ ? '경제력 +' + a.econ : '') + (a.culture ? '문화력 +' + a.culture : '') + (a.coinPerTurn ? ', 매 턴 코인 +' + a.coinPerTurn : '') + (a.happy ? ', 행복도 +' + a.happy : '') + (a.unlock ? '대포 훈련 가능' : '')),
              has ? h('small', { class: 'good' }, '지었어요') : h('small', {}, '비용: ' + costText(a.cost)), !has && short(a.cost) ? h('small', { class: 'bad' }, short(a.cost)) : null),
            has ? null : h('button', { class: 'primary small', disabled: !!short(a.cost) || !canRole('수석 건축가') || S.busy, title: roleWhy('수석 건축가'), onclick: () => act('advanced_build', [k]) }, '짓기'));
        })));
  }
  function setupPanel() {
    const st = S.st, co = st.country, lead = st.me.is_leader;
    const name = h('input', { type: 'text', id: 'cname', value: co.name, maxlength: 16, disabled: !lead });
    const up = (field, label, ratio) => {
      const inp = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
      inp.addEventListener('change', async () => {
        if (!inp.files[0] || viewOnly()) return;
        try { const url = await uploadImage(inp.files[0], 'country', 600, 'image/png'); await rpc('country_update', { [field]: url }); toast(label + '을(를) 올렸어요.'); refresh(false); }
        catch (e) { toast(e.message, 'error'); }
      });
      return h('div', { class: 'upload' }, co[field] ? h('img', { src: co[field], class: 'up-' + field }) : h('div', { class: 'up-empty up-' + field }, label + ' ' + ratio),
        lead ? h('button', { class: 'small', onclick: () => inp.click() }, label + ' 올리기') : null, inp);
    };
    return h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '나라 꾸미기', h('small', {}, lead ? '국가 대표만 바꿀 수 있어요' : '국가 대표가 정해요')),
      h('div', { class: 'row' }, name, lead ? h('button', { class: 'primary small', onclick: () => act('country_update', [{ name: name.value }]) }, '이름 저장') : null),
      h('div', { class: 'row', style: { marginTop: '10px', alignItems: 'flex-start' } }, up('flag_url', '국기', '(가로 3:세로 2)'), up('emblem_url', '왕국 문장', '(정사각형)')));
  }
  function membersPanel() {
    const st = S.st, mine = myRoles(), lead = R.ROLES[0];
    const holders = r => st.members.filter(m => (m.roles || []).includes(r));
    return h('div', { class: 'panel roles-panel' }, h('div', { class: 'panel-title' }, '역할 나누기', h('small', {}, '누르면 맡기 / 다시 누르면 내려놓기 · 한 사람 3개까지 · 국가 대표는 한 명')),
      h('div', { class: 'role-grid' }, R.ROLES.map(r => {
        const hs = holders(r), on = mine.includes(r), info = R.ROLE_INFO[r];
        const taken = r === lead && !on && hs.length > 0;
        return h('button', { class: 'role-card' + (on ? ' on' : '') + (hs.length ? '' : ' empty'), disabled: S.obs || taken || (!on && mine.length >= 3),
            onclick: () => act('set_role', [r], () => { if (!on) roleIntro(r); }) },
          h('span', { class: 'rc-check' }, on ? '✓' : ''),
          h('img', { src: roleImg(r), alt: '' }),
          h('b', {}, r),
          h('small', { class: 'rc-now' }, info.now),
          h('small', { class: 'rc-later' }, '무역 때: ' + info.later),
          h('span', { class: 'rc-who' }, hs.length ? hs.map(m => m.name).join(', ') : '아직 없음 (누구나 할 수 있음)'));
      })),
      h('div', { class: 'members' }, st.members.map(m => h('div', { class: 'member' }, h('span', { class: 'dot ' + (m.online ? 'on' : '') }), m.name,
        (m.roles || []).map(r => h('span', { class: 'chip ' + (r === lead ? 'lead' : 'tech') }, r))))));
  }

  // ================= 기술 계통도 =================
  function techView(page) {
    const st = S.st, have = st.country.techs, TT = R.TECH_TREE;
    const can = k => TT[k].req.every(q => have.includes(q));
    const lead = roleWhy('별빛 탐험가');
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '기술 계통도', h('small', {}, '왼쪽 기술을 알아야 오른쪽 기술을 연구할 수 있어요 · 한 턴에 하나 · 도시국가를 차지하면 기술자가 합류하기도 해요')),
      st.country.researched ? h('div', { class: 'hint' }, '이번 턴에는 이미 연구했어요. 「턴 끝내기」 뒤에 또 연구할 수 있어요.') : lead ? h('div', { class: 'hint' }, lead) : null,
      h('div', { class: 'tree-wrap' },
        svgEl(),
        h('div', { class: 'tree' },
          R.ERAS.map((e, i) => h('div', { class: 'era-head', style: { gridColumn: i + 1 } }, e)),
          h('div', { class: 'tcard done ancient', style: { gridColumn: 1, gridRow: '2 / span 8' } }, h('b', {}, '고대 기술'), h('small', {}, '모두 익혔어요'),
            R.ANCIENT.map(a => h('span', { class: 'anc' }, a))),
          Object.entries(TT).map(([k, t]) => {
            const done = have.includes(k), ok_ = can(k), why = done ? '' : !ok_ ? '먼저: ' + t.req.filter(q => !have.includes(q)).map(q => TT[q].name).join(', ') : (lead || (st.country.researched ? '이번 턴 연구 끝' : short(t.cost)));
            return h('div', { class: 'tcard ' + (done ? 'done' : ok_ ? 'open' : 'locked'), id: 'tc-' + k, style: { gridColumn: t.era + 1, gridRow: t.row + 2 } },
              h('div', { class: 'tc-top' }, R.TECH_ICON[k] ? h('img', { class: 'tc-ic', src: 'img/tech/' + R.TECH_ICON[k] + '.png', alt: '' }) : null, h('b', {}, t.name), done ? h('span', { class: 'tc-done' }, '완료') : null),
              h('small', { class: 'tc-un' }, t.unlock),
              done ? null : h('small', { class: 'tc-cost' }, '연구비: ' + costText(t.cost)),
              done ? null : h('button', { class: 'small ' + (ok_ ? 'primary' : ''), disabled: !!why || S.busy, title: why, onclick: () => act('research_tech', [k], () => toast('「' + t.name + '」 연구 완료!')) }, ok_ ? '연구' : '잠김'),
              !done && why && ok_ ? h('small', { class: 'bad' }, why) : null);
          })))));
    requestAnimationFrame(drawTreeLines);
  }
  function svgEl() { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('class', 'tree-lines'); e.id = 'tree-lines'; return e; }
  function drawTreeLines() {
    const svg = $('#tree-lines'); if (!svg) return;
    const box = svg.parentElement.getBoundingClientRect();
    svg.setAttribute('width', box.width); svg.setAttribute('height', svg.parentElement.scrollHeight);
    const have = S.st.country.techs; let out = '';
    for (const [k, t] of Object.entries(R.TECH_TREE)) for (const q of t.req) {
      const a = $('#tc-' + q), b = $('#tc-' + k); if (!a || !b) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top, x2 = rb.left - box.left, y2 = rb.top + rb.height / 2 - box.top, mx = (x1 + x2) / 2;
      out += `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" class="${have.includes(q) ? 'on' : ''}"/>`;
    }
    svg.innerHTML = out;
  }
  window.addEventListener('resize', () => S.view === 'tech' && drawTreeLines());

  // ================= 역할 안내 (퀘스트) =================
  // 각 역할마다 3단계. 끝나면 「완료! 이제 같은 방법으로 나라를 발전시켜요」
  function questSteps(role) {
    const st = S.st, co = st.country, tut = st.targets.find(t => t.tutorial && t.mine) || {};
    const tutTaken = tut.owner === co.id;
    const imps = S.mv.tiles.filter(t => t[3] === co.id && t[4]).map(t => t[4]);
    const cap = st.cities.find(c => c.kind === 'capital') || { buildings: [] };
    const army = st.units.filter(u => u.kind !== 'worker' && u.kind !== 'scout');
    const scout = st.units.find(u => u.kind === 'scout');
    const coreTechs = R.TYPES[co.type].techs;
    return {
      '국가 대표': [
        { t: '「우리 나라」 탭에서 나라 이름을 지어요', done: co.name !== R.TYPES[co.type].name, hl: '[data-v=nation]' },
        { t: '국기(가로 3 : 세로 2)를 그려서 올려요', done: !!co.flag_url, hl: '[data-v=nation]' },
        { t: '모둠원이 할 일을 마치면 위쪽 「턴 끝내기」를 눌러요', done: st.game.turn >= 2 || co.ready, hl: '#btn-ready' }],
      '총사령관': [
        { t: '「병력 고르기」나 지도에서 우리 창병을 눌러 골라요', done: S.picked || tutTaken || st.game.turn >= 2, hl: '#btn-army' },
        { t: '「' + (tut.name || '첫 도시국가') + '」 바로 옆 노란 칸으로 움직여요 (투석기는 2칸 밖에서도 쏴요)', done: tutTaken || army.some(u => tut.tile != null && HexMap.hexDist(u.tile, tut.tile) <= ((R.UNITS[u.kind] || {}).range || 1)), hl: '#btn-army' },
        { t: '붉게 빛나는 도시국가를 눌러 공격! 여러 병력으로 한 턴에 몰아쳐요', done: tutTaken, hl: '#btn-army' }],
      '수석 건축가': [
        { t: '「수도 열기」를 눌러 도시 창을 열어요', done: S.opened || cap.buildings.length > 0, hl: '#btn-capital' },
        { t: '「도시 시장」을 지어 코인 수입을 늘려요', done: st.cities.some(c => c.buildings.includes('market')), hl: '#btn-capital' },
        { t: '「병영」을 지어 병력을 훈련할 수 있게 해요', done: st.cities.some(c => c.buildings.includes('barracks')), hl: '#btn-capital' }],
      '대지 개척자': [
        { t: '수도 옆 우리 땅(색칠된 칸) 중 평원을 눌러 「농장」을 지어요', done: imps.includes('farm'), hl: null },
        { t: '숲에 「벌목장」이나 자원 칸에 「광산·농원」을 지어요', done: imps.some(k => k !== 'farm'), hl: null },
        { t: '수도 창에서 노동자를 한 명 더 고용해요', done: st.units.filter(u => u.kind === 'worker').length >= 2, hl: '#btn-capital' }],
      '별빛 탐험가': [
        { t: '「정찰병 움직이기」로 안개를 걷어요 (바다에선 배로 변신!)', done: !!scout && scout.tile !== capitalTile(), hl: '#btn-scout' },
        { t: '「기술」 탭에서 기술을 하나 연구해요', done: co.techs.some(t => !coreTechs.includes(t)), hl: '[data-v=tech]' },
        { t: '정찰병으로 다른 나라를 한 곳 찾아요', done: co.discovered.length > 0 || st.game.diplomacy_open, hl: '#btn-scout' }]
    }[role] || [];
  }
  function renderQuest() {
    const box = $('#quest'); if (!box || !S.st) return;
    box.innerHTML = '';
    $$('.pulse').forEach(e => e.classList.remove('pulse'));
    if (S.obs && !S.ctl) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const roles = S.ctl ? R.ROLES : myRoles();
    if (!roles.length) { box.append(h('div', { class: 'q-head' }, '임무'), h('div', { class: 'q-step now' }, '「우리 나라」 탭에서 내 역할을 골라요')); pulse('[data-v=nation]'); return; }
    if (S.st.game.turn < 1) { box.append(h('div', { class: 'q-head' }, '임무'), h('div', { class: 'q-step now' }, '선생님이 「나라 키우기」를 시작하면 임무가 열려요.')); return; }
    if (S.qMin) { box.append(h('button', { class: 'q-head q-open', onclick: () => { S.qMin = false; renderQuest(); } }, '임무 펼치기 ▾')); return; }
    box.append(h('div', { class: 'q-head' }, '임무', h('button', { class: 'q-x', onclick: () => { S.qMin = true; renderQuest(); } }, '접기')));
    let first = true;
    for (const r of roles) {
      const steps = questSteps(r), n = steps.findIndex(x => !x.done);
      const sec = h('div', { class: 'q-role' }, h('div', { class: 'q-rname' }, h('img', { src: roleImg(r), alt: '' }), r, h('span', {}, (n < 0 ? 3 : n) + '/3')));
      if (n < 0) { sec.append(h('div', { class: 'q-step done' }, '완료! 이제 같은 방법으로 나라를 발전시켜요.')); doneOnce(r); }
      else {
        steps.forEach((x, i) => { if (i <= n) sec.append(h('div', { class: 'q-step ' + (x.done ? 'done' : 'now') }, (x.done ? '✓ ' : '▶ ') + x.t)); });
        if (first && steps[n].hl) pulse(steps[n].hl);
        first = false;
      }
      box.append(sec);
    }
  }
  function pulse(sel) { const e = $(sel); if (e) e.classList.add('pulse'); }
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  function doneOnce(r) {
    const k = 'quest-done-' + (S.st.me.id || 't') + '-' + r;
    if (S.obs || LS.get(k)) return; LS.set(k, '1');
    modal(h('div', { class: 'center' }, h('img', { src: roleImg(r), class: 'role-pop' }), h('h2', {}, r + ' 임무 완료!'), h('p', {}, '잘했어요! 이제 같은 방법으로 나라를 발전시켜 주세요.'), h('p', { class: 'muted' }, R.ROLE_INFO[r].now)));
  }
  // 역할을 새로 맡으면 안내 팝업
  function roleIntro(r) {
    const steps = questSteps(r);
    modal(h('div', { class: 'center' }, h('img', { src: roleImg(r), class: 'role-pop' }), h('h2', {}, '「' + r + '」 임무를 맡았어요!'),
      h('p', {}, R.ROLE_INFO[r].now), h('div', { class: 'q-intro' }, steps.map((x, i) => h('div', {}, (i + 1) + '. ' + x.t))),
      h('p', { class: 'muted' }, '지도 왼쪽 위 「임무」 상자가 다음 할 일을 알려 줘요. 반짝이는 버튼을 눌러 보세요!'),
      h('button', { class: 'primary big', onclick: () => { document.querySelector('.modal-back').remove(); go('map'); } }, '지도로 가서 시작!')));
  }

  // ================= 외교 =================
  function diploView(page) {
    const st = S.st, g = st.game;
    if (!g.diplomacy_open) page.append(h('div', { class: 'hint' }, '정찰병으로 다른 나라 국경을 찾아보세요. 한 나라가 다섯 나라를 모두 발견하면 세계 외교의 시대가 열려요. (지금 ' + st.country.discovered.length + ' / 5)'));
    page.append(h('div', { class: 'diplo-grid' }, st.countries.map(c => {
      const me = c.id === st.country.id;
      return h('div', { class: 'panel nation-card' + (c.known ? '' : ' unknown'), style: { '--gc': typeColor(c.type) } },
        h('div', { class: 'nc-flag' }, c.known && c.flag_url ? h('img', { src: c.flag_url }) : h('div', { class: 'nc-noflag' }, c.known ? c.name.slice(0, 1) : '?')),
        h('div', { class: 'nc-name' }, c.known ? c.name : '아직 모르는 나라', me ? h('small', {}, ' (우리)') : null),
        c.known ? h('div', { class: 'muted' }, c.type_name) : null,
        c.known ? h('div', { class: 'nc-desc' }, R.TYPES[c.type].desc) : h('div', { class: 'nc-desc muted' }, '정찰병으로 찾아보세요.'),
        c.known && c.happy != null ? h('div', {}, '행복도 ' + c.happy) : null,
        c.title ? h('span', { class: 'chip lead' }, c.title) : null);
    })));
  }

  // ================= 무역 =================
  function tradeView(page) {
    const st = S.st, g = st.game, me = st.country.id;
    if (!g.market_open) { page.append(h('div', { class: 'panel center' }, h('h3', {}, '세계 시장이 아직 열리지 않았어요'), h('p', {}, '선생님이 세계 시장을 열면 다른 나라와 물건을 사고팔 수 있어요.'))); return; }
    const known = st.countries.filter(c => c.id !== me && c.known);
    const items = ['coin', ...Object.keys(R.ITEMS)];
    const to = h('select', { id: 'o-to' }, known.map(c => h('option', { value: c.id }, c.name)));
    const giveI = h('select', { id: 'o-gi' }, items.filter(k => k === 'coin' || (st.inventory[k] || 0) > 0).map(k => h('option', { value: k }, itemName(k) + ' (있음 ' + (k === 'coin' ? st.country.coin : st.inventory[k]) + ')')));
    const giveQ = h('input', { type: 'number', id: 'o-gq', min: 1, value: 1, style: { width: '80px' } });
    const getI = h('select', { id: 'o-ti' }, items.map(k => h('option', { value: k }, itemName(k))));
    const getQ = h('input', { type: 'number', id: 'o-tq', min: 1, value: 1, style: { width: '80px' } });
    const help = h('div', { class: 'muted fair' });
    const updHelp = () => {
      const gi = giveI.value, ti = getI.value, gq = +giveQ.value || 0, tq = +getQ.value || 0;
      let msg = '';
      if (gi !== 'coin' && ti === 'coin') msg = itemName(gi) + ' 기준가 ' + R.ITEMS[gi].ref + '코인 → ' + gq + '개는 최대 ' + R.ITEMS[gi].ref * R.FAIR_CAP * gq + '코인';
      if (gi === 'coin' && ti !== 'coin') msg = itemName(ti) + ' 기준가 ' + R.ITEMS[ti].ref + '코인 → ' + tq + '개는 최대 ' + R.ITEMS[ti].ref * R.FAIR_CAP * tq + '코인';
      help.textContent = g.fair_cap ? (msg ? '지구 서버 공정 거래 규칙: ' + msg : '물건끼리 바꾸기도 할 수 있어요.') : '공정 거래 규칙이 없어졌어요.';
      if (g.tariff > 0) help.textContent += ' · 지금은 수입품에 관세 ' + Math.round(g.tariff * 100) + '%가 붙어요(물가가 올라 행복도가 내려가요).';
    };
    // 같은 것끼리 바꾸지 않도록: 코인을 주면 물건을, 물건을 주면 코인을 기본으로
    const fixPair = () => { if (giveI.value === getI.value) getI.value = giveI.value === 'coin' ? 'food' : 'coin'; };
    getI.value = giveI.value === 'coin' ? 'food' : 'coin';
    giveI.addEventListener('input', fixPair);
    [giveI, getI, giveQ, getQ].forEach(e => e.addEventListener('input', updHelp)); updHelp();
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '거래 제안하기', h('small', {}, '상대 나라 무역 대표가 수락하면 바로 바뀌어요. 제안은 턴이 끝나면 사라져요.')),
      known.length ? h('div', { class: 'offer-form' },
        h('label', {}, '어느 나라와', to),
        h('label', {}, '우리가 주는 것', giveI, giveQ),
        h('label', {}, '우리가 받는 것', getI, getQ),
        h('button', { class: 'primary', onclick: () => act('offer_create', [+to.value, giveI.value, +giveQ.value, getI.value, +getQ.value], () => toast('거래를 제안했어요.')) }, '제안 보내기')) : h('p', {}, '아직 아는 나라가 없어요.'),
      help));
    const name = id => id ? (st.countries.find(c => c.id === id) || {}).name : '중립 상인';
    const inc = st.offers.filter(o => o.to_c === me && o.status === 'pending');
    const out = st.offers.filter(o => o.from_c === me);
    page.append(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '받은 제안', h('small', {}, inc.length + '건')),
        inc.length ? inc.map(o => h('div', { class: 'offer' }, h('b', {}, name(o.from_c)), ' 이(가) ',
          h('span', { class: 'give' }, itemName(o.give_item) + ' ' + o.give_qty), ' 을(를) 주고 ',
          h('span', { class: 'get' }, itemName(o.get_item) + ' ' + o.get_qty), ' 을(를) 원해요',
          h('div', { class: 'row' }, h('button', { class: 'primary small', onclick: () => act('offer_respond', [o.id, true], r => toast('거래 성사!' + (r.tariff ? ' (관세 ' + r.tariff + ')' : ''))) }, '수락'),
            h('button', { class: 'small', onclick: () => act('offer_respond', [o.id, false]) }, '거절')))) : h('p', { class: 'muted' }, '받은 제안이 없어요.')),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '보낸 제안'),
        out.length ? out.slice(0, 10).map(o => h('div', { class: 'offer' }, h('b', {}, name(o.to_c)), '에게 ', itemName(o.give_item) + ' ' + o.give_qty + ' ↔ ' + itemName(o.get_item) + ' ' + o.get_qty,
          h('span', { class: 'chip st-' + o.status }, { pending: '기다리는 중', accepted: '성사', declined: '거절됨', cancelled: '취소', expired: '시간 끝' }[o.status]),
          o.status === 'pending' ? h('button', { class: 'small', onclick: () => act('offer_cancel', [o.id]) }, '취소') : null)) : h('p', { class: 'muted' }, '보낸 제안이 없어요.'))));
    const ex = st.trades.filter(t => t.from_c === me), im = st.trades.filter(t => t.to_c === me);
    const row = (t, other) => h('tr', {}, h('td', {}, '턴 ' + t.turn), h('td', {}, name(other)), h('td', {}, h('img', { src: itemImg(t.item), class: 'mini' }), itemName(t.item) + ' ' + t.qty + '개'),
      h('td', {}, t.price ? '1개 ' + t.price + '코인' : '물물교환'), h('td', {}, t.tariff ? '관세 ' + t.tariff : ''));
    page.append(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '수출', h('small', {}, '우리 나라가 다른 나라에 판 것')),
        ex.length ? h('table', { class: 'tbl' }, ex.map(t => row(t, t.to_c))) : h('p', { class: 'muted' }, '아직 없어요.')),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '수입', h('small', {}, '다른 나라에서 사 온 것')),
        im.length ? h('table', { class: 'tbl' }, im.map(t => row(t, t.from_c))) : h('p', { class: 'muted' }, '아직 없어요.'))));
  }

  // ================= 소식 =================
  function newsView(page) {
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '소식'),
      S.st.notices.length ? S.st.notices.map(n => h('div', { class: 'news ' + n.kind }, h('small', { class: 'muted' }, new Date(n.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })), n.message))
        : h('p', { class: 'muted' }, '아직 소식이 없어요.')));
  }

  // ================= 조약 회의 (17차시) =================
  function treatyView(page) {
    const st = S.st, tr = st.treaty || {}, lead = st.me.is_leader;
    const FOCUS = { A: '거래 조건과 가격 정보를 공개하기', B: '관세 같은 거래 조건을 갑자기 바꾸지 않고 미리 알리기', C: '꼭 필요한 원료 공급에 문제가 생기면 미리 알리고 협의하기',
      D: '문제가 생기면 무역 대표가 먼저 협상하기', E: '특정 나라에 일방적으로 불리하지 않은 공정한 규칙 만들기', F: '갈등을 함께 살펴보고 중재할 회의 만들기' };
    const focus = h('select', { id: 't-focus', disabled: !lead }, Object.entries(FOCUS).map(([k, v]) => h('option', { value: k, selected: tr.focus === k }, k + '. ' + v)));
    const p1 = h('input', { type: 'text', id: 't-p1', value: tr.problem || '', placeholder: '석유 수출이 갑자기 멈춰서 연료를 살 수 없었습니다.', disabled: !lead });
    const p2 = h('input', { type: 'text', id: 't-p2', value: tr.promise || '', placeholder: '앞으로 우리는 ___ 하겠습니다.', disabled: !lead });
    const p3 = h('input', { type: 'text', id: 't-p3', value: tr.reason || '', placeholder: '그래야 ___ 할 수 있기 때문입니다.', disabled: !lead });
    page.append(h('div', { class: 'panel treaty' }, h('div', { class: 'panel-title' }, '우리 나라의 조약 한 조항', h('small', {}, '모둠이 함께 정하고 국가 대표가 등록해요')),
      h('label', {}, '탐구 초점', focus),
      h('label', {}, '1. 우리 나라가 겪은 문제', p1), h('label', {}, '2. 우리 나라의 약속', p2), h('label', {}, '3. 까닭', p3),
      lead ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => act('treaty_submit', [focus.value, p1.value, p2.value, p3.value], () => toast('조약을 등록했어요.')) }, '조약 등록'),
        h('button', { class: 'gold', onclick: () => act('treaty_agree', [], () => toast('공동 약속에 동의했어요.')) }, '공동 약속 동의')) : null));
    const mine = h('input', { type: 'text', id: 'refl', placeholder: '국가 간에 ___ 해야 합니다. 왜냐하면 ___ 때문입니다.' });
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '나의 한 문장'),
      h('div', { class: 'row' }, mine, h('button', { class: 'primary', onclick: () => act('reflection_submit', [mine.value], () => toast('저장했어요.')) }, '저장'))));
  }

  start();
})();
