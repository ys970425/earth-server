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
