// 전쟁 버전 서버 연결 층 (E2 H4)
// - 서버 모드: 무역 앱과 같은 Supabase 설정·로그인(storageKey 'earth-trade-auth')을 그대로 이어받아요.
//   새로 익명 로그인을 만들지 않아요 (Q-A A). 교사도 같은 브라우저의 무역 관제실 로그인을 씁니다 (Q-B A).
// - 미리보기 모드(?preview=1 / ?preview=real): 브라우저 PGlite에서 진짜 SQL을 실행해요.
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

  // ---------- 미리보기 SQL DB (브라우저 메모리에서만) ----------
  let previewDb = null;
  async function rpc(name, args) {
    if (mode) {
      previewDb ||= import('./war-preview-db.js');
      const r = await (await previewDb).rpc(name, args);
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

  window.WarAPI = { mode, rpc, startPoll, stopPoll, get country() { return myCountry; } };
})();
