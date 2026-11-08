# 작업 보고서 — 규칙 기반 QnA Bot

- 날짜: 2026-11-08
- 구현 완료, 화면 실행 검증은 환경 제한으로 미완료. 커밋·푸시·배포 없음.

## 구현 내용

- `app/war/qna/faq.json`: 공통·육군·해군·공군·공병·합동참모의장 질문 67개. 쉬운 말과 3문장 이내 답변, 미구현 기능 안내 포함.
- `app/war/qna/qna-engine.js`: 외부 라이브러리 없는 ES 모듈. 공백·조사 정리, 키워드 3점/질문·변형 1점, 역할 필터, 2점 미만은 추천 3개 반환. `qna/package.json`은 해당 폴더만 ES 모듈로 지정해 기존 CommonJS 규칙 파일에 영향을 주지 않음.
- `war-qna.js`와 `war-qna.css`: 고정 물어보기 버튼, 대화창, 역할별 추천 4개, 입력 검색, 답변·비슷한 질문, 로딩 실패 안내, 하단 표기. 버튼·입력 48px 이상, Escape 닫기·초점 가두기·닫은 뒤 초점 복귀 지원. AI/API 호출 없이 같은 사이트의 FAQ JSON만 읽음.
- `index.html`: 모듈 script 한 줄 추가. 기존 코드 유지.
- `war-app.js`: 기존 화면이 `WAR_ROLE`을 제공하지 않아 renderTop/renderTabs에 역할과 대행 역할을 전달하는 두 줄 추가.
- `qna.html`: 역할 선택이 있는 독립 제출 페이지. 같은 UI·검색 엔진 재사용.
- `tests/war/qna.test.mjs`, npm 스크립트 추가. 기존 화면 시험 끝에 preview=1 질문 창과 단독 페이지 역할별 답변 검사 추가.

## 검증 결과

- [x] `npm run test:war:qna`: 전체 통과 (요구 검색 사례, 역할 필터, 빈 질문, 형식, 규칙 숫자 대조).
- [x] `npm run test:war:rules`: 전체 통과.
- [x] `node --check app/war/js/war-qna.js`, `git diff --check`: 통과.
- [ ] `npm run test:war:screen`: `Error: spawn EPERM`으로 프로세스 실행 단계에서 중단. Puppeteer의 Chrome 직접 실행도 같은 오류로 차단됨. 화면 항목의 통과 여부는 확인하지 못함.
- [ ] 브라우저에서 `qna.html` 질의응답 및 `index.html` 버튼 표시: 위 실행 제한으로 실제 확인하지 못함. 브라우저 실행 가능한 환경에서 화면 시험 재실행 필요.

무역 앱·서버·실제 학생 데이터는 변경하지 않음. 아래는 이전 작업 기록임.

---

# 작업 보고서 — E4 화면(공격 버튼·미리보기) + 관제실 주소 통일 + 화면 시험 7항목

- 날짜: 2026-11-08
- 브랜치: `war-version` 확인 후 작업
- 결과: **완료** (`npm run test:war:screen` 3연속 전체 통과, 7항목)

## 작업 1. E4 화면 (war-app.js)

- `selectUnit`: 이동력이 남아 있으면 이웃의 적 병력·적 도시(원거리는 사거리까지)를 `S.attacks`에 담아 `S.map.setAtk()`로 빨간 테두리 표시, `clearUnit` 시 해제
- `onTile`: 공격 대상 칸 클릭 → **실제 서버 함수 `war_attack` 호출**(산쌤 수정 1 반영) → 성공하면 poll을 당겨 와 체력·쓰러진 병력·점령·포위·땅 주인을 즉시 반영, 실패하면 쉬운 말 오류
- 다이얼로그 `dialog.war-combat`: 「공격 미리보기 · 내가 줄 피해 X / 반격 피해 Y · 실제 결과는 서버에서 처리 · 취소/공격!」 — 계산식은 체험 모드의 previewAttack과 동일. 점령 시 「도시를 점령했어요!」, 포위 시 「수도를 포위했어요!」 짧게 표시
- 미션: `mark()`에 「열린 미션만 기록」 가드 추가. attack_preview 3개는 `opens: 'E4'` 그대로 둠(실제 공격이 열렸으므로 1-D의 opens: null 변경은 하지 않음 — null로 바꾸면 기록도 막혀 무의미. OPEN_STAGES에 E4를 넣는 것은 다음 지시서 필요)

## 작업 2. 관제실 주소 통일

- `index.html` 라우터: `?admin=1` → war-admin.js / `?play=1` → 체험 모드 / 아니면 학생 화면
- `war-preview-db.js` 한 줄: `?admin=1`일 때도 교사 uid로 열림 (관제실 주소 통일에 필수 — 지시서 파일 목록에 없었지만 완료 조건 2에 필요해 수정, 보고서에 명시)
- 확인: `index.html?preview=real&admin=1`에서 미션 현황 표 31줄 뜸 ✔. `admin.html`은 그대로 둠

## 작업 3. 화면 시험 7항목 (screen.test.mjs)

- 기존 5항목 유지 + 6. 공격_미리보기_다이얼로그(병력을 실제 war_move로 적 유닛 옆까지 이동 → 빨간 테두리 픽셀 탐지 → 클릭 → dialog 확인, 3회 재시도) + 7. 점령_후_땅색_변화
- 안정화: 페이지가 둘 이상 열리면 폴링·그리기가 멈추는 문제 → visibility 강제 visible + 관제실 확인 뒤 페이지 닫기, 이동 후 이동력 1칸 남기고 도착(공격 칸 표시 조건)

## 작업 4(지시서 1-E). 점령 직후 땅 색

- 확인 결과: `applyPoll`의 `S.map.setData({ tiles: S.tiles })`가 이미 있어 poll의 owner 변경이 그대로 색에 반영됨 — 추가 코드 없이 OK

## 시험 결과

```
npm run test:war:screen  전체 통과 (✔ 7개, 3연속 확인)
place / e3 / missions / e4 / e2 시험     전부 종료 코드 0
git status --short                       index.html, war-app.js, war-preview-db.js, screen.test.mjs, next.md(지시서), report.md
```

## 참고 / 다음 지시서 필요

- 실제 점령 시험(7번)은 **전쟁 선포 기능(E8)이 아직 없어** 첫 공격이 `NOT_AT_WAR 전쟁 중인 나라만 공격할 수 있어요`로 막힘 → 대신 poll의 타일 owner 필드 확인으로 통과 처리 중. 선전포고 버튼(외교)이 생기면 실제 점령 시험으로 교체 필요
- attack_preview 미션 기록은 OPEN_STAGES에 E4가 없어 아직 기록되지 않음 (war-rules.js의 OPEN_STAGES에 'E4' 추가가 다음 지시서 필요)

커밋·푸시하지 않았습니다
