// E11 성찰 양식 (설계 12-6): 게임이 끝난 뒤 학생이 돌아보는 화면
// 질문 글은 여기 QUESTIONS 한 곳에만 둔다 — 선생님이 나중에 고치기 쉽게.
// 학생은 한 번만 보낸다(수정 불가). 교사가 관제실에서 「성찰 열기 / 닫기」로 연다.
(function () {
  const $ = s => document.querySelector(s);
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

  window.WAR_REFLECT = {
    // 큰 버튼으로 고르기 3문항 (한 문항에 버튼 3~4개, 한 번에 하나만 고름) + 짧은 글 1문항
    QUESTIONS: [
      { text: '우리 나라는 자원을 어떻게 나눴나요?',
        answers: ['모두 똑같이', '급한 역할 먼저', '이유를 잘 말한 사람 먼저', '잘 모르겠어요'] },
      { text: '내 요청이 거절되거나 줄었을 때 어땠나요?',
        answers: ['이해했어요', '조금 속상했어요', '이유를 더 듣고 싶었어요', '그런 일이 없었어요'] },
      { text: '다시 한다면 무엇을 바꾸고 싶나요?',
        answers: ['미리 의논하기', '더 아껴 쓰기', '외교·무역 더 하기', '바꿀 게 없어요'] },
    ],
    FREE_QUESTION: '자원을 나눌 때 가장 고민한 것은?',
    FREE_LIMIT: 200,

    // 학생 화면에 성찰 양식을 그린다. answers = [a1, a2, a3, 글]
    render(container, { answers = [null, null, null, ''], onDone = null } = {}) {
      container.innerHTML = '';
      const panel = h('div', { class: 'panel war-reflect' });
      container.append(panel);
      panel.append(h('div', { class: 'panel-title' }, '돌아보기', h('small', {}, '게임을 돌아보며 골라요')));
      const picks = [...answers.slice(0, 3)];
      const free = h('textarea', { maxlength: this.FREE_LIMIT, class: 'war-reflect-text',
        placeholder: this.FREE_QUESTION });
      free.value = answers[3] || '';
      const count = h('small', { class: 'muted' }, (free.value.length) + ' / ' + this.FREE_LIMIT);
      free.addEventListener('input', () => { count.textContent = free.value.length + ' / ' + this.FREE_LIMIT; check(); });
      const btns = [];
      this.QUESTIONS.forEach((q, qi) => {
        panel.append(h('div', { class: 'panel-title' }, (qi + 1) + '. ' + q.text));
        const row = h('div', { class: 'war-reflect-btns' });
        q.answers.forEach((a, ai) => {
          const b = h('button', { class: 'war-reflect-btn' + (picks[qi] === ai + 1 ? ' on' : ''), type: 'button',
            onclick: () => {
              picks[qi] = ai + 1;
              row.querySelectorAll('.war-reflect-btn').forEach((x, xi) => x.classList.toggle('on', picks[qi] === xi + 1));
              check();
            } }, a);
          btns.push(b); row.append(b);
        });
        panel.append(row);
      });
      panel.append(h('div', { class: 'panel-title' }, '4. ' + this.FREE_QUESTION));
      panel.append(free);
      panel.append(count);
      panel.append(h('p', { class: 'bad war-reflect-warn' }, '친구 이름은 쓰지 마세요'));
      const send = h('button', { class: 'primary big war-reflect-send', type: 'button', disabled: '', onclick: doSubmit },
        '보내기');
      panel.append(send);
      const check = () => {
        send.disabled = !(picks[0] && picks[1] && picks[2] && free.value.trim().length > 0);
      };
      check();
      async function doSubmit() {
        send.disabled = true;
        try {
          await window.WarAPI.rpc('war_reflect_submit', { p_a1: picks[0], p_a2: picks[1], p_a3: picks[2], p_text: free.value });
          panel.replaceChildren(h('div', { class: 'panel-title' }, '고마워요!'),
            h('p', {}, '성찰을 보냈어요. 선생님이 확인할게요.'));
          if (onDone) onDone();
        } catch (e) {
          panel.append(h('p', { class: 'bad' }, e.message || '보내지 못했어요. 다시 눌러 주세요.'));
          send.disabled = false;
        }
      }
      return panel;
    },
  };
})();
