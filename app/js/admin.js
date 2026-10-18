// 교사 관제실
(function () {
  const { rpc, ensureSession, subscribe, PHASES } = window.API;
  const { $, h, toast, modal, envText, envClass, fmt, debounce, groupColor } = window.UI;
  const P = window.Pixel;
  const root = document.getElementById('app');
  const A = { st: null, tab: 'progress', group: 1, timer: null };

  const NEXT = {
    1: { title: '1차 제작 시작', desc: '학생들이 신발 2켤레를 만들 수 있어요.' },
    2: { title: '1차 시장 열기', desc: '지금 만든 신발이 판매대에 올라가요. 시장이 열리면 그 신발은 고칠 수 없어요.' },
    3: { title: '1차 시장 닫고 정산', desc: '판매 수입을 지급해요. 구매를 안 한 학생은 표를 잃어요.' },
    4: { title: '2차 경영 시작', desc: '연구·공장 확장·새 신발 제작이 열려요.' },
    5: { title: '2차 시장 열기', desc: '신발이 판매대에 올라가요.' },
    6: { title: '2차 시장 닫기 (정산 잠금)', desc: '판매 수입은 지급하지만 환경점수와 성적표는 아직 숨겨요. 화요일 수업은 여기서 끝내요.' },
    7: { title: '🚨 환경점수 공개', desc: '학생 화면에 긴급 경보가 뜨고, 모든 기업에 환경 전환 지원금이 지급돼요. (공개수업 도입)' },
    8: { title: '3차 경영 시작', desc: '재료 교체, 친환경 연구, 정화장치가 열려요.' },
    9: { title: '3차 시장 열기', desc: '친환경 별(★)이 표시된 마지막 시장이에요.' },
    10: { title: '최종 정산', desc: '최종 점수와 지구 게이지를 발표해요.' },
    11: { title: '경영 원칙 쓰기', desc: '모둠 원칙과 개인 한 문장을 받아요.' }
  };

  async function start() {
    root.innerHTML = '';
    try { await ensureSession(); } catch (e) { root.appendChild(h('p', { class: 'bad' }, e.message)); return; }
    const c = await rpc('admin_check').catch(() => ({ admin: false }));
    if (c.admin) return dashboard();
    const pw = h('input', { type: 'password', placeholder: '비밀번호', inputmode: 'numeric' });
    const btn = h('button', { class: 'primary', onclick: login }, '들어가기');
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    root.appendChild(h('div', { class: 'entry' }, h('h1', {}, '우주 운영진 관제실'), h('p', { class: 'sub' }, '교사 비밀번호를 입력해 주세요'),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, pw, btn),
      h('p', {}, h('a', { href: 'index.html' }, '← 학생 화면으로'))));
    pw.focus();
    async function login() {
      btn.disabled = true;
      try { await rpc('admin_login', { p_pw: pw.value }); dashboard(); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    }
  }

  async function dashboard() {
    await load();
    subscribe({ game: () => loadSoon(), tick: () => loadSoon(), notice: n => toast('[공지] ' + n.message) });
    A.timer = setInterval(load, 5000);
  }
  const loadSoon = debounce(() => load(), 400);

  async function load() {
    try { A.st = await rpc('admin_state'); }
    catch (e) { if (e.code === 'NOT_ADMIN') { clearInterval(A.timer); start(); } return; }
    const ae = document.activeElement;
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) && root.contains(ae)) { renderHeader(); return; }
    if (document.querySelector('.modal-back')) { renderHeader(); return; }
    render();
  }

  async function act(fn, args, okMsg) {
    try { const r = await rpc(fn, args); if (okMsg) toast(okMsg); await load(); return r; }
    catch (e) { toast(e.message, 'error'); return null; }
  }

  function render() {
    const y = window.scrollY;
    root.innerHTML = '';
    root.appendChild(h('div', { id: 'adminHeader', class: 'topbar' }));
    const tabs = [['progress', '진행'], ['groups', '모둠'], ['sales', '판매'], ['events', '시장 개입'], ['roster', '명단·연결'], ['backup', '백업·복구']];
    root.appendChild(h('div', { class: 'nav' }, tabs.map(([k, l]) => h('button', { class: A.tab === k ? 'on' : '', onclick: () => { A.tab = k; render(); } }, l)),
      h('a', { href: 'board.html', target: '_blank', style: { alignSelf: 'center', marginLeft: 'auto' } }, '전자칠판 화면 열기 ↗')));
    const page = h('div', { class: 'page' });
    root.appendChild(page);
    renderHeader();
    ({ progress: tabProgress, groups: tabGroups, sales: tabSales, events: tabEvents, roster: tabRoster, backup: tabBackup })[A.tab](page);
    window.scrollTo(0, y);
  }

  function renderHeader() {
    const st = A.st, bar = $('#adminHeader');
    if (!bar) return;
    const g = st.game;
    const joined = st.students.filter(s => s.bound).length;
    const online = st.students.filter(s => s.online).length;
    bar.innerHTML = '';
    bar.append(...[h('span', { class: 'company' }, '관제실'),
      h('span', { class: 'stat' }, '단계', h('b', {}, g.phase + '. ' + PHASES[g.phase].name)),
      h('span', { class: 'stat' }, '입장', h('b', {}, joined + '/' + st.students.length)),
      h('span', { class: 'stat' }, '접속 중', h('b', {}, online)),
      h('span', { class: 'stat' }, '지구 게이지', h('b', {}, st.gauge + '%'), g.env_revealed ? '' : ' (학생에겐 ???)'),
      st.market_round ? h('span', { class: 'stat' }, '구매 확정', h('b', {}, st.students.filter(s => s.voted).length + '/' + joined)) : null,
      st.pairings.length ? h('span', { class: 'phase', style: { background: '#E05A4F', color: '#fff' } }, '연결 승인 대기 ' + st.pairings.length) : null].filter(Boolean));
  }

  // ------------------------------------------------------------------
  function tabProgress(page) {
    const st = A.st, ph = st.game.phase;
    const nx = NEXT[ph + 1];
    const warn = [];
    if (ph + 1 === 2 || ph + 1 === 5) st.groups.forEach(g => { if (!g.products.length) warn.push(g.label + '에 신발이 없어요.'); });
    if (st.market_round) {
      const notVoted = st.students.filter(s => s.bound && !s.voted);
      if (notVoted.length) warn.push('아직 구매 확정 안 한 학생 ' + notVoted.length + '명: ' + notVoted.map(s => s.name).join(', '));
    }
    const box = h('div', { class: 'panel col' });
    box.appendChild(h('h2', { style: { margin: 0 } }, '지금: ' + ph + '. ' + PHASES[ph].name));
    if (nx) {
      box.appendChild(h('div', { class: 'hint' }, h('b', {}, '다음 → ' + (ph + 1) + '. ' + nx.title), h('div', {}, nx.desc)));
      warn.forEach(w => box.appendChild(h('div', { class: 'bad' }, '⚠ ' + w)));
      box.appendChild(h('button', { class: 'primary', style: { fontSize: '22px', padding: '12px' }, onclick: async () => {
        if (!confirm('「' + nx.title + '」(으)로 넘어갈까요?\n' + nx.desc + (warn.length ? '\n\n⚠ ' + warn.join('\n⚠ ') : ''))) return;
        await act('admin_set_phase', { p_target: ph + 1 }, nx.title + ' 완료');
      } }, '▶ ' + nx.title));
    } else box.appendChild(h('div', {}, '마지막 단계예요.'));
    page.appendChild(box);

    const list = h('div', { class: 'panel', style: { marginTop: '12px' } }, h('h3', { style: { marginTop: 0 } }, '전체 흐름'));
    PHASES.forEach(p => list.appendChild(h('div', { style: { padding: '3px 0', opacity: p.n < ph ? .5 : 1, fontWeight: p.n === ph ? 'bold' : 'normal' } },
      (p.n === ph ? '👉 ' : p.n < ph ? '✔ ' : '　 ') + p.n + '. ' + p.name + ' — ' + p.desc + (p.n === 6 ? '  [화요일 끝]' : p.n === 7 ? '  [공개수업 시작]' : ''))));
    page.appendChild(list);

    const flags = h('div', { class: 'panel row', style: { marginTop: '12px' } },
      h('label', {}, h('input', { type: 'checkbox', checked: st.game.fast_travel, onchange: e => act('admin_flags', { p: { fast_travel: e.target.checked } }, e.target.checked ? '빠른 이동 켬' : '빠른 이동 끔') }), ' 마을 빠른 이동 (집 목록 버튼)'),
      h('label', {}, h('input', { type: 'checkbox', checked: st.game.require_approval, onchange: e => act('admin_flags', { p: { require_approval: e.target.checked } }, e.target.checked ? '새 기기 승인 모드 켬' : '승인 모드 끔') }), ' 새 기기 연결 시 교사 승인'));
    page.appendChild(flags);

    // 요약 표
    const t = h('table', { class: 't', style: { marginTop: '12px', background: '#fff' } },
      h('tr', {}, h('th', {}, '모둠'), h('th', {}, '기업'), h('th', {}, '지갑'), h('th', {}, '경영 성과'), h('th', {}, '환경'), h('th', {}, '친환경 보너스'), h('th', {}, '종합점수'), h('th', {}, '투자')),
      st.groups.map(g => h('tr', {}, h('td', {}, g.label), h('td', {}, g.company_name || '-'), h('td', {}, fmt(g.wallet)), h('td', {}, fmt(g.perf)),
        h('td', { class: envClass(g.env) }, envText(g.env)), h('td', {}, g.eco_bonus), h('td', {}, h('b', {}, fmt(g.score))),
        h('td', {}, [g.has_research && '연구', g.has_factory && '공장', g.has_eco_research && '친환경연구', g.has_purifier && '정화'].filter(Boolean).join(', ')))));
    page.appendChild(t);
  }

  // ------------------------------------------------------------------
  function tabGroups(page) {
    const st = A.st;
    page.appendChild(h('div', { class: 'row', style: { marginBottom: '10px' } }, st.groups.map(g =>
      h('button', { class: A.group === g.id ? 'warn' : '', style: { borderLeft: '10px solid ' + groupColor(g.id) }, onclick: () => { A.group = g.id; render(); } }, g.label + (g.company_name ? ' · ' + g.company_name : '')))));
    const g = st.groups.find(x => x.id === A.group);
    const studs = st.students.filter(s => s.group_id === g.id);
    const lobbyFrame = h('div', { class: 'lobby-frame', style: { '--gc': groupColor(g.id) } },
      h('div', { class: 'logo-band', style: { height: '90px' } }, g.logo_url ? h('img', { src: g.logo_url, alt: '', style: { maxHeight: '70px' } }) : h('div', { class: 'logo-text', style: { fontSize: '30px' } }, g.company_name || g.label)));
    const lobby = h('div', { class: 'lobby ' + (g.bg_url ? '' : 'bg-' + (g.bg_preset || 0)) });
    if (g.bg_url) lobby.style.backgroundImage = `url("${g.bg_url}")`;
    lobby.appendChild(h('div', { class: 'name-tag' }, g.company_name || g.label));
    lobbyFrame.appendChild(lobby);
    const stands = (Array.isArray(g.stands) && g.stands.length ? g.stands : []);
    for (let i = 1; i <= g.slot_count; i++) {
      const sp = stands.find(s => s.slot === i) || { x: Math.round(100 / (g.slot_count + 1) * i), y: 68 };
      const pr = g.products.find(p => p.slot === i);
      const el = h('div', { class: 'stand static', style: { left: sp.x + '%', top: sp.y + '%' } });
      if (pr) el.append(P.shoeArt(pr, st.materials, 'shoe'), h('div', { class: 'pedestal' }),
        h('div', { class: 'tag' }, i + '번 · ', h('span', { class: envClass(pr.env) }, envText(pr.env))));
      else el.append(h('div', { class: 'empty' }, i + '번 빈 칸'), h('div', { class: 'pedestal' }));
      lobby.appendChild(el);
    }
    const label = h('input', { type: 'text', value: g.label, style: { width: '120px' } });
    page.appendChild(h('div', { class: 'workshop' },
      h('div', { class: 'panel col' },
        h('div', { class: 'row' }, '모둠 이름:', label, h('button', { class: 'small', onclick: () => act('admin_set_label', { p_group: g.id, p_label: label.value }, '저장') }, '저장')),
        h('div', {}, '지갑 ', h('b', {}, fmt(g.wallet)), ' · 경영 성과 ', fmt(g.perf), ' · ', h('span', { class: envClass(g.env) }, envText(g.env)), ' · 종합 ', h('b', {}, fmt(g.score))),
        h('h3', { style: { margin: '6px 0 0' } }, '학생'),
        h('table', { class: 't' }, studs.map(s => h('tr', {},
          h('td', {}, (s.online ? '🟢 ' : s.bound ? '⚪ ' : '— ') + (s.no ? s.no + '번 ' : '') + s.name + (s.is_leader ? ' 👑' : '')),
          h('td', {}, s.voted === null ? '' : s.voted ? '✔ 구매' : '구매 전'),
          h('td', {}, h('button', { class: 'small', onclick: () => act('admin_set_leader', { p_student: s.id, p_on: !s.is_leader }, s.is_leader ? '모둠장 해제' : '모둠장 지정') }, s.is_leader ? '모둠장 해제' : '모둠장'),
            ' ', s.bound ? h('button', { class: 'small', onclick: () => { if (confirm(s.name + ' 학생의 기기 연결을 풀까요?')) act('admin_reset_binding', { p_student: s.id }, '초기화했어요'); } }, '연결 초기화') : null)))),
        g.company_principle ? h('div', { class: 'hint' }, '기업 원칙: ' + g.company_principle) : null),
      h('div', { class: 'col' }, lobbyFrame,
        h('div', { class: 'panel' }, h('h3', { style: { marginTop: 0 } }, '신발'),
          g.products.length ? h('table', { class: 't' }, g.products.map(p => h('tr', {},
            h('td', {}, h('img', { style: { width: '90px' }, src: P.shoeDataUrl(p, st.materials) })),
            h('td', {}, p.slot + '번 · ' + (p.status === 'listed' ? '판매중' : '제작됨') + (p.locked_by ? ' · ✏ ' + p.locked_by + ' 수정 중' : '')),
            h('td', {}, ['sole', 'body', 'insole', 'lace'].map(k => { const m = P.matOf(st.materials, p.parts[k]); return m ? h('div', { style: { fontSize: '13px' } }, m.name) : null; })),
            h('td', { class: envClass(p.env) }, envText(p.env))))) : h('p', { class: 'muted' }, '아직 없어요.')))));
    // 학생 개인 문장
    const pers = studs.filter(s => s.personal);
    if (pers.length) page.appendChild(h('div', { class: 'panel', style: { marginTop: '12px' } }, h('h3', { style: { marginTop: 0 } }, '개인 한 문장'),
      pers.map(s => h('div', {}, h('b', {}, s.name + ': '), s.personal))));
  }

  // ------------------------------------------------------------------
  function tabSales(page) {
    const st = A.st;
    [1, 2, 3].forEach(r => {
      const rows = st.sales.filter(s => s.round === r);
      if (!rows.length) return;
      const settled = st.settled.includes(r);
      page.appendChild(h('h3', {}, r + '차 시장 ' + (settled ? '(정산 완료)' : '(진행 중)')));
      page.appendChild(h('table', { class: 't', style: { background: '#fff' } },
        h('tr', {}, h('th', {}, '모둠'), h('th', {}, '신발'), h('th', {}, '학생 표'), h('th', {}, '이벤트 주문'), h('th', {}, '환경'), h('th', {}, '환경 합계')),
        rows.map(s => {
          const g = st.groups.find(x => x.id === s.group_id);
          const total = s.student_votes + s.event_votes;
          return h('tr', {}, h('td', {}, g.label + (g.company_name ? ' · ' + g.company_name : '')),
            h('td', {}, h('img', { style: { width: '80px' }, src: P.shoeDataUrl(s, st.materials) }), ' ' + s.slot + '번'),
            h('td', {}, h('b', {}, s.student_votes)), h('td', {}, s.event_votes),
            h('td', { class: envClass(s.env) }, envText(s.env)), h('td', { class: envClass(s.env * total) }, envText(s.env * total)));
        })));
    });
    if (st.market_round) {
      const nv = st.students.filter(s => s.bound && !s.voted);
      page.appendChild(h('div', { class: 'hint' }, '구매 확정 안 한 학생: ' + (nv.length ? nv.map(s => s.group_id + '모둠 ' + s.name).join(', ') : '없음')));
    }
    if (!st.sales.length) page.appendChild(h('p', { class: 'muted' }, '아직 열린 시장이 없어요.'));
  }

  // ------------------------------------------------------------------
  function productPicker() {
    const st = A.st;
    const sel = h('select', {});
    const rows = st.sales.filter(s => s.round === st.market_round);
    if (!rows.length) sel.appendChild(h('option', { value: '' }, '(시장이 열려 있지 않아요)'));
    rows.forEach(s => {
      const g = st.groups.find(x => x.id === s.group_id);
      const stars = s.env >= 5 ? ' ★★' : s.env >= 1 ? ' ★' : '';
      sel.appendChild(h('option', { value: s.product_id }, g.label + (g.company_name ? '(' + g.company_name + ')' : '') + ' ' + s.slot + '번 신발' + stars + ' · ' + envText(s.env)));
    });
    return sel;
  }

  function tabEvents(page) {
    const st = A.st;
    page.appendChild(h('div', { class: 'hint' }, '이벤트 주문은 학생 화면에 「시장 소식」으로만 보이고, 내부에는 학생 표와 따로 기록돼요. 정산 전에는 취소할 수 있어요.'));
    const presets = [
      { kind: 'luxury', name: '명품 열풍', qty: 5, msg: p => '고급 신발에 관심이 몰리고 있습니다! ' + p + '에 주문이 쏟아져요!' },
      { kind: 'practical', name: '실용 신발 인기', qty: 8, msg: p => '저렴하고 튼튼한 신발을 찾는 소비자가 늘었습니다! ' + p + '이(가) 인기예요!' },
      { kind: 'ai_order', name: 'AI 소비자 주문', qty: null, msg: p => 'AI 소비자들이 ' + p + '을(를) 구매했습니다!' }
    ];
    const box = h('div', { class: 'panel col' }, h('h3', { style: { margin: 0 } }, '가상 주문'));
    const pick = productPicker();
    const qty = h('input', { type: 'number', value: '3', min: '1', max: '30', style: { width: '80px' } });
    box.appendChild(h('div', { class: 'row' }, '신발:', pick, '수량(AI 주문):', qty));
    box.appendChild(h('div', { class: 'row' }, presets.map(p => h('button', { disabled: !st.market_round, onclick: () => {
      const pid = Number(pick.value); if (!pid) return;
      const label = pick.options[pick.selectedIndex].text.split(' · ')[0];
      const q = p.qty || Number(qty.value);
      if (!confirm(p.name + ': ' + label + '에 주문 ' + q + '건을 넣을까요?')) return;
      act('admin_event', { p_kind: p.kind, p_product: pid, p_qty: q, p_gauge: 0, p_message: p.msg(label) }, p.name + ' 실행');
    } }, p.name + (p.qty ? ' (+' + p.qty + ')' : '')))));
    page.appendChild(box);

    const gbox = h('div', { class: 'panel col', style: { marginTop: '12px' } }, h('h3', { style: { margin: 0 } }, '시민 친환경 운동 (지구 게이지 회복)'));
    const gd = h('input', { type: 'number', value: '15', style: { width: '80px' } });
    gbox.appendChild(h('div', { class: 'row' }, '게이지 +', gd, '%p',
      h('button', { class: 'primary', onclick: () => {
        if (!confirm('지구 게이지를 ' + gd.value + '%p 올릴까요?')) return;
        act('admin_event', { p_kind: 'citizen', p_product: null, p_qty: 0, p_gauge: Number(gd.value), p_message: '지구 서버 곳곳에서 시민들의 친환경 소비와 정화 활동이 퍼지고 있습니다!' }, '시민 운동 실행');
      } }, '시민 운동 실행')));
    gbox.appendChild(h('div', { class: 'muted' }, '지금 게이지 ' + st.gauge + '% (이벤트 보정 ' + st.gauge_adj + '%p) · 최종 정산 때 ' + st.settings.gauge_threshold + '% 이상이면 공동 보너스'));
    page.appendChild(gbox);

    const nbox = h('div', { class: 'panel col', style: { marginTop: '12px' } }, h('h3', { style: { margin: 0 } }, '공지 · 지원금'));
    const msg = h('input', { type: 'text', placeholder: '학생 화면에 띄울 공지', style: { flex: 1 } });
    nbox.appendChild(h('div', { class: 'row' }, msg, h('button', { onclick: () => msg.value && act('admin_notice', { p_message: msg.value }, '공지 보냄') }, '공지 보내기')));
    const gsel = h('select', {}, h('option', { value: '' }, '전체 모둠'), st.groups.map(g => h('option', { value: g.id }, g.label)));
    const amt = h('input', { type: 'number', value: '300', style: { width: '90px' } });
    const why = h('input', { type: 'text', placeholder: '사유 (예: 판매 저조 지원)' });
    nbox.appendChild(h('div', { class: 'row' }, gsel, amt, '코인', why, h('button', { onclick: () => {
      if (!why.value) return toast('사유를 적어 주세요.', 'error');
      act('admin_grant', { p_group: gsel.value ? Number(gsel.value) : null, p_amount: Number(amt.value), p_reason: why.value }, '지원금 지급');
    } }, '지원금 지급')));
    nbox.appendChild(h('div', { class: 'muted' }, '지원금은 지갑에만 들어가고 경영 성과(성적표)에는 포함되지 않아요.'));
    page.appendChild(nbox);

    page.appendChild(h('h3', {}, '이벤트 기록'));
    page.appendChild(h('table', { class: 't', style: { background: '#fff' } },
      h('tr', {}, h('th', {}, '#'), h('th', {}, '종류'), h('th', {}, '차수'), h('th', {}, '주문'), h('th', {}, '게이지'), h('th', {}, '메시지'), h('th', {}, '')),
      st.events.map(e => h('tr', { style: { opacity: e.status === 'active' ? 1 : .45 } },
        h('td', {}, e.id), h('td', {}, e.kind), h('td', {}, e.round || '-'), h('td', {}, e.qty || ''), h('td', {}, Number(e.gauge_delta) || ''),
        h('td', {}, e.message || ''), h('td', {}, e.status === 'active' ? h('button', { class: 'small', onclick: () => confirm('이 이벤트를 취소할까요?') && act('admin_undo_event', { p_event: e.id }, '취소했어요') }, '취소') : '취소됨')))));
  }

  async function approveGroup(gid) {
    const r = await act('admin_approve_group', { p_group: gid });
    if (r) toast((gid ? gid + '모둠 ' : '전체 ') + r.approved + '명 승인' + (r.skipped ? ' · 중복 ' + r.skipped + '건은 직접 골라 주세요' : ''));
  }

  // ------------------------------------------------------------------
  function tabRoster(page) {
    const st = A.st;
    if (st.pairings.length) {
      const box = h('div', { class: 'panel', style: { marginBottom: '14px' } },
        h('div', { class: 'panel-title' }, '연결 승인 대기 ' + st.pairings.length + '명',
          h('button', { class: 'primary', onclick: () => approveGroup(null) }, '전체 일괄 승인')),
        h('div', { class: 'muted', style: { marginBottom: '8px' } }, '각 모둠 학생이 자기 이름을 골랐는지 눈으로 확인한 뒤 모둠별로 승인하세요. 한 이름에 요청이 두 개 이상이면 일괄 승인에서 빠지니 직접 골라 주세요.'));
      const groups = [...new Set(st.pairings.map(p => p.group_id))].sort((a, b) => a - b);
      groups.forEach(gid => {
        const list = st.pairings.filter(p => p.group_id === gid);
        const dup = name => list.filter(x => x.student_id === name).length > 1;
        box.appendChild(h('div', { style: { borderTop: '2px dashed #EADFC9', padding: '8px 0' } },
          h('div', { class: 'row', style: { marginBottom: '6px' } }, h('b', { style: { fontFamily: 'var(--font-display)', fontSize: '18px', color: groupColor(gid) } }, gid + '모둠'),
            h('button', { class: 'small primary', onclick: () => approveGroup(gid) }, gid + '모둠 일괄 승인')),
          h('div', { class: 'row' }, list.map(p => h('span', { class: 'row', style: { gap: '4px', background: dup(p.student_id) ? '#FFE1E6' : '#F6EBD6', borderRadius: '999px', padding: '3px 6px 3px 12px' } },
            p.name + (dup(p.student_id) ? ' (중복!)' : ''),
            h('button', { class: 'small primary', onclick: () => act('admin_approve', { p_request: p.id }, p.name + ' 승인') }, '승인'),
            h('button', { class: 'small', onclick: () => act('admin_reject', { p_request: p.id }, '거절') }, '거절'))))));
      });
      page.appendChild(box);
    }
    const ta = h('textarea', { style: { minHeight: '260px', fontFamily: 'monospace' }, placeholder: '모둠,번호,이름\n1,1,김민준\n1,2,이서연\n...' },
      st.students.map(s => s.group_id + ',' + (s.no || '') + ',' + s.name).join('\n'));
    page.appendChild(h('div', { class: 'panel col' },
      h('h3', { style: { margin: 0 } }, '학생 명단 (한 줄에 한 명: 모둠,번호,이름)'),
      h('div', { class: 'muted' }, '엑셀에서 세 칸(모둠·번호·이름)을 복사해 붙여넣어도 돼요. 저장하면 기존 명단과 기기 연결이 모두 바뀌어요. (1차 시장 전까지만)'),
      ta,
      h('button', { class: 'primary', onclick: () => {
        const rows = ta.value.split(/\r?\n/).map(l => l.split(/[,\t]/).map(x => x.trim())).filter(c => c.length >= 3 && c[2])
          .map(c => ({ group: Number(c[0]), no: c[1], name: c[2] }));
        if (!rows.length) return toast('명단이 비어 있어요.', 'error');
        if (!confirm(rows.length + '명으로 명단을 바꿀까요? 기존 기기 연결은 모두 풀려요.')) return;
        act('admin_roster_import', { p_rows: rows }, rows.length + '명 등록');
      } }, '명단 저장')));
  }

  // ------------------------------------------------------------------
  function tabBackup(page) {
    const st = A.st;
    page.appendChild(h('div', { class: 'panel col' },
      h('h3', { style: { margin: 0 } }, '백업 내려받기'),
      h('div', { class: 'muted' }, '화요일 수업이 끝나면 꼭 한 번 내려받아 두세요. 학생 기록 전체가 파일로 저장돼요.'),
      h('button', { class: 'primary', onclick: async () => {
        const d = await rpc('admin_export').catch(e => toast(e.message, 'error'));
        if (!d) return;
        const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })),
          download: 'earth-server-backup-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json' });
        document.body.appendChild(a); a.click(); a.remove();
      } }, '백업 파일 내려받기')));
    const fp = h('select', {}, PHASES.map(p => h('option', { value: p.n, selected: p.n === st.game.phase }, p.n + '. ' + p.name)));
    page.appendChild(h('div', { class: 'panel col', style: { marginTop: '12px' } },
      h('h3', { style: { margin: 0 } }, '복구 모드: 단계 강제 이동'),
      h('div', { class: 'bad' }, '정산·시장 열기 없이 단계 숫자만 바꿔요. 실수로 넘겼을 때만 쓰세요.'),
      h('div', { class: 'row' }, fp, h('button', { class: 'warn', onclick: () => confirm('정말 ' + fp.value + '단계로 강제 이동할까요?') && act('admin_force_phase', { p_target: Number(fp.value) }, '이동했어요') }, '강제 이동'))));
    const cf = h('input', { type: 'text', placeholder: '초기화 라고 입력' });
    page.appendChild(h('div', { class: 'panel col', style: { marginTop: '12px' } },
      h('h3', { style: { margin: 0 } }, '게임 초기화 (리허설 후)'),
      h('div', { class: 'bad' }, '신발·투표·돈 기록을 모두 지우고 0단계로 돌아가요. 명단과 기기 연결은 그대로예요.'),
      h('div', { class: 'row' }, cf, h('button', { class: 'danger', onclick: () => act('admin_reset_game', { p_confirm: cf.value }, '초기화했어요') }, '초기화'))));
    page.appendChild(h('div', { class: 'panel', style: { marginTop: '12px' } }, h('h3', { style: { marginTop: 0 } }, '최근 돈 기록'),
      h('table', { class: 't' }, st.ledger.slice(0, 60).map(l => h('tr', {}, h('td', {}, l.group_id + '모둠'), h('td', {}, l.kind), h('td', {}, l.amount), h('td', {}, l.env || ''), h('td', {}, l.note || ''), h('td', {}, new Date(l.at).toLocaleTimeString('ko-KR')))))));
  }

  start();
})();
