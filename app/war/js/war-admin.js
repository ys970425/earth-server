// 전쟁의 시간 교사 관제실 (E2 H5): 무역 게임에서 가져오기 + 지급 결과 표 + 역할 현황
// 교사 로그인은 같은 브라우저의 무역 관제실 로그인을 그대로 씁니다 (Q-B A).
(function () {
  const W = window.WAR_RULES;
  const root = document.getElementById('app');
  const $ = s => document.querySelector(s);
  const BRANCH_NAME = { army: '육군', navy: '해군', air: '공군' };
  const ROLE_NAME = Object.fromEntries(W.ROLES.map(r => [r.key, r.name]));
  let diplomacy = [];
  const countryNames = new Map();
  function applyPoll(data) {
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
    let grants, roles, missions;
    try {
      grants = (await WarAPI.rpc('war_admin_grants')).grants;
      roles = (await WarAPI.rpc('war_admin_roles')).roles;
      missions = (await WarAPI.rpc('war_admin_missions')).missions;
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
    render(grants, roles, missions);
    try { await refreshDiplomacy(); } catch (e) { $('#admin-diplomacy').append(h('p', {}, e.message)); }
    WarAPI.startPoll(applyPoll);
  }
  function showError(msg) {
    root.innerHTML = '';
    root.append(h('div', { class: 'entry' }, h('p', {}, msg)));
  }

  function render(grants, roles, missions) {
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
      h('div', { class: 'row' },
        h('button', { class: 'primary big', onclick: doImport }, '무역 게임에서 가져오기'),
        result)));
    // 지급 결과 표
    const gt = h('table', { class: 'tbl war-table' },
      h('tr', {}, h('th', {}, '나라'), h('th', {}, '병과'), h('th', {}, '지급한 병력'), h('th', {}, '결과'), h('th', {}, '까닭')),
      grants.map(g => h('tr', {},
        h('td', {}, g.country + '번 나라'),
        h('td', {}, BRANCH_NAME[g.branch] || g.branch),
        h('td', {}, (W.EXTRA_UNITS[g.kind] || {}).name || g.kind),
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
    root.append(page);
    applyPoll({ diplomacy });
  }
  async function doImport() {
    const word = prompt('가져오면 전쟁 데이터를 새로 시작해요. 확인하려면 「초기화」라고 입력해 주세요.');
    if (word !== '초기화') { $('#import-result').textContent = '취소했어요. 정확히 「초기화」라고 입력해야 해요.'; return; }
    try {
      const r = await WarAPI.rpc('war_admin_import', { p_confirm: '초기화' });
      $('#import-result').textContent = '가져왔어요: 나라 ' + r.countries + ' · 칸 ' + r.tiles + ' · 병력 ' + r.units +
        ' · 지급 ' + r.grants + ' · 시설 배치 ' + r.facilities;
    } catch (e) { $('#import-result').textContent = e.message; }
    await refresh();
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
      render(grants, roles, missions);
      await refreshDiplomacy();
    } catch (e) { showError(e.message); }
  }

  start();
})();
