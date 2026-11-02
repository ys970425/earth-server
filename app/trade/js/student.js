// 학생 화면: 입장 → 지도·도시·우리 나라·외교·무역·소식
(function () {
  const R = window.RULES;
  const { rpc, ensureSession, subscribe, uploadImage, PHASES } = window.API;
  const { $, $$, h, toast, modal, fmt, debounce, typeColor, itemName, itemImg, costText, happyWord } = window.UI;
  const root = document.getElementById('app');
  const S = { me: null, st: null, mv: null, view: 'map', sel: null, mode: null, scout: null, busy: false, offset: 0, cityTab: 'build' };
  const MIL = Object.keys(R.UNITS);
  let map = null;

  // 효과음 (브라우저에서 바로 만든 짧은 소리). 위쪽 「소리」 버튼으로 끄고 켜요
  const Sound = (() => {
    let ac = null, on = true;
    try { on = localStorage.getItem('trade-sound') !== 'off'; } catch (e) { }
    const tone = (f, t0, dur, type, vol, f2) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(f, ac.currentTime + t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, ac.currentTime + t0 + dur);
      g.gain.setValueAtTime(vol || 0.08, ac.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t0 + dur);
      o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + dur + 0.02);
    };
    const noise = (t0, dur, vol) => {
      const b = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ac.createBufferSource(), g = ac.createGain(); g.gain.value = vol || 0.15; src.buffer = b; src.connect(g); g.connect(ac.destination); src.start(ac.currentTime + t0);
    };
    return {
      get on() { return on; },
      toggle() { on = !on; try { localStorage.setItem('trade-sound', on ? 'on' : 'off'); } catch (e) { } return on; },
      play(k) {
        if (!on) return;
        try {
          ac = ac || new (window.AudioContext || window.webkitAudioContext)();
          if (k === 'move') { tone(520, 0, 0.06, 'square', 0.04); tone(660, 0.06, 0.06, 'square', 0.04); }
          else if (k === 'hit') { noise(0, 0.25, 0.18); tone(160, 0, 0.25, 'sawtooth', 0.06, 60); }
          else if (k === 'win') { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.18, 'square', 0.06)); }
          else if (k === 'turn') { tone(784, 0, 0.15, 'triangle', 0.08); tone(1046, 0.15, 0.25, 'triangle', 0.08); }
          else if (k === 'click') tone(880, 0, 0.04, 'square', 0.03);
        } catch (e) { }
      }
    };
  })();

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
    root.appendChild(h('div', { class: 'entry wide' }, h('div', { class: 'title' }, '지구 서버'), h('div', { class: 'title-sub' }, h('span', {}, '문명의 시대')), h('div', { class: 'credit' }, '제작 · 조영산'), ...kids));
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
    entryShell(orn(c.name), h('p', { class: 'sub' }, '빈 자리를 눌러 내 닉네임을 정하고 들어가요. (실제 이름은 쓰지 않아요)'),
      h('div', { class: 'roster' }, list.map(s => h('button', { class: s.taken ? '' : 'nick-slot', disabled: s.taken, onclick: () => nickModal(s) },
        s.taken ? s.nick : s.nick ? s.nick : '닉네임을 설정해주세요', s.taken ? h('small', {}, '들어와 있어요') : s.nick ? h('small', {}, '다시 들어가기') : null))),
      h('button', { class: 'ghost', onclick: pickCountry }, '← 나라 다시 고르기'));
  }
  function nickModal(s) {
    const inp = h('input', { type: 'text', maxlength: 8, value: s.nick || '', placeholder: '2~8글자', class: 'nick-in' });
    const m = modal(h('div', { class: 'center' }, h('h2', {}, '닉네임 정하기'), h('p', { class: 'muted' }, '게임에서 친구들에게 보일 이름이에요. 실제 이름 대신 멋진 닉네임으로!'),
      inp, h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } },
        h('button', { class: 'primary big', onclick: () => { if (inp.value.trim().length < 2) return toast('2글자 이상으로 지어요.', 'error'); m.close(); join(s, inp.value.trim()); } }, '확인'))));
    setTimeout(() => inp.focus(), 50);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') m.box.querySelector('button.primary').click(); });
  }
  async function join(s, nick) {
    try {
      const r = await rpc('join_student', s.id, nick);
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
      const prevPhase = S.st && S.st.game.phase, prevTurn = S.st && S.st.game.turn, prev = S.st && S.st.game.turn === st.game.turn ? { happy: S.st.country.happy, detail: S.st.country.happy_detail || [] } : null;
      S.st = st; S.mv = mv;
      if (prevTurn !== undefined && st.game.turn > prevTurn) Sound.play('turn');
      if (prev && prevTurn === st.game.turn && st.country.happy > prev.happy && !S.obs) cheer(prev, st.country);
      if (st.game.market_open && !S.obs) missionCheck();
      if (!S.obs) grantCheck(!prevTurn && prevTurn !== 0);
      if (prevPhase !== undefined && prevPhase !== st.game.phase && !S.obs) phaseShow(st.game.phase);
      if (st.now) S.offset = new Date(st.now).getTime() - Date.now();
      if (first || !$('.topbar')) shell(); else { renderTop(); renderNav(); }
      updateMap();
      if (S.view !== 'map' || first || prevPhase !== st.game.phase) renderPage(); else renderSide();
      councilOnce();
    } catch (e) {
      if (e.code === 'NOT_JOINED') { S.me = null; pickCountry(); return; }
      console.warn(e);
    }
  }
  // 턴이 시작될 때마다: 대표와 장관들이 이번 턴 계획을 상의 (한 턴에 한 번)
  function councilOnce(force) {
    const st = S.st, g = st.game; if (g.phase < 1 || g.turn < 1 || (S.obs && !S.ctl)) return;
    const k = 'council-' + (st.me.id || 't') + '-' + g.turn;
    if (!force) try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (e) { return; }
    const row = (r, what) => h('div', { class: 'cc-row' + (myRoles().includes(r) || st.me.is_leader ? ' mine' : '') }, h('img', { src: roleImg(r), alt: '' }), h('b', {}, r), h('span', {}, what));
    modal(h('div', { class: 'council' }, h('h2', {}, '턴 ' + g.turn + ' 시작! 국무 회의'),
      h('p', {}, '국가 대표와 장관들은 이번 턴에 국고 ', h('b', {}, fmt(st.country.coin) + '코인'), '을 어디에 쓸지 먼저 상의해요.'),
      row('과학기술부 장관', '어떤 기술을 연구할까? 정찰병은 어디로?'),
      row('국방부 장관', '병력을 몇 부대 훈련할까? 어느 도시국가를 칠까?'),
      row('국토부 장관', '어느 땅을 개발할까? 노동자를 더 고용할까?'),
      row('기획부 장관', '어느 도시에 무엇을 지을까?'),
      row('국가 대표', '정리해서 결정하고, 다 하면 「턴 끝내기」'),
      st.country.short && st.country.short.length ? h('div', { class: 'warn-box' }, '지난 턴 부족: ' + st.country.short.join(', ')) : null,
      h('button', { class: 'primary big', onclick: () => document.querySelector('.modal-back') && document.querySelector('.modal-back').remove() }, '회의 끝! 시작')));
  }
  window.__council = () => councilOnce(true);
  window.__refresh = () => refresh(false);
  function noticeToast(n) {
    if (n.kind === 'alert' && /불행해져서/.test(n.message)) { modal(h('div', { class: 'center' }, h('h2', { class: 'bad' }, '나라가 불행해요!'), h('p', {}, n.message), luxAdvice())); return; }
    const kind = ['crisis', 'alert', 'unrest', 'revolt', 'short'].includes(n.kind) ? 'alert' : '';
    if (n.kind === 'turn' || (n.kind === 'grant' && n.data) || (n.kind === 'crisis' && n.data)) return;   // 지원·위기는 큰 창으로
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
      h('span', { class: 'stat happy ' + happyClass(co.happy), tabindex: 0, onclick: () => happyModal() }, h('span', { class: 'ico face' }), '행복도', h('b', {}, (co.happy > 0 ? '+' : '') + co.happy), h('small', {}, happyWord(co.happy)),
        h('div', { class: 'happy-tip' }, happyList(co))),
      S.obs ? obsChip() : h('span', { class: 'me-chip' }, S.st.me.name, myRoles().length ? myRoles().map(r => h('span', { class: 'lead' + (r === R.ROLES[0] ? '' : ' role') }, r)) : h('span', { class: 'lead role nohold', onclick: () => go('nation') }, '역할 고르기 →')),
      readyBtn(),
      h('button', { class: 'small ghost snd', title: '효과음 켜기/끄기', onclick: e => { const on = Sound.toggle(); e.target.textContent = on ? '소리 켬' : '소리 끔'; } }, Sound.on ? '소리 켬' : '소리 끔'),
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
  const canRole = r => S.ctl || (!S.obs && (S.st.me.is_leader || myRoles().includes(r)));
  const roleWhy = r => canRole(r) ? '' : (S.obs ? '관전 중' : '「' + r + '」이(가) 하는 일');
  const off = r => canRole(r) ? '' : ' role-off';   // 내 역할이 아닌 칸은 짙은 회색
  const ROLE_IMG = { leader: 'img/city/capital_peninsula.png', spear: 'img/unit/spear.png', market: 'img/bld/market.png', worker: 'img/unit/worker.png', scout: 'img/unit/scout.png' };
  const roleImg = r => { const k = (R.ROLE_INFO[r] || {}).icon; return k === 'leader' ? 'img/city/' + (R.CITY_ART[S.st ? S.st.country.type : 'K'] || 'capital_peninsula') + '.png' : ROLE_IMG[k]; };
  function stat(kind, label, val, item) {
    const ico = kind === 'coin' ? h('span', { class: 'ico coin' }, 'C') : h('img', { class: 'ico img', src: itemImg(item), alt: '' });
    return h('span', { class: 'stat' }, ico, label, h('b', {}, val));
  }
  // 행복도 계산 내역 (서버가 매 턴 계산한 그대로)
  function happyList(co) {
    const d = (co.happy_detail || []).filter(x => x.v !== 0);
    return h('div', { class: 'hl' }, h('b', {}, '행복도는 왜 ' + co.happy + '일까?'),
      d.length ? d.map(x => h('div', { class: 'hl-row ' + (x.v > 0 ? 'plus' : 'minus') }, h('span', {}, x.k), h('i', {}, (x.v > 0 ? '+' : '') + x.v), h('small', {}, x.tip)))
        : h('small', {}, '턴이 끝나면 계산돼요.'),
      h('div', { class: 'hl-sum' }, '합계 ', h('b', {}, (co.happy > 0 ? '+' : '') + co.happy), ' → ', happyWord(co.happy)),
      h('small', { class: 'hl-rule' }, '30 이상 황금기(수입 +25%) · 0 아래 불만(병사 공격력 -30%) · -20 아래 불안(도시 생산 멈춤)'));
  }
  function happyModal() {
    const co = S.st.country;
    modal(h('div', {}, h('h2', {}, '우리 나라 행복도'), happyList(co), luxAdvice()));
  }
  const happyClass = v => v >= 30 ? 'golden' : v >= 0 ? 'ok' : v >= -20 ? 'bad1' : 'bad2';
  function tickClock() {
    const el = $('#clock'); if (!el || !S.st) return;
    const g = S.st.game, end = g.timer_end || g.turn_end;
    if (!end) { el.textContent = PHASES[g.phase].name; return; }
    const left = Math.round((new Date(end).getTime() - (Date.now() + S.offset)) / 1000);
    el.textContent = (g.timer_end && g.timer_label ? g.timer_label + ' ' : PHASES[g.phase].name + ' · ') + (left <= 0 ? '곧 다음 턴!' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
  }
  function renderNav() {
    const g = S.st.game;
    const tabs = [['map', '지도'], ['nation', '우리 나라'], ['tech', '기술'], ['diplo', '외교'], ['mission', '무역 미션'], ['trade', '무역'], ['news', '소식']];
    if (g.phase >= 10) tabs.splice(1, 0, ['meeting', '세계 무역 회의']);
    const nav = $('#nav'); nav.innerHTML = '';
    nav.append(...[...tabs.map(([k, label]) => h('button', { class: S.view === k ? 'on' : '', 'data-v': k, onclick: () => go(k) }, h('span', { class: 'dot' }), label,
      k === 'trade' && pendingIn() ? h('span', { class: 'badge' }, pendingIn()) : null,
      k === 'mission' && S.st.game.market_open && missionNow() ? h('span', { class: 'badge gold' }, '!') : null,
      k === 'diplo' && g.diplomacy_open ? null : null)),
      S.st.game.test_mode && (!S.obs || S.ctl) ? h('button', { class: 'small danger test-btn', title: '테스트용: 모든 나라가 연구·개발을 끝낸 상태로', onclick: testEndgame }, '최종 성장 모드 (테스트)') : null,
      h('span', { class: 'credit-nav' }, '제작 · 조영산'),
      S.obs ? h('a', { href: 'admin.html', class: 'leave' }, h('button', { class: 'ghost small' }, '관제실로')) : h('button', { class: 'ghost small leave', onclick: leave }, '나가기')].filter(Boolean));
  }
  async function testEndgame() {
    if (!confirm('[테스트] 모든 나라가 기술을 다 연구하고, 가장 강한 도시국가 하나만 남기고 모두 차지하고, 땅·건물·공장을 모두 지은 상태가 돼요. 세계 시장도 열려요. 되돌릴 수 없어요(관제실 초기화로만). 할까요?')) return;
    try { const r = await rpc('test_endgame'); toast('최종 성장 모드! 도시국가 ' + r.captured + '곳을 차지했어요. 이제 무역해 보세요.'); Sound.play('win'); await refresh(true); }
    catch (e) { toast(e.message, 'error'); }
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
    if (S.view === 'mission') return missionView(page);
    if (S.view === 'diplo') return diploView(page);
    if (S.view === 'trade') return tradeView(page);
    if (S.view === 'news') return newsView(page);
    if (S.view === 'meeting') return meetingView(page);
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
    map = HexMap.create(canvas, { onTile, onHover: hoverTile }); window.__map = map;
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
    const again = S.sel === id;
    S.sel = id; map.select(id); map.setHint([]); map.setPath([]);
    // 우리 병력이 있는 칸: 처음 누르면 병력, 한 번 더 누르면 칸(타일). 병력을 움직일 역할이 아니면 바로 칸
    const us = myUnitsOn(id).filter(u => u.kind !== 'worker' && canRole(unitRole(u)));
    if (us.length && !again && !myCity(id)) { pickUnit(us.find(u => !unitDone(u)) || us[0]); return; }
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
    const scouts = st.units.filter(u => u.kind === 'scout'), scout = scouts.find(u => u.moves > 0) || scouts[0];
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
      scouts.length ? todo('정찰', `정찰병 ${scouts.length}명 · 움직일 수 있는 ${scouts.filter(u => u.moves > 0).length}명`, '정찰병을 여러 방향으로 보내 다른 나라를 빨리 찾아요. 바다에선 배로 바뀌어요.') : null));
    side.append(h('div', { class: 'row' },
      scout ? h('button', { id: 'btn-scout', class: 'sky' + off('과학기술부 장관'), disabled: !scout.moves || g.turn < 1 || !canRole('과학기술부 장관'), title: roleWhy('과학기술부 장관'), onclick: () => pickUnit(scout) }, '정찰병 움직이기') : null,
      army.length ? h('button', { id: 'btn-army', class: 'danger' + off('국방부 장관'), disabled: g.turn < 1, onclick: () => pickUnit(army.find(u => !unitDone(u)) || army[0]) }, '병력 고르기') : null,
      h('button', { id: 'btn-capital', onclick: () => { const t = capitalTile(); S.sel = t; S.opened = true; map.select(t); map.centerOn(t); renderSide(); renderQuest(); } }, '수도 열기')));
    if (st.country.short && st.country.short.length) side.append(h('div', { class: 'warn-box' }, '부족해요: ' + st.country.short.join(', ')));
    if (st.country.crisis) side.append(h('div', { class: 'warn-box' }, '성장의 한계: 시민들이 사치품 2종류·강철·연료를 원해요. 무역으로 구해요!'));
    if (canRole('국방부 장관') && g.turn >= 1) side.append(armyList(null));
    if (canRole('과학기술부 장관') && g.turn >= 1) side.append(armyList(null, true));
  }
  const TODO_ROLE = { '노동자': '국토부 장관', '도시': '기획부 장관', '병력': '국방부 장관', '확장': '국방부 장관', '정찰': '과학기술부 장관' };
  const todo = (k, a, b) => h('div', { class: 'todo-item' + (TODO_ROLE[k] && myRoles().includes(TODO_ROLE[k]) ? ' mine' : '') }, h('b', {}, k),
    h('div', {}, h('div', {}, a, ' ', TODO_ROLE[k] ? h('span', { class: 'role-tag' }, TODO_ROLE[k]) : null), h('small', { class: 'muted' }, b)));

  function tileWindow(side, t, city) {
    const st = S.st, mine = t.owner === st.country.id;
    const ownerName = t.owner ? (st.countries.find(c => c.id === t.owner) || {}).name : null;
    side.append(sideHead(R.TERRAIN[t.terrain] + (t.res ? ' · ' + itemName(t.res) : ''), mine ? '우리 나라 땅' : ownerName ? ownerName + '의 땅 (국경 안은 볼 수 없어요)' : '주인 없는 땅', back));
    if (city && !mine) side.append(h('p', {}, city.kind === 'capital' ? (ownerName || '') + '의 수도예요.' : city.name + (city.country ? '' : ' (다른 나라 쪽 도시국가)')));
    if (t.res) side.append(h('div', { class: 'res-line' }, h('img', { src: itemImg(t.res) }), itemName(t.res), mine ? '' : ' — 우리 땅이 되어야 개발할 수 있어요.'));
    if (!mine) return;
    const resImp = t.res && Object.values(R.IMPROVE).some(v => v.res && v.res.includes(t.res));
    if (t.imp) {
      side.append(h('div', { class: 'done-box' }, R.IMPROVE[t.imp].name + ' 완성! 매 턴 ' + yieldText(t)));
      // 자원 칸에 다른 시설을 지었으면 해체할 수 있어요
      if (resImp && !R.IMPROVE[t.imp].res) {
        const ready = st.units.some(u => u.kind === 'worker' && !u.acted);
        const why = roleWhy('국토부 장관') || (!ready ? '일할 노동자가 없어요' : short(R.DEMOLISH_COST));
        side.append(h('div', { class: 'warn-box' }, '이 칸에는 「' + itemName(t.res) + '」이(가) 있는데 ' + R.IMPROVE[t.imp].name + '을(를) 지었어요. 해체하고 자원 시설을 지으면 ' + itemName(t.res) + '을(를) 얻어요!'));
        side.append(h('button', { class: 'danger' + off('국토부 장관'), disabled: !!why || S.busy, title: why, onclick: () => act('worker_demolish', [t.id], () => map.floatText(t.id, '해체!')) }, R.IMPROVE[t.imp].name + ' 해체하기 (' + costText(R.DEMOLISH_COST) + ', 노동자 1명)'));
        if (why) side.append(h('small', { class: 'bad' }, why));
      }
      return;
    }
    const opts = Object.entries(R.IMPROVE).filter(([k, v]) => v.res ? (t.res && v.res.includes(t.res)) : v.on.includes(t.terrain) && !(resImp || (v.noRes && t.res)));
    if (!canRole('국토부 장관')) side.append(h('div', { class: 'role-note' }, '땅 개발은 「국토부 장관」의 일이에요.'));
    const here = myUnitsOn(t.id).filter(u => u.kind !== 'worker');
    if (here.length) side.append(h('div', { class: 'row' }, h('small', { class: 'muted' }, '이 칸 병력:'), here.map(u => h('button', { class: 'small' + off(u.kind === 'scout' ? '과학기술부 장관' : '국방부 장관'), onclick: () => pickUnit(u) }, unitName(u.kind)))));
    if (!opts.length) { side.append(h('p', { class: 'muted' }, '이 칸에는 지을 수 있는 시설이 없어요.')); return; }
    const ready = st.units.some(u => u.kind === 'worker' && !u.acted);
    side.append(h('div', { class: 'card-list' }, opts.map(([k, v]) => {
      const mult = t.terrain === 'jungle' && !st.country.techs.includes('jungle') ? R.JUNGLE_MULT : 1;
      const cost = Object.fromEntries(Object.entries(v.cost).map(([a, b]) => [a, b * mult]));
      const why = roleWhy('국토부 장관') || (!ready ? '일할 노동자가 없어요' : v.tech && !st.country.techs.includes(v.tech) ? '「' + R.TECHS[v.tech] + '」 기술 필요' : short(cost));
      return h('div', { class: 'bcard' + off('국토부 장관') }, h('div', { class: 'bcard-img' }, impImg(k, t)),
        h('div', { class: 'bcard-body' }, h('b', {}, v.name), h('small', {}, '비용: ' + costText(cost) + (mult > 1 ? ' (정글이라 2배)' : '')),
          h('small', {}, '매 턴 ' + (v.coin ? '코인 +' + v.coin : v.item ? itemName(v.item) + ' +' + (t.terrain === 'tundra' && k === 'farm' ? R.TUNDRA_FOOD : v.yield) : itemName(t.res) + ' +' + v.yield)),
          why ? h('small', { class: 'bad' }, why) : null),
        h('button', { class: 'primary small', disabled: !!why || S.busy, onclick: () => act('worker_build', [t.id, k], r => { map.moveUnit(r.unit, [r.to]); map.floatText(t.id, v.name + ' 완성!'); }) }, '짓기'));
    })));
    if (!ready) side.append(h('button', { class: 'small', onclick: () => { const c = S.st.cities.find(x => x.kind === 'capital'); S.sel = c.tile; renderSide(); } }, '수도에서 노동자 고용하기 →'));
  }
  const yieldText = t => t.imp === 'farm' ? '식량 +' + (t.terrain === 'tundra' ? 1 : 2) : t.imp === 'lumber' ? '목재 +2' : t.imp === 'quarry' ? '코인 +' + R.QUARRY_COIN : itemName(t.res) + ' +' + (R.IMPROVE[t.imp] || {}).yield;
  function impImg(k, t) {
    const src = { farm: 'img/bld/farm.png', lumber: 'img/bld/lumber.png', mine: 'img/bld/mine.png', quarry: 'img/bld/mine.png' }[k] || (t && t.res ? itemImg(t.res) : '');
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
      side.append(h('div', { class: 'hint' }, c.built ? '이 도시는 이번 턴에 건물을 ' + R.BUILD_PER_TURN + '개 지었어요. 다음 턴에 또 지어요.' : '이번 턴 건설 ' + (c.built_n || 0) + ' / ' + R.BUILD_PER_TURN + '개'));
      side.append(h('div', { class: 'card-list' }, Object.entries(R.BUILDINGS).map(([k, b]) => {
        const has = c.buildings.includes(k);
        const why = has ? '' : roleWhy('기획부 장관') ? roleWhy('기획부 장관') : c.built ? '이번 턴 건설 끝' : b.tech && !st.country.techs.includes(b.tech) ? '「' + R.TECHS[b.tech] + '」 기술 필요'
          : b.coastal && !c.coastal ? '바닷가 도시만' : short(b.cost);
        const eff = k === 'market' && R.PRODUCTIVITY[st.country.type] ? '매 턴 코인 +' + R.PRODUCTIVITY[st.country.type].market + ' (우리 도시 안의 시장)' : b.effect;
        return h('div', { class: 'bcard' + (has ? ' have' : '') + (!has && b.coastal && !c.coastal ? ' locked' : '') + (has ? '' : off('기획부 장관')) }, h('div', { class: 'bcard-img' }, bldImg(k)),
          h('div', { class: 'bcard-body' }, h('b', {}, b.name), h('small', {}, eff), has ? h('small', { class: 'good' }, '지었어요') : h('small', {}, '비용: ' + costText(b.cost)),
            !has && why ? h('small', { class: 'bad' }, why) : null),
          has ? null : h('button', { class: 'primary small', disabled: !!why || S.busy, onclick: () => act('city_build', [c.id, k], () => map.floatText(c.tile, b.name + '!')) }, '짓기'));
      })));
      side.append(h('div', { class: 'bcard' + off('국토부 장관') }, h('div', { class: 'bcard-img' }, h('img', { src: 'img/unit/worker.png' })),
        h('div', { class: 'bcard-body' }, h('b', {}, '노동자 고용'), h('small', {}, '비용: ' + costText(R.HIRE_WORKER)), h('small', {}, '땅을 개발할 일꾼이 늘어나요. 매 턴 식량 1을 먹어요.'),
          (roleWhy('국토부 장관') || short(R.HIRE_WORKER)) ? h('small', { class: 'bad' }, roleWhy('국토부 장관') || short(R.HIRE_WORKER)) : null),
        h('button', { class: 'primary small', disabled: !!(roleWhy('국토부 장관') || short(R.HIRE_WORKER)) || S.busy, onclick: () => act('hire_worker', [c.id], () => map.floatText(c.tile, '노동자 +1')) }, '고용')));
    } else if (S.cityTab === 'train') {
      if (!c.buildings.includes('barracks') && !c.buildings.includes('harbor')) side.append(h('div', { class: 'hint' }, '병영(육군)이나 항구(배)가 있어야 훈련할 수 있어요. 「건설」에서 지어요.'));
      else if (c.trained) side.append(h('div', { class: 'hint' }, '이 도시는 이번 턴에 ' + R.TRAIN_PER_TURN + '부대를 다 훈련했어요.'));
      else side.append(h('small', { class: 'muted' }, '한 도시에서 한 턴에 ' + R.TRAIN_PER_TURN + '부대까지 (이번 턴 ' + (c.trained_n || 0) + '부대)'));
      const techs = st.country.techs;
      side.append(h('div', { class: 'card-list' }, Object.entries(R.UNITS).filter(([, u]) => (u.boss ? u.boss === st.country.type : (!u.tech || techs.includes(u.tech) || R.TECH_TREE[u.tech].era <= 2))).map(([k, u]) => {
        const need = u.sea ? 'harbor' : 'barracks';
        const why = roleWhy('국방부 장관') || (u.tech && !techs.includes(u.tech) ? '「' + R.TECHS[u.tech] + '」 기술 필요' : !c.buildings.includes(need) ? (u.sea ? '항구 필요' : '병영 필요') : c.trained ? '이번 턴 훈련 끝' : short(u.cost));
        return h('div', { class: 'bcard' + (why && why.includes('기술') ? ' locked' : '') + (u.boss ? ' special' : '') + off('국방부 장관') }, h('div', { class: 'bcard-img' }, h('img', { src: unitImg(k) })),
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
    commtower: 'commtower', broadcast: 'broadcast', nuclearplant: 'nuclearplant', aircraft: 'aircraft' };
  function bldImg(k, alt) {
    return BLD_ART[k] ? h('img', { src: 'img/bld/' + BLD_ART[k] + '.png', alt: alt || '' }) : null;
  }
  const count = arr => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});

  // ---------- 병력·정찰병: 고르기 → 노란 칸 이동 → 붉은 도시국가 공격 ----------
  const unitImg = k => 'img/unit/' + ((R.UNITS[k] || {}).img || k) + '.png';
  const unitName = k => k === 'scout' ? '정찰병' : k === 'worker' ? '노동자' : (R.UNITS[k] || { name: k }).name;
  const unitRole = u => u.kind === 'scout' ? '과학기술부 장관' : '국방부 장관';
  const isSea = k => !!(R.UNITS[k] || {}).sea;
  const armyOf = () => S.st.units.filter(u => u.kind !== 'worker' && u.kind !== 'scout');
  // 이번 턴에 더 할 일이 없는 병력 (이동도 공격도 못 함)
  const unitDone = u => u.moves === 0 && (u.kind === 'scout' || u.attacked || !attackable(u).length);
  function passFor(u) {
    const sea = isSea(u.kind), scout = u.kind === 'scout', fly = !!(R.UNITS[u.kind] || {}).fly;
    const cityTiles = new Set(S.mv.cities.filter(c => c.country !== S.st.country.id).map(c => c.tile));
    const blocked = new Set(S.mv.blocked || []);   // 안 보이는 다른 나라 국경 칸
    return id => {
      if (blocked.has(id)) return false;
      const t = map.st.tiles.get(id);
      if (!t) return scout || fly;   // 안 본 칸은 정찰병만 (서버가 다시 검사)
      const water = t.terrain === 'ocean' || t.terrain === 'coast';
      if (cityTiles.has(id)) return false;
      if (!scout && !fly && sea !== water) return false;
      return water || !t.owner || t.owner === S.st.country.id;
    };
  }
  function attackable(u) {
    if (u.kind === 'scout' || u.kind === 'worker' || u.attacked) return [];
    const rng = (R.UNITS[u.kind] || {}).range || 1;
    return S.mv.cities.filter(c => c.kind === 'cs' && !c.country && !(c.tutorial && !mineCs(c)) && canHit(u, c) && HexMap.hexDist(u.tile, c.tile) <= rng);
  }
  // 최종 도시국가는 그 나라 특수 부대만, 잊힌 제국은 어느 나라든 특수 부대만
  const canHit = (u, c) => { const ud = R.UNITS[u.kind] || {}; return c.final ? !!(ud.boss && c.mine) : c.boss ? !!ud.boss : true; };
  const mineCs = c => (S.st.targets.find(t => t.id === c.id) || {}).mine;
  function showUnitHints(u) {
    const canAct = canRole(unitRole(u));
    map.selectUnit(u.id); map.select(u.tile);
    map.setHint(canAct && u.moves > 0 ? [...HexMap.reachable(u.tile, passFor(u), u.moves).keys()] : []);
    map.setAtk(canAct ? attackable(u).map(c => c.tile) : []);
  }
  // 노란 칸 위에 마우스를 올리면 가는 길을 점선으로 미리 보여 줘요
  function hoverTile(id) {
    if (!S.unit || S.busy || !map) return;
    const u = S.st.units.find(x => x.id === S.unit);
    if (!u || !map.st.hint.has(id)) { if (map.st.pathPrev.length) map.setPath([]); return; }
    const p = HexMap.path(u.tile, id, passFor(u), u.moves);
    map.setPath(p ? [u.tile, ...p] : []);
  }
  function pickUnit(u) {
    if (!u) return;
    S.unit = u.id; S.sel = u.tile; S.picked = true;
    map.centerOn(u.tile); showUnitHints(u); renderSide(); renderQuest();
  }
  function unpick() { S.unit = null; if (map) { map.selectUnit(null); map.setHint([]); map.setAtk([]); map.setPath([]); } }
  // 다음으로 움직일 병력 (문명처럼 자동으로)
  function pickNext(after) {
    const role = after ? unitRole(after) : '국방부 장관';
    const list = (role === '과학기술부 장관' ? S.st.units.filter(u => u.kind === 'scout') : armyOf()).filter(u => !unitDone(u));
    if (list.length) { pickUnit(list.find(u => !after || u.id !== after.id) || list[0]); return true; }
    unpick(); S.sel = null; renderSide();
    if (after && role === '국방부 장관') toast('모든 병력이 이번 턴 행동을 마쳤어요.');
    return false;
  }
  // 병력 목록: 할 수 있는 병력은 밝게, 끝난 병력은 어둡게
  function armyList(cur, scouts) {
    const army = scouts ? S.st.units.filter(u => u.kind === 'scout') : armyOf(); if (!army.length) return null;
    return h('div', { class: 'army-list' }, h('div', { class: 'al-head' }, scouts ? '우리 정찰병 ' : '우리 병력 ', h('small', {}, army.filter(u => !unitDone(u)).length + ' / ' + army.length + (scouts ? '명' : '부대') + ' 움직일 수 있어요')),
      army.map(u => {
        const done = unitDone(u), info = R.UNITS[u.kind] || {};
        return h('button', { class: 'al-row' + (done ? ' done' : '') + (cur && cur.id === u.id ? ' cur' : ''), disabled: done, onclick: () => pickUnit(u) },
          h('img', { src: unitImg(u.kind), alt: '' }),
          h('span', { class: 'al-name' }, info.name || unitName(u.kind), h('small', {}, done ? '이번 턴 끝' : (u.moves ? '이동 ' + u.moves + '칸' : '') + (attackable(u).length ? ' · 공격 가능' : ''))),
          h('i', { class: 'al-hp' }, h('b', { style: { width: u.hp + '%', background: u.hp > 60 ? '#4FD06A' : u.hp > 30 ? '#F2B530' : '#E8443C' } })));
      }));
  }
  function unitWindow(side, u) {
    const st = S.st, info = R.UNITS[u.kind] || {}, role = unitRole(u), can = canRole(role);
    side.append(sideHead(unitName(u.kind), u.kind === 'scout' ? '안개를 걷고 다른 나라를 찾아요 · 바다에선 배로 바뀌어요' : '고른 병력이 금색으로 빛나요', () => { unpick(); S.sel = null; renderSide(); }));
    side.append(h('div', { class: 'unit-card' + (can ? '' : ' role-off') }, h('img', { src: unitImg(u.kind) }),
      h('div', { class: 'col', style: { gap: '4px', flex: 1 } },
        u.kind !== 'scout' ? h('div', {}, '힘 ', h('b', {}, info.str), info.range ? ' · 사거리 ' + info.range + '칸' : '', info.sea ? ' · 배' : '') : null,
        h('div', { class: 'meter' }, h('i', { style: { width: u.hp + '%', background: u.hp > 60 ? '#4FD06A' : u.hp > 30 ? '#F2B530' : '#E8443C' } })),
        h('small', {}, '체력 ' + u.hp + ' / 100 · 남은 이동 ' + u.moves + ' / ' + u.max_moves + '칸' + (u.attacked ? ' · 공격 끝' : '')))));
    if (S.st.country.happy < R.HAPPY.unhappy && u.kind !== 'scout') side.append(h('div', { class: 'warn-box' }, '나라가 불행해서 병사들의 공격력이 30% 약해졌어요. 사치품으로 행복도를 0 위로!'));
    if (!can) side.append(h('div', { class: 'role-note' }, '병력은 「' + role + '」이(가) 움직여요. 이 칸을 한 번 더 누르면 땅(타일) 창이 열려요.'));
    else side.append(h('ol', { class: 'how' },
      h('li', { class: u.moves ? 'now' : 'done' }, '노란 칸을 눌러 이동해요 (마우스를 올리면 길이 점선으로 보여요)'),
      u.kind !== 'scout' ? h('li', { class: attackable(u).length && !u.attacked ? 'now' : '' }, '붉게 깜빡이는 도시국가를 눌러 공격! ' + (info.range ? '이 병력은 ' + info.range + '칸 밖에서도 쏴요' : '바로 옆 칸에서만 공격해요')) : null,
      h('li', {}, '같은 칸을 한 번 더 누르면 땅(타일) 창이 열려요')));
    const targets = attackable(u);
    if (targets.length) side.append(h('div', { class: 'card-list' }, targets.map(c => {
      const pv = preview(u, c);
      return h('div', { class: 'bcard atk' + off(role) }, h('div', { class: 'bcard-img' }, h('img', { src: cityArt(c, 'capital') })),
        h('div', { class: 'bcard-body' }, h('b', {}, c.name + (c.boss ? ' (최종 보스)' : '')), h('small', {}, '방어 ' + c.def + ' · 체력 ' + c.hp + '/' + c.max_hp),
          h('small', { class: pv.dies ? 'bad' : '' }, '예상: 도시 -' + pv.dc + ' · 우리 -' + pv.du + (pv.dies ? ' (쓰러질 수 있어요!)' : pv.capture ? ' → 점령!' : ''))),
        h('button', { class: 'danger small', disabled: !can || S.busy, onclick: () => attack(u, c) }, '공격'));
    })));
    side.append(armyList(u, u.kind === 'scout'));
  }
  // 전투 미리보기 (서버와 같은 식)
  function preview(u, c) {
    const C = R.COMBAT, str = ((R.UNITS[u.kind] || {}).str || 1) * (S.st.country.happy < R.HAPPY.unhappy ? C.unhappyMult : 1), ranged = !!(R.UNITS[u.kind] || {}).range && HexMap.hexDist(u.tile, c.tile) > 1;
    const ratio = str * (0.5 + 0.5 * u.hp / 100) / Math.max(1, c.def);
    const dc = Math.max(C.min, Math.min(C.max, Math.round(C.base * ratio)));
    let du = Math.max(1, Math.min(150, Math.round(C.base * (C.counter || 1) / ratio))); if (ranged) du = Math.round(du * C.rangedCounter);
    return { dc, du, dies: du >= u.hp, capture: dc >= c.hp };
  }
  async function unitTap(id) {
    const u = S.st.units.find(x => x.id === S.unit); if (!u) { unpick(); return; }
    // 고른 병력이 있는 칸을 한 번 더 누르면 땅(타일) 창
    if (id === u.tile) { unpick(); S.sel = id; map.select(id); renderSide(); return; }
    const city = S.mv.cities.find(c => c.tile === id && c.kind === 'cs' && !c.country);
    if (city && canRole(unitRole(u)) && attackable(u).some(c => c.id === city.id)) return attack(u, city);
    if (map.st.hint.has(id)) return moveTo(u, id);
    // 다른 우리 병력을 누르면 그 병력으로
    const us = myUnitsOn(id).filter(x => x.kind !== 'worker' && canRole(unitRole(x)));
    if (us.length) return pickUnit(us.find(x => !unitDone(x)) || us[0]);
    unpick(); S.sel = id; map.select(id); renderSide();
  }
  async function moveTo(u, id) {
    if (viewOnly() || S.busy) return;
    const p = HexMap.path(u.tile, id, passFor(u), u.moves);
    if (!p || !p.length) { toast('그곳은 이번 턴에 갈 수 없어요.', 'error'); return; }
    S.busy = true; map.setHint([]); map.setAtk([]); map.setPath([u.tile, ...p]);
    try {
      const r = await rpc('unit_move', u.id, p);
      Sound.play('move');
      map.moveUnit(u.id, p, async () => {
        map.setPath([]); S.busy = false;
        await refresh(false);
        if (r.new_tiles) map.floatText(id, '새로 본 칸 ' + r.new_tiles);
        const nu = S.st.units.find(x => x.id === u.id);
        if (nu && unitDone(nu)) pickNext(nu);   // 더 할 일이 없으면 다음 병력
        if (r.discovered && r.discovered.length) {
          const names = r.discovered.map(c => (S.st.countries.find(x => x.id === c) || {}).name).join(', ');
          Sound.play('win');
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
      Sound.play('hit');
      map.floatText(city.tile, '-' + res.city_dmg, '#FFB13D');
      setTimeout(() => map.floatText(u.tile, res.died ? '쓰러짐' : '-' + res.unit_dmg, '#FF6A6A'), 250);
      if (res.died) toast(unitName(u.kind) + '이(가) 반격에 쓰러졌어요. 쓰던 물자는 창고로 돌아왔어요.', 'alert');
      if (res.captured) {
        Sound.play('win');
        unpick();
        const kids = [h('img', { src: cityArt(city, 'capital'), class: 'capture-pic' }), h('h2', {}, res.name + ' 점령!'), h('p', { class: 'big-joy' }, '시민들이 환호해요! 행복도 +' + (city.final ? R.FINAL_CS.glory : R.HAPPY.glory)), h('small', { class: 'muted' }, '환호는 매 턴 ' + R.HAPPY.gloryDecay + '씩 줄어요. 도시가 늘면 관리할 일도 늘어요(도시마다 행복도 ' + R.HAPPY.perCity + ').')];
        if (res.coin) kids.push(h('p', {}, '보물 창고에서 코인 +' + res.coin));
        if (res.res && res.res.length) kids.push(h('p', {}, '새 자원: ', res.res.map(r => h('span', { class: 'res-chip' }, h('img', { src: itemImg(r) }), itemName(r)))));
        if (res.techs && res.techs.length) kids.push(h('p', {}, '기술자들이 합류했어요: ', res.techs.map(t => h('span', { class: 'chip tech' }, t))));
        setTimeout(() => modal(h('div', { class: 'center capture' }, ...kids)), 500);
      } else if (!res.died) map.floatText(city.tile, '성벽 ' + res.city_hp + '/' + res.max_hp, '#FFE9C2');
      await refresh(false);
      if (!res.captured) { const nu = S.st.units.find(x => x.id === u.id); if (!nu || unitDone(nu)) pickNext(nu || u); }
    };
    map.centerOn(city.tile);
    if (ranged) map.siege(u.tile, city.tile, 1, after); else map.strike(u.tile, city.tile, after);
  }
  // 도시국가 정보 창 (병력을 안 고르고 눌렀을 때)
  function csWindow(side, city) {
    const st = S.st, tg = st.targets.find(t => t.id === city.id) || city;
    const tier = R.CS_TIERS[city.tier || 0];
    side.append(sideHead(city.name, city.rebel ? '잊힌 제국의 반란 도시' + (tg.mine ? ' · 우리 나라의 첫 도시' : '') : (city.boss ? '최종 보스 · ' : '') + tier.name + (tg.mine ? ' · 우리 나라 쪽' : ' · 누구나 차지할 수 있어요'), back));
    side.append(h('div', { class: 'city-pic' }, h('img', { src: cityArt(city, 'capital'), class: 'neutral' })));
    side.append(h('div', { class: 'vs' }, h('div', {}, h('small', {}, '방어력'), h('b', {}, city.def)), h('span', {}, '성벽'), h('div', {}, h('small', {}, '체력'), h('b', {}, city.hp + '/' + city.max_hp))));
    const gain = [];
    if (tg.res && tg.res.length) gain.push(h('div', { class: 'res-line' }, '주변 자원: ', tg.res.map(r => h('span', { class: 'res-chip' }, h('img', { src: itemImg(r) }), itemName(r)))));
    if (city.rebel) gain.length = 0, gain.push(h('div', {}, '잊힌 제국의 테러가 사라져요'), h('div', {}, '격퇴 환호: 행복도 +' + R.REBEL.glory));
    else if (tg.tech) gain.push(h('div', {}, '기술자 합류: ', tg.tech.split(',').map(t => h('span', { class: 'chip tech' }, R.TECHS[t]))));
    if (tg.bonus) gain.push(h('div', {}, '보물 창고 코인 +' + tg.bonus));
    gain.push(h('div', {}, '매 턴 코인 +' + R.INCOME.city + ', 주변 땅이 우리 영토로'));
    side.append(h('div', { class: 'gain' }, h('b', {}, '차지하면'), ...gain));
    if (city.tutorial && !tg.mine) side.append(h('div', { class: 'warn-box' }, '각 나라의 첫 도시국가는 그 나라만 차지할 수 있어요.'));
    if (city.final) side.append(h('div', { class: 'warn-box final' }, tg.mine ? '최종 도전! 평범한 병력으로는 꿈쩍도 안 해요. 「' + R.UNITS[R.BOSS_UNIT[S.st.country.type].unit].name + '」을(를) 만들어야 해요. 재료는 「우리 나라」 탭의 무역 안내를 봐요.' : '다른 나라의 최종 도전이에요. 그 나라의 특수 부대만 무너뜨릴 수 있어요.'));
    if (city.boss) side.append(h('div', { class: 'warn-box final' }, '잊힌 제국! 여러 나라의 특수 부대가 힘을 합쳐야 무너뜨릴 수 있어요.'));
    if (city.rebel) side.append(h('div', { class: 'warn-box final' }, !tg.mine ? '다른 나라의 반란 도시예요. 그 나라가 되찾도록 응원해요!'
      : S.st.alliance ? '무역 동맹 덕분에 잊힌 제국이 약해졌어요! 이제 회복도 못 해요. 특수 부대로 공격해 되찾아요.'
      : '잊힌 제국이 우리 첫 도시를 빼앗았어요. 지금은 너무 강해서(매 턴 체력을 모두 회복) 이길 수 없어요. 여섯 나라가 「무역 동맹」을 맺으면 크게 약해져요!'));
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
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '행복도 ' + (co.happy > 0 ? '+' : '') + co.happy, h('small', {}, happyWord(co.happy))),
        h('div', { class: 'hmeter' }, h('i', { class: 'zero' }), h('b', { style: { left: (50 + Math.max(-50, Math.min(50, co.happy)) ) + '%' } })),
        happyList(co), luxAdvice())));
    page.append(tradeGuidePanel());
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '기술', h('small', {}, '도시국가를 차지하면 기술자가 합류하기도 해요')),
      h('div', { class: 'row' }, co.techs.map(t => h('span', { class: 'chip tech' }, R.TECHS[t])), h('button', { class: 'small gold', onclick: () => go('tech') }, '기술 계통도 보기 →'))));
    if (g.turn >= 1) page.append(industryPanel());
    if (rolesFirst) page.append(setupPanel()); else page.append(membersPanel(), setupPanel());
  }
  function industryPanel() {
    const st = S.st, tp = st.country.type;
    const facts = Object.entries(R.FACTORIES).filter(([, f]) => st.country.techs.includes(f.tech) && R.PROC_COST[tp][f.output] !== undefined);
    const bcost = k => ((R.FACTORY_BUILD[k] || {})[tp]) || R.FACTORIES[k].build;
    const free = k => !!(R.FACTORY_FREE[tp] || {})[k];
    return h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '공장과 발전 건물', h('small', {}, '원료 1개 + 가공비 → 제품 1개 (매 턴 2개까지) · 특산 공장은 원료 없이')),
      h('div', { class: 'card-list wide' },
        facts.length ? facts.map(([k, f]) => {
          const has = st.factories.includes(k);
          const noIn = has && !free(k) && !(st.inventory[f.input] > 0);
          return h('div', { class: 'bcard' + (has ? ' have' : off('기획부 장관')) + (free(k) ? ' special' : '') }, h('div', { class: 'bcard-img' }, bldImg(k, f.name)),
            h('div', { class: 'bcard-body' }, h('b', {}, f.name, free(k) ? h('span', { class: 'chip lead' }, '우리 특산') : null), free(k) || R.SPECIALTY[tp].factory === k ? h('small', { class: 'good' }, R.SPECIALTY[tp].why + (free(k) ? ' (기본 원료는 나라 안에서 구한다고 생각해요)' : '')) : null,
              h('small', {}, (free(k) ? '원료 없이 매 턴 ' + itemName(f.output) + ' ' + f.perTurn + '개' : itemName(f.input) + ' → ' + itemName(f.output)) + ' · 가공비 ' + R.PROC_COST[tp][f.output] + '코인/개'),
              has ? h('small', { class: noIn ? 'bad' : 'good' }, noIn ? '원료(' + itemName(f.input) + ')가 없어 쉬는 중 — 무역으로 구해요' : '가동 중') : h('small', {}, '짓는 비용: ' + costText(bcost(k))),
              !has && short(bcost(k)) ? h('small', { class: 'bad' }, short(bcost(k))) : null),
            has ? null : h('button', { class: 'primary small', disabled: !!short(bcost(k)) || !canRole('기획부 장관') || S.busy, title: roleWhy('기획부 장관'), onclick: () => act('factory_build', [k]) }, '짓기'));
        }) : h('p', { class: 'muted' }, '우리 나라 기술로 지을 수 있는 공장이 없어요. 제품은 다른 나라에서 사 와야 해요.'),
        Object.entries(R.ADVANCED).filter(([, a]) => !a.tech || st.country.techs.includes(a.tech)).map(([k, a]) => {
          const has = st.advanced.includes(k);
          return h('div', { class: 'bcard' + (has ? ' have' : off('기획부 장관')) }, h('div', { class: 'bcard-img' }, bldImg(k, a.name)),
            h('div', { class: 'bcard-body' }, h('b', {}, a.name), h('small', {}, (a.econ ? '경제력 +' + a.econ : '') + (a.culture ? '문화력 +' + a.culture : '') + (a.coinPerTurn ? ', 매 턴 코인 +' + a.coinPerTurn : '') + (a.happy ? ', 행복도 +' + a.happy : '') + (a.unlock ? '대포 훈련 가능' : '')),
              has ? h('small', { class: 'good' }, '지었어요') : h('small', {}, '비용: ' + costText(a.cost)), !has && short(a.cost) ? h('small', { class: 'bad' }, short(a.cost)) : null),
            has ? null : h('button', { class: 'primary small', disabled: !!short(a.cost) || !canRole('기획부 장관') || S.busy, title: roleWhy('기획부 장관'), onclick: () => act('advanced_build', [k]) }, '짓기'));
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

  // ================= 무역 안내 (사야 할 것 · 팔 것 · 누구에게) =================
  const tname = t => { const c = S.st.countries.find(x => x.type === t); return c ? c.name : R.TYPES[t].name; };
  const whoHas = (it, me) => (R.SOURCES[it] || []).filter(t => t !== me);
  function guide() {
    const st = S.st, me = st.country.type, inv = st.inventory, bu = R.BOSS_UNIT[me], unit = R.UNITS[bu.unit];
    const fin = st.targets.find(t => t.final && t.mine) || {};
    const needs = bu.needs.map(it => ({ it, qty: unit.cost[it], have: inv[it] || 0, from: whoHas(it, me) }));
    // 특산 공장에 원료가 필요한 나라 (섬나라: 고무 → 타이어)
    const sp = R.SPECIALTY[me], spf = R.FACTORIES[sp.factory];
    const spNeed = sp.input && !(R.SOURCES[spf.input] || []).includes(me) ? { it: spf.input, out: spf.output, have: inv[spf.input] || 0, from: whoHas(spf.input, me) } : null;
    const myLux = R.LUX.filter(l => (R.SOURCES[l] || []).includes(me));
    const lux = R.LUX.filter(l => !myLux.includes(l)).map(l => ({ it: l, have: inv[l] || 0, from: whoHas(l, me) }));
    // 우리가 팔 수 있는 것: 우리가 가진 것을 다른 나라가 특수 부대에 쓰거나 사치품으로 원함
    const sell = Object.entries(R.SOURCES).filter(([it, ts]) => ts.includes(me)).map(([it, ts]) => ({
      it, only: ts.length === 1, buyers: [...Object.entries(R.BOSS_UNIT).filter(([t, b]) => t !== me && b.needs.includes(it)).map(([t]) => t),
        ...Object.entries(R.SPECIALTY).filter(([t, x]) => t !== me && x.input && R.FACTORIES[x.factory].input === it).map(([t]) => t + ':원료')],
      luxBuyers: R.LUX.includes(it) ? Object.keys(R.TYPES).filter(t => t !== me && !(R.SOURCES[it] || []).includes(t)) : [] }))
      .filter(x => x.buyers.length || x.luxBuyers.length);
    return { me, bu, unit, fin, needs, lux, sell, spNeed };
  }
  const itemTag = (it, extra) => h('span', { class: 'res-chip' }, h('img', { src: itemImg(it), alt: '' }), itemName(it), extra || '');
  function tradeGuidePanel() {
    const gd = guide(), st = S.st;
    const ready = gd.needs.every(n => n.have >= n.qty);
    return h('div', { class: 'panel guide' }, h('div', { class: 'panel-title' }, '무역 안내', h('small', {}, '모둠 회의 때 이 표를 보고 누구와 무엇을 거래할지 정해요')),
      h('div', { class: 'guide-grid' },
        h('div', { class: 'gcol need' }, h('h4', {}, '① 최종 도전에 꼭 필요한 것'),
          h('p', {}, '「' + (gd.fin.name || '최종 도시국가') + '」은(는) 평범한 병력으로는 꿈쩍도 안 해요. ', h('b', {}, gd.unit.name), '을(를) 만들어야 해요. 그런데 재료가 우리 나라에는 없어요!'),
          gd.needs.map((n, i) => h('div', { class: 'grow-row' + (n.have >= n.qty ? ' ok' : '') }, itemTag(n.it, ' ' + n.qty + '개'),
            h('span', {}, n.have >= n.qty ? '✓ 준비 완료' : (i === 0 ? h('b', { class: 'only' }, '딱 한 나라만 있어요 → ' + n.from.map(tname).join(', ')) : '← ' + n.from.map(tname).join(' 또는 ')), ' (지금 ' + n.have + '개)'))),
          gd.spNeed ? h('div', { class: 'grow-row' + (gd.spNeed.have ? ' ok' : '') }, itemTag(gd.spNeed.it), h('span', {}, h('b', { class: 'only' }, '특산품 ' + itemName(gd.spNeed.out) + '의 원료 → ' + gd.spNeed.from.map(tname).join(', ')), ' (지금 ' + gd.spNeed.have + '개)')) : null,
          h('small', { class: 'muted' }, ready ? '재료가 다 모였어요! 국방부 장관이 병영에서 ' + gd.unit.name + '을(를) 훈련해요.' : '빨간 글씨 나라와는 꼭 거래해야 해요. 국가 대표끼리 만나 이야기해 봐요.')),
        h('div', { class: 'gcol lux' }, h('h4', {}, '② 행복을 위한 사치품'),
          h('p', {}, '사치품은 종류마다 행복도 +' + R.HAPPY.perLuxType + '. 우리 나라에 없는 사치품은 사 와야 해요.'),
          gd.lux.map(l => h('div', { class: 'grow-row' + (l.have > 0 ? ' ok' : '') }, itemTag(l.it), h('span', {}, l.have > 0 ? '✓ ' + l.have + '개 있음' : '← ' + l.from.map(tname).join(', '))))),
        h('div', { class: 'gcol sell' }, h('h4', {}, '③ 우리가 팔 수 있는 것'),
          h('p', {}, '다른 나라가 꼭 필요한 물건이에요. 대신 우리가 필요한 것과 바꿔요!'),
          gd.sell.map(x => h('div', { class: 'grow-row' }, itemTag(x.it, x.only ? ' (우리만!)' : ''),
            h('span', {}, [...x.buyers.map(t => t.endsWith(':원료') ? tname(t.slice(0, 1)) + '(특산품 원료)' : tname(t) + '(특수 부대)'), ...x.luxBuyers.slice(0, 3).map(t => tname(t))].join(', ') + ' 에게'))))),
      h('div', { class: 'guide-tip' }, '거래 예시: "우리 ' + itemName((gd.sell[0] || {}).it || 'food') + ' 2개를 줄 테니, ' + itemName(gd.needs[0].it) + ' 2개를 주세요." → 「무역」 탭에서 제안을 보내요.'));
  }
  function luxAdvice() {
    const gd = guide(), miss = gd.lux.filter(l => !l.have);
    if (!miss.length) return null;
    return h('div', { class: 'lux-adv' }, '행복도를 올리려면: ', miss.slice(0, 4).map(l => h('span', {}, itemName(l.it) + '(' + l.from.map(tname).join('·') + ')')), ' 을(를) 사 와요.');
  }

  // ================= 무역 미션 (순서대로 하나씩) =================
  // 1) 급한 사치품 1개 → 2) 딱 한 나라만 가진 재료 → 3·4) 나머지 재료 → 5) 특수 부대로 최종 도전 → 6) 여유: 사치품 하나 더
  const imported = it => S.st.trades.filter(t => t.to_c === S.st.country.id && t.item === it).reduce((a, t) => a + t.qty, 0);
  const countryOf = t => S.st.countries.find(c => c.type === t);
  // 그 나라가 원하는 우리 물건 (바꿀 거리)
  function wantsFrom(seller) {
    const gd = guide();
    const myBan = (S.st.game.banned || {})[S.st.country.id] || [];   // 우리가 수출을 막은 물건은 빼요
    return gd.sell.filter(x => !myBan.includes(x.it) && (x.buyers.some(b => b.slice(0, 1) === seller) || x.luxBuyers.includes(seller))).map(x => x.it)
      .concat(['coin']).slice(0, 3);
  }
  function missions() {
    const st = S.st, gd = guide(), inv = st.inventory, me = gd.me;
    const luxOrder = gd.lux.slice().sort((a, b) => b.from.length - a.from.length);
    const lux1 = luxOrder[0], lux2 = luxOrder.find(l => l !== lux1 && (lux1 ? l.it !== lux1.it : true));
    const hasBoss = st.units.some(u => u.kind === gd.bu.unit), finDone = gd.fin.owner === st.country.id;
    const L = [];
    if (lux1) L.push({ k: 'lux1', kind: 'lux', it: lux1.it, qty: 2, from: lux1.from, title: '급해요! 사치품 「' + itemName(lux1.it) + '」 2개 사 오기',
      why: '인구가 늘어 행복도가 계속 떨어지고 있어요. 사치품은 종류마다 행복도 +' + R.HAPPY.perLuxType + '! 받는 순간 바로 올라요. (사치품은 한 턴에 1개씩 써요. 2개면 두 턴 동안 행복해요)',
      after: '행복도 +' + R.HAPPY.perLuxType + '! 행복도가 0 위면 병사들도 다시 힘을 내요.', done: (inv[lux1.it] || 0) >= 2 || imported(lux1.it) >= 2 });
    gd.needs.forEach((n, i) => L.push({ k: 'need' + i, kind: 'need', it: n.it, qty: n.qty, from: n.from, only: i === 0,
      title: (i === 0 ? '꼭 필요해요! ' : '특수 부대 재료 ') + '「' + itemName(n.it) + '」 ' + n.qty + '개 사 오기',
      why: i === 0 ? itemName(n.it) + '은(는) 세계에서 ' + n.from.map(tname).join(', ') + '만 가지고 있어요. 이 나라와 꼭 거래해야 ' + gd.unit.name + '을(를) 만들 수 있어요.'
                   : gd.unit.name + '에 ' + itemName(n.it) + ' ' + n.qty + '개가 들어가요. ' + n.from.map(tname).join(' 또는 ') + ' 중 조건이 좋은 나라를 골라요.',
      after: '재료 하나 완성! 다음 재료를 모아요.', done: hasBoss || finDone || (inv[n.it] || 0) >= n.qty }));
    if (false && gd.spNeed) L.splice(1, 0, {   // 섬나라는 고무 4개로 시작 → 필수 미션에서 뺐어요 (17차시 위기에서 다시 등장) k: 'sp', kind: 'need', it: gd.spNeed.it, qty: 2, from: gd.spNeed.from, only: true, title: '특산품 원료 「' + itemName(gd.spNeed.it) + '」 2개 사 오기',
      why: '우리 특산품 ' + itemName(gd.spNeed.out) + '은(는) ' + itemName(gd.spNeed.it) + '을(를) 사 와서 만들어요 (가공 무역). 만든 ' + itemName(gd.spNeed.out) + '은(는) 다른 나라에 비싸게 팔 수 있어요!',
      after: '특산 공장이 돌아가요! 다음 턴부터 ' + itemName(gd.spNeed.out) + '이(가) 생겨요.', done: (inv[gd.spNeed.it] || 0) >= 2 || imported(gd.spNeed.it) >= 2 });
    L.push({ k: 'boss', kind: 'act', title: gd.unit.name + ' 만들고 「' + (gd.fin.name || '최종 도전') + '」 공격!',
      why: '재료가 다 모였어요! 국방부 장관이 병영에서 ' + gd.unit.name + '을(를) 훈련하고, 지도에서 「' + (gd.fin.name || '') + '」 근처로 움직여 공격해요.',
      after: '최종 도전 성공! 행복도 +' + R.FINAL_CS.glory + ', 코인 +' + R.FINAL_CS.coin + '.', done: finDone, go: 'map' });
    if (lux2) L.push({ k: 'lux2', kind: 'lux', it: lux2.it, qty: 2, from: lux2.from, title: '여유가 있으면: 사치품 「' + itemName(lux2.it) + '」도 2개 사 오기',
      why: '사치품 종류가 늘수록 행복도가 더 올라요. 행복도 ' + R.HAPPY.golden + ' 이상이면 황금기(수입 +25%)!', after: '행복도 +' + R.HAPPY.perLuxType + '!', done: (inv[lux2.it] || 0) >= 2 || imported(lux2.it) >= 2 });
    // 17차시: 잊힌 제국이 나타나면 → ① 사치품으로 행복도 지키기 (무역이 막히는 걸 겪어요) → ② 반란 도시 되찾기
    const rep = st.report;
    if (st.game.phase >= 8 && rep) {
      const lx = luxOrder.find(l => (inv[l.it] || 0) < 2) || luxOrder[0], rebel = rep.rebel, ally = st.alliance;
      const C = [];
      if (lx) C.push({ k: 'c_lux', kind: 'lux', it: lx.it, qty: 2, from: lx.from, title: '행복도를 지켜요! 사치품 「' + itemName(lx.it) + '」 2개 사 오기',
        why: '잊힌 제국의 테러와 사치품 싫증으로 행복도가 뚝 떨어졌어요. 행복도가 0 밑이면 병사들이 약해져요.' + (st.game.banned && Object.keys(st.game.banned).length ? ' 그런데… 지금 사치품을 살 수 있을까요? 제안을 보내 봐요.' : ''),
        after: '행복도 +' + R.HAPPY.perLuxType + '!', done: (inv[lx.it] || 0) >= 2 || ally });
      C.push({ k: 'rebel', kind: 'act', go: 'map', title: '잊힌 제국에게 빼앗긴 「' + (rebel ? rebel.name : '첫 도시') + '」 되찾기',
        why: !rebel ? '' : ally ? '무역 동맹 덕분에 잊힌 제국이 약해졌어요 (체력 ' + rebel.hp + '/' + rebel.max_hp + ', 회복 없음). 특수 부대로 공격해요!'
          : '지금은 잊힌 제국이 너무 강해요 (체력 ' + rebel.hp + ', 매 턴 모두 회복). 여섯 나라가 힘을 모아 「무역 동맹」을 맺으면 약해져요!',
        after: '잊힌 제국 격퇴! 테러가 사라지고 행복도 +' + R.REBEL.glory + '!', done: !rebel });
      return C;
    }
    return L;
  }
  const missionNow = () => missions().find(m => !m.done);
  function missionView(page) {
    const st = S.st, g = st.game, L = missions(), cur = L.findIndex(m => !m.done);
    page.append(h('div', { class: 'panel mission-head' }, h('div', { class: 'panel-title' }, '무역 미션', h('small', {}, '위에서부터 하나씩! 지금 할 미션만 열려 있어요')),
      g.market_open ? h('p', {}, '모둠이 함께 미션을 읽고, 국가 대표가 상대 나라 대표를 만나 이야기해요. 정해지면 「제안 쓰기」를 눌러 무역 탭에서 보내요.')
        : h('div', { class: 'hint' }, '아직 세계 시장이 열리지 않았어요. 미리 읽어 보고, 선생님이 시장을 열면 바로 시작해요!')));
    page.append(h('div', { class: 'missions' }, L.map((m, i) => {
      const state = m.done ? 'done' : i === cur ? 'now' : 'lock';
      const card = h('div', { class: 'mcard ' + state + (m.only ? ' only' : '') },
        h('div', { class: 'm-num' }, m.done ? '✓' : i + 1),
        h('div', { class: 'm-body' }, h('b', {}, m.title), state === 'lock' ? h('small', {}, '앞의 미션을 끝내면 열려요') : h('p', {}, m.why)));
      if (state === 'now' && m.it) {
        const sellers = m.from.map(countryOf).filter(Boolean);
        card.querySelector('.m-body').append(
          h('div', { class: 'm-who' }, h('span', {}, '누구에게: '), sellers.map(c => h('span', { class: 'm-c', style: { '--gc': typeColor(c.type) } }, c.name, c.known ? '' : ' (아직 못 만남)'))),
          h('div', { class: 'm-who' }, h('span', {}, '바꿀 거리: '), (sellers[0] ? wantsFrom(sellers[0].type) : ['coin']).map(it => it === 'coin' ? h('span', { class: 'res-chip' }, '코인') : itemTag(it))),
          h('div', { class: 'm-say' }, '이렇게 말해 봐요: "우리 ' + itemName((sellers[0] ? wantsFrom(sellers[0].type) : ['coin'])[0]) + '을(를) 줄 테니, ' + itemName(m.it) + ' ' + m.qty + '개를 주세요!"'),
          h('div', { class: 'row' }, sellers.filter(c => c.known).map(c => h('button', { class: 'primary small', disabled: !g.market_open || g.locked, onclick: () => { S.prefill = { to: c.id, get: m.it, qty: m.qty, give: wantsFrom(c.type)[0], giveQty: m.qty }; go('trade'); } }, c.name + '에게 제안 쓰기'))));
      }
      if (state === 'now' && m.go && !(m.k === 'rebel' && !st.alliance)) card.querySelector('.m-body').append(h('button', { class: 'danger small', onclick: () => go(m.go) }, '지도로 가기'));
      if (state === 'now' && m.k === 'rebel' && !st.alliance) card.querySelector('.m-body').append(h('div', { class: 'hint' }, '선생님 신호에 맞춰 「세계 무역 회의」를 열어요. 6나라가 무역 규칙을 다 올리면 무역 동맹!'));
      if (m.done) card.querySelector('.m-body').append(h('small', { class: 'good' }, m.after));
      return card;
    })));
  }
  // 미션을 끝내면 축하 창 (한 번만)
  function missionCheck() {
    const L = missions(), key = 'mission-' + S.st.country.id + '-';
    for (const m of L) {
      if (!m.done) break;
      let seen = false; try { seen = !!localStorage.getItem(key + m.k); localStorage.setItem(key + m.k, '1'); } catch (e) { seen = true; }
      if (!seen) {
        const next = L.find(x => !x.done);
        Sound.play('win');
        modal(h('div', { class: 'center celebrate' }, h('div', { class: 'burst' }), h('h2', {}, '무역 미션 성공!'), h('p', { class: 'big-joy' }, m.after),
          next ? h('p', {}, '다음 미션: ', h('b', {}, next.title)) : h('p', {}, '모든 미션 완료! 이제 다른 나라를 도와줘도 좋아요.'),
          h('button', { class: 'primary big', onclick: () => { document.querySelector('.modal-back').remove(); go('mission'); } }, '다음 미션 보기')));
        return;
      }
    }
  }
  // 행복도가 오르면 화려하게
  function cheer(prev, co) {
    const d = co.happy - prev.happy;
    const why = (co.happy_detail || []).filter(x => { const p = prev.detail.find(y => y.k.split(' ')[0] === x.k.split(' ')[0]); return x.v > (p ? p.v : 0); }).map(x => x.v <= 0 ? x.k + ' 줄어듦' : x.k);
    Sound.play('win');
    const box = h('div', { class: 'joy-pop' }, h('b', {}, '행복도가 올랐어요! +' + d), h('span', {}, why.join(', ') || ''), h('small', {}, '지금 행복도 ' + co.happy + ' (' + happyWord(co.happy) + ')'));
    document.body.appendChild(box); setTimeout(() => box.classList.add('out'), 2600); setTimeout(() => box.remove(), 3200);
  }

  // 거래가 막혔을 때: 큰 도장
  function blockedPop(r) {
    Sound.play('hit');
    modal(h('div', { class: 'blocked-pop' }, h('div', { class: 'stamp ' + (r.blocked === 'tariff' ? 'tariff' : '') }, r.blocked === 'tariff' ? '관세 폭탄!' : '무역로 공격!'),
      r.item ? h('img', { src: itemImg(r.item), alt: itemName(r.item) }) : null, h('h2', {}, '거래가 이루어지지 않았어요'), h('p', {}, r.message),
      h('div', { class: 'hint' }, '이 일은 기록돼요. 세계 무역 회의에서 「우리 나라가 겪은 일」로 이야기해요.')));
  }
  // 지구 서버 관리자의 지원·긴급 중립 상인·특수 부대 도착: 화려한 창 (한 번만)
  function grantCheck(first) {
    const st = S.st, key = 'grant-seen-' + st.country.id;
    const list = st.notices.filter(n => n.kind === 'grant' && n.data).sort((a, b) => a.id - b.id);
    let seen = 0; try { seen = +localStorage.getItem(key) || 0; } catch (e) { return; }
    const top = list.length ? list[list.length - 1].id : 0;
    if (!seen && first) { try { localStorage.setItem(key, String(top)); } catch (e) { } return; }   // 처음 들어온 기기는 지난 것은 건너뜀
    const fresh = list.filter(n => n.id > seen);
    if (!fresh.length) return;
    try { localStorage.setItem(key, String(top)); } catch (e) { }
    fresh.forEach(grantPop);
  }
  function grantPop(n) {
    const d = n.data || {}, items = Object.entries(d.items || {});
    const merchant = d.mode === 'merchant', boss = d.mode === 'boss';
    Sound.play('win');
    const it = ([k, v]) => h('div', { class: 'grant-it' }, k === 'coin' ? h('span', { class: 'ico coin coin-big' }, 'C') : h('img', { src: itemImg(k), alt: '' }), h('b', {}, itemName(k)), h('span', {}, (k === 'coin' ? '+' : '×') + v));
    modal(h('div', { class: 'grant-pop' + (merchant ? ' merchant' : '') }, h('div', { class: 'burst' + (merchant ? '' : ' blue') }),
      h('span', { class: 'grant-badge' }, merchant ? '긴급 중립 상인' : '지구 서버 관리자'),
      h('h2', {}, boss ? '특수 부대 도착!' : merchant ? '중립 상인이 물건을 팔았어요' : '관리자의 지원이 도착했어요!'),
      boss ? h('div', { class: 'grant-items' }, h('div', { class: 'grant-it' }, h('img', { src: unitImg(d.unit), alt: '' }), h('b', {}, unitName(d.unit)), h('span', {}, d.city + ' 근처'))) : h('div', { class: 'grant-items' }, items.map(it)),
      merchant ? h('p', { class: 'bad' }, '코인 -' + d.coin + ' (기준가의 ' + R.CRISIS.merchantMult + '배)') : null,
      d.reason ? h('p', {}, d.reason) : null,
      h('p', { class: 'muted' }, boss ? '지도에서 특수 부대를 눌러 최종 도시국가를 공격해요!' : merchant ? '나라끼리 거래가 막혔을 때만 오는 비싼 상인이에요.' : '창고에 바로 들어갔어요.'),
      h('button', { class: 'primary big', onclick: () => { const b = $$('.modal-back'); b.length && b[b.length - 1].remove(); if (boss) go('map'); } }, boss ? '지도로 가기' : '좋아요!')));
  }
  // 17차시 단계가 바뀔 때: 긴급속보
  function phaseShow(ph) {
    const st = S.st, rep = st.report || {};
    const close = () => $$('.modal-back').forEach(b => b.remove());
    if (ph === 8) {
      Sound.play('hit');
      modal(h('div', { class: 'blocked-pop news-flash' }, h('div', { class: 'stamp' }, '긴급속보'), h('img', { class: 'flash-img', src: 'img/city/boss.png', alt: '' }),
        h('h2', {}, '잊힌 제국 등장!'),
        h('p', {}, '잊힌 제국이 우리 첫 도시 「' + ((rep.rebel || {}).name || '') + '」을(를) 빼앗아 반란 도시로 만들었어요!'),
        h('div', { class: 'report-grid' },
          h('div', { class: 'rcard ban' }, h('h3', {}, h('span', { class: 'rbadge' }, '-' + R.REBEL.terror), '잊힌 제국의 테러'), h('small', {}, '반란 도시가 남아 있는 동안 시민들이 불안해해요')),
          h('div', { class: 'rcard tariff' }, h('h3', {}, h('span', { class: 'rbadge tariff' }, '-' + R.REBEL.boredom), '사치품에 싫증'), h('small', {}, '인터넷으로 다른 나라 물건을 보게 된 시민들이 더 다양한 사치품을 원해요'))),
        h('div', { class: 'q-box' }, '반란 도시는 너무 강해서 지금은 이길 수 없어요. 행복도를 지키려면 사치품이 필요해요!'),
        h('button', { class: 'primary big', onclick: () => { close(); go('mission'); } }, '무역 미션 보기')));
    } else if (ph === 9) {
      Sound.play('hit');
      const tars = Object.keys(st.game.tariffs || {}).length;
      modal(h('div', { class: 'blocked-pop news-flash' }, h('div', { class: 'stamp' }, '긴급속보'), h('h2', {}, '세계 무역 협정 만료!'),
        h('p', {}, '잊힌 제국이 무역 약속을 깨뜨렸어요. 무역선과 수송기를 공격하고, 관세 폭탄을 퍼부어요!'),
        h('div', { class: 'report-grid' },
          h('div', { class: 'rcard ban' }, h('h3', {}, h('span', { class: 'rbadge' }, '거래 불가'), '사치품'), h('small', {}, R.LUX.map(itemName).join(' · ') + ' — 실어 나를 수 없어요')),
          h('div', { class: 'rcard tariff' }, h('h3', {}, h('span', { class: 'rbadge tariff' }, '관세 폭탄'), '나머지 ' + tars + '가지 물건'), h('small', {}, '사 올 때 기준가만큼 코인을 더 내요 (+100%)'))),
        h('div', { class: 'q-box' }, '무역 약속이 깨지면 어떤 일이 생길까요? 직접 거래해 보며 확인해요!'),
        h('button', { class: 'primary big', onclick: () => { close(); go('trade'); } }, '무역해 보기')));
    } else if (ph === 10) { close(); go('meeting'); }
    else if (ph === 11) {
      Sound.play('win');
      modal(h('div', { class: 'center celebrate' }, h('div', { class: 'burst' }), h('h2', {}, '무역 동맹 체결!'),
        h('p', { class: 'big-joy' }, '무역로가 다시 열리고 관세 폭탄이 사라졌어요.'),
        h('p', {}, '여섯 나라의 약속 앞에 잊힌 제국이 크게 약해졌어요 (체력 ' + R.REBEL.weakHp + ', 회복 없음). 우리 반란 도시를 되찾아요!'),
        h('button', { class: 'danger big', onclick: () => { close(); go('map'); } }, '반란 도시 되찾으러 가기')));
    }
  }
  // ================= 기술 계통도 =================
  function techView(page) {
    const st = S.st, have = st.country.techs, TT = R.TECH_TREE;
    const can = k => TT[k].req.every(q => have.includes(q));
    const lead = roleWhy('과학기술부 장관');
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '기술 계통도', h('small', {}, '왼쪽 기술을 알아야 오른쪽 기술을 연구할 수 있어요 · 한 턴에 하나 · 도시국가를 차지하면 기술자가 합류하기도 해요')),
      st.country.researched ? h('div', { class: 'hint' }, '이번 턴에는 기술을 ' + R.RESEARCH_PER_TURN + '개 연구했어요. 「턴 끝내기」 뒤에 또 연구할 수 있어요.') : lead ? h('div', { class: 'hint' }, lead) : h('div', { class: 'hint' }, '이번 턴 연구 ' + (st.country.research_n || 0) + ' / ' + R.RESEARCH_PER_TURN + '개'),
      h('div', { class: 'tree-wrap' },
        svgEl(),
        h('div', { class: 'tree' },
          R.ERAS.map((e, i) => h('div', { class: 'era-head', style: { gridColumn: i + 1 } }, e)),
          h('div', { class: 'tcard done ancient', style: { gridColumn: 1, gridRow: '2 / span 4' } }, h('b', {}, '고대 기술'), h('small', {}, '모두 익혔어요'),
            R.ANCIENT.map(a => h('span', { class: 'anc' }, a))),
          Object.entries(TT).map(([k, t]) => {
            const done = have.includes(k), ok_ = can(k), why = done ? '' : !ok_ ? '먼저: ' + t.req.filter(q => !have.includes(q)).map(q => TT[q].name).join(', ') : (lead || (st.country.researched ? '이번 턴 연구 끝' : short(t.cost)));
            return h('div', { class: 'tcard ' + (done ? 'done' : ok_ ? 'open' + off('과학기술부 장관') : 'locked'), id: 'tc-' + k, style: { gridColumn: t.era + 1, gridRow: t.row + 2 } },
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
      '국방부 장관': [
        { t: '「병력 고르기」나 지도에서 우리 창병을 눌러 골라요', done: S.picked || tutTaken || st.game.turn >= 2, hl: '#btn-army' },
        { t: '「' + (tut.name || '첫 도시국가') + '」 바로 옆 노란 칸으로 움직여요 (투석기는 2칸 밖에서도 쏴요)', done: tutTaken || army.some(u => tut.tile != null && HexMap.hexDist(u.tile, tut.tile) <= ((R.UNITS[u.kind] || {}).range || 1)), hl: '#btn-army' },
        { t: '붉게 빛나는 도시국가를 눌러 공격! 여러 병력으로 한 턴에 몰아쳐요', done: tutTaken, hl: '#btn-army' }],
      '기획부 장관': [
        { t: '「수도 열기」를 눌러 도시 창을 열어요', done: S.opened || cap.buildings.length > 0, hl: '#btn-capital' },
        { t: '「도시 시장」을 지어 코인 수입을 늘려요', done: st.cities.some(c => c.buildings.includes('market')), hl: '#btn-capital' },
        { t: '「병영」을 지어 병력을 훈련할 수 있게 해요', done: st.cities.some(c => c.buildings.includes('barracks')), hl: '#btn-capital' }],
      '국토부 장관': [
        { t: '수도 옆 우리 땅(색칠된 칸) 중 평원을 눌러 「농장」을 지어요', done: imps.includes('farm'), hl: null },
        { t: '숲에 「벌목장」이나 자원 칸에 「광산·농원」을 지어요', done: imps.some(k => k !== 'farm'), hl: null },
        { t: '수도 창에서 노동자를 한 명 더 고용해요', done: st.units.filter(u => u.kind === 'worker').length >= 2, hl: '#btn-capital' }],
      '과학기술부 장관': [
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
    page.append(tradeGuidePanel());
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
      const tu = it => g.tariffs && g.tariffs[it] ? Math.ceil(R.ITEMS[it].ref * g.tariffs[it]) : 0;
      if (ti !== 'coin' && tu(ti)) help.textContent += ' · 관세 폭탄: ' + itemName(ti) + '을(를) 사 오면 1개마다 ' + tu(ti) + '코인을 더 내요 (' + tq + '개면 ' + tu(ti) * tq + '코인).';
      const bans = [...new Set(Object.values(g.banned || {}).flat())];
      if (bans.length) help.textContent += ' · 잊힌 제국의 무역로 공격으로 거래 불가: ' + bans.map(itemName).join(', ');
    };
    // 같은 것끼리 바꾸지 않도록: 코인을 주면 물건을, 물건을 주면 코인을 기본으로
    const fixPair = () => { if (giveI.value === getI.value) getI.value = giveI.value === 'coin' ? 'food' : 'coin'; };
    getI.value = giveI.value === 'coin' ? 'food' : 'coin';
    if (S.prefill) {   // 무역 미션에서 넘어오면 미리 채워 줘요
      const pf = S.prefill; S.prefill = null;
      if (pf.to && known.some(c => c.id === pf.to)) to.value = pf.to;
      if (pf.get) { getI.value = pf.get; getQ.value = pf.qty || 1; }
      if (pf.give && [...giveI.options].some(o => o.value === pf.give)) { giveI.value = pf.give; giveQ.value = pf.giveQty || 1; }
      setTimeout(() => { const f = $('.offer-form'); if (f) { f.scrollIntoView({ block: 'center' }); f.classList.add('pulse'); } }, 50);
    }
    giveI.addEventListener('input', fixPair);
    [giveI, getI, giveQ, getQ].forEach(e => e.addEventListener('input', updHelp)); updHelp();
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '거래 제안하기', h('small', {}, '상대 나라 무역 대표가 수락하면 바로 바뀌어요. 제안은 턴이 끝나면 사라져요.')),
      known.length ? h('div', { class: 'offer-form' },
        h('label', {}, '어느 나라와', to),
        h('label', {}, '우리가 주는 것', giveI, giveQ),
        h('label', {}, '우리가 받는 것', getI, getQ),
        h('button', { class: 'primary', onclick: () => act('offer_create', [+to.value, giveI.value, +giveQ.value, getI.value, +getQ.value], r => r.blocked ? blockedPop(r) : toast('거래를 제안했어요.' + (r.tariff ? ' 성사되면 관세 ' + r.tariff + '코인을 더 내요.' : ''))) }, '제안 보내기')) : h('p', {}, '아직 아는 나라가 없어요.'),
      help));
    const name = id => id ? (st.countries.find(c => c.id === id) || {}).name : '중립 상인';
    const inc = st.offers.filter(o => o.to_c === me && o.status === 'pending');
    const out = st.offers.filter(o => o.from_c === me);
    page.append(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '받은 제안', h('small', {}, inc.length + '건')),
        inc.length ? inc.map(o => h('div', { class: 'offer' }, h('b', {}, name(o.from_c)), ' 이(가) ',
          h('span', { class: 'give' }, itemName(o.give_item) + ' ' + o.give_qty), ' 을(를) 주고 ',
          h('span', { class: 'get' }, itemName(o.get_item) + ' ' + o.get_qty), ' 을(를) 원해요',
          h('div', { class: 'row' }, h('button', { class: 'primary small', onclick: () => act('offer_respond', [o.id, true], r => r.blocked ? blockedPop(r) : toast('거래 성사!' + (r.tariff_me ? ' (우리가 낸 관세 ' + r.tariff_me + '코인)' : ''))) }, '수락'),
            h('button', { class: 'small', onclick: () => act('offer_respond', [o.id, false]) }, '거절')))) : h('p', { class: 'muted' }, '받은 제안이 없어요.')),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '보낸 제안'),
        out.length ? out.slice(0, 10).map(o => h('div', { class: 'offer' }, h('b', {}, name(o.to_c)), '에게 ', itemName(o.give_item) + ' ' + o.give_qty + ' ↔ ' + itemName(o.get_item) + ' ' + o.get_qty,
          h('span', { class: 'chip st-' + o.status }, { pending: '기다리는 중', accepted: '성사', declined: '거절됨', cancelled: '취소', expired: '시간 끝', blocked: '막힘' }[o.status]),
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
  // ================= 세계 무역 회의 (17차시): ① 역할끼리 → ② 모둠 규칙 1개 → ③ 대표 모여 헌장 =================
  function meetingView(page) {
    const st = S.st, tr = st.treaty || {}, lead = st.me.is_leader || S.ctl, rep = st.report || { fails: [] }, me = st.country.id;
    const roles = (st.me.is_leader ? ['국가 대표'] : []).concat(myRoles().filter(r => r !== '국가 대표'));
    const list = st.treaties || [];
    const cn = id => (st.countries.find(c => c.id === id) || {}).name || '';
    // 우리 나라가 겪은 일 (실제 기록)
    const myF = rep.fails.filter(f => f.buyer === me);
    const told = [rep.rebel ? '잊힌 제국에게 「' + rep.rebel.name + '」을(를) 빼앗겼어요' : null,
      myF.length ? '거래가 ' + myF.length + '번 막혔어요 (' + [...new Set(myF.map(f => itemName(f.item)))].join(', ') + ')' : null,
      rep.tariff_paid ? '관세 폭탄으로 ' + rep.tariff_paid + '코인을 더 냈어요' : null,
      '지금 행복도 ' + st.country.happy + ' (' + happyWord(st.country.happy) + ')'].filter(Boolean);
    page.append(h('div', { class: 'panel meet-head' }, h('div', { class: 'panel-title' }, '세계 무역 회의', h('small', {}, '잊힌 제국을 물리칠 약속을 만들어요')),
      h('div', { class: 'meet-steps' },
        h('div', { class: 'ms' }, h('b', {}, '①'), h('span', {}, '같은 역할끼리 모여 이야기해요')),
        h('div', { class: 'ms' }, h('b', {}, '②'), h('span', {}, '우리 모둠으로 돌아와 무역 규칙 1개 고르기')),
        h('div', { class: 'ms' }, h('b', {}, '③'), h('span', {}, '대표들이 모여 세계 무역 헌장 → 국가 대표가 입력')),
        h('div', { class: 'ms gold' }, h('b', {}, '6/6'), h('span', {}, '여섯 나라가 다 올리면 무역 동맹!'))),
      h('div', { class: 'told' }, h('b', {}, '우리 나라가 겪은 일: '), told.join(' · '))));
    // ① 역할 카드
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '① 같은 역할끼리 모여요', h('small', {}, '다른 모둠의 같은 역할 친구들과 이 질문으로 이야기해요')),
      h('div', { class: 'role-talks' }, (roles.length ? roles : R.ROLES).map(r => { const t = R.ROLE_TALK[r]; if (!t) return null;
        return h('div', { class: 'rtalk' }, h('div', { class: 'rt-head' }, h('img', { src: roleImg(r), alt: '' }), h('b', {}, r + ' 모임')), h('p', { class: 'rt-q' }, t.q),
          h('div', { class: 'rt-hints' }, h('small', {}, '이런 생각도 있어요'), t.hints.map(x => h('span', {}, x)))); }))));
    // ② 모둠 규칙
    let pick = tr.focus || null;
    const sentence = h('input', { type: 'text', id: 't-rule', value: tr.promise || '', placeholder: '위에서 카드를 고르면 채워져요. 우리 말로 고쳐 써도 돼요.', disabled: !lead });
    const why = h('input', { type: 'text', id: 't-why', value: tr.reason || '', placeholder: '왜냐하면 ___ 때문이에요. (우리 나라가 겪은 일을 넣어요)', disabled: !lead });
    const cards = h('div', { class: 'treaty-cards' });
    const draw = () => { cards.innerHTML = ''; cards.append(...R.RULE_CARDS.map(c => h('button', { class: 'tcard' + (pick === c.k ? ' on' : ''), disabled: !lead,
      onclick: () => { pick = c.k; sentence.value = c.text; draw(); } }, h('b', {}, c.name), h('small', {}, c.text))),
      h('button', { class: 'tcard' + (pick === 'X' ? ' on' : ''), disabled: !lead, onclick: () => { pick = 'X'; sentence.value = ''; sentence.focus(); draw(); } }, h('b', {}, '직접 만들기'), h('small', {}, '우리 모둠만의 규칙을 써요'))); };
    draw();
    page.append(h('div', { class: 'panel treaty' }, h('div', { class: 'panel-title' }, '② 우리 모둠의 무역 규칙 1개', h('small', {}, '역할 모임에서 들은 이야기를 나누고 하나를 골라요')),
      cards, h('label', {}, '우리 규칙 (한 문장)', sentence), h('label', {}, '이 규칙이 필요한 까닭', why),
      lead ? h('button', { class: 'primary big', disabled: st.game.phase !== 10 && !tr.promise, onclick: () => {
        if (!sentence.value.trim()) return toast('규칙을 한 문장으로 써 주세요.', 'error');
        act('treaty_submit', [pick || 'X', '', sentence.value, why.value], r => { Sound.play('win'); toast(r.alliance ? '무역 동맹 체결!' : '세계 무역 헌장에 올렸어요! (' + r.count + '/6)'); });
      } }, tr.promise ? '규칙 고쳐 올리기' : '③ 세계 무역 헌장에 올리기') : h('p', { class: 'muted' }, '대표들이 모여 정한 뒤, 국가 대표가 올려요.')));
    // ③ 헌장
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '③ 세계 무역 헌장', h('small', {}, list.length + '/6 나라')),
      h('div', { class: 'ally-bar' }, h('i', { style: { width: (list.length / 6 * 100) + '%' } }), h('span', {}, list.length >= 6 ? '무역 동맹 체결!' : '무역 동맹까지 ' + (6 - list.length) + '나라')),
      list.length ? h('div', { class: 'charter-list' }, list.map(t => { const c = st.countries.find(x => x.id === t.country) || {};
        return h('div', { class: 'charter-it', style: { '--gc': typeColor(c.type) } }, h('b', {}, c.name + ' '), t.promise || '', t.reason ? h('div', { class: 'muted' }, t.reason) : null); }))
        : h('p', { class: 'muted' }, '아직 올린 나라가 없어요.')));
    const mine = h('input', { type: 'text', id: 'refl', placeholder: '나라 사이의 무역에서는 ___해야 합니다. 왜냐하면 ___ 때문입니다.' });
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '정리: 나의 한 문장'),
      h('div', { class: 'row' }, mine, h('button', { class: 'primary', onclick: () => act('reflection_submit', [mine.value], () => toast('저장했어요.')) }, '저장'))));
  }

  start();
})();
