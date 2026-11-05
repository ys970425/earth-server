// 서버 연결 공통 도구
(function () {
  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    // lock: 여러 탭(학생·관제실·전자칠판)이 서로 기다리다 멈추지 않게 브라우저 잠금을 쓰지 않아요
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'earth-trade-auth', lock: async (name, timeout, fn) => await fn() },
    realtime: { params: { eventsPerSecond: 5 } }
  });

  const PHASES = window.RULES.PHASES;

  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  async function ensureSession() {
    // 저장된 접속 정보가 만료돼 다시 받는 데 막히면(학교 전체가 한꺼번에 접속할 때) 버리고 새로 로그인해요
    try {
      const { data, error } = await within(sb.auth.getSession(), 6000);
      if (!error && data && data.session) return data.session;
    } catch (e) {
      try { localStorage.removeItem('earth-trade-auth'); } catch (x) { }
      try { await within(sb.auth.signOut({ scope: 'local' }), 3000); } catch (x) { }
    }
    const r = await within(sb.auth.signInAnonymously(), 12000);
    if (r.error) throw new Error('접속에 실패했어요. 인터넷 연결을 확인해 주세요. (' + r.error.message + ')');
    return r.data.session;
  }

  // 서버 에러 'CODE: 메시지' → 메시지만
  function cleanError(e) {
    const msg = (e && (e.message || e.details || e.hint)) || String(e);
    const m = msg.match(/^[A-Z_]+:\s*(.*)$/s);
    const err = new Error(m ? m[1] : msg);
    err.code = (msg.match(/^([A-Z_]+):/) || [])[1] || 'ERROR';
    return err;
  }

  // 서버 함수 인자 이름 (rpc('함수', 값1, 값2…) 형태로 부르기 위해)
  const PARAMS = {
    get_roster: ['p_country'], join_student: ['p_student', 'p_nick'], set_role: ['p_role'], country_update: ['p'],
    worker_build: ['p_tile', 'p_kind'], hire_worker: ['p_city'], city_build: ['p_city', 'p_building'], train_unit: ['p_city', 'p_kind'],
    attack_city: ['p_city'], scout_move: ['p_unit', 'p_path'], factory_build: ['p_kind'], advanced_build: ['p_kind'],
    offer_create: ['p_to', 'p_give_item', 'p_give_qty', 'p_get_item', 'p_get_qty'], offer_cancel: ['p_offer'], offer_respond: ['p_offer', 'p_accept'],
    treaty_submit: ['p_focus', 'p_problem', 'p_promise', 'p_reason'], reflection_submit: ['p_body'],
    admin_login: ['p_pw'], admin_observe: ['p_country'], admin_control: ['p_country'], unit_move: ['p_unit', 'p_path'], worker_demolish: ['p_tile'], unit_attack: ['p_unit', 'p_city'], research_tech: ['p_tech'], admin_next_turn: ['p_from'], admin_set_phase: ['p_target'], admin_force_phase: ['p_target'], admin_auto_turn: ['p_seconds'], admin_timer: ['p_seconds', 'p_label'],
    admin_flags: ['p'], admin_set_type: ['p_country', 'p_type'], admin_roster_import: ['p_rows'], admin_set_leader: ['p_student', 'p_on'],
    admin_reset_binding: ['p_student'], admin_approve: ['p_request'], admin_approve_group: ['p_country'], admin_reject: ['p_request'],
    admin_grant: ['p_country', 'p_items', 'p_reason'], admin_relief: ['p_country'], admin_turn_help: ['p_country'], admin_explore_help: ['p_country'],
    admin_broker_trade: ['p_country', 'p_item', 'p_qty', 'p_coin'], admin_notice: ['p_message'], admin_reset_game: ['p_confirm'], admin_reset_all: ['p_confirm', 'p_unbind'], unit_disband: ['p_unit'], poll_state: ['p_after'],
    admin_event: ['p_kind', 'p_args'], admin_preview_event: ['p_kind', 'p_args'],
    admin_merchant: ['p_country', 'p_items'], admin_boss_help: ['p_country'], expert_submit: ['p_role', 'p_body'], admin_normalize: [], admin_video: []
  };
  async function rpc(fn, ...vals) {
    let args = {};
    if (PARAMS[fn]) PARAMS[fn].forEach((k, i) => { if (vals[i] !== undefined) args[k] = vals[i]; });
    else if (vals[0] && typeof vals[0] === 'object') args = vals[0];
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw cleanError(error);
    return data;
  }

  // 배경처럼 큰 그림은 JPEG(용량↓), 로고는 PNG(투명 배경 유지)
  async function uploadImage(file, folder, maxSize, type) {
    type = type || 'image/png';
    const blob = await shrinkImage(file, maxSize || 800, type);
    const ext = type === 'image/jpeg' ? 'jpg' : 'png';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from('images').upload(path, blob, { contentType: type, upsert: false });
    if (error) throw new Error('그림을 올리지 못했어요: ' + error.message);
    return sb.storage.from('images').getPublicUrl(path).data.publicUrl;
  }

  function shrinkImage(file, max, type) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        const ctx = c.getContext('2d');
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? resolve(b) : reject(new Error('그림 변환 실패')), type, 0.88);
      };
      img.onerror = () => reject(new Error('그림 파일을 읽지 못했어요.'));
      img.src = URL.createObjectURL(file);
    });
  }

  // 실시간 구독: game·country_ticks·notices 변경 시 콜백
  // 바뀐 것이 있는지 3초마다 가볍게 확인해요 (실시간 연결은 무료 서버를 멈추게 해서 쓰지 않아요)
  function subscribe(handlers) {
    let last = null, busy = false, timer = null;
    async function tick() {
      if (busy) return; busy = true;
      try {
        const r = await rpc('poll_state', last ? last.top : 0);
        if (last) {
          if (r.game !== last.game && handlers.game) handlers.game({ ver: r.game });
          for (const [k, v] of Object.entries(r.ticks || {})) if ((last.ticks || {})[k] !== v && handlers.tick) handlers.tick({ country_id: +k, ver: v });
          for (const n of r.notices || []) if (handlers.notice) handlers.notice(n);
        }
        last = { game: r.game, ticks: r.ticks, top: Math.max(r.top || 0, (last && last.top) || 0) };
      } catch (e) { /* 잠깐 실패하면 다음에 다시 */ }
      busy = false;
    }
    const loop = () => { timer = setTimeout(async () => { await tick(); loop(); }, (document.hidden ? 10000 : 3000) + Math.random() * 800); };
    tick().then(loop);
    return { unsubscribe: () => clearTimeout(timer) };
  }

  // 화면 도우미
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function toast(msg, kind) {
    let box = $('#toasts');
    if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box); }
    const t = h('div', { class: 'toast ' + (kind || ''), title: '누르면 닫혀요', onclick: () => t.remove() }, msg);
    box.appendChild(t);
    // 활동 안내 같은 긴 알림은 오래 (누르면 닫혀요)
    const ms = /long/.test(kind || '') || String(msg).length > 45 ? 15000 : 4200;
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 600);
  }

  function modal(content, opts) {
    opts = opts || {};
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal ' + (opts.wide ? 'wide' : '') });
    const close = () => { back.remove(); opts.onClose && opts.onClose(); };
    if (!opts.noClose) box.appendChild(h('button', { class: 'modal-x', onclick: close, 'aria-label': '닫기' }, '×'));
    box.appendChild(content);
    back.appendChild(box);
    back.addEventListener('click', e => { if (e.target === back && !opts.noClose) close(); });
    document.body.appendChild(back);
    return { close, box };
  }

  const fmt = n => (n === null || n === undefined) ? '???' : Number(n).toLocaleString('ko-KR');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  // 서버를 쉬게: 한 번에 하나만, 앞의 요청이 시작되고 gap 밀리초가 지나야 다음 요청 (그 사이 부탁은 하나로 모아요)
  const calm = (fn, gap) => { let running = false, want = false, lastStart = 0, t = null;
    const go = async () => { t = null; if (running) { want = true; return; }
      const wait = lastStart + gap - Date.now(); if (wait > 0) { t = setTimeout(go, wait); return; }
      running = true; want = false; lastStart = Date.now();
      try { await fn(); } catch (e) { console.warn(e); } finally { running = false; if (want && !t) t = setTimeout(go, Math.max(0, lastStart + gap - Date.now())); } };
    return () => { if (running) { want = true; return; } if (!t) go(); }; };

  // 나라 색은 유형별 (rules.js)
  const typeColor = t => (window.RULES.TYPES[t] || {}).color || '#3B6FE0';
  const gaugeColor = v => v >= 70 ? 'linear-gradient(180deg,#A8F5C2,#3DCB6C)' : v >= 45 ? 'linear-gradient(180deg,#FFE58A,#F2B530)' : 'linear-gradient(180deg,#FF9AA8,#E0465C)';
  const itemName = k => k === 'coin' ? '코인' : ((window.RULES.ITEMS[k] || {}).name || k);
  const itemImg = k => 'img/res/' + k + '.png';
  const costText = cost => Object.entries(cost || {}).map(([k, v]) => itemName(k) + ' ' + v).join(' · ');
  const happyWord = v => v >= 30 ? '황금기' : v >= 0 ? '보통' : v >= -20 ? '불만' : '불안';

  // 그림이 아직 없는 물건(강철·반도체 등)은 글자 배지로 대신 보여 줌
  document.addEventListener('error', e => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.fb) return;
    img.dataset.fb = '1';
    const m = /img\/res\/(\w+)\.png/.exec(img.getAttribute('src') || '');
    const label = img.getAttribute('alt') || (m ? itemName(m[1]) : '');
    if (!label) { img.style.visibility = 'hidden'; return; }
    const b = document.createElement('span');
    b.className = 'img-fb ' + img.className;
    b.textContent = label;
    img.replaceWith(b);
  }, true);

  window.API = { sb, rpc, ensureSession, uploadImage, subscribe, PHASES };
  window.UI = { $, $$, h, toast, modal, fmt, debounce, calm, typeColor, gaugeColor, itemName, itemImg, costText, happyWord };
})();
