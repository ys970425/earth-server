// 서버 연결 공통 도구
(function () {
  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'earth-server-auth' },
    realtime: { params: { eventsPerSecond: 5 } }
  });

  const PHASES = [
    { n: 0, name: '기업 등록', desc: '기업 이름과 로고를 정하고 로비를 꾸며요.' },
    { n: 1, name: '1차 제작', desc: '신발 2켤레를 만들어요.' },
    { n: 2, name: '1차 시장', desc: '마을을 돌며 다른 회사 신발을 사요. (3표)' },
    { n: 3, name: '1차 결과', desc: '판매 수입을 확인해요.' },
    { n: 4, name: '2차 경영', desc: '연구·공장 확장, 새 신발을 만들어요.' },
    { n: 5, name: '2차 시장', desc: '마을을 돌며 신발을 사요. (4표)' },
    { n: 6, name: '정산 중', desc: '우주 운영진이 정산하고 있어요.' },
    { n: 7, name: '환경 공개', desc: '지구 서버 긴급 경보!' },
    { n: 8, name: '3차 경영', desc: '재료를 바꾸고 친환경 투자를 할 수 있어요.' },
    { n: 9, name: '3차 시장', desc: '마지막 시장이에요. (5표)' },
    { n: 10, name: '최종 결과', desc: '최종 성적표와 지구 게이지를 확인해요.' },
    { n: 11, name: '경영 원칙', desc: '우리 기업의 경영 원칙을 정해요.' }
  ];

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

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
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

  // 실시간 구독: game·group_ticks·notices 변경 시 콜백
  function subscribe(handlers) {
    const ch = sb.channel('es-' + Math.random().toString(36).slice(2));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, p => handlers.game && handlers.game(p.new));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'group_ticks' }, p => handlers.tick && handlers.tick(p.new));
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

  // 환경점수를 음수 없이 말로 표시
  function envText(v) {
    if (v === null || v === undefined) return '???';
    if (v > 0) return '환경 보호 ' + v;
    if (v < 0) return '환경 피해 ' + (-v);
    return '환경 영향 없음';
  }
  const envClass = v => v > 0 ? 'good' : v < 0 ? 'bad' : '';
  const fmt = n => (n === null || n === undefined) ? '???' : Number(n).toLocaleString('ko-KR');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // 모둠 색 = 마을 지붕 색
  const GROUP_COLORS = { 1: '#3B6FE0', 2: '#E0463C', 3: '#F29A2E', 4: '#8A4FD8', 5: '#22A36A', 6: '#EC5C9A' };
  const groupColor = id => GROUP_COLORS[id] || '#3B6FE0';
  const gaugeColor = v => v >= 60 ? 'linear-gradient(180deg,#A8F5C2,#3DCB6C)' : v >= 40 ? 'linear-gradient(180deg,#FFE58A,#F2B530)' : 'linear-gradient(180deg,#FF9AA8,#E0465C)';
  const matImg = id => 'img/mat/' + id + '.webp';

  window.API = { sb, rpc, ensureSession, uploadImage, subscribe, PHASES };
  window.UI = { $, $$, h, toast, modal, envText, envClass, fmt, debounce, groupColor, gaugeColor, matImg };
})();
