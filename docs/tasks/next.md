# GPT 작업지시서: 질의응답 봇 (QnA Bot)

> 커밋·푸시 금지. 완료 후 `docs/tasks/report.md`에 보고.

## 목표
「지구 서버: 전쟁의 시간」에 AI·API 없이 작동하는 규칙 기반 질의응답 봇을 추가한다.
연수 과제 제출용 단독 페이지도 함께 만든다.

---

## 1. 지식 파일 생성: `app/war/qna/faq.json`

**읽어야 할 파일:**
- `docs/war-design.md` — 전체 설계
- `app/war/js/war-rules.js` — 규칙 숫자 (158줄)

**형식:**
```json
[
  {
    "id": "q001",
    "role": "common",
    "keywords": ["이동", "움직이기"],
    "variants": ["어떻게 이동해요?", "병력을 옮기려면?"],
    "question": "병력을 어떻게 이동하나요?",
    "answer": "내 병력을 누르고 이동할 칸을 누르면 돼요. 한 번에 이동력만큼만 움직일 수 있어요. 적 병력이 있는 칸으로는 이동할 수 없어요."
  }
]
```

**항목 수:** 60~80개

**role 값:** `common` / `army` / `navy` / `air` / `engineer` / `chief`
- chief = 합동참모의장, engineer = 공병사령관, army/navy/air = 각 참모총장

**규칙:**
- 답변은 5학년 이하 쉬운 말, 「~해요」 체, 3문장 이내
- 숫자는 `war-rules.js`의 실제 값 그대로 사용 (임의로 쓰지 않음)
- 아직 안 만든 기능(외교, 무역, 시장 거래, 첩보)은 답변: 「아직 열리지 않은 기능이에요. 다음에 열려요.」

**필수 주제 (빠짐없이 포함):**
- 이동 (육군·해군·공군·노동자 이동력 각각)
- 공격 방법, 전투 결과
- 점령 조건, 수도 점령
- 병력 생산 방법 (합참·공병)
- 미션 완료 방법
- 역할별 권한 (누가 뭘 할 수 있나)
- 지휘권 넘기기
- 멸망 조건
- 미리보기 모드 설명
- 시장(market) 위치
- 선생님께 물어봐야 하는 것

---

## 2. 검색 엔진: `app/war/qna/qna-engine.js`

외부 라이브러리 없이 순수 JS. ES 모듈(`export`).

```js
// 사용 예
import { search } from './qna-engine.js';
const result = search(faqArray, '이동하려면', currentRole);
// result: { found: true, item: {...} } 또는 { found: false, suggestions: [...3개] }
```

**알고리즘:**
1. 질문 텍스트를 공백·조사 단위로 분리
2. 각 FAQ 항목의 `keywords` + `variants` + `question` 과 낱말 겹침 점수 계산
3. 현재 역할(`currentRole`)과 `common`인 항목만 검색 (다른 역할 제외)
4. 최고 점수 항목 반환; 점수가 2 미만이면 `found: false` + 상위 3개 `suggestions`

---

## 3. UI 컴포넌트: `app/war/js/war-qna.js`

- 기존 화면 (`app/war/index.html`) 에 주입할 수 있는 독립 모듈
- 화면 오른쪽 하단에 「❓ 물어보기」 버튼 (고정, z-index 높게)
- 버튼 클릭 → 대화창 오버레이 열림
- 대화창 구성:
  - 상단: 「규칙 물어보기」 제목 + 닫기(×) 버튼
  - 중단: 추천 질문 버튼 4개 (현재 역할에 맞게, `faq.json`에서 역할 필터링 후 랜덤)
  - 입력창 + 「물어보기」 버튼
  - 답변 영역 (답변 텍스트 표시)
  - 못 찾으면: 「선생님께 물어보세요 😊」 + 비슷한 질문 3개 버튼
- 웨일북 기준: 모든 버튼 48px 이상, 입력창 48px
- 하단 footer: `myoLab(산쌤)`
- 역할 정보는 `window.WAR_ROLE` 전역 변수에서 읽음 (없으면 `'common'`)

**`app/war/index.html` 수정:**
- `</body>` 직전에 아래 추가 (기존 코드는 건드리지 않음):
```html
<script type="module" src="js/war-qna.js"></script>
```

---

## 4. 단독 페이지: `app/war/qna.html`

- 과제 제출용 독립 HTML
- `war-qna.js`와 `qna-engine.js` 그대로 재사용
- 역할 선택 드롭다운 추가 (합동참모의장/공병사령관/육군/해군/공군/공통)
- 하단: `myoLab(산쌤)`
- 외부 CSS 프레임워크 없이, `app/war/css/` 기존 스타일 활용 가능

---

## 5. 시험 파일: `tests/war/qna.test.mjs`

Node.js에서 실행 (브라우저 없음). `faq.json`과 `qna-engine.js`만 테스트.

```js
// 테스트 항목 (최소):
// 1. '이동하려면' → 이동 관련 답 반환
// 2. '공격' → 공격 관련 답 반환
// 3. '점령' → 점령 관련 답 반환
// 4. '수도 차지' → 수도 점령 관련 답 반환
// 5. '병력 만들기' → 생산 관련 답 반환
// 6. '미션' → 미션 관련 답 반환
// 7. '지휘권' → 지휘권 관련 답 반환
// 8. '외교' → found: false (아직 열리지 않은 기능)
// 9. 'ㄱㄴㄷ 무슨말이야 완전 이상한말' → found: false
// 10. 역할 필터: chief 역할로 army 전용 질문 검색 → found: false
```

테스트 형식은 기존 `tests/war/rules.test.mjs` 스타일 따름.

**`package.json`에 추가할 스크립트:**
```json
"test:war:qna": "node tests/war/qna.test.mjs"
```

---

## 6. 화면 자동 시험 추가: `tests/war/screen.test.mjs`

기존 파일 끝에 항목 1개 추가:
- 「물어보기 창이 열리고 답이 나온다」
  - `index.html?preview=1` 열기
  - `❓ 물어보기` 버튼 클릭
  - 대화창 `.qna-overlay` 가 화면에 보이는지 확인
  - 추천 질문 버튼 하나 클릭
  - 답변 영역 `.qna-answer`에 텍스트가 나타나는지 확인

---

## 완료 조건

- [ ] `npm run test:war:qna` 전체 통과
- [ ] `npm run test:war:screen` 전체 통과 (새 항목 포함)
- [ ] `app/war/qna.html` 브라우저에서 열리고 질문-답변 작동
- [ ] `app/war/index.html`에 「물어보기」 버튼 보임

## 보고 위치
`docs/tasks/report.md`
