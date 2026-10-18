// 학생 화면
(function () {
  const { rpc, ensureSession, uploadImage, subscribe, PHASES } = window.API;
  const { $, h, toast, modal, envText, envClass, fmt, debounce } = window.UI;
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
  async function start() {
    root.innerHTML = '<div class="entry"><h1>지구 서버</h1><p class="sub">접속 중...</p></div>';
    try {
      await ensureSession();
      const me = await rpc('get_me');
      if (me.status === 'joined') return enterGame();
      if (me.status === 'pending') return pendingView();
      entryView();
    } catch (e) {
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'entry' }, h('h1', {}, '지구 서버'),
        h('p', { class: 'bad' }, e.message), h('button', { onclick: start }, '다시 시도')));
    }
  }

  async function entryView() {
    const pub = await rpc('get_public');
    root.innerHTML = '';
    const grid = h('div', { class: 'group-grid' });
    pub.groups.forEach(g => grid.appendChild(h('button', { class: 'group-btn', onclick: () => rosterView(g) },
      g.logo_url ? h('img', { src: g.logo_url, alt: '' }) : null,
      g.label, g.company_name ? h('small', {}, g.company_name) : null)));
    root.appendChild(h('div', { class: 'entry' },
      h('h1', {}, '지구 서버'),
      h('p', { class: 'sub' }, '신발 기업 경영 시뮬레이터 · 우리 모둠을 눌러 주세요'),
      grid));
    root.appendChild(h('button', { class: 'teacher-link', onclick: () => location.href = 'admin.html' }, '교사'));
  }

  async function rosterView(g) {
    const list = await rpc('get_roster', { p_group: g.id });
    root.innerHTML = '';
    const box = h('div', { class: 'roster' });
    if (!list.length) box.appendChild(h('p', { class: 'muted' }, '아직 명단이 없어요. 선생님께 말해 주세요.'));
    list.forEach(s => box.appendChild(h('button', {
      disabled: s.taken, onclick: () => avatarView(g, s)
    }, (s.no ? s.no + '번 ' : '') + s.name, s.taken ? h('div', { class: 'muted', style: { fontSize: '13px' } }, '이미 들어옴') : null)));
    root.appendChild(h('div', { class: 'entry' },
      h('h1', {}, g.label), h('p', { class: 'sub' }, '내 이름을 눌러 주세요'), box,
      h('button', { onclick: entryView }, '← 모둠 다시 고르기')));
  }

  function avatarView(g, s) {
    root.innerHTML = '';
    let pick = 'boy';
    const btns = ['boy', 'girl'].map(k => h('button', { class: k === pick ? 'on' : '', onclick: e => {
      pick = k; btns.forEach(b => b.classList.toggle('on', b === e.currentTarget));
    } }, h('img', { class: 'pixel', src: P.avatarDataUrl(k, 8), alt: '' }), k === 'boy' ? '캐릭터 1' : '캐릭터 2'));
    const go = h('button', { class: 'primary', onclick: async () => {
      go.disabled = true;
      try {
        const r = await rpc('join_student', { p_student: s.id, p_avatar: pick });
        if (r.status === 'joined') enterGame(); else pendingView();
      } catch (e) { toast(e.message, 'error'); go.disabled = false; }
    } }, '입장하기');
    root.appendChild(h('div', { class: 'entry' },
      h('h1', {}, s.name), h('p', { class: 'sub' }, '마을에서 쓸 캐릭터를 골라요'),
      h('div', { class: 'avatar-pick' }, btns), go, h('div', { style: { height: '14px' } }),
      h('button', { onclick: () => rosterView(g) }, '← 이름 다시 고르기')));
  }

  function pendingView() {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'entry' }, h('h1', {}, '잠깐만요!'),
      h('p', {}, '선생님이 연결을 확인하고 있어요. 이 화면을 켜 둔 채로 기다려 주세요.')));
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
    root.innerHTML = '';
    root.appendChild(h('div', { id: 'topbar', class: 'topbar' }));
    const st = S.st;
    const navs = [['lobby', '우리 로비'], ['workshop', '제작방'], ['village', '마을 (구매)'], ['report', '성적표']];
    if (st.phase >= 10) navs.push(['principle', '경영 원칙']);
    root.appendChild(h('div', { class: 'nav' }, navs.map(([v, label]) =>
      h('button', { class: S.view === v || (v === 'village' && S.view === 'house') ? 'on' : '', onclick: () => go(v) }, label))));
    root.appendChild(h('div', { id: 'page', class: 'page' }));
    renderTopbar();
    renderView();
  }

  function renderTopbar() {
    const st = S.st, bar = $('#topbar');
    if (!bar) return;
    const g = st.group;
    bar.innerHTML = '';
    if (g.logo_url) bar.appendChild(h('img', { class: 'logo', src: g.logo_url, alt: '' }));
    bar.appendChild(h('span', { class: 'company' }, g.company_name || g.label));
    bar.appendChild(h('span', { class: 'stat' }, '👛 지갑', h('b', {}, fmt(st.wallet))));
    bar.appendChild(h('span', { class: 'stat' }, '📋 성적표', h('b', {}, st.revealed ? fmt(st.score) : '???')));
    const gauge = h('span', { class: 'stat' }, '🌏 지구 게이지', h('b', {}, st.revealed ? st.gauge + '%' : '???'));
    if (st.revealed) gauge.appendChild(h('span', { class: 'gauge-mini' }, h('i', { style: { width: st.gauge + '%', background: st.gauge >= 60 ? '#6FD08C' : st.gauge >= 40 ? '#F2C230' : '#E05A4F' } })));
    bar.appendChild(gauge);
    bar.appendChild(h('span', { class: 'stat' }, S.me.name + (S.me.is_leader ? ' (모둠장)' : '')));
    bar.appendChild(h('span', { class: 'phase' }, PHASES[st.phase].name));
  }

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

  function lobbyBox(g, products, materials, opts) {
    const box = h('div', { class: 'lobby ' + (g.bg_url ? '' : 'bg-' + (g.bg_preset || 0)) });
    if (g.bg_url) box.style.backgroundImage = `url("${g.bg_url}")`;
    if (g.logo_url) box.appendChild(h('img', { class: 'lobby-logo', src: g.logo_url, alt: '' }));
    box.appendChild(h('div', { class: 'lobby-name' }, g.company_name || g.label));
    standsOf(g).forEach(sp => {
      const pr = products.find(p => p.slot === sp.slot);
      const el = h('div', { class: 'stand ' + (opts.drag ? '' : 'static'), style: { left: sp.x + '%', top: sp.y + '%' } });
      el.dataset.slot = sp.slot;
      if (pr) {
        el.appendChild(h('img', { class: 'shoe', src: P.shoeDataUrl(pr, materials, 4), alt: '신발', draggable: 'false' }));
        el.appendChild(h('div', { class: 'pedestal' }));
        let tag = sp.slot + '번 · ' + (P.SHAPES.find(s => s.id === pr.shape) || {}).name;
        el.appendChild(h('div', { class: 'tag' }, tag, pr.stars ? h('span', { class: 'stars' }, ' ' + '★'.repeat(pr.stars)) : null));
        if (opts.onShoe) el.addEventListener('click', () => opts.onShoe(pr));
      } else {
        el.appendChild(h('div', { class: 'empty' }, sp.slot + '번 빈 칸'));
        el.appendChild(h('div', { class: 'pedestal' }));
      }
      if (opts.drag) enableDrag(el, box);
      box.appendChild(el);
    });
    return box;
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
    wrap.appendChild(h('div', { class: 'hint' }, PHASES[st.phase].desc, ' · 전시대는 끌어서 옮길 수 있어요.'));
    wrap.appendChild(lobbyBox(g, st.products, st.materials, { drag: true }));

    const deco = h('div', { class: 'panel', style: { marginTop: '12px' } });
    deco.appendChild(h('h3', { style: { margin: '0 0 8px' } }, '로비 꾸미기'));
    const bgRow = h('div', { class: 'row' }, '기본 배경:');
    [0, 1, 2, 3].forEach(i => bgRow.appendChild(h('button', {
      class: 'small bg-' + i, style: { width: '56px', height: '36px' },
      onclick: async () => { try { await rpc('lobby_update', { p: { bg_preset: i, bg_url: null } }); await refresh(false); renderView(); } catch (e) { toast(e.message, 'error'); } }
    }, ' ')));
    deco.appendChild(bgRow);
    deco.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
      fileButton('판매홀 그림 올리기', async f => {
        const url = await uploadImage(f, 'g' + g.id, 1280);
        await rpc('lobby_update', { p: { bg_url: url } });
      }),
      S.me.is_leader ? fileButton('로고 올리기 (모둠장)', async f => {
        const url = await uploadImage(f, 'g' + g.id, 400);
        await rpc('lobby_update', { p: { logo_url: url } });
      }) : null));
    if (S.me.is_leader) {
      const inp = h('input', { type: 'text', maxlength: '20', placeholder: '기업 이름', value: g.company_name || '' });
      deco.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, '기업 이름:', inp,
        h('button', { class: 'primary small', onclick: async () => {
          try { await rpc('lobby_update', { p: { company_name: inp.value } }); toast('기업 이름을 저장했어요.'); await refresh(false); renderShell(); }
          catch (e) { toast(e.message, 'error'); }
        } }, '저장')));
    } else {
      deco.appendChild(h('p', { class: 'muted' }, '기업 이름과 로고는 모둠장이 바꿀 수 있어요.'));
    }
    deco.appendChild(h('div', { style: { marginTop: '10px' } }, '우리 팀: ',
      st.team.map(t => h('span', { style: { marginRight: '10px' } }, (t.online ? '🟢 ' : '⚪ ') + t.name + (t.is_leader ? '(모둠장)' : '')))));
    wrap.appendChild(deco);
    return wrap;
  }

  function fileButton(label, handler) {
    const inp = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const btn = h('button', { onclick: () => inp.click() }, label);
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
      colors: Object.assign({ body: 'blue', lace: 'ivory' }, pr ? pr.colors : {}),
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
    if (S.st.phase === 8) {
      if (!pr) return { pay: 0, text: '3차에는 이미 만든 신발만 바꿀 수 있어요.' };
      const pay = ['sole', 'body', 'insole', 'lace'].reduce((t, k) => t + (ed.parts[k] !== pr.parts[k] ? priceOf(ed.parts[k]) : 0), 0);
      return { pay, text: '바꾼 재료 값: ' + pay + '코인' };
    }
    if (!pr) return { pay: total, text: '제작비: ' + total + '코인' };
    if (pr.status === 'draft') {
      const d = total - pr.cost;
      return { pay: d, text: d >= 0 ? '추가로 낼 돈: ' + d + '코인' : '돌려받을 돈: ' + (-d) + '코인' };
    }
    return { pay: 0, text: '이미 판매한 신발이에요.' };
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
    let hint = editable ? (st.phase === 8 ? '3차 경영: 이미 만든 신발의 재료를 바꾸거나 친환경 투자를 할 수 있어요.' : '재료를 골라 신발을 만들어요. 돈이 부족하지 않게 계획해요!')
      : '지금은 「' + PHASES[st.phase].name + '」 시간이라 신발을 만들 수 없어요.';
    wrap.appendChild(h('div', { class: 'hint' }, hint));

    const tabs = h('div', { class: 'slot-tabs' });
    for (let i = 1; i <= st.group.slot_count; i++) {
      const pr = st.products.find(p => p.slot === i);
      tabs.appendChild(h('button', { class: ed.slot === i ? 'on' : '', onclick: async () => {
        S.slot = i; S.editor = editorFor(i); await takeLock(i); renderView();
      } }, i + '번 칸 ' + (pr ? (pr.status === 'listed' ? '(판매중)' : '(제작됨)') : '(비어 있음)')));
    }

    // 왼쪽: 미리보기
    const left = h('div', { class: 'panel col' });
    left.appendChild(tabs);
    const cv = h('canvas', { class: 'pixel' });
    P.drawShoe(cv, ed, st.materials, 10);
    left.appendChild(h('div', { class: 'preview' }, cv));
    if (lockOther) left.appendChild(h('div', { class: 'hint' }, lockOther.name + ' 학생이 이 신발을 고치는 중이에요.'));
    left.appendChild(h('div', {}, '모양'));
    left.appendChild(h('div', { class: 'row' }, P.SHAPES.map(s => h('button', {
      class: 'small ' + (ed.shape === s.id ? 'warn' : ''), onclick: () => { ed.shape = s.id; renderView(); }
    }, s.name))));
    ['body', 'lace'].forEach(k => {
      left.appendChild(h('div', {}, k === 'body' ? '몸체 색 (무료)' : '끈 색 (무료)'));
      left.appendChild(h('div', { class: 'swatches' }, P.PALETTE.map(c => h('button', {
        class: 'swatch ' + (ed.colors[k] === c.id ? 'on' : ''), title: c.name, style: { background: c.hex },
        onclick: () => { ed.colors[k] = c.id; renderView(); }
      }))));
    });
    const cp = costPreview(ed);
    left.appendChild(h('div', { class: 'cost-box' }, cp.text, h('div', { class: 'muted' }, '우리 지갑: ' + fmt(st.wallet) + '코인')));
    const pr = ed.original;
    const blocked = !editable || !!lockOther || (pr && pr.status === 'listed' && st.phase !== 8) || (st.phase === 8 && !pr);
    const saveLabel = st.phase === 8 ? '재료 바꾸기' : pr ? '수정 저장' : '신발 만들기';
    left.appendChild(h('button', { class: 'primary', disabled: blocked, onclick: saveShoe }, saveLabel));
    if (pr && pr.status === 'draft' && [1, 4].includes(st.phase)) {
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
      const row = h('div', { class: 'part-row' }, h('h4', {}, P.PART_LABEL[part]));
      const mats = h('div', { class: 'mats' });
      st.materials.filter(m => m.part === part).forEach(m => {
        const ok = unlocked(m);
        const tier = P.TIERS[m.tier];
        mats.appendChild(h('button', {
          class: 'mat ' + (ed.parts[part] === m.id ? 'on ' : '') + (ok ? '' : 'locked'),
          disabled: !ok,
          onclick: () => { if (!ok) return; ed.parts[part] = m.id; renderView(); }
        },
          h('span', { class: 'tier', style: { background: tier.color } }, tier.label),
          h('span', { class: 'nm' }, m.name),
          h('span', { class: 'price' }, m.price + '코인'),
          m.env !== null ? h('span', { class: 'envtag ' + envClass(m.env) }, envText(m.env)) : null,
          h('span', { class: 'desc' }, ok ? m.descr : (m.unlock === 'research' ? '신소재 연구 필요' : '친환경 소재 연구 필요'))));
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
    } catch (e) { toast(e.message, 'error'); }
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
    const panel = h('div', { class: 'panel', style: { marginTop: '14px' } },
      h('h3', { style: { margin: '0 0 8px' } }, '기업 투자 ', h('span', { class: 'muted', style: { fontSize: '15px' } }, S.me.is_leader ? '(모둠장만 누를 수 있어요)' : '(모둠장에게 부탁하세요)')));
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
      }, h('b', {}, it.name), h('span', {}, inv['cost_' + it.k] + '코인'),
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

  const TILE = 16, MAP_W = 24, MAP_H = 15;
  const HOUSES = [
    { gid: 1, x: 2, y: 1 }, { gid: 2, x: 9.5, y: 1 }, { gid: 3, x: 17, y: 1 },
    { gid: 4, x: 2, y: 9 }, { gid: 5, x: 9.5, y: 9 }, { gid: 6, x: 17, y: 9 }
  ];
  const HW = 5, HH = 4; // 집 크기(타일)
  const doorRect = hs => ({ x: (hs.x + 2) * TILE, y: (hs.y + 3) * TILE, w: TILE, h: TILE });
  const houseRect = hs => ({ x: hs.x * TILE, y: hs.y * TILE, w: HW * TILE, h: HH * TILE });
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function villageView() {
    const m = S.market;
    const wrap = h('div', {});
    if (!m) { wrap.appendChild(h('p', {}, '마을 불러오는 중...')); return wrap; }
    let hint;
    if (m.market_round) hint = m.voted ? '이번 시장에서는 구매를 마쳤어요. 다른 회사 로비 구경은 계속할 수 있어요.'
      : '방향키(또는 화면 십자 버튼)로 걸어가서 다른 회사 집의 문으로 들어가요. 마음에 드는 신발을 장바구니에 담고 마지막에 「구매 확정」!';
    else hint = '지금은 시장이 열려 있지 않아요. 다른 회사 로비를 구경할 수 있어요.';
    wrap.appendChild(h('div', { class: 'hint' }, hint));
    const cv = h('canvas', { class: 'village' });
    cv.width = MAP_W * TILE * 3; cv.height = MAP_H * TILE * 3;
    const vw = h('div', { class: 'village-wrap' }, cv);
    // 십자 버튼
    const dp = h('div', { class: 'dpad' });
    const mk = (label, dir, col, row) => {
      const b = h('button', { style: { gridColumn: col, gridRow: row } }, label);
      const on = e => { e.preventDefault(); keys[dir] = true; };
      const off = () => { keys[dir] = false; };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      return b;
    };
    dp.append(mk('▲', 'up', 2, 1), mk('◀', 'left', 1, 2), mk('▶', 'right', 3, 2), mk('▼', 'down', 2, 3));
    vw.appendChild(dp);
    if (m.fast_travel) {
      vw.appendChild(h('div', { class: 'fast' }, m.groups.filter(g => g.id !== m.my_group).map(g =>
        h('button', { class: 'small', onclick: () => enterHouse(g.id) }, '🏠 ' + (g.company_name || g.label)))));
    }
    wrap.appendChild(vw);
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * MAP_W * TILE, y = (e.clientY - r.top) / r.height * MAP_H * TILE;
      const hs = HOUSES.find(hs => overlap({ x, y, w: 1, h: 1 }, houseRect(hs)));
      if (!hs) return;
      if (hs.gid === m.my_group) return go('lobby');
      if (m.fast_travel) enterHouse(hs.gid);
      else toast('캐릭터를 움직여 집 문으로 들어가요!');
    });
    startLoop(cv);
    return wrap;
  }

  const keys = {};
  window.addEventListener('keydown', e => {
    const k = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' }[e.key];
    if (k && S.view === 'village') { keys[k] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    const k = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' }[e.key];
    if (k) keys[k] = false;
  });

  let loopId = null;
  function startLoop(cv) {
    cancelAnimationFrame(loopId);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (!S.player) S.player = { x: 11.5 * TILE, y: 6.5 * TILE, dir: 'down', step: 0 };
    const p = S.player;
    let entering = false;
    const tick = () => {
      if (S.view !== 'village' || !document.body.contains(cv)) return;
      const sp = 1.6;
      let dx = 0, dy = 0;
      if (keys.up) dy -= sp; if (keys.down) dy += sp; if (keys.left) dx -= sp; if (keys.right) dx += sp;
      if (dx || dy) {
        p.dir = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
        p.step += 1;
        const tryMove = (nx, ny) => {
          const box = { x: nx + 3, y: ny + 10, w: 10, h: 6 };
          if (nx < TILE || ny < TILE * 0.5 || nx > (MAP_W - 2) * TILE || ny > (MAP_H - 2) * TILE) return false;
          for (const hs of HOUSES) {
            const hr = houseRect(hs), dr = doorRect(hs);
            if (overlap(box, hr) && !overlap(box, dr)) return false;
          }
          return true;
        };
        if (tryMove(p.x + dx, p.y)) p.x += dx;
        if (tryMove(p.x, p.y + dy)) p.y += dy;
        if (!entering) {
          const box = { x: p.x + 3, y: p.y + 10, w: 10, h: 6 };
          const hs = HOUSES.find(hs => overlap(box, doorRect(hs)));
          if (hs) {
            entering = true;
            Object.keys(keys).forEach(k => keys[k] = false);
            if (hs.gid === S.market.my_group) { p.y += 14; go('lobby'); return; }
            enterHouse(hs.gid); return;
          }
        }
      }
      drawVillage(ctx, p);
      loopId = requestAnimationFrame(tick);
    };
    loopId = requestAnimationFrame(tick); // 화면에 붙은 뒤 시작
  }

  function drawVillage(ctx, p) {
    const sc = 3;
    ctx.save();
    ctx.scale(sc, sc);
    // 잔디
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#7EC77A' : '#78C174';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      if ((x * 7 + y * 3) % 5 === 0) { ctx.fillStyle = '#5FA85C'; ctx.fillRect(x * TILE + 5, y * TILE + 9, 2, 3); ctx.fillRect(x * TILE + 8, y * TILE + 8, 2, 4); }
    }
    // 길
    ctx.fillStyle = '#E5CF9A';
    ctx.fillRect(0, 6 * TILE, MAP_W * TILE, 2 * TILE);
    HOUSES.forEach(hs => { const d = doorRect(hs); const top = Math.min(d.y + TILE, 6 * TILE), bot = Math.max(d.y, 8 * TILE); ctx.fillRect(d.x, Math.min(top, d.y), TILE, Math.abs(bot - top) + TILE); });
    // 광장
    ctx.fillStyle = '#D9BE84'; ctx.fillRect(10 * TILE, 5.5 * TILE, 4 * TILE, 3 * TILE);
    ctx.fillStyle = '#6BB4E8'; ctx.fillRect(11.25 * TILE, 6.25 * TILE, 1.5 * TILE, 1.5 * TILE);
    // 나무 테두리
    for (let x = 0; x < MAP_W; x++) { tree(ctx, x * TILE, -6); tree(ctx, x * TILE, (MAP_H - 1) * TILE + 4); }
    for (let y = 1; y < MAP_H - 1; y++) { if (y !== 6 && y !== 7) { tree(ctx, -4, y * TILE); tree(ctx, (MAP_W - 1) * TILE + 4, y * TILE); } }
    // 집
    HOUSES.forEach(hs => drawHouse(ctx, hs));
    // 캐릭터
    P.drawAvatar(ctx, S.me.avatar || 'boy', p.x + 2, p.y, 1, p.dir, Math.floor(p.step / 8) % 2);
    ctx.font = '7px Jua, sans-serif'; ctx.textAlign = 'center';
    const nm = S.me.name;
    const tw = ctx.measureText(nm).width + 6;
    ctx.fillStyle = 'rgba(255,253,246,.92)'; ctx.fillRect(p.x + 8 - tw / 2, p.y - 11, tw, 9);
    ctx.fillStyle = '#1F2A24'; ctx.fillText(nm, p.x + 8, p.y - 4);
    ctx.restore();
  }

  function tree(ctx, x, y) {
    ctx.fillStyle = '#7A4E2D'; ctx.fillRect(x + 6, y + 9, 4, 6);
    ctx.fillStyle = '#2F7D3B'; ctx.fillRect(x + 2, y + 2, 12, 9);
    ctx.fillStyle = '#3E9A4C'; ctx.fillRect(x + 4, y, 8, 4); ctx.fillRect(x + 3, y + 3, 4, 3);
  }

  function drawHouse(ctx, hs) {
    const x = hs.x * TILE, y = hs.y * TILE, w = HW * TILE, hgt = HH * TILE;
    const g = S.market.groups.find(gg => gg.id === hs.gid) || {};
    const mine = hs.gid === S.market.my_group;
    // 지붕
    ctx.fillStyle = mine ? '#3B7DDD' : '#C9503C';
    ctx.beginPath(); ctx.moveTo(x - 4, y + 22); ctx.lineTo(x + w / 2, y - 2); ctx.lineTo(x + w + 4, y + 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(x - 2, y + 19, w + 4, 3);
    // 벽
    ctx.fillStyle = '#F3E6C8'; ctx.fillRect(x, y + 22, w, hgt - 22);
    ctx.strokeStyle = '#2B3A30'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + 22.5, w - 1, hgt - 23);
    // 창문
    ctx.fillStyle = '#8FD3F4'; ctx.fillRect(x + 6, y + 30, 12, 10); ctx.fillRect(x + w - 18, y + 30, 12, 10);
    ctx.strokeRect(x + 6.5, y + 30.5, 11, 9); ctx.strokeRect(x + w - 17.5, y + 30.5, 11, 9);
    // 문
    const d = doorRect(hs);
    ctx.fillStyle = '#8A5A33'; ctx.fillRect(d.x + 2, d.y - 6, TILE - 4, TILE + 6);
    ctx.fillStyle = '#F2C230'; ctx.fillRect(d.x + TILE - 6, d.y + 3, 2, 2);
    // 간판
    const label = (g.company_name || g.label || (hs.gid + '모둠')) + (mine ? ' (우리)' : '');
    ctx.font = '7px Jua, sans-serif'; ctx.textAlign = 'center';
    const tw = Math.min(ctx.measureText(label).width + 8, w + 20);
    ctx.fillStyle = '#FFFDF6'; ctx.fillRect(x + w / 2 - tw / 2, y + 22, tw, 9);
    ctx.strokeRect(x + w / 2 - tw / 2 + .5, y + 22.5, tw - 1, 8);
    ctx.fillStyle = '#1F2A24'; ctx.fillText(label, x + w / 2, y + 29, w + 16);
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
    wrap.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('button', { onclick: () => {
        const hs = HOUSES.find(x => x.gid === S.houseId);
        if (S.player && hs) { S.player.x = (hs.x + 2) * TILE; S.player.y = (hs.y + HH) * TILE + 6; S.player.dir = 'down'; }
        S.view = 'village'; renderShell();
      } }, '← 마을로 나가기'),
      h('span', { class: 'hint', style: { margin: 0 } }, canBuy ? '신발을 누르면 장바구니에 담을 수 있어요.' : '구경만 할 수 있어요.')));
    wrap.appendChild(lobbyBox(g, g.products, m.materials, { drag: false, onShoe: pr => shoeModal(g, pr) }));
    return wrap;
  }

  function shoeModal(g, pr) {
    const m = S.market;
    const cv = h('canvas', { class: 'pixel', style: { width: '100%', maxWidth: '360px' } });
    P.drawShoe(cv, pr, m.materials, 10);
    const lines = ['sole', 'body', 'insole', 'lace'].map(k => {
      const mt = P.matOf(m.materials, pr.parts[k]);
      return h('div', {}, P.PART_LABEL[k] + ': ', mt ? mt.name : '-', mt ? h('span', { class: 'muted' }, ' (' + P.TIERS[mt.tier].label + ')') : null);
    });
    const body = h('div', { class: 'col center' },
      h('h3', { style: { margin: 0 } }, (g.company_name || g.label) + ' · ' + pr.slot + '번 신발'),
      pr.stars ? h('div', { class: 'stars', style: { fontSize: '20px' } }, '★'.repeat(pr.stars) + ' 친환경 인증') : null,
      cv, h('div', { style: { textAlign: 'left' } }, lines));
    let dlg;
    if (m.market_round && !m.voted) {
      const cart = getCart();
      const inCart = (cart[pr.id] || {}).qty || 0;
      const check = canAdd(cart, g.id);
      body.appendChild(h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'primary', disabled: !check.ok, onclick: () => { addCart(g, pr, 1); dlg.close(); toast('장바구니에 담았어요!'); } }, '장바구니에 담기 (+1표)'),
        inCart ? h('button', { onclick: () => { addCart(g, pr, -1); dlg.close(); } }, '하나 빼기') : null));
      if (!check.ok) body.appendChild(h('div', { class: 'muted' }, check.why));
      if (inCart) body.appendChild(h('div', {}, '지금 장바구니에 ' + inCart + '표 담겨 있어요.'));
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
      box.appendChild(h('h4', {}, '🛒 구매 완료!'));
      box.appendChild(h('div', { class: 'muted' }, '이번 시장 구매를 확정했어요.'));
      document.body.appendChild(box); return;
    }
    const c = getCart();
    box.appendChild(h('h4', {}, '🛒 장바구니 ', h('span', { class: 'muted' }, '남은 표 ' + (m.votes_total - cartTotal(c)) + ' / ' + m.votes_total)));
    Object.entries(c).forEach(([pid, x]) => {
      box.appendChild(h('div', { class: 'item' },
        h('img', { src: P.shoeDataUrl(x.shoe, m.materials, 2), alt: '' }),
        h('span', { class: 'grow' }, x.name + ' × ' + x.qty),
        h('button', { class: 'small', onclick: () => { const cc = getCart(); cc[pid].qty -= 1; if (cc[pid].qty <= 0) delete cc[pid]; setCart(cc); renderCart(); } }, '−')));
    });
    if (!Object.keys(c).length) box.appendChild(h('div', { class: 'muted' }, '마음에 드는 신발을 담아 보세요.'));
    box.appendChild(h('button', { class: 'primary', style: { width: '100%', marginTop: '6px' }, disabled: !cartTotal(c), onclick: async e => {
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
    const body = h('div', { class: 'col' }, h('h2', { style: { margin: 0 } }, '📋 우리 기업 성적표'));
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
      body.appendChild(h('div', {}, '🌏 지구 게이지: ' + r.gauge + '%'));
      if (r.detail && r.detail.length) {
        body.appendChild(h('h3', { style: { margin: '8px 0 0' } }, '신발별 환경 영향'));
        body.appendChild(h('table', { class: 't' }, h('tr', {}, h('th', {}, '차수'), h('th', {}, '신발'), h('th', {}, '팔린 수'), h('th', {}, '한 켤레'), h('th', {}, '합계')),
          r.detail.map(d => h('tr', {},
            h('td', {}, d.round + '차'),
            h('td', {}, h('img', { class: 'pixel', style: { width: '64px' }, src: P.shoeDataUrl(d, S.st.materials, 2), alt: '' })),
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
      h('h2', {}, '🚨 지구 서버 긴급 경보 🚨'),
      h('p', { style: { fontSize: '22px', maxWidth: '760px' } }, '우주 운영진입니다. 그동안 숨겨져 있던 「환경점수」를 공개합니다. 여러분 기업의 신발이 지구 서버에 어떤 영향을 주었는지 확인하세요.'),
      h('div', { class: 'big-gauge' }, bar),
      h('div', { style: { fontSize: '26px' } }, '지구 게이지 ', h('b', { id: 'alarm-g' }, '100%')),
      r ? h('div', { style: { fontSize: '22px', marginTop: '8px' } }, '우리 기업 환경 점수: ' + envText(r.env)) : null,
      h('button', { class: 'warn', style: { marginTop: '18px', fontSize: '22px' }, onclick: () => { ov.remove(); showReport(); } }, '성적표 확인하기'));
    document.body.appendChild(ov);
    const target = r ? r.gauge : 50;
    setTimeout(() => { bar.style.width = target + '%'; bar.style.background = target >= 60 ? '#6FD08C' : target >= 40 ? '#F2C230' : '#E05A4F'; }, 600);
    let v = 100; const t = setInterval(() => { v = Math.max(target, v - 1.5); const el = document.getElementById('alarm-g'); if (el) el.textContent = Math.round(v) + '%'; if (v <= target) clearInterval(t); }, 40);
  }

  async function showFinal() {
    let r = null;
    try { r = await rpc('report'); } catch (e) { return; }
    const ok = r.common_bonus > 0;
    const ov = h('div', { class: 'alarm', style: { background: ok ? 'rgba(20,110,60,.92)' : 'rgba(40,60,90,.92)', animation: 'none' } },
      h('h2', {}, ok ? '🌏 지구 서버가 회복되었습니다!' : '🌏 최종 결과 발표'),
      h('p', { style: { fontSize: '22px', maxWidth: '760px' } }, ok
        ? '기업들의 친환경 경영과 시민들의 노력이 함께 지구 서버를 살렸어요. 모든 기업에 공동 보너스가 지급됩니다!'
        : '지구 서버는 아직 회복 중이에요. 기업의 선택이 지구에 어떤 영향을 주는지 다시 생각해 봐요.'),
      h('div', { style: { fontSize: '26px' } }, '지구 게이지 ' + r.gauge + '%'),
      h('button', { class: 'warn', style: { marginTop: '18px', fontSize: '22px' }, onclick: () => { ov.remove(); showReport(); } }, '최종 성적표 보기'));
    document.body.appendChild(ov);
  }

  async function showPrinciple() {
    let mine = {};
    try { mine = await rpc('my_principles'); } catch (e) { /* 무시 */ }
    const personal = h('textarea', { maxlength: '300', placeholder: '기업이 사회적 책임을 다해야 하는 까닭은 ...' }, mine.personal || '');
    const company = h('textarea', { maxlength: '300', placeholder: '우리 기업은 ... 을(를) 지키며 신발을 만들겠습니다.' }, mine.company || '');
    const body = h('div', { class: 'col' },
      h('h2', { style: { margin: 0 } }, '✍ 경영 원칙'),
      h('div', {}, '나의 한 문장: 기업이 사회적 책임을 다해야 하는 까닭'),
      personal,
      h('button', { class: 'primary', onclick: async () => {
        try { await rpc('principle_submit', { p_kind: 'personal', p_text: personal.value }); toast('저장했어요!'); } catch (e) { toast(e.message, 'error'); }
      } }, '내 문장 저장'));
    body.appendChild(h('div', { style: { marginTop: '10px' } }, '우리 기업의 경영 원칙 ' + (S.me.is_leader ? '(모둠장이 등록)' : '(모둠장이 등록해요)')));
    body.appendChild(company);
    if (S.me.is_leader) body.appendChild(h('button', { class: 'primary', onclick: async () => {
      try { await rpc('principle_submit', { p_kind: 'company', p_text: company.value }); toast('기업 원칙을 등록했어요!'); } catch (e) { toast(e.message, 'error'); }
    } }, '기업 원칙 등록'));
    else company.disabled = true;
    modal(body);
  }

  start();
})();
