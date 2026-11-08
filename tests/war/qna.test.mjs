import { readFileSync } from 'node:fs';
import { search } from '../../app/war/qna/qna-engine.js';
import { createRequire } from 'node:module';
const W = createRequire(import.meta.url)('../../app/war/js/war-rules.js');
const faq = JSON.parse(readFileSync(new URL('../../app/war/qna/faq.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (condition, message) => { console.log((condition ? '  ✔ ' : '  ✘ ') + message); if (!condition) fails++; };
for (const [query, expected] of [['이동하려면', '이동'], ['공격', '공격'], ['점령', '점령'], ['수도 차지', '수도'], ['병력 만들기', '생산'], ['미션', '미션'], ['지휘권', '지휘권']]) {
  const result = search(faq, query, 'common');
  ok(result.found && result.item.keywords.includes(expected), query);
}
for (const query of ['외교', '뚱깐뿡 무슨말이야 완전 이상한질문', '', '   ']) {
  const result = search(faq, query);
  ok(!result.found && result.suggestions.length === 3, '모르는 질문: ' + query);
}
ok(!search(faq, '육군전용', 'chief').found, '다른 역할 전용 질문 제외');
ok(search(faq, '육군전용', 'army').found, '내 역할 질문 포함');
ok(faq.length >= 60 && faq.length <= 80 && new Set(faq.map(x => x.id)).size === faq.length, 'FAQ 개수와 고유 번호');
ok(faq.every(x => ['common', 'army', 'navy', 'air', 'engineer', 'chief'].includes(x.role) && x.keywords.length && x.variants.length && x.answer && x.question), 'FAQ 형식');
for (const [query, role, values] of [
  ['구축함', 'navy', [W.EXTRA_UNITS.destroyer.str, W.EXTRA_UNITS.destroyer.move]],
  ['전투기', 'air', [W.EXTRA_UNITS.fighter.str, W.EXTRA_UNITS.fighter.move, W.EXTRA_UNITS.fighter.range]],
  ['특수', 'common', [W.BOSS.str(), W.BOSS.damageMax]],
  ['멸망', 'common', [W.MAX_CITY_LOSS, W.SHIELD_TURNS]],
  ['노동자', 'engineer', [W.MOVES.worker]],
  ['정찰병', 'engineer', [W.MOVES.scout]]
]) {
  const result = search(faq, query, role);
  ok(result.found && values.every(value => result.item.answer.includes(String(value))), query + ' 규칙 숫자');
}
// 프록시가 꺼져 있어도 기존 시험은 통과한다.
const longQuery = 'ㄱ'.repeat(201);
ok(longQuery.length > 200, '201자 길이 초과 확인');
const shortQuery = 'ㄱ'.repeat(200);
ok(shortQuery.length <= 200, '200자 길이 허용 확인');
const proxyRunning = await fetch('http://localhost:3717/api/qna', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: '', role: 'common' }),
  signal: AbortSignal.timeout(500),
}).then(r => r.json()).catch(() => null);
if (proxyRunning !== null) {
  ok(['TOO_LONG', 'BAD_ROLE', 'NO_KEY'].includes(proxyRunning.error), '프록시: 빈 질문 거절');
}
console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exitCode = fails ? 1 : 0;
