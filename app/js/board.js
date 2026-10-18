// 전자칠판 화면 (교실 앞 TV용, 읽기 전용)
(function () {
  const { rpc, ensureSession, subscribe, PHASES } = window.API;
  const { h, envText, envClass, fmt, debounce } = window.UI;
  const root = document.getElementById('app');
  let last = null, shownAlarm = false, shownFinal = false;

  function gaugeColor(v) { return v >= 60 ? '#6FD08C' : v >= 40 ? '#F2C230' : '#E05A4F'; }

  async function load() {
    let b;
    try { b = await rpc('get_board'); } catch (e) { return; }
    const prev = last; last = b;
    render(b);
    // 7단계로 막 넘어온 순간 경보 연출
    if (b.phase === 7 && prev && prev.phase < 7 && !shownAlarm) { shownAlarm = true; alarm(b); }
    if (b.phase === 10 && prev && prev.phase < 10 && !shownFinal) { shownFinal = true; final(b); }
  }
  const loadSoon = debounce(load, 500);

  function render(b) {
    root.innerHTML = '';
    root.style.padding = '18px';
    const ph = PHASES[b.phase];
    const g = b.revealed ? Number(b.gauge) : null;
    const bar = h('i', { style: { width: (g === null ? 100 : g) + '%', background: g === null ? '#9AA0A6' : gaugeColor(g) } });
    root.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '14px' } },
      h('div', {}, h('div', { style: { fontSize: '22px', opacity: .7 } }, '지구 서버 신발 시장'),
        h('div', { style: { fontSize: '44px' } }, b.phase + '. ' + ph.name), h('div', { style: { fontSize: '22px' } }, ph.desc)),
      h('div', { style: { textAlign: 'right', fontSize: '22px' } }, '입장 ' + b.joined + '명',
        [2, 5, 9].includes(b.phase) ? h('div', { style: { fontSize: '30px' } }, '구매 확정 ' + b.voted + '명') : null)));
    root.appendChild(h('div', { class: 'panel', style: { marginBottom: '18px' } },
      h('div', { style: { fontSize: '28px', marginBottom: '6px' } }, '🌏 지구 게이지 ', h('b', {}, g === null ? '???' : g + '%'),
        g !== null ? h('span', { style: { fontSize: '18px', opacity: .7 } }, '   (공동 보너스 기준 ' + b.threshold + '%)') : null),
      h('div', { class: 'big-gauge', style: { width: '100%', maxWidth: 'none' } }, bar)));
    root.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' } },
      b.groups.map(gr => h('div', { class: 'panel center', style: { minHeight: '170px' } },
        gr.logo_url ? h('img', { src: gr.logo_url, style: { width: '84px', height: '84px', objectFit: 'contain' } }) : h('div', { style: { fontSize: '60px' } }, '👟'),
        h('div', { style: { fontSize: '28px' } }, gr.company_name || gr.label),
        h('div', { style: { fontSize: '18px', opacity: .7 } }, gr.label),
        b.revealed ? h('div', { style: { fontSize: '22px', marginTop: '6px' } }, '종합점수 ', h('b', {}, fmt(gr.score)),
          ' · ', h('span', { class: envClass(gr.env) }, envText(gr.env))) : null))));
  }

  function alarm(b) {
    const target = Number(b.gauge);
    const bar = h('i', { style: { width: '100%' } });
    const num = h('b', {}, '100%');
    const ov = h('div', { class: 'alarm', onclick: () => ov.remove() },
      h('h2', {}, '🚨 지구 서버 긴급 경보 🚨'),
      h('p', { style: { fontSize: '30px' } }, '숨겨져 있던 환경점수가 공개되었습니다.'),
      h('div', { class: 'big-gauge' }, bar),
      h('div', { style: { fontSize: '40px' } }, '지구 게이지 ', num),
      h('div', { style: { fontSize: '18px', marginTop: '20px', opacity: .8 } }, '(화면을 누르면 닫혀요)'));
    document.body.appendChild(ov);
    setTimeout(() => { bar.style.width = target + '%'; bar.style.background = gaugeColor(target); }, 600);
    let v = 100;
    const t = setInterval(() => { v = Math.max(target, v - 1); num.textContent = Math.round(v) + '%'; if (v <= target) clearInterval(t); }, 40);
  }

  function final(b) {
    const ok = Number(b.gauge) >= Number(b.threshold);
    const ov = h('div', { class: 'alarm', onclick: () => ov.remove(), style: { background: ok ? 'rgba(20,110,60,.92)' : 'rgba(40,60,90,.92)', animation: 'none' } },
      h('h2', {}, ok ? '🌏 지구 서버가 회복되었습니다!' : '🌏 최종 결과 발표'),
      h('p', { style: { fontSize: '30px' } }, ok ? '모든 기업에 공동 보너스가 지급됩니다!' : '지구 서버는 아직 회복 중이에요.'),
      h('div', { style: { fontSize: '44px' } }, '지구 게이지 ' + b.gauge + '%'));
    document.body.appendChild(ov);
  }

  (async function start() {
    try { await ensureSession(); } catch (e) { root.textContent = e.message; return; }
    await load();
    subscribe({ game: loadSoon, tick: loadSoon });
    setInterval(load, 8000);
    // 수동으로 다시 보기: A = 경보, F = 최종
    document.addEventListener('keydown', e => {
      if (!last) return;
      if (e.key === 'a' && last.revealed) alarm(last);
      if (e.key === 'f' && last.phase >= 10) final(last);
    });
  })();
})();
