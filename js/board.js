// 전자칠판 화면 (교실 앞 TV용, 읽기 전용)
(function () {
  const { rpc, ensureSession, subscribe, PHASES } = window.API;
  const { h, envText, envClass, fmt, debounce, groupColor, gaugeColor } = window.UI;
  const root = document.getElementById('app');
  let last = null, shownAlarm = false, shownFinal = false;


  let view = null, viewPhase = null, offset = 0;
  const autoView = ph => ph >= 11 ? 'principles' : ph >= 7 ? 'rank' : 'cards';

  async function load() {
    let b;
    try { b = await rpc('get_board'); } catch (e) { return; }
    const prev = last; last = b;
    if (b.now) offset = new Date(b.now).getTime() - Date.now();
    if (viewPhase !== b.phase) { view = autoView(b.phase); viewPhase = b.phase; }
    render(b);
    // 7단계로 막 넘어온 순간 경보 연출
    if (b.phase === 7 && prev && prev.phase < 7 && !shownAlarm) { shownAlarm = true; alarm(b); }
    if (b.phase === 10 && prev && prev.phase < 10 && !shownFinal) { shownFinal = true; final(b); }
  }
  const loadSoon = debounce(load, 500);

  function tickTimer() {
    const el = document.getElementById('b-timer'), t = last && last.timer;
    if (!el) return;
    if (!t || !t.end) { el.style.display = 'none'; return; }
    const left = Math.round((new Date(t.end).getTime() - (Date.now() + offset)) / 1000);
    el.style.display = '';
    el.className = 'b-timer' + (left <= 0 ? ' over' : left <= 60 ? ' soon' : '');
    el.textContent = (t.label ? t.label + '  ' : '') + (left <= 0 ? '시간 끝!' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
  }
  setInterval(tickTimer, 1000);

  function render(b) {
    root.innerHTML = '';
    root.className = 'board';
    const ph = PHASES[b.phase];
    const g = b.revealed ? Number(b.gauge) : null;
    const bar = h('i', { style: { width: (g === null ? 100 : g) + '%', background: g === null ? '#9AA0A6' : gaugeColor(g) } });
    const tabs = [['cards', '기업', true], ['rank', '순위 비교', b.revealed], ['principles', '경영 원칙', b.phase >= 10]];
    root.appendChild(h('div', { class: 'b-head' },
      h('div', {}, h('div', { class: 'b-kicker' }, '지구 서버 신발 시장'), h('div', { class: 'title b-title' }, ph.name), h('div', { class: 'b-desc' }, ph.desc)),
      h('div', { class: 'b-side' },
        h('div', { id: 'b-timer', class: 'b-timer', style: { display: 'none' } }),
        h('div', {}, '입장 ' + b.joined + '명', [2, 5, 9].includes(b.phase) ? ' · 구매 확정 ' + b.voted + '명' : ''),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, tabs.filter(t => t[2]).map(([k, label]) =>
          h('button', { class: 'small ' + (view === k ? 'gold' : 'ghost'), onclick: () => { view = k; render(b); } }, label))))));
    root.appendChild(h('div', { class: 'panel b-gauge' },
      h('div', { class: 'b-gauge-label' }, '지구 게이지 ', h('b', {}, g === null ? '???' : g + '%'),
        g !== null ? h('span', { style: { fontSize: '18px', opacity: .7 } }, '   (공동 보너스 기준 ' + b.threshold + '%)') : null),
      h('div', { class: 'big-gauge', style: { width: '100%', maxWidth: 'none', margin: '6px 0 0' } }, bar)));
    if (view === 'rank' && b.revealed) root.appendChild(rankView(b));
    else if (view === 'principles' && b.phase >= 10) root.appendChild(principleView(b));
    else root.appendChild(cardsView(b));
    tickTimer();
  }

  const gname = gr => gr.company_name || gr.label;
  function logoOf(gr, size) {
    return gr.logo_url ? h('img', { src: gr.logo_url, style: { height: size + 'px', maxWidth: (size * 2) + 'px', objectFit: 'contain' } })
      : h('div', { class: 'b-logo-num', style: { background: groupColor(gr.id), width: size + 'px', height: size + 'px', fontSize: (size * 0.5) + 'px' } }, gr.id);
  }

  function cardsView(b) {
    return h('div', { class: 'b-cards' }, b.groups.map(gr => h('div', { class: 'panel center', style: { borderTop: '14px solid ' + groupColor(gr.id) } },
      logoOf(gr, 84), h('div', { style: { fontSize: '28px' } }, gname(gr)), h('div', { style: { fontSize: '18px', opacity: .7 } }, gr.label),
      b.revealed ? h('div', { style: { fontSize: '22px', marginTop: '6px' } }, '종합점수 ', h('b', {}, fmt(gr.score)), ' · ', h('span', { class: envClass(gr.env) }, envText(gr.env))) : null)));
  }

  // 돈 순위 vs 종합점수 순위
  function rankView(b) {
    const byPerf = [...b.groups].sort((a, c) => c.perf - a.perf);
    const byScore = [...b.groups].sort((a, c) => c.score - a.score);
    const perfRank = Object.fromEntries(byPerf.map((gr, i) => [gr.id, i + 1]));
    const row = (gr, i, val, extra) => h('div', { class: 'b-rank-row', style: { '--gc': groupColor(gr.id) } },
      h('span', { class: 'b-rank-n' }, i + 1), logoOf(gr, 40), h('span', { class: 'b-rank-name' }, gname(gr)),
      h('span', { class: 'b-rank-val' }, fmt(val)), extra || null);
    return h('div', { class: 'b-rank' },
      h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '이윤 순위', h('small', {}, '판매 수입 − 비용')),
        byPerf.map((gr, i) => row(gr, i, gr.perf))),
      h('div', { class: 'b-rank-arrow' }, '환경점수\n더하기 →'),
      h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '종합점수 순위', h('small', {}, '환경까지 더한 점수')),
        byScore.map((gr, i) => {
          const d = perfRank[gr.id] - (i + 1);
          return row(gr, i, gr.score, h('span', { class: 'b-rank-move ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, d > 0 ? '▲' + d : d < 0 ? '▼' + (-d) : '−'));
        })));
  }

  // 모둠 경영 원칙 + 학생 한 문장 (이름 없이)
  function principleView(b) {
    const wrap = h('div', {});
    wrap.appendChild(h('div', { class: 'b-cards' }, b.groups.map(gr => h('div', { class: 'panel b-principle', style: { borderTop: '14px solid ' + groupColor(gr.id) } },
      h('div', { class: 'row', style: { gap: '10px' } }, logoOf(gr, 40), h('b', { style: { fontSize: '22px' } }, gname(gr))),
      h('div', { class: 'b-principle-text' }, gr.principle || '아직 등록 전이에요')))));
    const sents = b.sentences || [];
    wrap.appendChild(h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('div', { class: 'b-rank-title' }, '기업이 사회적 책임을 다해야 하는 까닭', h('small', {}, sents.length + '명')),
      h('div', { class: 'b-sentences' }, sents.map(x => h('div', { class: 'b-sentence', style: { borderLeftColor: groupColor(x.group_id) } }, x.body)))));
    return wrap;
  }

  const clearOverlays = () => document.querySelectorAll('.alarm').forEach(x => x.remove());
  function alarm(b) {
    clearOverlays();
    const target = Number(b.gauge);
    const bar = h('i', { style: { width: '100%' } });
    const num = h('b', {}, '100%');
    const ov = h('div', { class: 'alarm', onclick: () => ov.remove() },
      h('h2', {}, '지구 서버 긴급 경보'),
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
    clearOverlays();
    const ok = Number(b.gauge) >= Number(b.threshold);
    const ov = h('div', { class: 'alarm calm ' + (ok ? '' : 'dim'), onclick: () => ov.remove() },
      h('h2', {}, ok ? '지구 서버가 회복되었습니다!' : '최종 결과 발표'),
      h('p', { style: { fontSize: '30px' } }, ok ? '모든 기업에 공동 보너스가 지급됩니다!' : '지구 서버는 아직 회복 중이에요.'),
      h('div', { style: { fontSize: '44px' } }, '지구 게이지 ' + b.gauge + '%'));
    document.body.appendChild(ov);
  }

  (async function start() {
    try { await ensureSession(); } catch (e) { root.textContent = e.message; return; }
    await load();
    subscribe({ game: loadSoon, tick: loadSoon });
    setInterval(load, 8000);
    // 수동으로 다시 보기: A = 경보, F = 최종, 1·2·3 = 화면 바꾸기
    document.addEventListener('keydown', e => {
      if (!last) return;
      if (e.key === 'a' && last.revealed) alarm(last);
      if (e.key === 'f' && last.phase >= 10) final(last);
      const k = { 1: 'cards', 2: 'rank', 3: 'principles' }[e.key];
      if (k) { view = k; render(last); }
    });
  })();
})();
