// 전자칠판: 세계 지도 전체, 나라 카드, 안정도, 거래량, 큰 사건 연출
(function () {
  const R = window.RULES;
  const { rpc, ensureSession, subscribe, PHASES } = window.API;
  const { h, fmt, debounce, typeColor, gaugeColor, happyWord } = window.UI;
  const root = document.getElementById('app');
  let last = null, map = null, offset = 0;

  async function load() {
    let b; try { b = await rpc('get_board'); } catch (e) { return; }
    const prev = last; last = b;
    offset = new Date(b.now).getTime() - Date.now();
    render(b);
    if (prev) {
      if (!prev.game.world_first && b.game.world_first) overlay('세계 외교의 시대', name(b, b.game.world_first) + '의 정찰대가 세계의 모든 나라를 발견했습니다!', b.countries);
      else if (prev.game.phase < 2 && b.game.phase >= 2) overlay('성장의 한계', '나라가 커지자 시민들이 더 다양한 물건을 원합니다.');
      else if (prev.game.phase < 3 && b.game.phase >= 3) overlay('세계 시장 개방', '이제 다른 나라와 물건을 사고팔 수 있어요. 그리드 링크 세계무역중계가 모든 거래를 안전하게 이어 드려요!', b.countries, null, null, 'grid');
      else if (prev.game.phase < 4 && b.game.phase >= 4 && b.game.phase < 5) Brand.glitch(() => overlay('긴급속보: 그리드 링크의 폭주!', '무역으로 나라들이 크게 성장하자, 세계의 거래를 모두 이어 주던 그리드 링크가 이윤을 끝까지 짜내기 시작했어요. 여섯 나라의 첫 도시를 사들여 오염 공장 「메가팩토리」로 바꿨어요. 환경 규칙을 무시한 공장에서 매연과 폐수가 쏟아져요!', null, 'alarm', null, 'greed'), { big: true });
      else if (prev.game.phase < 5 && b.game.phase >= 5 && b.game.phase < 6) overlay('긴급속보: 불공정 무역!', 'GREED LINK가 관세를 멋대로 올리고(1개마다 +' + R.CRISIS.tariffPerUnit + '코인), 사치품과 핵심 전략 자원은 "저희 독점 상품"이라며 나라끼리 거래를 막았어요. "불만은 상대 나라에 말씀하세요 ^^"', null, 'alarm', null, 'greed');
      else if (prev.game.phase < 6 && b.game.phase >= 6 && b.game.phase < 7) overlay('세계 무역 회의', '활동 2 전문가 회의: 같은 역할끼리 모여 「올바른 무역을 위해 중요한 것」을 한 문장으로 만들어요');
      else if (b.game.phase === 6 && prev.game.meet_step !== b.game.meet_step && b.game.meet_step === 3) overlay('활동 3 · 모둠 회의', '우리 모둠으로 돌아가 전문가 문장을 나눠요. 중요한 두 의견을 골라 그 뜻을 살린 우리 나라 무역 약속을 등록해요!');
      const wtoNow = prev.game.phase < 7 && b.game.phase >= 7 && b.game.phase < 8;
      if (wtoNow) overlay('세계무역기구(WTO)가 탄생했습니다!', '여섯 나라가 함께 정한 무역 약속을 모두가 지키기로 했어요.', null, null,
        b.treaties.map(t => h('div', { class: 'ov-clause', style: { '--gc': typeColor((b.countries.find(c => c.id === t.country) || {}).type) } }, h('b', {}, name(b, t.country)), t.promise || '')));
      else if (prev.game.phase < 8 && b.game.phase >= 8) overlay('정리', '무역을 할 때 필요한 노력을 적어 봅시다');
      // 국가 정상화: WTO 탄생 → (7초) 공정한 무역 회복 → (4초) 영상
      if (!prev.game.normalized && b.game.normalized) {
        const normal = () => overlay('공정한 무역이 돌아왔습니다!', '세계무역기구(WTO)의 분쟁 조정과 개입으로 GREED LINK의 횡포가 멈췄어요. 사치품 수입 → 행복도 회복 · 멋대로 올린 관세 해제 → 물건값 정상 · 메가팩토리 폐쇄 → 도시가 돌아오고 지구가 회복되기 시작', b.countries, null, null, 'wto');
        const wait = wtoNow ? 7000 : 0;
        setTimeout(normal, wait);
        setTimeout(() => showVideo(b.game.video_url), wait + 4000);
      } else if (prev.game.video_seq !== b.game.video_seq) showVideo(b.game.video_url);
      // 최종 도시국가 정복 · 도시 재건 소식은 위쪽 띠로
      b.countries.forEach(c => { const p = prev.countries.find(x => x.id === c.id) || {};
        if (c.final_done && !p.final_done) banner(c.name + ' — 최종 도전 성공!', '무역으로 모은 자원으로 특수 부대를 만들었어요', typeColor(c.type));
      });
    }
  }
  const loadSoon = debounce(load, 500);
  const name = (b, id) => (b.countries.find(c => c.id === id) || {}).name;

  function render(b) {
    const g = b.game;
    if (!root.querySelector('.tb')) {
      root.innerHTML = '';
      root.className = 'board tb';
      root.append(h('div', { class: 'b-head' }, h('div', {}, h('div', { class: 'b-kicker' }, '지구 서버: 문명의 시대 · 제작 조영산'), h('div', { class: 'title b-title', id: 'b-title' }), h('div', { class: 'b-desc', id: 'b-desc' })),
          h('div', { class: 'b-side' }, h('div', { id: 'b-brand', class: 'b-brand' }), h('div', { id: 'b-timer', class: 'b-timer' }), h('div', { id: 'b-turn' }))),
        h('div', { class: 'tb-main' }, h('div', { class: 'tb-map', id: 'tb-map' }, h('canvas', { class: 'hexmap', id: 'tb-canvas' })), h('div', { class: 'tb-right', id: 'tb-right' })));
      map = HexMap.create(document.getElementById('tb-canvas'), {});
      setTimeout(() => map.fitAll(), 50);
    }
    // 정리 단계: 지도는 작게, 행복도·안정도·무역 조항을 크게
    const wrap = g.phase >= 8;
    if (root.classList.contains('wrap-mode') !== wrap) { root.classList.toggle('wrap-mode', wrap); setTimeout(() => map && map.fitAll(), 80); }
    document.getElementById('b-title').textContent = PHASES[g.phase].name;
    document.getElementById('b-desc').textContent = PHASES[g.phase].desc;
    document.getElementById('b-turn').textContent = g.turn ? '턴 ' + g.turn : '';
    // 무역 중계 회사 로고 (세계 시장이 열린 뒤부터)
    const bm = g.phase >= 3 ? Brand.mode(g) : '', bb = document.getElementById('b-brand');
    if (bb.dataset.m !== bm) { bb.dataset.m = bm; bb.innerHTML = ''; if (bm) bb.appendChild(Brand.logo(bm)); }
    const factories = b.countries.filter(c => c.rebel).length;
    root.classList.toggle('smog', factories > 0);
    const tiles = new Map(b.tiles.map(([id, terrain, res, owner, imp]) => [id, { terrain, res, owner, imp }]));
    const countries = Object.fromEntries(b.countries.map(c => [c.id, { color: typeColor(c.type), type: c.type, name: c.name, flag_url: c.flag_url }]));
    map.setData({ tiles, cities: b.cities.map(c => ({ ...c, def: null })), units: [], countries, all: true });
    const right = document.getElementById('tb-right'); right.innerHTML = '';
    right.append(h('div', { class: 'panel b-gauge' }, h('div', { class: 'b-gauge-label' }, '지구 서버 안정도 ', h('b', {}, b.gauge + '%')),
      h('div', { class: 'big-gauge', style: { width: '100%', maxWidth: 'none', margin: '6px 0 0' } }, h('i', { style: { width: b.gauge + '%', background: gaugeColor(b.gauge) } })),
      factories ? h('div', { class: 'b-env' }, '환경 경보! 메가팩토리 ' + factories + '곳 가동 중 — 매연과 폐수로 지구 안정도 -' + factories * R.REBEL.pollution)
        : g.alliance ? h('div', { class: 'b-env ok' }, '메가팩토리 폐쇄 · 환경을 지키는 무역 약속으로 지구가 회복되기 시작했어요') : null));
    if (g.phase >= 4 && g.phase < 6) {
      const bans = [...new Set(Object.values(g.banned || {}).flat())], tars = Object.keys(g.tariffs || {});
      right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, 'GREED LINK의 횡포'),
        bans.length ? h('div', { class: 'b-crisis' }, h('b', {}, '독점 · 거래 금지 '), bans.map(UI.itemName).join(' · ')) : null,
        tars.length ? h('div', { class: 'b-crisis tariff' }, h('b', {}, '관세 폭탄 1개마다 +' + R.CRISIS.tariffPerUnit + '코인 '), '나머지 물건 ' + tars.length + '가지') : null,
        h('table', { class: 'tbl b-dmg' }, h('tr', {}, h('th', {}, '나라'), h('th', {}, '첫 도시'), h('th', {}, '막힌 거래'), h('th', {}, '행복')),
          b.countries.map(c => h('tr', {}, h('td', {}, h('b', { style: { color: typeColor(c.type) } }, c.name)), h('td', { class: c.rebel ? 'bad' : '' }, c.rebel ? '메가팩토리' : '돌아옴'),
            h('td', { class: c.fails ? 'bad' : '' }, c.fails + '번'), h('td', { class: c.happy < 0 ? 'bad' : '' }, c.happy))))));
    } else if (g.phase >= 8) {
      right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '우리 반의 무역 결과'),
        h('table', { class: 'tbl b-dmg b-wrap' }, h('tr', {}, ['나라', '행복도', '군사력', '코인'].map(x => h('th', {}, x))),
          b.countries.map(c => h('tr', {}, h('td', {}, h('b', { style: { color: typeColor(c.type) } }, c.name)), h('td', { class: c.happy < 0 ? 'bad' : '' }, c.happy),
            h('td', {}, c.units + '부대'), h('td', {}, fmt(c.coin)))))),
        h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '여섯 나라의 무역 약속'),
          b.treaties.map(t => h('div', { class: 'b-sentence', style: { borderLeftColor: typeColor((b.countries.find(c => c.id === t.country) || {}).type) } }, h('b', {}, name(b, t.country) + ' '), t.promise || ''))));
    } else if (g.phase === 6 && !b.treaties.length) {
      right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, g.meet_step === 3 ? '활동 3 · 모둠 회의' : '활동 2 · 전문가 회의'),
        (g.meet_step === 3 ? ['우리 모둠으로 돌아와 전문가 문장을 나눠요', '중요하다고 생각하는 두 의견 고르기', '두 의견의 뜻을 살려 「우리가 제안한 약속은 (   )입니다.」', '국가 대표가 등록 → 6나라가 모이면 세계무역기구(WTO) 탄생!']
          : ['같은 역할끼리 모여요 (대표·국방·기획·국토·과학기술)', '화면의 질문을 함께 이야기해요', '「올바른 무역을 위해 (   ).」 한 문장을 직접 써요', '각자 앱에 저장해요']).map(x => h('div', { class: 'b-sentence' }, x))));
    } else if (g.phase >= 6 && b.treaties.length) {
      right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '세계 무역 약속 ' + b.treaties.length + '/6' + (g.alliance ? ' · WTO 탄생!' : '')),
        b.treaties.map(t => h('div', { class: 'b-sentence', style: { borderLeftColor: typeColor((b.countries.find(c => c.id === t.country) || {}).type) } },
          h('b', {}, name(b, t.country) + ' '), t.promise || '', h('div', { class: 'muted' }, t.reason || ''), g.alliance ? h('small', { class: 'b-ok' }, 'WTO 약속 ✓') : null))));
    } else {
      right.append(h('div', { class: 'tb-cards' }, b.countries.map(c => h('div', { class: 'panel tb-card', style: { '--gc': typeColor(c.type) } },
        c.flag_url ? h('img', { src: c.flag_url, class: 'tb-flag' }) : h('div', { class: 'tb-flag none' }, c.id),
        h('div', { class: 'tb-info' }, h('b', {}, c.name), (c.name !== c.type_name || c.title) ? h('small', {}, (c.name !== c.type_name ? c.type_name : '') + (c.title ? (c.name !== c.type_name ? ' · ' : '') + c.title : '')) : null,
          h('div', { class: 'tb-nums' }, h('span', {}, '도시 ' + c.cities), h('span', { class: c.happy < 0 ? 'bad' : '' }, '행복 ' + c.happy), h('span', {}, '발견 ' + c.discovered + '/5'),
            g.market_open ? h('span', {}, '수출 ' + c.exports + ' · 수입 ' + c.imports) : null))))));
      if (g.market_open) {
        const max = Math.max(1, ...b.volume.map(v => v.qty));
        right.append(h('div', { class: 'panel' }, h('div', { class: 'b-rank-title' }, '턴별 거래량'),
          h('div', { class: 'vol' }, b.volume.map(v => h('div', { class: 'vol-bar' }, h('i', { style: { height: (v.qty / max * 100) + '%' } }), h('small', {}, v.qty), h('span', {}, v.turn))))));
      }
    }
    tick();
  }
  function tick() {
    const el = document.getElementById('b-timer'); if (!el || !last) return;
    const g = last.game, end = g.timer_end || g.turn_end;
    if (!end) { el.style.display = 'none'; return; }
    const left = Math.round((new Date(end).getTime() - (Date.now() + offset)) / 1000);
    el.style.display = '';
    el.className = 'b-timer' + (left <= 0 ? ' over' : left <= 30 ? ' soon' : '');
    el.textContent = (g.timer_end ? (g.timer_label || '활동') : '다음 턴까지') + ' ' + (left <= 0 ? '0:00' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
  }
  setInterval(tick, 1000);

  // 정상화 뒤 영상: 유튜브 주소면 유튜브로, 아니면 영상 파일로
  function showVideo(url) {
    if (!url) return;
    document.querySelectorAll('.alarm, .b-video').forEach(x => x.remove());
    const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(url);
    const media = m ? h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?autoplay=1&rel=0', allow: 'autoplay; encrypted-media; fullscreen', allowfullscreen: true })
      : h('video', { src: url, autoplay: true, controls: true });
    const box = h('div', { class: 'b-video' }, h('div', { class: 'b-video-head' }, h('b', {}, '현실에서도 무역 다툼이 생기면?'), h('small', {}, '소리가 안 나오면 화면의 재생 버튼을 눌러요'), h('button', { onclick: () => box.remove() }, '닫기')), media);
    document.body.appendChild(box);
  }
  function banner(title, sub, color) {
    let box = document.getElementById('b-banners');
    if (!box) { box = h('div', { id: 'b-banners' }); document.body.appendChild(box); }
    const el = h('div', { class: 'b-banner', style: { '--gc': color } }, h('b', {}, title), h('span', {}, sub));
    box.appendChild(el); setTimeout(() => el.classList.add('out'), 6000); setTimeout(() => el.remove(), 6800);
  }
  function overlay(title, msg, countries, kind, extra, brand) {
    document.querySelectorAll('.alarm').forEach(x => x.remove());
    const ov = h('div', { class: 'alarm ' + (kind === 'alarm' ? '' : 'calm'), onclick: () => ov.remove() },
      brand ? h('div', { style: { width: 'min(560px, 70vw)', margin: '0 auto 10px' } }, Brand.logo(brand)) : null,
      h('h2', {}, title), h('p', { style: { fontSize: '30px' } }, msg),
      countries ? h('div', { class: 'ov-flags' }, countries.map((c, i) => h('div', { class: 'ov-flag', style: { animationDelay: (i * 0.25) + 's', '--gc': typeColor(c.type) } },
        c.flag_url ? h('img', { src: c.flag_url }) : h('div', { class: 'none' }, c.id), h('span', {}, c.name)))) : null,
      extra && extra.length ? h('div', { class: 'ov-clauses' }, extra) : null,
      h('div', { style: { fontSize: '18px', marginTop: '20px', opacity: .8 } }, '(화면을 누르면 닫혀요)'));
    document.body.appendChild(ov);
  }

  (async function start() {
    try { await ensureSession(); } catch (e) { root.textContent = e.message; return; }
    await load();
    subscribe({ game: loadSoon, tick: loadSoon });
    setInterval(load, 8000);
    document.addEventListener('keydown', e => { if (e.key === 'f' && map) map.fitAll(); if (e.key === 'Escape') document.querySelectorAll('.alarm').forEach(x => x.remove()); });
  })();
})();
