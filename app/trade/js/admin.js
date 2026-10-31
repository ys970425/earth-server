// 교사 관제실 (지구 서버: 문명의 시대)
(function () {
  const R = window.RULES;
  const { rpc, ensureSession, subscribe, PHASES } = window.API;
  const { $, h, toast, modal, fmt, debounce, typeColor, itemName, happyWord } = window.UI;
  const root = document.getElementById('app');
  const A = { st: null, tab: 'progress', timer: null, offset: 0, turning: false };

  const NEXT = {
    1: { title: '나라 키우기 시작 (턴 1)', desc: '노동자·건물·병력·점령·정찰을 할 수 있어요. 13차시 시작.' },
    2: { title: '성장의 한계', desc: '시민들이 사치품·강철·연료를 원하기 시작해요. 다음 턴 정산부터 행복도가 떨어져요. (14차시 시작)' },
    3: { title: '세계 시장 개방', desc: '외교 창과 무역(거래 제안)이 열려요. 나라마다 수출 1건, 수입 1건 미션!' },
    4: { title: '무역 라운드 (15차시)', desc: '생산비 비교, 잘 만드는 것 집중하기.' },
    5: { title: '공급 차질 (16차시)', desc: '단계만 바뀌어요. 한파 사건은 아래 사건 버튼으로 실행해요.' },
    6: { title: '가격 경쟁', desc: '단계만 바뀌어요. 가격 경쟁 사건은 사건 버튼으로.' },
    7: { title: '실제 나라와 비교', desc: '16차시 마무리.' },
    8: { title: '협정 만료 (17차시 도입)', desc: '공정 거래 규칙(기준가 2배)이 사라져요.' },
    9: { title: '무역 갈등', desc: '단계만 바뀌어요. 「세계 경제 위기」 사건 버튼으로 관세·수출 제한을 실행해요.' },
    10: { title: '조약 회의', desc: '게임 조작이 멈추고, 학생 화면에 조약 회의 탭이 열려요.' },
    11: { title: '무역 헌장', desc: '조약 체결과 시범 거래, 회복.' }
  };

  async function start() {
    root.innerHTML = '';
    try { await ensureSession(); } catch (e) { root.appendChild(h('p', { class: 'bad' }, e.message)); return; }
    const c = await rpc('admin_check').catch(() => ({ admin: false }));
    if (c.admin) return dashboard();
    const pw = h('input', { type: 'password', placeholder: '비밀번호' });
    const btn = h('button', { class: 'primary', onclick: login }, '들어가기');
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    root.appendChild(h('div', { class: 'entry' }, h('h1', {}, '우주 운영진 관제실'), h('p', { class: 'sub' }, '교사 비밀번호를 입력해 주세요'),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, pw, btn), h('p', {}, h('a', { href: 'index.html' }, '← 학생 화면으로'))));
    pw.focus();
    async function login() {
      btn.disabled = true;
      try { await rpc('admin_login', pw.value); dashboard(); } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    }
  }
  async function logout() {
    if (!confirm('관제실에서 나갈까요?')) return;
    clearInterval(A.timer);
    try { await rpc('admin_logout'); } catch (e) { /* 무시 */ }
    location.href = 'index.html';
  }
  async function dashboard() {
    await load();
    subscribe({ game: () => loadSoon(), tick: () => loadSoon() });
    A.timer = setInterval(load, 5000);
    setInterval(autoTurn, 1000);
  }
  const loadSoon = debounce(() => load(), 500);
  async function load() {
    try { A.st = await rpc('admin_state'); A.offset = new Date(A.st.now).getTime() - Date.now(); }
    catch (e) { if (e.code === 'NOT_ADMIN') { clearInterval(A.timer); start(); } return; }
    const ae = document.activeElement;
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) && root.contains(ae)) { header(); return; }
    render();
  }
  // 자동 턴: 시간이 다 되면 이 화면이 다음 턴을 누름 (같은 턴을 두 번 넘기지 않게 서버가 확인)
  async function autoTurn() {
    const g = A.st && A.st.game; if (!g || !g.turn_end || A.turning) return;
    const left = (new Date(g.turn_end).getTime() - (Date.now() + A.offset)) / 1000;
    const el = $('#turn-left'); if (el) el.textContent = left > 0 ? Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0') : '넘기는 중';
    if (left <= 0) { A.turning = true; try { await rpc('admin_next_turn', g.turn); } catch (e) { toast(e.message, 'error'); } await load(); A.turning = false; }
  }

  function render() {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'topbar', id: 'top' }));
    header();
    const tabs = [['progress', '진행'], ['nations', '나라 현황'], ['trade', '무역 기록'], ['roster', '명단·연결'], ['backup', '백업·복구']];
    root.appendChild(h('div', { class: 'nav' }, tabs.map(([k, l]) => h('button', { class: A.tab === k ? 'on' : '', onclick: () => { A.tab = k; render(); } }, h('span', { class: 'dot' }), l,
      k === 'roster' && A.st.pairings.length ? h('span', { class: 'badge' }, A.st.pairings.length) : null)),
      h('a', { href: 'index.html?observe=1', target: '_blank', class: 'board-link' }, '관전 모드 ↗'),
      h('a', { href: 'board.html', target: '_blank', class: 'board-link' }, '전자칠판 화면 열기 ↗'),
      h('button', { class: 'ghost small leave', onclick: logout }, '나가기')));
    const page = h('div', { class: 'page' }); root.appendChild(page);
    ({ progress, nations, trade, roster, backup })[A.tab](page);
  }
  function header() {
    const st = A.st, g = st.game, top = $('#top'); if (!top) return;
    top.innerHTML = '';
    const online = st.students.filter(s => s.online).length, bound = st.students.filter(s => s.bound).length;
    top.append(...[h('span', { class: 'company' }, '관제실'),
      h('span', { class: 'stat' }, '단계', h('b', {}, g.phase + '. ' + PHASES[g.phase].name)),
      h('span', { class: 'stat' }, '턴', h('b', {}, g.turn), g.turn_end ? h('span', { id: 'turn-left' }, '') : null),
      h('span', { class: 'stat' }, '입장', h('b', {}, bound + '/' + st.students.length)),
      h('span', { class: 'stat' }, '접속 중', h('b', {}, online)),
      h('span', { class: 'stat' }, '지구 서버 안정도', h('b', {}, st.gauge + '%')),
      g.market_open ? h('span', { class: 'stat' }, '대기 중 제안', h('b', {}, st.offers_pending)) : null,
      st.pairings.length ? h('span', { class: 'phase', style: { background: '#E05A4F', color: '#fff' } }, '연결 승인 대기 ' + st.pairings.length) : null].filter(Boolean));
  }
  const cname = id => (A.st.countries.find(c => c.id === id) || {}).name || '중립 상인';
  async function act(fn, args, msg) {
    try { const r = await rpc(fn, ...args); if (msg) toast(msg); await load(); return r; }
    catch (e) { toast(e.message, 'error'); }
  }

  // ---------- 진행 ----------
  function progress(page) {
    const st = A.st, g = st.game, nx = NEXT[g.phase + 1];
    page.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, '지금: ' + g.phase + '. ' + PHASES[g.phase].name, h('small', {}, PHASES[g.phase].desc)),
      h('div', { class: 'row' },
        nx ? h('button', { class: 'primary big', onclick: () => confirm(nx.title + '(으)로 넘길까요?\n' + nx.desc) && act('admin_set_phase', [g.phase + 1], '단계를 넘겼어요.') }, '▶ ' + nx.title) : null,
        g.phase >= 1 ? h('button', { class: 'gold big', onclick: () => act('admin_next_turn', [g.turn], '다음 턴!') }, '다음 턴 (지금 턴 ' + g.turn + ' 정산)') : null),
      nx ? h('p', { class: 'muted' }, nx.desc) : null,
      h('div', { class: 'row' }, '자동 턴 넘김',
        [[0, '끄기'], [180, '3분'], [240, '4분'], [300, '5분']].map(([s, l]) => h('button', { class: 'small ' + (g.auto_turn === s ? 'gold' : ''), onclick: () => act('admin_auto_turn', [s], s ? l + '마다 턴이 넘어가요' : '자동 넘김 끔') }, l)),
        h('small', { class: 'muted' }, '이 관제실 화면이 열려 있어야 자동으로 넘어가요.')),
      h('div', { class: 'row' }, '활동 타이머',
        [[240, '4분'], [300, '5분'], [480, '8분'], [600, '10분']].map(([s, l]) => h('button', { class: 'small', onclick: () => act('admin_timer', [s, '활동'], l + ' 타이머') }, l)),
        h('button', { class: 'small', onclick: () => act('admin_timer', [0, ''], '타이머 끔') }, '끄기'))));
    // 수업 도우미
    const noTrade = st.countries.filter(c => g.market_open && (c.exports === 0 || c.imports === 0));
    page.appendChild(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '세계 발견과 외교', h('small', {}, g.world_first ? '세계 발견: ' + cname(g.world_first) : g.diplomacy_open ? '외교 열림' : '아직 아무도 다 발견하지 못함')),
        h('div', { class: 'mini-bars' }, st.countries.map(c => h('div', { class: 'mb' }, h('b', { style: { color: typeColor(c.type) } }, c.name), h('span', {}, '발견 ' + c.discovered + '/5')))),
        h('div', { class: 'row' },
          h('button', { onclick: () => confirm('모든 나라에 바닷길 지도를 줄까요? (발견은 정찰병이 직접 해야 해요)') && act('admin_explore_help', [null], '탐험 지원') }, '탐험 지원 (모든 나라)'),
          h('button', { onclick: () => confirm('발견과 관계없이 외교 창을 열까요?') && act('admin_open_diplomacy', [], '외교 열림') }, '외교 열기'))),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '공지 보내기'),
        (() => { const m = h('input', { type: 'text', placeholder: '모든 학생 화면에 떠요', style: { flex: 1 } });
          return h('div', { class: 'row' }, m, h('button', { onclick: () => m.value && act('admin_notice', [m.value], '공지 보냄') }, '보내기')); })(),
        g.market_open ? h('div', { class: noTrade.length ? 'warn-box' : 'done-box', style: { marginTop: '10px' } },
          noTrade.length ? '수출·수입 미션 미완료: ' + noTrade.map(c => c.name + (c.exports ? '' : ' (수출 0)') + (c.imports ? '' : ' (수입 0)')).join(', ') : '모든 나라가 수출과 수입을 했어요.') : null)));
    page.appendChild(nationsTable());
    page.appendChild(eventsPanel());
  }
  function eventsPanel() {
    const ev = A.st.events;
    return h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '사건 기록'),
      ev.length ? h('table', { class: 'tbl' }, ev.map(e => h('tr', {}, h('td', {}, '턴 ' + (e.turn ?? '-')), h('td', {}, e.kind), h('td', {}, e.message || '')))) : h('p', { class: 'muted' }, '아직 없어요.'));
  }

  // ---------- 나라 현황 ----------
  function nationsTable() {
    const st = A.st, g = st.game;
    return h('div', { class: 'panel', style: { overflowX: 'auto' } }, h('div', { class: 'panel-title' }, '나라 현황', h('small', {}, '느린 나라는 지원 버튼으로 도와주세요')),
      h('table', { class: 'tbl nations' },
        h('tr', {}, ['모둠', '나라', '국고', '행복도', '도시', '병력', '개발', '발견', '수출/수입', '부족', '접속', '지원'].map(x => h('th', {}, x))),
        st.countries.map(c => h('tr', {},
          h('td', {}, h('span', { class: 'chip', style: { background: typeColor(c.type) } }, c.id + '모둠')),
          h('td', {}, h('b', {}, c.name), h('div', { class: 'muted' }, c.type_name)),
          h('td', {}, fmt(c.coin), h('div', { class: 'muted' }, '수입 ' + c.income)),
          h('td', { class: c.happy < 25 ? 'bad' : c.happy >= 70 ? 'good' : '' }, c.happy + ' ' + happyWord(c.happy), c.unrest ? h('div', { class: 'bad' }, '불안 ' + c.unrest) : null),
          h('td', {}, c.cities + ' / ' + (c.targets + 1)),
          h('td', {}, Object.entries(c.units).filter(([k]) => R.UNITS[k]).map(([k, n]) => R.UNITS[k].name + n).join(' ') || '-'),
          h('td', {}, c.improved + '칸'),
          h('td', {}, c.discovered + '/5'),
          h('td', { class: g.market_open && (!c.exports || !c.imports) ? 'bad' : '' }, c.exports + ' / ' + c.imports),
          h('td', { class: 'bad' }, (c.short || []).join(', ')),
          h('td', {}, c.online),
          h('td', {}, h('div', { class: 'row' },
            h('button', { class: 'small', onclick: () => act('admin_grant', [c.id, { coin: 50 }, '나라 발전 지원'], c.name + ' 코인 50') }, '코인 50'),
            h('button', { class: 'small', onclick: () => act('admin_turn_help', [c.id], c.name + ' 턴 지원') }, '턴 지원'),
            h('button', { class: 'small', onclick: () => act('admin_relief', [c.id], c.name + ' 불안 진정') }, '불안 진정'),
            h('button', { class: 'small', onclick: () => act('admin_explore_help', [c.id], c.name + ' 탐험 지원') }, '탐험'),
            g.market_open ? h('button', { class: 'small', onclick: () => broker(c) }, '보조 거래') : null))))));
  }
  function nations(page) {
    page.appendChild(nationsTable());
    page.appendChild(h('div', { class: 'grid2' }, A.st.countries.map(c => h('div', { class: 'panel' },
      h('div', { class: 'panel-title', style: { color: typeColor(c.type) } }, c.name, h('small', {}, c.type_name)),
      h('div', {}, '창고: ' + (Object.entries(c.inventory).map(([k, v]) => itemName(k) + ' ' + v).join(', ') || '없음')),
      h('div', {}, '기술: ' + c.techs.map(t => R.TECHS[t]).join(', ')),
      c.factories.length ? h('div', {}, '공장: ' + c.factories.map(f => R.FACTORIES[f].name).join(', ')) : null,
      c.advanced.length ? h('div', {}, '발전 건물: ' + c.advanced.map(f => R.ADVANCED[f].name).join(', ')) : null))));
  }
  function broker(c) {
    const item = h('select', {}, Object.keys(R.ITEMS).map(k => h('option', { value: k }, itemName(k))));
    const dir = h('select', {}, h('option', { value: '1' }, '중립 상인이 이 나라에 팔기'), h('option', { value: '-1' }, '중립 상인이 이 나라에서 사기'));
    const qty = h('input', { type: 'number', value: 1, min: 1, style: { width: '80px' } });
    const coin = h('input', { type: 'number', value: 10, min: 0, style: { width: '90px' } });
    const m = modal(h('div', { class: 'col' }, h('h2', {}, c.name + ' 보조 거래'), h('p', { class: 'muted' }, '거래 상대가 없을 때만 쓰세요. 기록에 「보조」로 표시돼요.'),
      dir, h('div', { class: 'row' }, item, qty, '개', coin, '코인'),
      h('button', { class: 'primary', onclick: async () => { await act('admin_broker_trade', [c.id, item.value, +qty.value * +dir.value, +coin.value], '보조 거래 완료'); m.close(); } }, '거래')));
  }

  // ---------- 무역 기록 ----------
  function trade(page) {
    const st = A.st;
    const max = Math.max(1, ...st.volume.map(v => v.qty));
    page.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '턴별 거래량'),
      h('div', { class: 'vol' }, st.volume.map(v => h('div', { class: 'vol-bar' }, h('i', { style: { height: (v.qty / max * 100) + '%' } }), h('small', {}, v.qty), h('span', {}, '턴' + v.turn))))));
    page.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '최근 거래'),
      st.trades.length ? h('table', { class: 'tbl' }, h('tr', {}, ['턴', '판 나라', '산 나라', '물건', '값', '관세', ''].map(x => h('th', {}, x))),
        st.trades.map(t => h('tr', {}, h('td', {}, t.turn), h('td', {}, cname(t.from_c)), h('td', {}, cname(t.to_c)), h('td', {}, itemName(t.item) + ' ' + t.qty),
          h('td', {}, t.price ? '1개 ' + t.price : '물물교환'), h('td', {}, t.tariff || ''), h('td', {}, t.broker ? '보조' : '')))) : h('p', { class: 'muted' }, '아직 거래가 없어요.')));
  }

  // ---------- 명단·연결 ----------
  function roster(page) {
    const st = A.st, g = st.game;
    if (st.pairings.length) {
      const byC = {}; for (const p of st.pairings) (byC[p.country_id] = byC[p.country_id] || []).push(p);
      page.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '연결 승인 대기'),
        h('button', { class: 'primary', onclick: () => act('admin_approve_group', [null], '모두 승인') }, '전체 일괄 승인'),
        Object.entries(byC).map(([c, list]) => h('div', { class: 'row', style: { marginTop: '8px' } }, h('b', {}, c + '모둠'),
          list.map(p => h('span', { class: 'chip', style: { background: '#4A4378' } }, p.name, h('button', { class: 'small', onclick: () => act('admin_approve', [p.id]) }, '승인'), h('button', { class: 'small', onclick: () => act('admin_reject', [p.id]) }, '거절'))),
          h('button', { class: 'small primary', onclick: () => act('admin_approve_group', [+c], c + '모둠 승인') }, c + '모둠 일괄 승인')))));
    }
    // 모둠 ↔ 나라 유형
    page.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '모둠별 나라 유형', h('small', {}, g.phase === 0 ? '건국 단계에서만 바꿀 수 있어요 (바꾸면 게임판이 처음 상태로)' : '게임이 시작되어 바꿀 수 없어요')),
      h('div', { class: 'row' }, st.countries.map(c => {
        const sel = h('select', { disabled: g.phase > 0 }, Object.entries(R.TYPES).map(([k, t]) => h('option', { value: k, selected: c.type === k }, t.name)));
        sel.addEventListener('change', () => act('admin_set_type', [c.id, sel.value], '바꿨어요'));
        return h('label', { class: 'col' }, c.id + '모둠', sel);
      }))));
    const ta = h('textarea', { placeholder: '모둠,번호,이름 (한 줄에 한 명)\n1,1,김하늘\n1,2,이바다' });
    page.appendChild(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '명단 넣기', h('small', {}, '엑셀 세 칸을 복사해 붙여도 돼요. 기존 명단은 바뀌어요.')), ta,
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => {
          const rows = ta.value.split(/\n/).map(l => l.split(/[,\t]/).map(x => x.trim())).filter(x => x.length >= 3 && x[2]).map(([group, no, name]) => ({ group: +group, no, name }));
          if (!rows.length) return toast('명단 형식을 확인해 주세요.', 'error');
          if (confirm(rows.length + '명으로 명단을 바꿀까요?')) act('admin_roster_import', [rows], '명단 저장');
        } }, '명단 저장'),
          h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: g.require_approval, onchange: e => act('admin_flags', [{ require_approval: e.target.checked }]) }), '새 기기 연결 시 교사 승인'))),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '학생', h('small', {}, '국가 대표를 정해 주세요 (이름·국기·조약 담당)')),
        h('table', { class: 'tbl' }, st.students.map(s => h('tr', {},
          h('td', {}, s.country_id + '모둠'), h('td', {}, s.name), h('td', {}, s.role || ''), h('td', {}, s.bound ? (s.online ? '접속 중' : '연결됨') : '-'),
          h('td', {}, h('button', { class: 'small ' + (s.is_leader ? 'gold' : ''), onclick: () => act('admin_set_leader', [s.id, !s.is_leader]) }, s.is_leader ? '국가 대표' : '대표로')),
          h('td', {}, s.bound ? h('button', { class: 'small', onclick: () => confirm(s.name + ' 연결을 초기화할까요?') && act('admin_reset_binding', [s.id], '연결 초기화') }, '연결 초기화') : null)))))));
  }

  // ---------- 백업·복구 ----------
  function backup(page) {
    const conf = h('input', { type: 'text', placeholder: '초기화' });
    const ph = h('select', {}, PHASES.map(p => h('option', { value: p.n, selected: p.n === A.st.game.phase }, p.n + '. ' + p.name)));
    page.appendChild(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '백업 내려받기', h('small', {}, '수업이 끝날 때마다 받아 두세요')),
        h('button', { class: 'primary', onclick: async () => {
          const data = await rpc('admin_export');
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: '지구서버-무역-백업-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json' });
          document.body.appendChild(a); a.click(); a.remove();
        } }, '백업 파일 받기')),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '단계 강제 이동', h('small', {}, '실수로 넘겼을 때만 (사건은 다시 실행되지 않아요)')),
        h('div', { class: 'row' }, ph, h('button', { onclick: () => confirm('강제로 옮길까요?') && act('admin_force_phase', [+ph.value], '옮겼어요') }, '옮기기'))),
      h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '게임 초기화', h('small', {}, '명단·기기 연결·나라 이름은 그대로, 게임판만 처음으로')),
        h('div', { class: 'row' }, conf, h('button', { class: 'danger', onclick: () => act('admin_reset_game', [conf.value], '초기화했어요') }, '초기화')))));
  }

  start();
})();
