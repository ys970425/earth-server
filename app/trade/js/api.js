// 서버 연결 공통 도구
(function () {
  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'earth-trade-auth' },
    realtime: { params: { eventsPerSecond: 5 } }
  });

  const PHASES = window.RULES.PHASES;

  async function ensureSession() {
    const { data } = await sb.auth.getSession();
    if (data && data.session) return data.session;
    const r = await sb.auth.signInAnonymously();
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
    get_roster: ['p_country'], join_student: ['p_student'], set_role: ['p_role'], country_update: ['p'],
    worker_build: ['p_tile', 'p_kind'], hire_worker: ['p_city'], city_build: ['p_city', 'p_building'], train_unit: ['p_city', 'p_kind'],
    attack_city: ['p_city'], scout_move: ['p_unit', 'p_path'], factory_build: ['p_kind'], advanced_build: ['p_kind'],
    offer_create: ['p_to', 'p_give_item', 'p_give_qty', 'p_get_item', 'p_get_qty'], offer_cancel: ['p_offer'], offer_respond: ['p_offer', 'p_accept'],
    treaty_submit: ['p_focus', 'p_problem', 'p_promise', 'p_reason'], reflection_submit: ['p_body'],
    admin_login: ['p_pw'], admin_observe: ['p_country'], admin_control: ['p_country'], unit_move: ['p_unit', 'p_path'], unit_attack: ['p_unit', 'p_city'], research_tech: ['p_tech'], admin_next_turn: ['p_from'], admin_set_phase: ['p_target'], admin_force_phase: ['p_target'], admin_auto_turn: ['p_seconds'], admin_timer: ['p_seconds', 'p_label'],
    admin_flags: ['p'], admin_set_type: ['p_country', 'p_type'], admin_roster_import: ['p_rows'], admin_set_leader: ['p_student', 'p_on'],
    admin_reset_binding: ['p_student'], admin_approve: ['p_request'], admin_approve_group: ['p_country'], admin_reject: ['p_request'],
    admin_grant: ['p_country', 'p_items', 'p_reason'], admin_relief: ['p_country'], admin_turn_help: ['p_country'], admin_explore_help: ['p_country'],
    admin_broker_trade: ['p_country', 'p_item', 'p_qty', 'p_coin'], admin_notice: ['p_message'], admin_reset_game: ['p_confirm'],
    admin_event: ['p_kind', 'p_args'], admin_preview_event: ['p_kind', 'p_args']
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
  function subscribe(handlers) {
    const ch = sb.channel('et-' + Math.random().toString(36).slice(2));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, p => handlers.game && handlers.game(p.new));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'country_ticks' }, p => handlers.tick && handlers.tick(p.new));
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notices' }, p => handlers.notice && handlers.notice(p.new));
    ch.subscribe();
    return ch;
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
    const t = h('div', { class: 'toast ' + (kind || '') }, msg);
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4800);
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

  // 나라 색은 유형별 (rules.js)
  const typeColor = t => (window.RULES.TYPES[t] || {}).color || '#3B6FE0';
  const gaugeColor = v => v >= 70 ? 'linear-gradient(180deg,#A8F5C2,#3DCB6C)' : v >= 45 ? 'linear-gradient(180deg,#FFE58A,#F2B530)' : 'linear-gradient(180deg,#FF9AA8,#E0465C)';
  const itemName = k => k === 'coin' ? '코인' : ((window.RULES.ITEMS[k] || {}).name || k);
  const itemImg = k => 'img/res/' + k + '.png';
  const costText = cost => Object.entries(cost || {}).map(([k, v]) => itemName(k) + ' ' + v).join(' · ');
  const happyWord = v => v >= 70 ? '황금기' : v >= 40 ? '보통' : v >= 25 ? '불만' : '불안';

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
  window.UI = { $, $$, h, toast, modal, fmt, debounce, typeColor, gaugeColor, itemName, itemImg, costText, happyWord };
})();
