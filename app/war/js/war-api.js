// 전쟁 버전 서버 연결 층 (E2 H4)
// - 서버 모드: 무역 앱과 같은 Supabase 설정·로그인(storageKey 'earth-trade-auth')을 그대로 이어받아요.
//   새로 익명 로그인을 만들지 않아요 (Q-A A). 교사도 같은 브라우저의 무역 관제실 로그인을 씁니다 (Q-B A).
// - 미리보기 모드(?preview=1 / ?preview=real): 서버 대신 가짜 서버가 브라우저 메모리에서 응답해요.
//   &as=나라번호:역할 (예 &as=1:chief) / &size=4 (4명 모둠 흉내)
// - WarAPI.rpc(이름, 인자객체), WarAPI.startPoll(받을 함수): 4초마다 war_poll, 실패하면 8·16초로 늘리고,
//   성공하면 4초로 돌아와요. 화면이 안 보이면(탭 뒤로) 잠깐 멈춰요.
(function () {
  const R = window.RULES, W = window.WAR_RULES;
  const q = new URLSearchParams(location.search);
  const mode = q.has('preview') ? (q.get('preview') === 'real' ? 'real' : 'fake') : null;

  // ---------- 서버 모드 ----------
  let sb = null;
  if (!mode) {
    const cfg = window.APP_CONFIG;
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
      // 무역 앱 api.js와 똑같은 옵션: 같은 로그인 정보(스토리지 키)를 그대로 씀
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'earth-trade-auth', lock: async (name, timeout, fn) => await fn() },
      realtime: { params: { eventsPerSecond: 5 } }
    });
  }
  function cleanError(e) {
    const msg = (e && (e.message || e.details || e.hint)) || String(e);
    const m = msg.match(/^[A-Z_]+:\s*(.*)$/s);
    const err = new Error(m ? m[1] : msg);
    err.code = (msg.match(/^([A-Z_]+):/) || [])[1] || 'ERROR';
    return err;
  }
  let myCountry = null;

  // ---------- 미리보기 가짜 서버 (브라우저 메모리에서만) ----------
  function makeFake(state) {
    const size = q.get('size') === '4' ? 4 : 5;
    const as = (q.get('as') || '').split(':');
    const meCountry = as[0] ? +as[0] : 1;
    const meRole = as[1] || null;
    const taken = {};   // country -> role -> {nick, absent}
    for (const c of state.countries) taken[c.id] = taken[c.id] || {};
    if (meRole) taken[meCountry][meRole] = { nick: '나(미리보기)', absent: false };
    const ver = { game: 1, map: 1, units: 1, cities: 1, diplomacy: 1, notice: 0 };
    const countryVer = {};
    for (const c of state.countries) countryVer[c.id] = 0;
    const bump = (area, country) => {
      if (area === 'country') countryVer[country] = (countryVer[country] || 0) + 1;
      else ver[area] = (ver[area] || 0) + 1;
    };
    const countryOf = id => state.countries.find(c => c.id === id) || {};
    const rolesPayload = c => W.ROLES.map(r => {
      const t = (taken[c] || {})[r.key];
      return { key: r.key, name: r.name, nick: t ? t.nick : null, absent: !!(t && t.absent) };
    });
    const menusOf = role => {
      const r = W.ROLES.find(x => x.key === role);
      return role === 'chief' && size <= 4 ? r.menus4 : r.menus;
    };
    const deputyOf = c => {
      if (meRole !== 'chief' || meCountry !== c) return [];
      return W.ROLES.filter(r => r.key !== 'chief' && (!(taken[c] || {})[r.key] || (taken[c] || {})[r.key].absent))
        .map(r => ({ key: r.key, name: r.name, menus: r.menus, absent: !!((taken[c] || {})[r.key] || {}).absent }));
    };
    const cityCountry = {};
    for (const c of state.cities) cityCountry[c.id] = c.country;
    // 병력은 메모리에서 관리 (새로고침하면 state.json대로 처음 상태). 이동력은 전쟁 규칙대로 채움
    const units = state.units.map(u => ({ ...u, moves_left: W.MOVES_OF(u.kind) }));
    let paused = false;
    const unitsFull = () => units.map(u => ({ ...u }));
    const tilesFull = () => state.tiles;
    const countryPayload = c => ({
      country: c, coin: countryOf(c).coin ?? 0, inventory: countryOf(c).inventory || {},
      wallets: {}, roles: rolesPayload(c),
      facilities: (state.facilities || []).filter(f => cityCountry[f.city] === c)
    });
    const versions = () => ({ ...ver, ['country:' + meCountry]: countryVer[meCountry] || 0 });
    // act_start 흉내: 역할·결석 대행·일시정지 검사
    function fakeAct(role) {
      if (paused) { const e = new Error('지금은 잠깐 멈춘 시간이에요.'); e.code = 'PAUSED'; throw e; }
      if (meRole === role) return;
      const holder = (taken[meCountry] || {})[role];
      const okDeputy = meRole === 'chief' && (!holder || holder.absent || (role === 'engineer' && size <= 4));
      if (!okDeputy) { const e = new Error('이 일은 ' + (W.ROLES.find(r => r.key === role) || {}).name + '이(가) 해요.'); e.code = 'ROLE_ONLY'; throw e; }
    }
    const tileAt = id => state.tiles.find(t => t[0] === id);
    const hexDist = (a, b) => {
      const w = R.W, cube = id => { const c = id % w, r = Math.floor(id / w); const q = c - (r - (r & 1)) / 2; return [q, r, -q - r]; };
      const A = cube(a), B = cube(b);
      return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
    };
    const occAt = id => units.filter(x => x.tile === id);
    const infoAt = (id, u) => ({
      market: (state.markets || []).some(m => m.tile === id),
      enemyCity: (() => { const c = state.cities.find(x => x.tile === id); return !!(c && c.country !== u.country); })(),
      enemyUnit: occAt(id).some(x => x.country !== u.country),
      sameKind: occAt(id).some(x => (x.kind === 'worker' || x.kind === 'scout') === (u.kind === 'worker' || u.kind === 'scout'))
    });
    const err = (code, msg) => { const e = new Error(msg); e.code = code; return e; };
    async function rpc(name, args) {
      args = args || {};
      await new Promise(res => setTimeout(res, 30));   // 서버 느낌
      if (name === 'war_me') {
        const c = countryOf(meCountry);
        return { country: { id: c.id, name: c.name, type: c.type, color: c.color, size },
          countries: state.countries.map(x => ({ id: x.id, name: x.name, type: x.type })),
          role: meRole, menus: meRole ? menusOf(meRole) : [],
          deputy_roles: deputyOf(meCountry), roles: rolesPayload(meCountry) };
      }
      if (name === 'war_choose_role') {
        const role = args.p_role;
        if (meRole) { const e = new Error('이미 고른 역할이 있어요. 바꾸는 것은 선생님만 할 수 있어요.'); e.code = 'HAS_ROLE'; throw e; }
        const def = W.ROLES.find(r => r.key === role);
        if (!def) { const e = new Error('없는 역할이에요.'); e.code = 'BAD_ROLE'; throw e; }
        if (role === 'engineer' && size <= 4) { const e = new Error('4명 모둠은 공병사령관이 없어요. 합동참모의장이 함께 해요.'); e.code = 'FOUR_GROUP'; throw e; }
        if ((taken[meCountry] || {})[role]) { const e = new Error('이미 다른 친구가 고른 역할이에요.'); e.code = 'ROLE_TAKEN'; throw e; }
        taken[meCountry][role] = { nick: '나(미리보기)', absent: false };
        bump('country', meCountry);
        return { ok: true, role };
      }
      if (name === 'war_poll') {
        const known = args.p_known || {};
        const k = key => (known[key] == null ? null : +known[key]);
        const out = { versions: versions(), me: { country: meCountry } };
        if (k('game') == null || k('game') !== ver.game) out.game = {
          turn: state.game.turn, turn_seconds: state.game.turn_seconds ?? 180,
          turn_end: null, paused: !!state.game.paused, combat_on: state.game.combat_on !== false };
        if (k('map') == null || k('map') === 0 || k('map') !== ver.map) {
          out.map = (k('map') == null || k('map') === 0) ? tilesFull() : [];
          out.markets = state.markets || [];   // 시장 칸(공개 정보)은 지도 영역과 함께
        }
        if (k('units') == null || k('units') !== ver.units) out.units = unitsFull();
        if (k('cities') == null || k('cities') !== ver.cities) out.cities = state.cities.map(c => ({
          id: c.id, tile: c.tile, country: c.country, name: c.name, hp: c.hp, max_hp: c.max_hp, besieged: !!c.besieged }));
        if (k('diplomacy') == null || k('diplomacy') !== ver.diplomacy) out.diplomacy = state.diplomacy || [];
        if (k('country') == null || k('country') !== (countryVer[meCountry] || 0)) out.country = countryPayload(meCountry);
        if (k('notice') == null || k('notice') !== ver.notice) out.notice = [];
        return out;
      }
      if (name === 'war_move') {
        const u = units.find(x => x.id === args.p_unit);
        if (!u) throw err('NO_UNIT', '없는 병력이에요.');
        if (u.country !== meCountry) throw err('NOT_MINE', '우리 나라 병력이 아니에요.');
        fakeAct(u.commander);
        const path = args.p_path || [];
        if (!path.length) throw err('BAD_PATH', '갈 칸을 골라 주세요.');
        if (path.length > (u.moves_left || 0)) throw err('NO_MOVES', '이동력이 모자라요 (남은 이동력 ' + (u.moves_left || 0) + ')');
        let prev = u.tile;
        for (const step of path) {
          if (prev == null || step == null || hexDist(prev, step) !== 1) throw err('BAD_PATH', '이어지지 않는 길이에요.');
          const t = tileAt(step);
          if (!t) throw err('BAD_PATH', '없는 칸이에요.');
          const o = infoAt(step, u);
          if (!W.canPass(u.kind, { terrain: t[1] }, o)) throw err('NO_ENTRY', '지나갈 수 없는 칸이에요.');
          prev = step;
        }
        const last = tileAt(prev);
        if (!W.canStop(u.kind, { terrain: last[1] }, infoAt(prev, u))) {
          throw (occAt(prev).some(x => (x.kind === 'worker' || x.kind === 'scout') === (u.kind === 'worker' || u.kind === 'scout'))
            ? err('TILE_TAKEN', '먼저 온 병력이 있어요. 다른 칸을 골라 주세요.')
            : err('BAD_STOP', '공기는 바다 위에 멈출 수 없어요. 땅으로 가요.'));
        }
        u.tile = prev;
        u.moves_left -= path.length;
        bump('units');
        return { ok: true, unit: u.id, kind: u.kind, tile: u.tile, moves_left: u.moves_left };
      }
      if (name === 'war_transfer') {
        const u = units.find(x => x.id === args.p_unit);
        if (!u) throw err('NO_UNIT', '없는 병력이에요.');
        if (u.country !== meCountry) throw err('NOT_MINE', '우리 나라 병력이 아니에요.');
        fakeAct(u.commander);
        if (u.kind === 'worker' || u.kind === 'scout') throw err('NOT_MILITARY', '노동자와 정찰병은 넘길 수 없어요.');
        const to = args.p_to;
        if (!['army', 'navy', 'air'].includes(to)) throw err('BAD_BRANCH', '육·해·공 참모총장 중에 골라 주세요.');
        if (to === u.commander) throw err('SAME_BRANCH', '이미 그 참모총장이 조종하고 있어요.');
        u.commander = to;
        bump('units');
        return { ok: true, unit: u.id, kind: u.kind, commander: u.commander };
      }
      if (name === 'war_admin_roles') {
        const rows = [];
        let n = 0;
        for (const c of state.countries) {
          for (let i = 0; i < size; i++) {
            n++;
            const nick = '친구' + c.id + '-' + i;
            let role = null, absent = false;
            for (const rk of Object.keys(taken[c.id])) {
              if (taken[c.id][rk].nick === nick) { role = rk; absent = !!taken[c.id][rk].absent; }
            }
            rows.push({ student: n, country: c.id, nick, role, absent });
          }
        }
        return { roles: rows };
      }
      if (name === 'war_admin_set_absent') {
        for (const c of state.countries) for (const rk of Object.keys(taken[c.id] || {})) {
          if ((taken[c.id][rk].nick || '').startsWith('친구')) taken[c.id][rk].absent = !!args.p_absent;
        }
        bump('country', meCountry);
        return { ok: true };
      }
      if (name === 'war_admin_set_role') return { ok: true };   // 미리보기에서는 흉내만
      if (name === 'war_admin_import') {
        bump('map'); bump('units'); bump('cities'); bump('diplomacy'); bump('game');
        return { countries: state.countries.length, tiles: state.tiles.length, units: state.units.length,
          grants: (state.grants || []).filter(g => g.result === 'given').length,
          facilities: (state.facilities || []).length, markets: (state.markets || []).length };
      }
      if (name === 'war_admin_grants') return { grants: state.grants || [] };
      const e = new Error('없는 함수예요: ' + name); e.code = 'BAD_FN'; throw e;
    }
    return { rpc, meCountry };
  }

  let fake = null;
  async function rpc(name, args) {
    if (mode) {
      if (!fake) fake = makeFake(await window.WarData.load());   // 미리보기: 처음 부를 때 가짜 서버 만들기
      const r = await fake.rpc(name, args);
      if (name === 'war_me' && r.country) myCountry = r.country.id;
      return r;
    }
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw cleanError(error);
    if (name === 'war_me' && data.country) myCountry = data.country.id;
    return data;
  }

  // ---------- 4초마다 바뀐 것만 받기 ----------
  let known = {}, timer = 0, wait = 4000, onPoll = null;
  function schedule() { clearInterval(timer); timer = setInterval(tick, wait); }
  async function tick() {
    if (document.hidden || !onPoll) return;
    try {
      const data = await rpc('war_poll', { p_known: known });
      wait = 4000; schedule();
      if (data.versions) known = { ...data.versions, country: data.versions['country:' + myCountry] };
      onPoll(data);
    } catch (e) { wait = Math.min(16000, wait * 2); schedule(); console.error('war_poll 실패 (잠깐 뒤에 다시 해요):', e); }
  }
  function startPoll(cb) {
    onPoll = cb; wait = 4000; known = {};
    tick(); schedule();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }
  function stopPoll() { onPoll = null; clearInterval(timer); }

  window.WarAPI = { mode, rpc, startPoll, stopPoll, makeFake, get country() { return myCountry; } };
})();
