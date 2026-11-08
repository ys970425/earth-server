import { search } from '../qna/qna-engine.js';

const PROXY_URL = 'http://localhost:3717/api/qna';
const MAX_Q_LEN = 200;

const style = document.createElement('link');
style.rel = 'stylesheet';
style.href = new URL('../css/war-qna.css', import.meta.url).href;
document.head.append(style);
const standalone = document.querySelector('[data-qna-page]');
const launcher = document.createElement('button');
launcher.className = 'qna-launcher';
launcher.textContent = '❓ 물어보기';
const overlay = document.createElement('div');
overlay.className = 'qna-overlay';
overlay.hidden = true;
overlay.innerHTML = `<section class="qna-panel" role="dialog" aria-modal="true" aria-labelledby="qna-title" tabindex="-1">
  <header><h2 id="qna-title">❓ 물어보기</h2><button type="button" class="qna-close" aria-label="닫기">×</button></header>
  <div class="qna-recommendations" aria-label="추천 질문"></div>
  <form><label for="qna-input">궁금한 것을 적어요</label><div class="qna-input-row"><input id="qna-input" maxlength="300" autocomplete="off" placeholder="예: 이동하려면"><button type="submit">물어보기</button></div></form>
  <div class="qna-answer" role="status" aria-live="polite"></div><div class="qna-suggestions"></div>
  <footer>myoLab(산쌤)</footer></section>`;
document.body.append(launcher, overlay);
const panel = overlay.querySelector('.qna-panel');
const input = overlay.querySelector('input');
const answer = overlay.querySelector('.qna-answer');
const recommendations = overlay.querySelector('.qna-recommendations');
const suggestions = overlay.querySelector('.qna-suggestions');
const role = () => window.WAR_ROLE || 'common';
let faq = [], loading = null, previousFocus, previousOverflow;
function buttons(target, items) {
  target.replaceChildren(...items.map(item => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = item.question;
    button.onclick = () => ask(item.question);
    return button;
  }));
}
async function load() {
  if (!loading) loading = fetch(new URL('../qna/faq.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('FAQ');
    return response.json();
  }).then(items => { faq = items; }).catch(() => {
    loading = null; answer.textContent = '질문 모음을 열지 못했어요. 잠시 뒤 다시 물어봐요.';
  });
  await loading;
}
function refresh() {
  const eligible = faq.filter(item => item.role === 'common' || item.role === role());
  eligible.sort((a, b) => Number(b.role === role()) - Number(a.role === role()));
  buttons(recommendations, eligible.slice(0, 4));
}
async function ask(query) {
  if (!query.trim()) return;
  input.value = query;
  suggestions.replaceChildren();
  if (query.length > MAX_Q_LEN) {
    answer.textContent = '질문이 너무 길어요 (200자 이하로 써주세요).';
    return;
  }
  const aiResult = await askAI(query);
  if (aiResult.ok) {
    const p = document.createElement('p');
    p.textContent = aiResult.answer;
    answer.replaceChildren(p);
    addBadge('🤖 AI 답변');
    return;
  }
  const errors = {
    RATE_MIN: '잠깐 쉬었다가 다시 질문해요 (1분에 3번까지).',
    RATE_DAY: '오늘은 질문을 많이 했어요. 내일 또 물어보세요.',
    TOO_LONG: '질문이 너무 길어요 (200자 이하로 써주세요).',
  };
  if (errors[aiResult.error]) {
    answer.textContent = errors[aiResult.error];
    return;
  }
  await load();
  if (!faq.length) return;
  const result = search(faq, query, role());
  suggestions.replaceChildren();
  answer.textContent = result.found ? result.item.answer : '선생님께 물어보세요 🙂 비슷한 질문도 살펴봐요.';
  addBadge('💬 간단 답변');
  if (!result.found) buttons(suggestions, result.suggestions);
}
function addBadge(text) {
  const badge = document.createElement('small');
  badge.textContent = text;
  badge.style.cssText = 'display:block;opacity:0.6;font-size:0.75em;margin-top:4px';
  answer.append(badge);
}
async function askAI(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: query, role: role() }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    if (typeof data.answer !== 'string' || !data.answer.trim()) return { ok: false, error: 'AI_ERROR' };
    return { ok: true, answer: data.answer };
  } catch {
    return { ok: false, error: 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}
async function open() {
  previousFocus = document.activeElement;
  previousOverflow = document.body.style.overflow;
  overlay.hidden = false; document.body.style.overflow = 'hidden'; input.focus();
  await load(); refresh();
}
function close() {
  overlay.hidden = true; document.body.style.overflow = previousOverflow;
  previousFocus?.focus();
}
launcher.onclick = open;
overlay.querySelector('.qna-close').onclick = close;
overlay.onclick = event => { if (event.target === overlay) close(); };
overlay.querySelector('form').onsubmit = event => { event.preventDefault(); ask(input.value); };
overlay.onkeydown = event => {
  if (event.key === 'Escape') close();
  if (event.key !== 'Tab') return;
  const controls = [...panel.querySelectorAll('button,input')];
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
};
if (standalone) {
  const select = standalone.querySelector('select');
  window.WAR_ROLE = select.value;
  select.onchange = () => {
    window.WAR_ROLE = select.value; refresh(); answer.textContent = ''; suggestions.replaceChildren();
  };
}
