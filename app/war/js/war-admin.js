// 전쟁의 시간 교사 관제실 (E2 H5): 무역 게임에서 가져오기 + 지급 결과 표 + 역할 현황
// 교사 로그인은 같은 브라우저의 무역 관제실 로그인을 그대로 씁니다 (Q-B A).
(function () {
  const W = window.WAR_RULES;
  const root = document.getElementById('app');
  const $ = s => document.querySelector(s);
  const BRANCH_NAME = { army: '육군', navy: '해군', air: '공군' };
  const ROLE_NAME = Object.fromEntries(W.ROLES.map(r => [r.key, r.name]));
  let diplomacy = [];
  let turnTimer = 0;
  const countryNames = new Map();

  // ---------- 자동 턴 넘김 (켜기/끄기 토글, 기본 켜짐) ----------
  // 관제실이 켜져 있고 일시정지가 아닐 때 남은 시간이 0:00이 되면 「다음 턴」을 자동으로 눌러요.
  // 중복 방지: ① 같은 턴 번호로는 한 번만 부르고 ② 부르는 동안은 다시 부르지 않고 ③ 서버도 같은 턴 번호로 두 번 오면 한 번만 처리해요.
  // 교사 PC의 시계가 맞아야 해요 (남은 시간을 이 컴퓨터 시계로 재요).
  const AUTO_KEY = 'war_admin_auto_turn';
  let autoTurn = true;
  try { autoTurn = localStorage.getItem(AUTO_KEY) !== 'off'; } catch (e) { /* 저장 못 해도 기본 켜짐 */ }
  let autoLastTurn = null, autoBusy = false, autoBlockedUntil = 0, autoNote = '';
  // 지금 자동으로 넘길 때인가? (순수 함수. 시험에서 직접 불러 봐요)
  function shouldAutoAdvance(game, auto, nowMs, lastTurn, busy, blockedUntil) {
    if (!auto || busy || !game || game.paused || !game.turn_end) return false;
    if (lastTurn === game.turn) return false;
    if (nowMs < (blockedUntil || 0)) return false;
    return new Date(game.turn_end).getTime() <= nowMs;
  }
  window.WarAdminAuto = { shouldAutoAdvance };
  async function autoAdvance(game, onNote) {
    autoBusy = true; autoLastTurn = game.turn;
    try {
      const r = await WarAPI.rpc('war_next_turn', { p_turn: game.turn });
      // ok:false 는 다른 곳(수동 클릭·다른 탭)에서 이미 넘긴 것이라 조용히 넘어가요
      autoNote = r.ok === false ? '' : '자동으로 ' + r.turn + '턴을 시작했어요';
      refreshDiplomacy().catch(() => {});
    } catch (e) {
      autoLastTurn = null; autoBlockedUntil = Date.now() + 5000;   // 실패하면 5초 뒤 다시 시도
      autoNote = '자동 넘김 실패 (5초 뒤 다시): ' + e.message;
    } finally { autoBusy = false; onNote && onNote(); }
  }

  function applyPoll(data) {
    if (data.game) {
      clearInterval(turnTimer);
      const game = data.game, currentTurn = game.turn ?? 0, paused = !!game.paused;
      let panel = $('#admin-turn');
      if (!panel) {
        panel = h('div', { class: 'panel', id: 'admin-turn' });
        $('.war-admin')?.prepend(panel);
      }
      const remaining = h('span', {}, '--:--');
      const note = h('small', { class: 'muted', id: 'auto-note' }, autoNote);
      const tick = () => {
        const seconds = Math.max(0, Math.ceil((new Date(game.turn_end).getTime() - Date.now()) / 1000));
        remaining.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        if (shouldAutoAdvance(game, autoTurn, Date.now(), autoLastTurn, autoBusy, autoBlockedUntil))
          autoAdvance(game, () => { note.textContent = autoNote; });
      };
      if (game.turn_end) { tick(); turnTimer = setInterval(tick, 1000); }
      const autoBtn = h('button', { class: autoTurn ? 'primary' : '', id: 'auto-turn-btn', 'aria-pressed': String(autoTurn), onclick: () => {
        autoTurn = !autoTurn;
        try { localStorage.setItem(AUTO_KEY, autoTurn ? 'on' : 'off'); } catch (e) { /* 저장 못 해도 이번 화면에서는 적용돼요 */ }
        autoBtn.textContent = '자동 넘김: ' + (autoTurn ? '켜짐' : '꺼짐');
        autoBtn.className = autoTurn ? 'primary' : ''; autoBtn.setAttribute('aria-pressed', String(autoTurn));
        if (autoTurn) autoLastTurn = null;   // 다시 켜면 이 턴도 시간이 지났다면 바로 넘겨요
      } }, '자동 넘김: ' + (autoTurn ? '켜짐' : '꺼짐'));
      const call = async (name, args) => {
        try {
          const result = await WarAPI.rpc(name, args);
          if (result.ok === false) { alert(result.reason); return; }
          await refreshDiplomacy();
        } catch (e) { alert(e.message); }
      };
      const combatOn = game.combat_on !== false;
      panel.replaceChildren(h('div', { class: 'row' },
        h('b', {}, '턴 ' + currentTurn), h('span', {}, '남은 시간 ', remaining),
        paused ? h('b', { class: 'bad', id: 'paused-note' }, '⏸ 일시정지 중') : null,
        h('button', { onclick: () => call('war_next_turn', { p_turn: currentTurn }) }, '다음 턴'),
        h('button', { onclick: () => call('war_pause', { p_pause: !paused }) }, paused ? '다시시작' : '일시정지'),
        autoBtn,
        h('span', { id: 'combat-state' }, combatOn ? '⚔ 전투 가능' : '🔒 전투 잠금 중'),
        h('button', { id: 'combat-btn', class: combatOn ? '' : 'primary', onclick: () => call('war_admin_set_combat', { p_on: !combatOn }) },
          combatOn ? '전투 잠금' : '전투 풀기'),
        h('select', { 'aria-label': '시간 조절', onchange: e => call('war_set_turn_time', { p_seconds: Number(e.target.value) }) },
          [60, 90, 120, 180, 240, 300].map((seconds, i) => h('option', {
            value: seconds, selected: game.turn_seconds === seconds ? '' : null
          }, ['1분', '1분30초', '2분', '3분', '4분', '5분'][i]))),
        note));
    }
    if (!data.diplomacy) return;
    diplomacy = data.diplomacy;
    const panel = $('#admin-diplomacy'); if (!panel) return;
    panel.replaceChildren(h('div', { class: 'panel-title' }, '외교 현황'));
    const wars = diplomacy.filter(d => d.status === 'war');
    if (!wars.length) panel.append(h('p', {}, '전쟁 없음'));
    for (const d of wars) panel.append(h('div', { class: 'row' },
      (countryNames.get(d.a) || d.a + '번 나라') + ' ⚔ ' + (countryNames.get(d.b) || d.b + '번 나라'),
      h('button', { class: 'small', onclick: async () => {
        try {
          await WarAPI.rpc('war_admin_ceasefire', { p_a: d.a, p_b: d.b });
          await refreshDiplomacy();
        } catch (e) { panel.append(h('p', { class: 'bad' }, e.message)); }
      } }, '강제 휴전')));
  }
  async function refreshDiplomacy() {
    const data = await WarAPI.rpc('war_poll', { p_known: {} });
    for (const c of data.countries || []) countryNames.set(c.id, c.name);
    applyPoll(data);
  }
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
    if (WarAPI.mode) root.textContent = '미리보기를 준비하고 있어요 (몇 초 걸려요)';
    let grants, roles, missions, students = [];
    try {
      grants = (await WarAPI.rpc('war_admin_grants')).grants;
      roles = (await WarAPI.rpc('war_admin_roles')).roles;
      missions = (await WarAPI.rpc('war_admin_missions')).missions;
      students = await loadStudents();
    } catch (e) {
      if (e.code === 'NOT_ADMIN') {
        root.innerHTML = '';
        root.append(h('div', { class: 'entry' },
          h('h1', {}, '전쟁 관제실'),
          h('p', {}, '같은 브라우저에서 무역 관제실에 먼저 로그인해 주세요.'),
          h('a', { href: '../trade/admin.html' }, h('button', { class: 'primary big' }, '무역 관제실로'))));
        return;
      }
      console.error(e);
      return showError(/^[A-Za-z0-9 .,:;'"()\-_[\]]+$/.test(e.message || '') ? '문제가 생겼어요. 새로고침해 주세요.' : e.message);
    }
    render(grants, roles, missions, students);
    try { await refreshDiplomacy(); } catch (e) { $('#admin-diplomacy').append(h('p', {}, e.message)); }
    WarAPI.startPoll(applyPoll);
  }
  function showError(msg) {
    root.innerHTML = '';
    root.append(h('div', { class: 'entry' }, h('p', {}, msg)));
  }

  function render(grants, roles, missions, students = []) {
    root.innerHTML = '';
    if (WarAPI.mode) root.append(h('div', { class: 'war-banner' + (WarAPI.mode === 'real' ? ' real' : '') },
      WarAPI.mode === 'real' ? '실제 데이터 미리보기: 우리 반 무역 게임 기록이에요 (여기서 바꿔도 저장되지 않아요)' : '미리보기 모드: 가짜 데이터예요'));
    root.append(h('div', { class: 'entry wide' }, h('h1', {}, '전쟁 관제실'),
      h('p', { class: 'sub' }, '무역 게임 기록을 전쟁으로 가져와요. 가져오면 전쟁 데이터는 새로 시작해요.')));
    const page = h('div', { class: 'war-admin' });
    // 가져오기
    const result = h('div', { class: 'muted', id: 'import-result' }, '아직 가져오지 않았어요.');
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '무역 게임에서 가져오기',
      h('small', {}, '다시 누르면 전쟁 데이터를 지우고 새로 가져와요')),
      studentPicker(students),
      h('div', { class: 'row' },
        h('button', { class: 'primary big', onclick: doImport }, '무역 게임에서 가져오기'),
        result)));
    // 지급 결과 표
    const gt = h('table', { class: 'tbl war-table' },
      h('tr', {}, h('th', {}, '나라'), h('th', {}, '병과'), h('th', {}, '지급한 병력'), h('th', {}, '결과'), h('th', {}, '까닭')),
      grants.map(g => h('tr', {},
        h('td', {}, g.country + '번 나라'),
        h('td', {}, BRANCH_NAME[g.branch] || g.branch),
        h('td', {}, (W.UNITS[g.kind] || {}).name || g.kind),
        h('td', {}, g.result === 'given' ? h('b', { class: 'good' }, '지급') : h('b', { class: 'bad' }, '건너뜀')),
        h('td', {}, g.reason || '-'))));
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '병과 지급 결과',
      h('small', {}, '나라마다 육·해·공이 1부대씩은 있게 줘요')), gt.length ? gt : h('p', { class: 'muted' }, '기록이 없어요.')));
    // 역할 현황
    const roleRows = [];
    for (const r of roles) {
      const sel = h('select', { class: 'war-role-sel', onchange: () => setRole(r, sel.value) },
        h('option', { value: '', selected: r.role ? null : '' }, '역할 없음'),
        W.ROLES.map(x => h('option', { value: x.key, selected: r.role === x.key ? '' : null }, x.name)));
      roleRows.push(h('tr', {},
        h('td', {}, r.country + '번 나라'),
        h('td', {}, r.nick),
        h('td', {}, sel),
        h('td', {}, h('label', { class: 'war-absent' },
          h('input', { type: 'checkbox', checked: r.absent ? '' : null, onchange: e => setAbsent(r, e.target.checked) }),
          '결석'))));
    }
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '역할 현황',
      h('small', {}, '역할 지정·결석 표시를 여기서 해요')), h('table', { class: 'tbl war-table' },
      h('tr', {}, h('th', {}, '나라'), h('th', {}, '닉네임'), h('th', {}, '역할'), h('th', {}, '결석')),
      roleRows)));
    // 튜토리얼 미션 현황 (나라별로 묶어서)
    const byCountry = {};
    for (const m of missions || []) (byCountry[m.country] = byCountry[m.country] || []).push(m);
    const missionRows = Object.keys(byCountry).sort((a, b) => a - b).flatMap(c => byCountry[c].map(m =>
      h('tr', {},
        h('td', {}, m.country + '번 나라'),
        h('td', {}, m.nick),
        h('td', {}, m.role ? (ROLE_NAME[m.role] || m.role) : '-'),
        h('td', {}, m.done.length + ' / ' + m.total_open),
        h('td', {}, m.done.length ? m.done.map(k => ((W.MISSIONS.find(x => x.key === k) || {}).text || k)).join(', ') : '-'))));
    page.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, '튜토리얼 미션 현황',
      h('small', {}, '완료 수 ÷ 지금 열린 미션 수')), h('table', { class: 'tbl war-table' },
      h('tr', {}, h('th', {}, '나라'), h('th', {}, '닉네임'), h('th', {}, '역할'), h('th', {}, '완료 / 열림'), h('th', {}, '완료한 미션')),
      missionRows)));
    page.append(h('div', { class: 'panel', id: 'admin-diplomacy' }));
    renderReflect(page);
    root.append(page);
    applyPoll({ diplomacy });
  }
  // E11 성찰 모아 보기: 열기/닫기, 제출 수, 문항별 막대, 응답 목록, AI에게 넘기기
  // 목록·내보내기 글에는 학생 이름·번호·id가 없다(서버가 지워서 준다)
  const REFLECT_LABELS = (window.WAR_REFLECT || {}).QUESTIONS || [];
  function renderReflect(page) {
    const box = h('div', { class: 'panel', id: 'admin-reflect' });
    page.append(box);
    loadReflect(box, null);
  }
  async function loadReflect(box, list) {
    try {
      if (!list) list = await WarAPI.rpc('war_admin_reflect_list');
    } catch (e) { box.append(h('p', { class: 'bad' }, e.message)); return; }
    const toggle = h('button', { class: 'primary', onclick: async () => {
      try {
        await WarAPI.rpc('war_admin_reflect_set', { p_open: !list.open });
        box.innerHTML = '';
        loadReflect(box, null);
      } catch (e) { box.append(h('p', { class: 'bad' }, e.message)); }
    } }, list.open ? '성찰 닫기' : '성찰 열기');
    box.replaceChildren(h('div', { class: 'panel-title' }, '성찰 모아 보기',
      h('small', {}, '게임이 끝난 뒤 학생이 돌아보는 답이에요 (이름은 저장하지 않아요)'), toggle),
      h('p', {}, '제출 ' + list.submitted + ' / ' + list.total + '명'));
    // 문항별 막대 (버튼별 몇 명)
    const counts = list.counts || [];
    const bars = REFLECT_LABELS.map((q, qi) => {
      const c = counts[qi] || {};
      const max = Math.max(1, ...Object.values(c).map(v => +v));
      return h('div', { class: 'war-reflect-count' },
        h('b', {}, (qi + 1) + '. ' + q.text),
        q.answers.map((a, ai) => h('div', { class: 'row' },
          h('span', { class: 'muted', style: { minWidth: '160px' } }, a),
          h('div', { class: 'war-bar', style: { width: Math.round(200 * (+((c[String(ai + 1)] || 0)) / max)) + 'px' } }),
          h('span', {}, String(c[String(ai + 1)] || 0) + '명'))));
    });
    box.append(h('div', { class: 'panel-title' }, '문항별 선택 수'), ...bars);
    // 응답 목록 (나라·역할·번호 답·글·시각만)
    box.append(h('div', { class: 'panel-title' }, '응답 목록'));
    if (!(list.responses || []).length) box.append(h('p', { class: 'muted' }, '아직 응답이 없어요.'));
    for (const r of list.responses || []) {
      box.append(h('div', { class: 'war-row' },
        h('small', { class: 'muted' }, r.country + '번 나라 · ' + (ROLE_NAME[r.role] || r.role) + ' · ' + r.at),
        h('span', {}, '답 ' + r.a1 + '-' + r.a2 + '-' + r.a3),
        h('span', {}, r.text ? '「' + r.text + '」' : '')));
    }
    // AI에게 넘기기: 복사 또는 .md 내려받기 (이름은 서버가 ○○로 바꾼 글만 내려온다)
    box.append(h('div', { class: 'panel-title' }, 'AI에게 넘기기',
      h('small', {}, '학생 이름·번호·id는 들어가지 않아요')));
    box.append(h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: async () => {
        try {
          const ex = await WarAPI.rpc('war_admin_reflect_export');
          await navigator.clipboard.writeText(ex.markdown);
          alert('복사했어요. 글 속 실명 「○○」로 바꾼 곳 ' + ex.replaced + '곳');
        } catch (e) { alert(e.message); }
      } }, '복사하기'),
      h('button', { class: 'primary', onclick: async () => {
        try {
          const ex = await WarAPI.rpc('war_admin_reflect_export');
          const blob = new Blob([ex.markdown], { type: 'text/markdown;charset=utf-8' });
          const a = h('a', { href: URL.createObjectURL(blob), download: '성찰응답.md' });
          document.body.append(a); a.click(); a.remove();
          alert('내려받았어요. 글 속 실명 「○○」로 바꾼 곳 ' + ex.replaced + '곳');
        } catch (e) { alert(e.message); }
      } }, '.md로 내려받기')));
  }
  // ---------- 가져올 학생 고르기 (모둠별 체크 목록) ----------
  // 무역 데이터에 시험용 계정 같은 학생이 더 있을 때, 체크를 해제하면 그 학생은 전쟁판에 가져오지 않아요 (무역 데이터는 안 바뀌어요).
  // 이름은 이 교사 화면에만 보이고, 어디에도 따로 저장하거나 보내지 않아요.
  async function loadStudents() {
    try { return (await WarAPI.rpc('war_admin_students')).students || []; }
    catch (e) { console.error(e); return []; }
  }
  const unchecked = () => [...document.querySelectorAll('#import-students input[type=checkbox]')].filter(i => !i.checked).map(i => Number(i.value));
  function studentPicker(students) {
    if (!students.length) return null;
    const summary = h('div', { class: 'war-exclude-summary', id: 'import-summary' });
    const byCountry = new Map();
    for (const st of students) { if (!byCountry.has(st.country)) byCountry.set(st.country, []); byCountry.get(st.country).push(st); }
    const update = () => {
      const boxes = [...document.querySelectorAll('#import-students input[type=checkbox]')];
      const on = boxes.filter(b => b.checked).length;
      summary.textContent = '가져올 학생 ' + on + '명 / 무역 데이터 ' + boxes.length + '명' + (on === boxes.length ? '' : ' · 뺄 학생 ' + (boxes.length - on) + '명');
      for (const [c] of byCountry) {
        const n = boxes.filter(b => b.dataset.country === String(c) && b.checked).length;
        const note = document.getElementById('grp-note-' + c);
        if (note) note.textContent = n + '명' + (n <= 4 ? ' · 4명 모둠 규칙 (합동참모의장이 공병 일도 함께 해요)' : '');
      }
    };
    const groups = [...byCountry].map(([c, list]) => h('fieldset', { class: 'war-exclude-group' },
      h('legend', {}, c + '번 나라 · 가져올 ', h('b', { id: 'grp-note-' + c }, '')),
      list.map(st => h('label', { class: 'war-exclude-item' },
        h('input', { type: 'checkbox', value: String(st.id), 'data-country': String(c), checked: st.excluded ? null : '', onchange: update }),
        ' ' + (st.name || '학생') + (st.nick ? ' (' + st.nick + ')' : '')))));
    const box = h('div', { class: 'war-exclude', id: 'import-students' },
      h('p', { class: 'muted' }, '가져오지 않을 학생은 체크를 풀어 주세요 (시험용 계정 등). 기본은 모두 체크예요. 이름은 이 화면에만 보여요.'),
      h('div', { class: 'row' }, h('button', { class: 'small', onclick: () => { document.querySelectorAll('#import-students input[type=checkbox]').forEach(b => { b.checked = true; }); update(); } }, '모두 선택'), summary),
      h('div', { class: 'war-exclude-grid' }, groups));
    setTimeout(update, 0);
    return box;
  }
  async function doImport() {
    const skip = unchecked();
    const word = prompt('가져오면 전쟁 데이터를 새로 시작해요.' + (skip.length ? ' (이번 전쟁에서 뺄 학생 ' + skip.length + '명)' : '') + ' 확인하려면 「초기화」라고 입력해 주세요.');
    if (word !== '초기화') { $('#import-result').textContent = '취소했어요. 정확히 「초기화」라고 입력해야 해요.'; return; }
    let msg = '';
    try {
      if ($('#import-students')) await WarAPI.rpc('war_admin_set_excluded', { p_students: skip });   // 뺄 학생을 먼저 저장 (무역 데이터는 안 바뀌어요)
      const r = await WarAPI.rpc('war_admin_import', { p_confirm: '초기화' });
      msg = '가져왔어요: 나라 ' + r.countries + ' · 칸 ' + r.tiles + ' · 병력 ' + r.units +
        ' · 지급 ' + r.grants + ' · 시설 배치 ' + r.facilities + (skip.length ? ' · 뺀 학생 ' + skip.length + '명' : '');
    } catch (e) { msg = e.message; }
    await refresh();   // 화면을 다시 그리면 결과 문구가 지워지니까, 다시 그린 뒤에 문구를 넣어요
    const el = $('#import-result'); if (el) el.textContent = msg;
  }
  async function setAbsent(r, absent) {
    try { await WarAPI.rpc('war_admin_set_absent', { p_student: r.student, p_absent: absent }); }
    catch (e) { showError(e.message); }
  }
  async function setRole(r, role) {
    try { await WarAPI.rpc('war_admin_set_role', { p_student: r.student, p_role: role || null }); }
    catch (e) { showError(e.message); }
  }
  async function refresh() {
    try {
      const grants = (await WarAPI.rpc('war_admin_grants')).grants;
      const roles = (await WarAPI.rpc('war_admin_roles')).roles;
      const missions = (await WarAPI.rpc('war_admin_missions')).missions;
      render(grants, roles, missions, await loadStudents());
      await refreshDiplomacy();
    } catch (e) { showError(e.message); }
  }

  start();
})();
