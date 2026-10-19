// 학생 화면
(function () {
  const { rpc, ensureSession, uploadImage, subscribe, PHASES } = window.API;
  const { $, h, toast, modal, envText, envClass, fmt, debounce, groupColor, gaugeColor, matImg } = window.UI;
  const P = window.Pixel;
  const root = document.getElementById('app');

  const S = {
    me: null, st: null, market: null, view: 'lobby', houseId: null,
    slot: 1, editor: null, lockedSlot: null, heartbeat: null,
    lastPhase: null, channel: null, player: null
  };

  // ------------------------------------------------------------------
  // 시작
  // ------------------------------------------------------------------
  function entryShell(...kids) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'entry-bg' }));
    root.appendChild(h('div', { class: 'entry' }, ...kids));
  }

  async function start() {
    entryShell(h('h1', { class: 'title' }, '지구 서버'), h('p', { class: 'title-sub' }, '접속하는 중...'));
    try {
      await ensureSession();
      const me = await rpc('get_me');
      if (me.status === 'joined') return enterGame();
      if (me.status === 'pending') return pendingView();
      entryView();
    } catch (e) {
      entryShell(h('h1', { class: 'title' }, '지구 서버'),
        h('p', { class: 'title-sub' }, e.message), h('div', {}, h('button', { class: 'gold big', onclick: start }, '다시 접속하기')));
    }
  }

  async function entryView() {
    const pub = await rpc('get_public');
    const grid = h('div', { class: 'group-grid' });
    pub.groups.forEach(g => grid.appendChild(h('button', { class: 'group-btn', style: { '--gc': groupColor(g.id) }, onclick: () => rosterView(g) },
      h('div', { class: 'roof' }, g.logo_url ? h('img', { src: g.logo_url, alt: '' }) : null),
      h('div', { class: 'gname' }, g.label),
      h('div', { class: 'gco' }, g.company_name || '기업 이름을 기다리는 중'))));
    entryShell(h('h1', { class: 'title' }, '지구 서버'),
      h('p', { class: 'title-sub' }, '신발 기업 경영 시뮬레이터 · 우리 모둠을 골라 입장해요'), grid);
    root.appendChild(h('button', { class: 'teacher-link ghost', onclick: () => location.href = 'admin.html' }, '교사 관제실'));
  }

  async function rosterView(g) {
    const list = await rpc('get_roster', { p_group: g.id });
    const box = h('div', { class: 'roster' });
    if (!list.length) box.appendChild(h('p', {}, '아직 명단이 없어요. 선생님께 말해 주세요.'));
    list.forEach(s => box.appendChild(h('button', {
      disabled: s.taken, onclick: () => avatarView(g, s)
    }, (s.no ? s.no + '번 ' : '') + s.name, s.taken ? h('small', {}, '이미 들어왔어요') : null)));
    entryShell(h('h1', {}, g.label + (g.company_name ? ' · ' + g.company_name : '')),
      h('p', { class: 'sub' }, '내 이름을 눌러 주세요'), box,
      h('button', { class: 'ghost', onclick: entryView }, '모둠 다시 고르기'));
  }

  function avatarView(g, s) {
    let pick = 'boy';
    const btns = ['boy', 'girl'].map(k => h('button', { class: k === pick ? 'on' : '', onclick: e => {
      pick = k; btns.forEach(b => b.classList.toggle('on', b === e.currentTarget));
    } }, h('img', { class: 'pixel', src: P.avatarDataUrl(k, 8), alt: '' }), k === 'boy' ? '캐릭터 1' : '캐릭터 2'));
    const go = h('button', { class: 'primary big', onclick: async () => {
      go.disabled = true;
      try {
        const r = await rpc('join_student', { p_student: s.id, p_avatar: pick });
        if (r.status === 'joined') enterGame(); else pendingView();
      } catch (e) { toast(e.message, 'error'); go.disabled = false; }
    } }, '입장하기');
    entryShell(h('h1', {}, s.name), h('p', { class: 'sub' }, '마을에서 쓸 캐릭터를 골라요'),
      h('div', { class: 'avatar-pick' }, btns), go, h('div', { style: { height: '18px' } }),
      h('button', { class: 'ghost', onclick: () => rosterView(g) }, '이름 다시 고르기'));
  }

  function pendingView() {
    entryShell(h('h1', {}, '잠깐만요!'),
      h('p', { class: 'sub' }, '선생님이 내 기기를 확인하고 있어요. 이 화면을 켜 둔 채로 기다려 주세요.'),
      h('div', { class: 'waiting-dots' }, h('i'), h('i'), h('i')));
    const t = setInterval(async () => {
      try {
        const me = await rpc('get_me');
        if (me.status === 'joined') { clearInterval(t); enterGame(); }
        if (me.status === 'none') { clearInterval(t); entryView(); }
      } catch (e) { /* 계속 기다림 */ }
    }, 3000);
  }

  // ------------------------------------------------------------------
  // 게임 화면
  // ------------------------------------------------------------------
  async function enterGame() {
    await P.ready;
    await refresh(true);
    if (!S.channel) {
      S.channel = subscribe({
        game: () => refreshSoon(),
        tick: t => {
          if (S.st && t.group_id === S.st.group.id) refreshSoon();
          if (S.view === 'village' || S.view === 'house') marketSoon();
        },
        notice: n => {
          if (n.kind !== 'alert') toast(n.message, n.kind === 'event' || n.kind === 'citizen' ? '' : '');
        }
      });
      // 실시간이 끊겨도 15~20초마다 다시 확인
      setInterval(() => refresh(false), 15000 + Math.random() * 5000);
    }
  }

  const refreshSoon = debounce(() => refresh(false), 350);
  const marketSoon = debounce(() => loadMarket().then(() => { if (S.view === 'house') renderView(); }), 500);

  async function refresh(first) {
    let st;
    try { st = await rpc('my_state'); }
    catch (e) {
      if (e.code === 'NOT_JOINED') { location.reload(); return; }
      return;
    }
    const prev = S.st;
    S.st = st; S.me = st.me;
    if (st.now) S.offset = new Date(st.now).getTime() - Date.now();
    const phaseChanged = !prev || prev.phase !== st.phase;
    if (!first && phaseChanged) onPhaseChange(prev ? prev.phase : null, st.phase);
    // 새로고침·늦게 들어온 학생도 경보·최종 발표를 한 번은 보게
    if (first && (st.phase === 7 || st.phase === 10) && !seenOnce('ov' + st.phase)) setTimeout(() => st.phase === 7 ? showAlarm() : showFinal(), 300);
    if (first || phaseChanged) {
      if (!S.editor || phaseChanged) S.editor = null;
      if (st.market_round && (S.view === 'village' || S.view === 'house')) await loadMarket();
      renderShell();
    } else {
      renderTopbar();
      if (S.view === 'lobby' || S.view === 'workshop') softRender();
    }
  }

  function seenOnce(key) {
    const k = 'seen-' + key + '-' + (S.me && S.me.id);
    try { if (localStorage.getItem(k)) return true; localStorage.setItem(k, '1'); } catch (e) { /* 저장 불가 */ }
    return false;
  }

  function onPhaseChange(from, to) {
    if (to === 7 || to === 10) seenOnce('ov' + to);
    if (to === 7 && from !== null && from < 7) showAlarm();
    else if (to === 10) showFinal();
    else if ([2, 5, 9].includes(to)) toast('시장이 열렸어요! 마을로 나가 신발을 사 보세요.');
    else toast('지금은 「' + PHASES[to].name + '」 시간이에요.');
    if (S.view === 'workshop' && ![1, 4, 8].includes(to)) releaseLock();
  }

  function renderShell() {
    hideTip();
    root.innerHTML = '';
    root.appendChild(h('div', { id: 'topbar', class: 'topbar' }));
    const st = S.st;
    const navs = [['lobby', '우리 로비'], ['workshop', '제작방'], ['village', '마을 · 구매'], ['report', '성적표']];
    if (st.phase >= 10) navs.push(['principle', '경영 원칙']);
    root.appendChild(h('div', { class: 'nav' }, navs.map(([v, label]) =>
      h('button', { class: S.view === v || (v === 'village' && S.view === 'house') ? 'on' : '', onclick: () => go(v) }, h('span', { class: 'dot' }), label)),
      h('button', { class: 'leave small ghost', title: '이 기기에서 나가고 처음 화면으로', onclick: leaveDevice }, '나가기')));
    root.appendChild(h('div', { id: 'page', class: 'page' }));
    renderTopbar();
    renderView();
  }

  function renderTopbar() {
    const st = S.st, bar = $('#topbar');
    if (!bar) return;
    const g = st.group;
    bar.innerHTML = '';
    bar.style.setProperty('--gc', groupColor(g.id));
    bar.appendChild(h('div', { class: 'brand' },
      g.logo_url ? h('img', { class: 'logo', src: g.logo_url, alt: '' }) : h('div', { class: 'logo-empty' }, String(g.id)),
      h('div', { class: 'company' }, g.company_name || g.label, h('small', {}, g.company_name ? g.label : '기업 이름을 정해 주세요'))));
    bar.appendChild(h('span', { class: 'stat' }, h('span', { class: 'ico coin' }, 'C'), '지갑', h('b', {}, fmt(st.wallet))));
    bar.appendChild(h('span', { class: 'stat' }, h('span', { class: 'ico card' }), '성적표', h('b', {}, st.revealed ? fmt(st.score) : '???')));
    const gauge = h('span', { class: 'stat' }, h('span', { class: 'ico earth' }), '지구 게이지', h('b', {}, st.revealed ? st.gauge + '%' : '???'));
    if (st.revealed) gauge.appendChild(h('span', { class: 'gauge-mini' }, h('i', { style: { width: st.gauge + '%', background: gaugeColor(st.gauge) } })));
    bar.appendChild(gauge);
    bar.appendChild(h('span', { class: 'me-chip' }, h('img', { src: P.avatarDataUrl(S.me.avatar || 'boy', 2), alt: '' }), S.me.name,
      S.me.is_leader ? h('span', { class: 'lead' }, '모둠장') : null));
    bar.appendChild(h('span', { id: 'timer-chip', class: 'timer-chip hidden' }));
    bar.appendChild(h('span', { class: 'phase-badge' }, h('span', { class: 'n' }, st.phase), PHASES[st.phase].name));
    tickTimer();
  }

  async function leaveDevice() {
    if (!confirm('이 기기에서 나갈까요?\n다시 들어오려면 모둠과 이름을 다시 골라야 해요.')) return;
    try { await releaseLock(); await rpc('leave_student'); } catch (e) { /* 그래도 처음 화면으로 */ }
    location.reload();
  }

  // 활동 타이머 (교사가 관제실에서 시작)
  function tickTimer() {
    const el = $('#timer-chip'), t = S.st && S.st.timer;
    if (!el) return;
    if (!t || !t.end) { el.classList.add('hidden'); return; }
    const left = Math.round((new Date(t.end).getTime() - (Date.now() + (S.offset || 0))) / 1000);
    el.classList.remove('hidden');
    el.classList.toggle('over', left <= 0);
    el.classList.toggle('soon', left > 0 && left <= 60);
    el.textContent = (t.label ? t.label + ' ' : '') + (left <= 0 ? '시간 끝!' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
  }
  setInterval(tickTimer, 1000);

  function go(v) {
    if (S.view === 'workshop' && v !== 'workshop') releaseLock();
    if (v === 'report') return showReport();
    if (v === 'principle') return showPrinciple();
    S.view = v;
    if (v === 'village') return loadMarket().then(renderShell);
    renderShell();
  }

  function renderView() {
    const page = $('#page');
    if (!page) return;
    hideTip();
    page.innerHTML = '';
    if (S.view === 'lobby') page.appendChild(lobbyView());
    else if (S.view === 'workshop') page.appendChild(workshopView());
    else if (S.view === 'village') page.appendChild(villageView());
    else if (S.view === 'house') page.appendChild(houseView());
    renderCart();
  }

  // 로비·제작방은 다른 친구 변경 시 화면 일부만 다시 그림 (편집 중인 값은 유지)
  function softRender() {
    if (S.view === 'lobby' && !S.dragging) renderView();
    if (S.view === 'workshop') renderView();
  }

  // ------------------------------------------------------------------
  // 로비
  // ------------------------------------------------------------------
  function defaultStands(n) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push({ slot: i, x: Math.round((100 / (n + 1)) * i), y: 68 });
    return out;
  }
  function standsOf(g) {
    const base = defaultStands(g.slot_count);
    const saved = Array.isArray(g.stands) ? g.stands : [];
    return base.map(b => saved.find(s => s.slot === b.slot) || b);
  }

  // 로비 = 로고 칸 + 16:9 전시장
  function lobbyBox(g, products, materials, opts) {
    const frame = h('div', { class: 'lobby-frame', style: { '--gc': groupColor(g.id) } });
    const band = h('div', { class: 'logo-band' });
    if (g.logo_url) band.appendChild(h('img', { src: g.logo_url, alt: (g.company_name || g.label) + ' 로고' }));
    else if (opts.mine) band.appendChild(h('div', { class: 'logo-empty' }, '우리 기업 로고 자리예요' + (S.me.is_leader ? ' · 아래에서 올려 주세요' : '')));
    else if (g.company_name) band.appendChild(h('div', { class: 'logo-text' }, g.company_name));
    else band.appendChild(h('div', { class: 'logo-none' }, '로고 준비 중'));
    frame.appendChild(band);
    const box = h('div', { class: 'lobby ' + (g.bg_url ? '' : 'bg-' + (g.bg_preset || 0)) });
    if (g.bg_url) box.style.backgroundImage = `url("${g.bg_url}")`;
    box.appendChild(h('div', { class: 'name-tag' }, g.company_name || g.label, g.company_name ? h('small', {}, g.label) : null));
    standsOf(g).forEach(sp => {
      const pr = products.find(p => p.slot === sp.slot);
      const el = h('div', { class: 'stand ' + (opts.drag ? '' : 'static ') + (pr && opts.onShoe ? 'buyable' : ''), style: { left: sp.x + '%', top: sp.y + '%' } });
      el.dataset.slot = sp.slot;
      if (pr) {
        const qty = opts.cartQty ? opts.cartQty(pr) : 0;
        if (qty) el.appendChild(h('span', { class: 'cart-n' }, qty));
        el.appendChild(P.shoeArt(pr, materials, 'shoe'));
        el.appendChild(h('div', { class: 'pedestal' }));
        const tag = sp.slot + '번 · ' + (P.SHAPES.find(s => s.id === pr.shape) || {}).name;
        el.appendChild(h('div', { class: 'tag' }, tag, pr.stars ? h('span', { class: 'stars' }, '★'.repeat(pr.stars)) : null));
        if (opts.onShoe) el.addEventListener('click', () => { hideTip(); opts.onShoe(pr); });
        attachTip(el, g, pr, materials, opts.onShoe ? opts.tipFoot : null);
      } else {
        el.appendChild(h('div', { class: 'empty' }, sp.slot + '번 빈 칸'));
        el.appendChild(h('div', { class: 'pedestal' }));
      }
      if (opts.drag) enableDrag(el, box);
      box.appendChild(el);
    });
    frame.appendChild(box);
    return frame;
  }

  // 재료 그림 (아직 그림이 없으면 등급 색 칸)
  function matPic(m) {
    const img = h('img', { src: matImg(m.id), alt: '', loading: 'lazy' });
    img.addEventListener('error', () => {
      const t = P.TIERS[m.tier] || {};
      img.replaceWith(h('div', { class: 'noimg', style: { '--tc': t.color || '#999' } }, P.PART_LABEL[m.part] || ''));
    });
    return img;
  }

  // 신발에 마우스를 올리면 재료 설명
  let tipEl = null;
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
  function partLines(pr, materials) {
    return P.shoeParts(pr, materials).map(x => {
      const m = x.mat;
      const tier = m ? P.TIERS[m.tier] : null;
      return h('div', { class: 'part-line' },
        m ? matPic(m) : h('span'),
        h('div', {}, h('div', { class: 'pl' }, x.label), h('div', { class: 'pn' }, m ? m.name : '-')),
        tier ? h('span', { class: 'chip', style: { background: tier.color } }, tier.label) : h('span'));
    });
  }
  function shoeEnv(pr, materials) {
    const ms = P.shoeParts(pr, materials).map(x => x.mat);
    if (ms.some(m => !m || m.env === null || m.env === undefined)) return null;
    return ms.reduce((t, m) => t + m.env, 0);
  }
  function tipContent(g, pr, materials, foot) {
    const shape = (P.SHAPES.find(s => s.id === pr.shape) || {}).name || '';
    const env = shoeEnv(pr, materials);
    const price = P.shoeParts(pr, materials).reduce((t, x) => t + (x.mat ? x.mat.price : 0), 0);
    return [
      h('h4', {}, h('span', {}, pr.slot + '번 ' + shape), pr.stars ? h('span', { class: 'stars' }, '★'.repeat(pr.stars)) : null),
      ...partLines(pr, materials),
      h('div', { class: 'foot' }, '재료값 ' + price + '코인', env !== null ? h('span', { class: envClass(env) }, ' · ' + envText(env)) : null,
        foot ? h('div', {}, foot) : null)
    ];
  }
  function attachTip(el, g, pr, materials, foot) {
    el.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch' || S.dragging) return;
      hideTip();
      tipEl = h('div', { class: 'tip' }, ...tipContent(g, pr, materials, foot));
      document.body.appendChild(tipEl);
      const r = el.getBoundingClientRect(), tw = 290, th = tipEl.offsetHeight;
      let x = r.right + 12;
      if (x + tw > window.innerWidth - 8) x = r.left - tw - 12;
      if (x < 8) x = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left));
      const y = Math.max(8, Math.min(window.innerHeight - th - 8, r.top + r.height / 2 - th / 2));
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
      requestAnimationFrame(() => tipEl && tipEl.classList.add('on'));
    });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('pointerdown', hideTip);
  }

  function enableDrag(el, box) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      S.dragging = true;
      el.setPointerCapture(e.pointerId);
      const rect = box.getBoundingClientRect();
      const move = ev => {
        const x = Math.max(8, Math.min(92, ((ev.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(30, Math.min(90, ((ev.clientY - rect.top) / rect.height) * 100));
        el.style.left = x + '%'; el.style.top = y + '%';
      };
      const up = async () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        S.dragging = false;
        const stands = Array.from(box.querySelectorAll('.stand')).map(s => ({
          slot: Number(s.dataset.slot), x: Math.round(parseFloat(s.style.left)), y: Math.round(parseFloat(s.style.top))
        }));
        try { await rpc('lobby_update', { p: { stands } }); } catch (err) { toast(err.message, 'error'); }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  function lobbyView() {
    const st = S.st, g = st.group;
    const wrap = h('div', {});
    wrap.appendChild(h('div', { class: 'hint' }, PHASES[st.phase].desc, ' 전시대는 끌어서 옮길 수 있어요.'));
    wrap.appendChild(lobbyBox(g, st.products, st.materials, { drag: true, mine: true }));

    const deco = h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '전시장 꾸미기'));
    deco.appendChild(h('div', { class: 'field-label' }, '기본 배경'));
    deco.appendChild(h('div', { class: 'row' }, [0, 1, 2, 3].map(i => h('button', {
      class: 'bg-swatch bg-' + i, 'aria-label': '기본 배경 ' + (i + 1),
      onclick: async () => { try { await rpc('lobby_update', { p: { bg_preset: i, bg_url: null } }); await refresh(false); renderView(); } catch (e) { toast(e.message, 'error'); } }
    }))));
    deco.appendChild(h('div', { class: 'field-label' }, '직접 만든 배경 · 가로 16:9 (미리캔버스 「프레젠테이션」 크기 1920×1080)'));
    deco.appendChild(fileButton('전시장 배경 올리기', async f => {
      const url = await uploadImage(f, 'g' + g.id, 1920, 'image/jpeg');
      await rpc('lobby_update', { p: { bg_url: url } });
    }));

    const info = h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '기업 정보', h('small', {}, S.me.is_leader ? '모둠장만 바꿀 수 있어요' : '이름과 로고는 모둠장이 바꿔요')));
    if (S.me.is_leader) {
      const inp = h('input', { type: 'text', maxlength: '20', placeholder: '기업 이름', value: g.company_name || '', style: { flex: '1' } });
      info.appendChild(h('div', { class: 'field-label' }, '기업 이름'));
      info.appendChild(h('div', { class: 'row' }, inp,
        h('button', { class: 'primary', onclick: async () => {
          try { await rpc('lobby_update', { p: { company_name: inp.value } }); toast('기업 이름을 저장했어요.'); await refresh(false); renderShell(); }
          catch (e) { toast(e.message, 'error'); }
        } }, '저장')));
      info.appendChild(h('div', { class: 'field-label' }, '로고 · 배경이 투명한 PNG면 가장 예뻐요 (가로로 긴 로고도 괜찮아요)'));
      info.appendChild(fileButton('로고 올리기', async f => {
        const url = await uploadImage(f, 'g' + g.id, 800, 'image/png');
        await rpc('lobby_update', { p: { logo_url: url } });
      }));
    }
    info.appendChild(h('div', { class: 'field-label' }, '우리 팀'));
    info.appendChild(h('div', { class: 'team' }, st.team.map(t => h('span', {}, h('i', { class: t.online ? 'on' : '' }), t.name + (t.is_leader ? ' (모둠장)' : '')))));
    wrap.appendChild(h('div', { class: 'deco-grid' }, deco, info));
    return wrap;
  }

  function fileButton(label, handler) {
    const inp = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const btn = h('button', { class: 'sky', onclick: () => inp.click() }, label);
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      btn.disabled = true; btn.textContent = '올리는 중...';
      try { await handler(inp.files[0]); toast('그림을 올렸어요!'); await refresh(false); renderShell(); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = label; }
    });
    return h('span', {}, btn, inp);
  }

  // ------------------------------------------------------------------
  // 제작방
  // ------------------------------------------------------------------
  const DEFAULT_PARTS = { sole: 'M02', body: 'M07', insole: 'M12', lace: 'M17' };

  function canEdit() { return [1, 4, 8].includes(S.st.phase); }

  async function takeLock(slot) {
    if (!canEdit()) return;
    if (S.lockedSlot && S.lockedSlot !== slot) await releaseLock();
    try {
      await rpc('slot_lock', { p_slot: slot });
      S.lockedSlot = slot;
      clearInterval(S.heartbeat);
      S.heartbeat = setInterval(() => rpc('slot_lock', { p_slot: slot }).catch(() => {}), 60000);
    } catch (e) { toast(e.message, 'error'); }
  }
  async function releaseLock() {
    clearInterval(S.heartbeat);
    const s = S.lockedSlot;
    S.lockedSlot = null;
    if (s) { try { await rpc('slot_unlock', { p_slot: s }); } catch (e) { /* 무시 */ } }
  }
  window.addEventListener('beforeunload', () => { if (S.lockedSlot) rpc('slot_unlock', { p_slot: S.lockedSlot }); });

  function editorFor(slot) {
    const pr = S.st.products.find(p => p.slot === slot);
    return {
      slot,
      shape: pr ? pr.shape : 'lowtop',
      colors: {},
      parts: Object.assign({}, pr ? pr.parts : DEFAULT_PARTS),
      original: pr || null
    };
  }

  function unlocked(m) {
    const inv = S.st.invest;
    if (m.unlock === 'research') return inv.research;
    if (m.unlock === 'eco_research') return inv.eco_research;
    return true;
  }

  function priceOf(id) { const m = P.matOf(S.st.materials, id); return m ? m.price : 0; }

  function costPreview(ed) {
    const total = ['sole', 'body', 'insole', 'lace'].reduce((t, k) => t + priceOf(ed.parts[k]), 0);
    const pr = ed.original;
    if (S.st.phase === 8 && pr && pr.status === 'listed') {
      const pay = ['sole', 'body', 'insole', 'lace'].reduce((t, k) => t + (ed.parts[k] !== pr.parts[k] ? priceOf(ed.parts[k]) : 0), 0);
      return { pay, label: '바꾼 재료 값', text: pay + '코인' };
    }
    if (!pr) return { pay: total, label: '제작비', text: total + '코인' };
    if (pr.status === 'draft') {
      const d = total - pr.cost;
      return d >= 0 ? { pay: d, label: '추가로 낼 돈', text: d + '코인' } : { pay: d, label: '돌려받을 돈', text: (-d) + '코인' };
    }
    return { pay: 0, label: '이미 판매한 신발', text: '수정 불가' };
  }

  function workshopView() {
    const st = S.st;
    if (!S.editor || S.editor.slot > st.group.slot_count) {
      S.slot = Math.min(S.slot || 1, st.group.slot_count);
      S.editor = editorFor(S.slot);
      takeLock(S.slot);
    }
    const ed = S.editor;
    ed.original = st.products.find(p => p.slot === ed.slot) || null;
    const wrap = h('div', {});
    const editable = canEdit();
    const lockOther = (st.locks || []).find(l => l.slot === ed.slot && !l.mine);
    let hint = editable ? (st.phase === 8 ? '3차 경영: 판매 중인 신발은 재료를 바꾸고, 빈 칸에는 새 신발을 만들 수 있어요. 친환경 투자도 할 수 있어요.' : '재료를 골라 신발을 만들어요. 돈이 부족하지 않게 계획해요!')
      : '지금은 「' + PHASES[st.phase].name + '」 시간이라 신발을 만들 수 없어요.';
    wrap.appendChild(h('div', { class: 'hint' }, hint));

    const tabs = h('div', { class: 'slot-tabs' });
    for (let i = 1; i <= st.group.slot_count; i++) {
      const pr = st.products.find(p => p.slot === i);
      tabs.appendChild(h('button', { class: ed.slot === i ? 'on' : '', onclick: async () => {
        S.slot = i; S.editor = editorFor(i); await takeLock(i); renderView();
      } }, i + '번 칸', h('small', {}, pr ? (pr.status === 'listed' ? '판매 중' : '만든 신발') : '비어 있음')));
    }

    // 왼쪽: 미리보기
    const left = h('div', { class: 'panel col' });
    left.appendChild(tabs);
    left.appendChild(h('div', { class: 'preview' }, P.shoeArt(ed, st.materials)));
    left.appendChild(h('div', { class: 'mat-strip' }, P.shoeParts(ed, st.materials).map(x => x.mat ? h('span', { title: x.label + ': ' + x.mat.name }, matPic(x.mat)) : null)));
    if (lockOther) left.appendChild(h('div', { class: 'hint' }, lockOther.name + ' 학생이 이 신발을 고치는 중이에요.'));
    left.appendChild(h('div', { class: 'field-label' }, '모양'));
    left.appendChild(h('div', { class: 'shape-row' }, P.SHAPES.map(s => h('button', {
      class: ed.shape === s.id ? 'on' : '', onclick: () => { ed.shape = s.id; renderView(); }
    }, s.name))));
    left.appendChild(h('div', { class: 'muted', style: { fontSize: '13px' } }, '재료를 누르면 그 부분이 바로 바뀌어요. 몸체 재료가 신발 전체 디자인을 정해요. 아래 그림 4개가 지금 고른 재료예요.'));
    const cp = costPreview(ed);
    const after = st.wallet - (cp.pay > 0 ? cp.pay : 0) + (cp.pay < 0 ? -cp.pay : 0);
    left.appendChild(h('div', { class: 'cost-box' },
      h('div', {}, h('div', { class: 'muted', style: { fontSize: '13px' } }, cp.label || '이번에 낼 돈'), h('b', {}, cp.text)),
      h('div', { class: 'after ' + (after < 0 ? 'neg' : '') }, '지금 지갑 ' + fmt(st.wallet), h('br'), '저장 후 ' + fmt(after))));
    const pr = ed.original;
    const blocked = !editable || !!lockOther || (pr && pr.status === 'listed' && st.phase !== 8);
    const saveLabel = st.phase === 8 && pr && pr.status === 'listed' ? '재료 바꾸기' : pr ? '수정 저장' : '신발 만들기';
    left.appendChild(h('button', { class: 'primary big', disabled: blocked, onclick: e => { e.currentTarget.disabled = true; saveShoe(); } }, saveLabel));
    if (pr && pr.status === 'draft' && [1, 4, 8].includes(st.phase)) {
      left.appendChild(h('button', { disabled: !!lockOther, onclick: async () => {
        if (!confirm('이 신발을 취소하고 돈을 돌려받을까요?')) return;
        try { await rpc('product_cancel', { p_slot: ed.slot }); toast('취소하고 돈을 돌려받았어요.'); S.editor = null; await refresh(false); renderView(); }
        catch (e) { toast(e.message, 'error'); }
      } }, '판매 전 취소 (환불)'));
    }
    if (pr && pr.status === 'listed' && st.phase === 4) {
      left.appendChild(h('button', { class: 'warn', disabled: !!lockOther, onclick: async () => {
        if (!confirm('이 신발을 단종할까요? 돈은 돌려받지 못하고, 빈 칸에 새 신발을 만들 수 있어요.')) return;
        try { await rpc('product_retire', { p_slot: ed.slot }); toast('단종했어요. 새 신발을 만들어 보세요.'); S.editor = null; await refresh(false); renderView(); }
        catch (e) { toast(e.message, 'error'); }
      } }, '단종하고 새로 만들기'));
    }

    // 오른쪽: 재료
    const right = h('div', { class: 'panel' });
    ['sole', 'body', 'insole', 'lace'].forEach(part => {
      const row = h('div', { class: 'part-row' }, h('h4', {}, P.PART_LABEL[part] + ' 재료'));
      const mats = h('div', { class: 'mats' });
      st.materials.filter(m => m.part === part).forEach(m => {
        const ok = unlocked(m);
        const tier = P.TIERS[m.tier];
        mats.appendChild(h('button', {
          class: 'mat ' + (ed.parts[part] === m.id ? 'on ' : '') + (ok ? '' : 'locked'),
          disabled: !ok, title: ok ? m.descr : '',
          onclick: () => { if (!ok) return; ed.parts[part] = m.id; renderView(); }
        },
          h('div', { class: 'thumb', style: { '--tc': tier.color } }, matPic(m), h('span', { class: 'chip', style: { background: tier.color } }, tier.label)),
          h('div', { class: 'info' },
            h('span', { class: 'nm' }, m.name),
            h('span', { class: 'price' }, m.price + '코인'),
            m.env !== null ? h('span', { class: 'envtag ' + envClass(m.env) }, envText(m.env)) : null,
            h('span', { class: 'desc' }, ok ? m.descr : (m.unlock === 'research' ? '신소재 연구를 하면 열려요' : '친환경 소재 연구를 하면 열려요')))));
      });
      row.appendChild(mats);
      right.appendChild(row);
    });

    wrap.appendChild(h('div', { class: 'workshop' }, left, right));
    wrap.appendChild(investPanel());
    return wrap;
  }

  async function saveShoe() {
    const ed = S.editor;
    try {
      const r = await rpc('product_save', { p_slot: ed.slot, p_shape: ed.shape, p_colors: ed.colors, p_parts: ed.parts });
      toast(r.paid > 0 ? r.paid + '코인을 써서 저장했어요!' : '저장했어요!');
      S.lockedSlot = null; clearInterval(S.heartbeat);
      await refresh(false);
      S.editor = editorFor(ed.slot);
      await takeLock(ed.slot);
      renderView();
    } catch (e) { toast(e.message, 'error'); renderView(); }
  }

  function investPanel() {
    const st = S.st, inv = st.invest;
    const items = [
      { k: 'research', name: '신소재 연구', desc: '더 화려하고 멋진 고급 합성 재료가 열려요.', phases: [4, 8] },
      { k: 'factory', name: '공장 확장', desc: '전시 칸이 2개에서 4개로 늘어나요.', phases: [4, 8] }
    ];
    if (st.phase >= 7) {
      items.push({ k: 'eco_research', name: '친환경 소재 연구', desc: '환경을 지키는 친환경 고급 재료가 열려요.', phases: [8] });
      items.push({ k: 'purifier', name: '공장 정화장치', desc: '공장에서 나오는 오염을 줄여요.', phases: [8] });
    }
    const panel = h('div', { class: 'panel', style: { marginTop: '18px' } },
      h('div', { class: 'panel-title' }, '기업 투자', h('small', {}, S.me.is_leader ? '모둠장만 누를 수 있어요' : '모둠장에게 부탁하세요')));
    const grid = h('div', { class: 'invest-grid' });
    items.forEach(it => {
      const done = inv[it.k];
      const open = it.phases.includes(st.phase);
      const env = inv['env_' + it.k];
      grid.appendChild(h('button', {
        class: 'invest ' + (done ? 'done' : ''), disabled: done || !open || !S.me.is_leader,
        onclick: async () => {
          if (!confirm(it.name + '에 ' + inv['cost_' + it.k] + '코인을 투자할까요?')) return;
          try { await rpc('invest', { p_kind: it.k }); toast(it.name + ' 완료!'); await refresh(false); renderView(); }
          catch (e) { toast(e.message, 'error'); }
        }
      }, h('b', {}, it.name), h('span', { class: 'cost' }, inv['cost_' + it.k] + '코인'),
        env !== null && env !== undefined ? h('span', { class: envClass(env) }, envText(env)) : null,
        h('span', { class: 'muted', style: { fontSize: '13px' } }, done ? '✔ 완료' : open ? it.desc : '지금은 투자할 수 없어요')));
    });
    panel.appendChild(grid);
    return panel;
  }

  // ------------------------------------------------------------------
  // 마을
  // ------------------------------------------------------------------
  async function loadMarket() {
    try { S.market = await rpc('market'); } catch (e) { toast(e.message, 'error'); }
  }

  // 마을 지도: 그림 좌표 기준. 화면은 16:9 카메라가 캐릭터를 따라감
  const MAP = {
    src: 'img/village2.webp', w: 1672, h: 941,
    houses: [
      { gid: 1, cx: 457, sx: 458, sy: 180, doorY: 274, top: true },
      { gid: 2, cx: 841, sx: 841, sy: 180, doorY: 274, top: true },
      { gid: 3, cx: 1225, sx: 1225, sy: 180, doorY: 274, top: true },
      { gid: 4, cx: 454, sx: 454, sy: 684, doorY: 776 },
      { gid: 5, cx: 841, sx: 841, sy: 684, doorY: 776 },
      { gid: 6, cx: 1225, sx: 1225, sy: 684, doorY: 776 }
    ],
    houseRect: hs => hs.top ? { x: hs.cx - 118, y: 40, w: 236, h: 232 } : { x: hs.cx - 118, y: 575, w: 236, h: 199 },
    fountain: { x: 840, y: 452, rx: 128, ry: 96 },
    spawn: { x: 620, y: 455 },
    bounds: { x0: 255, x1: 1640, y0: 40, y1: 915 },
    avatarScale: 4,
    fountainAnim: false
  };
  const VW = MAP.w, VH = MAP.h, CW = 1600, CH = 900;
  const VIMG = new Image();
  VIMG.src = MAP.src;
  const HOUSES = MAP.houses;
  const houseRect = MAP.houseRect;
  const doorRect = hs => ({ x: hs.cx - 24, y: hs.doorY - 20, w: 48, h: 30 });
  const FOUNTAIN = MAP.fountain;
  const SPAWN = MAP.spawn;
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const feet = (x, y) => ({ x: x - 14, y: y - 10, w: 28, h: 12 });
  const SHOW_DPAD = false; // 패드로 수업할 때 true
  const cam = { x: 0, y: 0, s: 1, vw: VW, vh: VH };

  function villageView() {
    const m = S.market;
    const wrap = h('div', {});
    if (!m) { wrap.appendChild(h('p', { class: 'hint' }, '마을 불러오는 중...')); return wrap; }
    let hint;
    if (m.market_round) hint = m.voted ? '이번 시장 구매를 마쳤어요. 다른 회사 전시장 구경은 계속할 수 있어요.'
      : '방향키(또는 W·A·S·D)로 걸어가 다른 회사 집 문으로 들어가요. 마음에 드는 신발을 담고 마지막에 「구매 확정」!';
    else hint = '지금은 시장이 열려 있지 않아요. 방향키로 걸어 다니며 다른 회사 전시장을 구경할 수 있어요.';
    wrap.appendChild(h('div', { class: 'hint' }, hint));
    const cv = h('canvas', { class: 'village', tabindex: '0', 'aria-label': '마을 지도. 방향키로 움직여요' });
    cv.width = CW; cv.height = CH;
    const vw = h('div', { class: 'village-wrap' }, cv);
    if (SHOW_DPAD) {
      const dp = h('div', { class: 'dpad' });
      const mk = (label, dir, col, row, aria) => {
        const b = h('button', { style: { gridColumn: col, gridRow: row }, 'aria-label': aria }, label);
        const on = e => { e.preventDefault(); keys[dir] = true; };
        const off = () => { keys[dir] = false; };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
        b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
        return b;
      };
      dp.append(mk('▲', 'up', 2, 1, '위로'), mk('◀', 'left', 1, 2, '왼쪽으로'), mk('▶', 'right', 3, 2, '오른쪽으로'), mk('▼', 'down', 2, 3, '아래로'));
      vw.appendChild(dp);
    }
    if (m.fast_travel) {
      vw.appendChild(h('div', { class: 'fast' }, m.groups.filter(g => g.id !== m.my_group).map(g =>
        h('button', { class: 'small', style: { '--gc': groupColor(g.id) }, onclick: () => enterHouse(g.id) }, h('i'), g.company_name || g.label))));
    }
    const gv = S.st && S.st.revealed ? S.st.gauge : null;
    vw.appendChild(h('div', { class: 'v-gauge' }, h('span', { class: 'ico earth' }), '지구 게이지', h('b', {}, gv === null ? '???' : gv + '%'),
      gv !== null ? h('span', { class: 'gauge-mini' }, h('i', { style: { width: gv + '%', background: gaugeColor(gv) } })) : null));
    wrap.appendChild(vw);
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect();
      const x = cam.x + (e.clientX - r.left) / r.width * cam.vw, y = cam.y + (e.clientY - r.top) / r.height * cam.vh;
      const hs = HOUSES.find(hs => overlap({ x, y, w: 1, h: 1 }, houseRect(hs)));
      if (!hs) return;
      if (hs.gid === m.my_group) return go('lobby');
      if (m.fast_travel) enterHouse(hs.gid);
      else toast('캐릭터를 걸어서 집 문으로 들어가 보세요!');
    });
    if (VIMG.complete) startLoop(cv); else VIMG.onload = () => startLoop(cv);
    return wrap;
  }

  const keys = {};
  const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right', 'ㅈ': 'up', 'ㄴ': 'down', 'ㅁ': 'left', 'ㅇ': 'right' };
  window.addEventListener('keydown', e => {
    const k = KEYMAP[e.key];
    if (k && S.view === 'village' && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) { keys[k] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });
  window.addEventListener('blur', () => Object.keys(keys).forEach(k => keys[k] = false));

  // 간판 글씨를 미리 그려 둔 바탕 지도
  function buildBase() {
    const m = S.market, st = S.st;
    const c = document.createElement('canvas'); c.width = VW; c.height = VH;
    const ctx = c.getContext('2d');
    ctx.drawImage(VIMG, 0, 0, VW, VH);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    HOUSES.forEach(hs => {
      const g = m.groups.find(gg => gg.id === hs.gid) || {};
      const name = g.company_name || g.label || (hs.gid + '모둠');
      rrect(ctx, hs.sx - 86, hs.sy - 20, 172, 40, 10, '#FFF9EE', '#6E4A2B');
      let size = 26;
      do { ctx.font = size + 'px Jua, sans-serif'; size -= 1; } while (ctx.measureText(name).width > 156 && size > 12);
      ctx.fillStyle = '#2A2350'; ctx.fillText(name, hs.sx, hs.sy + 2);
      if (hs.gid === m.my_group) {
        rrect(ctx, hs.sx - 48, hs.sy - 50, 96, 28, 10, '#FFC83D', '#7A4F05');
        ctx.font = '18px Jua, sans-serif'; ctx.fillStyle = '#3A2600'; ctx.fillText('우리 회사', hs.sx, hs.sy - 35);
      }
    });
    return c;
  }

  function rrect(ctx, x, y, w, hh, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.lineWidth = 4; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  let loopId = null;
  function startLoop(cv) {
    cancelAnimationFrame(loopId);
    const ctx = cv.getContext('2d');
    const base = buildBase();
    cam.s = Math.max(CW / VW, CH / VH); cam.vw = CW / cam.s; cam.vh = CH / cam.s;
    const camTarget = () => ({
      x: Math.max(0, Math.min(VW - cam.vw, p.x - cam.vw / 2)),
      y: Math.max(0, Math.min(VH - cam.vh, p.y - 40 - cam.vh / 2))
    });
    if (!S.player) S.player = { x: SPAWN.x, y: SPAWN.y, dir: 'down', step: 0 };
    const p = S.player;
    { const t0 = camTarget(); cam.x = t0.x; cam.y = t0.y; }
    let entering = false, t = 0;
    const free = (x, y) => {
      const b = MAP.bounds;
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
      const fx = (x - FOUNTAIN.x) / FOUNTAIN.rx, fy = (y - FOUNTAIN.y) / FOUNTAIN.ry;
      if (fx * fx + fy * fy < 1) return false;
      const box = feet(x, y);
      return !HOUSES.some(hs => overlap(box, houseRect(hs)) && !overlap(box, doorRect(hs)));
    };
    const tick = () => {
      if (S.view !== 'village' || !document.body.contains(cv)) return;
      t++;
      const sp = 5;
      let dx = 0, dy = 0;
      if (keys.up) dy -= sp; if (keys.down) dy += sp; if (keys.left) dx -= sp; if (keys.right) dx += sp;
      if (dx || dy) {
        p.dir = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
        p.step += 1;
        if (free(p.x + dx, p.y)) p.x += dx;
        if (free(p.x, p.y + dy)) p.y += dy;
        if (!entering) {
          const hs = HOUSES.find(hs => overlap(feet(p.x, p.y), doorRect(hs)));
          if (hs) {
            entering = true;
            Object.keys(keys).forEach(k => keys[k] = false);
            p.y = hs.doorY + 40; p.x = hs.cx; p.dir = 'down';
            if (hs.gid === S.market.my_group) { go('lobby'); return; }
            enterHouse(hs.gid); return;
          }
        }
      }
      const tg = camTarget();
      cam.x += (tg.x - cam.x) * 0.15; cam.y += (tg.y - cam.y) * 0.15;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(cam.s, 0, 0, cam.s, -cam.x * cam.s, -cam.y * cam.s);
      ctx.drawImage(base, 0, 0);
      if (MAP.fountainAnim) drawFountain(ctx, t);
      drawPlayer(ctx, p);
      loopId = requestAnimationFrame(tick);
    };
    loopId = requestAnimationFrame(tick);
  }

  function drawFountain(ctx, t) {
    const cx = FOUNTAIN.x, cy = FOUNTAIN.y - 12;
    for (let k = 0; k < 3; k++) {
      const r = (t * 0.5 + k * 22) % 66;
      ctx.strokeStyle = `rgba(255,255,255,${(0.75 * (1 - r / 66)).toFixed(2)})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(cx, cy + 6, 24 + r, (24 + r) * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // 가운데 분수대 기둥과 물방울
    ctx.fillStyle = '#4A4640'; ctx.fillRect(cx - 14, cy - 30, 28, 40);
    ctx.fillStyle = '#D9D4CA'; ctx.fillRect(cx - 10, cy - 26, 20, 34);
    ctx.fillStyle = '#F2EEE6'; ctx.fillRect(cx - 10, cy - 26, 6, 34);
    ctx.fillStyle = '#4A4640'; ctx.fillRect(cx - 26, cy - 38, 52, 12);
    ctx.fillStyle = '#C9C4BB'; ctx.fillRect(cx - 22, cy - 35, 44, 6);
    for (let i = 0; i < 8; i++) {
      const ph = (t * 0.06 + i / 8) % 1;
      const ang = (i % 2 ? 1 : -1) * (0.35 + (i % 4) * 0.12);
      const x = cx + Math.sin(ang) * ph * 60, y = cy - 44 - Math.sin(ph * Math.PI) * 46;
      ctx.fillStyle = i % 3 ? '#BDEBFF' : '#FFFFFF';
      ctx.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, 8, 8);
    }
  }

  function drawPlayer(ctx, p) {
    const sc = MAP.avatarScale || 5;
    ctx.fillStyle = 'rgba(20,20,40,.25)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, sc * 5, sc * 1.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.imageSmoothingEnabled = false;
    P.drawAvatar(ctx, S.me.avatar || 'boy', p.x - sc * 6, p.y - sc * 16, sc, p.dir, Math.floor(p.step / 6) % 2);
    ctx.font = '22px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const nm = S.me.name, tw = ctx.measureText(nm).width + 20, ty = p.y - sc * 16 - 38;
    rrect(ctx, p.x - tw / 2, ty, tw, 32, 10, '#FFF9EE', '#2A2350');
    ctx.fillStyle = '#2A2350'; ctx.fillText(nm, p.x, ty + 17);
  }

  function enterHouse(gid) {
    const fade = h('div', { class: 'fade' });
    document.body.appendChild(fade);
    requestAnimationFrame(() => fade.classList.add('on'));
    setTimeout(async () => {
      S.houseId = gid; S.view = 'house';
      await loadMarket();
      renderShell();
      fade.classList.remove('on');
      setTimeout(() => fade.remove(), 400);
    }, 380);
  }

  function houseView() {
    const m = S.market, g = m.groups.find(x => x.id === S.houseId);
    const wrap = h('div', {});
    const canBuy = m.market_round && !m.voted;
    const cart = getCart();
    wrap.appendChild(h('div', { class: 'house-head' },
      h('button', { class: 'gold', onclick: () => { S.view = 'village'; renderShell(); } }, '마을로 나가기'),
      h('div', { class: 'hint' }, canBuy ? '신발에 마우스를 올리면 재료가 보여요. 누르면 장바구니에 담을 수 있어요.' : '신발에 마우스를 올리면 재료가 보여요. 지금은 구경만 할 수 있어요.')));
    wrap.appendChild(lobbyBox(g, g.products, m.materials, {
      drag: false, onShoe: pr => shoeModal(g, pr),
      tipFoot: canBuy ? '누르면 장바구니에 담을 수 있어요' : null,
      cartQty: pr => (cart[pr.id] || {}).qty || 0
    }));
    return wrap;
  }

  function shoeModal(g, pr) {
    const m = S.market;
    const cv = P.shoeArt(pr, m.materials);
    cv.style.maxWidth = '380px';
    const env = shoeEnv(pr, m.materials);
    const shape = (P.SHAPES.find(s => s.id === pr.shape) || {}).name || '';
    const body = h('div', { class: 'col' },
      h('h2', {}, (g.company_name || g.label) + ' · ' + pr.slot + '번 ' + shape),
      pr.stars ? h('div', { class: 'stars', style: { fontSize: '20px' } }, '★'.repeat(pr.stars) + ' 친환경 인증') : null,
      h('div', { class: 'preview' }, cv),
      h('div', {}, ...partLines(pr, m.materials)),
      env !== null ? h('div', { class: envClass(env) }, '이 신발 한 켤레: ' + envText(env)) : null);
    let dlg;
    if (m.market_round && !m.voted) {
      const cart = getCart();
      const inCart = (cart[pr.id] || {}).qty || 0;
      const check = canAdd(cart, g.id);
      body.appendChild(h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '6px' } },
        h('button', { class: 'primary big', disabled: !check.ok, onclick: () => { addCart(g, pr, 1); dlg.close(); toast('장바구니에 담았어요!'); if (S.view === 'house') renderView(); } }, '장바구니에 담기 (+1표)'),
        inCart ? h('button', { class: 'big', onclick: () => { addCart(g, pr, -1); dlg.close(); if (S.view === 'house') renderView(); } }, '하나 빼기') : null));
      if (!check.ok) body.appendChild(h('div', { class: 'muted center' }, check.why));
      if (inCart) body.appendChild(h('div', { class: 'center' }, '지금 장바구니에 ' + inCart + '표 담겨 있어요.'));
    }
    dlg = modal(body);
  }

  // 장바구니 (구매 확정 전까지 이 기기에만 저장)
  const cartKey = () => 'cart-' + S.me.id + '-r' + (S.market && S.market.market_round);
  function getCart() { try { return JSON.parse(localStorage.getItem(cartKey()) || '{}'); } catch (e) { return {}; } }
  function setCart(c) { try { localStorage.setItem(cartKey(), JSON.stringify(c)); } catch (e) { /* 무시 */ } }
  function cartTotal(c) { return Object.values(c).reduce((t, x) => t + x.qty, 0); }
  function canAdd(c, gid) {
    const m = S.market;
    if (cartTotal(c) >= m.votes_total) return { ok: false, why: '표를 다 썼어요. (' + m.votes_total + '표)' };
    const g = Object.values(c).filter(x => x.gid === gid).reduce((t, x) => t + x.qty, 0);
    if (g >= m.max_per_group) return { ok: false, why: '한 회사에는 ' + m.max_per_group + '표까지만 줄 수 있어요.' };
    return { ok: true };
  }
  function addCart(g, pr, d) {
    const c = getCart();
    const cur = c[pr.id] || { qty: 0, gid: g.id, name: (g.company_name || g.label) + ' ' + pr.slot + '번', shoe: { shape: pr.shape, colors: pr.colors, parts: pr.parts } };
    cur.qty += d;
    if (cur.qty <= 0) delete c[pr.id]; else c[pr.id] = cur;
    setCart(c);
    renderCart();
  }

  function renderCart() {
    const old = $('#cart'); if (old) old.remove();
    const m = S.market;
    if (!m || !m.market_round || !(S.view === 'village' || S.view === 'house')) return;
    const box = h('div', { id: 'cart', class: 'cart' });
    if (m.voted) {
      box.appendChild(h('h4', {}, '구매 완료!'));
      box.appendChild(h('div', { class: 'muted' }, '이번 시장 구매를 확정했어요.'));
      document.body.appendChild(box); return;
    }
    const c = getCart();
    const used = cartTotal(c);
    box.appendChild(h('h4', {}, '장바구니', h('span', { class: 'votes-left', title: '남은 표 ' + (m.votes_total - used) }, Array.from({ length: m.votes_total }, (_, i) => h('i', { class: i < used ? 'used' : '' })))));
    box.appendChild(h('div', { class: 'muted', style: { fontSize: '13px' } }, '남은 표 ' + (m.votes_total - used) + ' / ' + m.votes_total + ' · 한 회사에 ' + m.max_per_group + '표까지'));
    Object.entries(c).forEach(([pid, x]) => {
      box.appendChild(h('div', { class: 'item' },
        h('img', { src: P.shoeDataUrl(x.shoe, m.materials), alt: '' }),
        h('span', { class: 'grow' }, x.name + ' × ' + x.qty),
        h('button', { class: 'small', 'aria-label': '하나 빼기', onclick: () => { const cc = getCart(); cc[pid].qty -= 1; if (cc[pid].qty <= 0) delete cc[pid]; setCart(cc); renderCart(); if (S.view === 'house') renderView(); } }, '−')));
    });
    if (!Object.keys(c).length) box.appendChild(h('div', { class: 'muted' }, '마음에 드는 신발을 담아 보세요.'));
    box.appendChild(h('button', { class: 'primary big', style: { width: '100%', marginTop: '8px' }, disabled: !cartTotal(c), onclick: async e => {
      if (!confirm('이대로 구매를 확정할까요? 확정하면 바꿀 수 없어요.')) return;
      e.currentTarget.disabled = true;
      try {
        await rpc('votes_submit', { p_items: Object.entries(getCart()).map(([pid, x]) => ({ product_id: Number(pid), qty: x.qty })) });
        setCart({});
        toast('구매를 확정했어요! 고마워요.');
        await loadMarket(); renderCart();
      } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
    } }, '구매 확정'));
    document.body.appendChild(box);
  }

  // ------------------------------------------------------------------
  // 성적표 · 경보 · 경영 원칙
  // ------------------------------------------------------------------
  async function showReport() {
    let r;
    try { r = await rpc('report'); } catch (e) { return toast(e.message, 'error'); }
    const body = h('div', { class: 'col' }, h('h2', {}, '우리 기업 성적표'));
    body.appendChild(h('table', { class: 't' },
      h('tr', {}, h('th', {}, '판매로 번 돈'), h('td', {}, fmt(r.income) + '코인')),
      h('tr', {}, h('th', {}, '쓴 돈 (제작·투자)'), h('td', {}, fmt(r.spent) + '코인')),
      r.grants ? h('tr', {}, h('th', {}, '지원금'), h('td', {}, fmt(r.grants) + '코인')) : null,
      h('tr', {}, h('th', {}, '지금 지갑'), h('td', {}, fmt(r.wallet) + '코인'))));
    if (r.rounds.length) {
      body.appendChild(h('table', { class: 't' }, h('tr', {}, h('th', {}, '차수'), h('th', {}, '팔린 신발(표)'), h('th', {}, '판매 수입')),
        r.rounds.map(x => h('tr', {}, h('td', {}, x.round + '차'), h('td', {}, x.votes), h('td', {}, fmt(x.revenue))))));
    }
    if (!r.revealed) {
      body.appendChild(h('div', { class: 'hint' }, '성적표 점수와 지구 게이지는 아직 「???」예요. 우주 운영진이 정산 중이에요.'));
    } else {
      const envPts = r.env_points;
      body.appendChild(h('h3', { style: { margin: '8px 0 0' } }, '종합점수 계산'));
      body.appendChild(h('table', { class: 't' },
        h('tr', {}, h('th', {}, '경영 성과 (번 돈 − 쓴 돈)'), h('td', {}, fmt(r.perf))),
        h('tr', {}, h('th', {}, '환경 점수'), h('td', { class: envClass(r.env) }, envText(r.env), ' × ' + r.env_mult + ' = ', (envPts < 0 ? '−' : '+') + fmt(Math.abs(envPts)))),
        h('tr', {}, h('th', {}, '친환경 소비 보너스'), h('td', {}, '+' + fmt(r.eco_bonus))),
        h('tr', {}, h('th', {}, '지구 서버 공동 보너스'), h('td', {}, '+' + fmt(r.common_bonus))),
        h('tr', {}, h('th', {}, '종합점수'), h('td', { class: 'report-num' }, fmt(r.score)))));
      body.appendChild(h('div', {}, '지구 게이지: ' + r.gauge + '%'));
      if (r.detail && r.detail.length) {
        body.appendChild(h('h3', { style: { margin: '8px 0 0' } }, '신발별 환경 영향'));
        body.appendChild(h('table', { class: 't' }, h('tr', {}, h('th', {}, '차수'), h('th', {}, '신발'), h('th', {}, '팔린 수'), h('th', {}, '한 켤레'), h('th', {}, '합계')),
          r.detail.map(d => h('tr', {},
            h('td', {}, d.round + '차'),
            h('td', {}, h('img', { style: { width: '72px' }, src: P.shoeDataUrl(d, S.st.materials), alt: '' })),
            h('td', {}, d.votes),
            h('td', { class: envClass(d.env) }, envText(d.env)),
            h('td', { class: envClass(d.env * d.votes) }, envText(d.env * d.votes))))));
      }
      if (r.investments && r.investments.length) {
        body.appendChild(h('h3', { style: { margin: '8px 0 0' } }, '투자의 환경 영향'));
        body.appendChild(h('table', { class: 't' }, r.investments.map(i => h('tr', {}, h('td', {}, i.note), h('td', {}, i.cost + '코인'), h('td', { class: envClass(i.env) }, envText(i.env))))));
      }
      body.appendChild(h('p', { class: 'muted' }, '※ 환경 점수는 게임 속 가상 점수예요.'));
    }
    modal(body, { wide: true });
  }

  async function showAlarm() {
    let r = null;
    try { r = await rpc('report'); } catch (e) { /* 무시 */ }
    const bar = h('i', { style: { width: '100%' } });
    const ov = h('div', { class: 'alarm' },
      h('h2', {}, '지구 서버 긴급 경보'),
      h('p', { style: { fontSize: '22px', maxWidth: '760px' } }, '우주 운영진입니다. 그동안 숨겨져 있던 「환경점수」를 공개합니다. 여러분 기업의 신발이 지구 서버에 어떤 영향을 주었는지 확인하세요.'),
      h('div', { class: 'big-gauge' }, bar),
      h('div', { style: { fontSize: '22px' } }, '지구 게이지'), h('div', { class: 'big-num', id: 'alarm-g' }, '100%'),
      r ? h('div', { style: { fontSize: '22px', marginTop: '8px' } }, '우리 기업 환경 점수: ' + envText(r.env)) : null,
      h('button', { class: 'gold big', style: { marginTop: '22px' }, onclick: () => { ov.remove(); showReport(); } }, '성적표 확인하기'));
    document.body.appendChild(ov);
    const target = r ? r.gauge : 50;
    setTimeout(() => { bar.style.width = target + '%'; bar.style.background = gaugeColor(target); }, 600);
    let v = 100; const t = setInterval(() => { v = Math.max(target, v - 1.5); const el = document.getElementById('alarm-g'); if (el) el.textContent = Math.round(v) + '%'; if (v <= target) clearInterval(t); }, 40);
  }

  async function showFinal() {
    let r = null;
    try { r = await rpc('report'); } catch (e) { return; }
    const ok = r.common_bonus > 0;
    const ov = h('div', { class: 'alarm calm ' + (ok ? '' : 'dim') },
      h('h2', {}, ok ? '지구 서버가 회복되었습니다!' : '최종 결과 발표'),
      h('p', { style: { fontSize: '22px', maxWidth: '760px' } }, ok
        ? '기업들의 친환경 경영과 시민들의 노력이 함께 지구 서버를 살렸어요. 모든 기업에 공동 보너스가 지급됩니다!'
        : '지구 서버는 아직 회복 중이에요. 기업의 선택이 지구에 어떤 영향을 주는지 다시 생각해 봐요.'),
      h('div', { class: 'big-gauge' }, h('i', { style: { width: r.gauge + '%', background: gaugeColor(r.gauge) } })),
      h('div', { style: { fontSize: '22px' } }, '지구 게이지'), h('div', { class: 'big-num' }, r.gauge + '%'),
      h('button', { class: 'gold big', style: { marginTop: '22px' }, onclick: () => { ov.remove(); showReport(); } }, '최종 성적표 보기'));
    document.body.appendChild(ov);
  }

  async function showPrinciple() {
    let mine = {};
    try { mine = await rpc('my_principles'); } catch (e) { /* 무시 */ }
    const company = h('textarea', { maxlength: '300', placeholder: '우리 기업은 ...을/를 지키며 신발을 만들겠습니다.' }, mine.company || '');
    const personal = h('textarea', { maxlength: '300', placeholder: '기업이 사회적 책임을 다해야 하는 까닭은 ... 때문입니다.' }, mine.personal || '');
    // 문장틀: 누르면 칸에 넣고 ( ) 자리로 커서 이동
    const frames = (ta, list) => h('div', { class: 'frames' }, list.map(f => h('button', { class: 'small', type: 'button', onclick: () => {
      ta.value = f; ta.focus(); const at = f.indexOf('( )'); if (at >= 0) ta.setSelectionRange(at, at + 3);
    } }, f)));
    const body = h('div', { class: 'col' }, h('h2', {}, '경영 원칙'));
    body.appendChild(h('div', { class: 'panel-title', style: { margin: '6px 0 0', fontSize: '18px' } }, '1. 우리 기업의 경영 원칙', h('small', {}, S.me.is_leader ? '모둠과 정한 뒤 모둠장이 등록해요' : '모둠과 함께 정하고, 등록은 모둠장이 해요')));
    if (mine.company && !S.me.is_leader) body.appendChild(h('div', { class: 'hint' }, '등록된 원칙: ' + mine.company));
    if (S.me.is_leader) {
      body.appendChild(frames(company, ['우리 기업은 ( )을/를 지키며 신발을 만들겠습니다.', '우리 기업은 이윤보다 ( )을/를 먼저 생각하겠습니다.', '우리 기업은 ( ) 재료를 써서 지구를 지키겠습니다.']));
      body.appendChild(company);
      body.appendChild(h('button', { class: 'primary', onclick: async () => {
        if (company.value.includes('( )')) return toast('( ) 자리를 채워 주세요.', 'error');
        try { await rpc('principle_submit', { p_kind: 'company', p_text: company.value }); toast('기업 원칙을 등록했어요!'); } catch (e) { toast(e.message, 'error'); }
      } }, '기업 원칙 등록'));
    }
    body.appendChild(h('div', { class: 'panel-title', style: { margin: '14px 0 0', fontSize: '18px' } }, '2. 나의 한 문장', h('small', {}, '기업이 사회적 책임을 다해야 하는 까닭')));
    body.appendChild(frames(personal, ['기업이 사회적 책임을 다해야 하는 까닭은 ( ) 때문입니다.', '기업이 환경을 해치면 ( ) 때문에 책임을 다해야 합니다.']));
    body.appendChild(personal);
    body.appendChild(h('button', { class: 'primary', onclick: async () => {
      if (personal.value.includes('( )')) return toast('( ) 자리를 채워 주세요.', 'error');
      try { await rpc('principle_submit', { p_kind: 'personal', p_text: personal.value }); toast('저장했어요!'); } catch (e) { toast(e.message, 'error'); }
    } }, '내 문장 저장'));
    modal(body);
  }

  start();
})();
