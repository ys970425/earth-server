# 작업 보고서 — ①b 화면 두 탭 + 미션 화면 + 관제실 미션 현황 + 시장 표시 + 문서

- 날짜: 2026-11-08
- 브랜치: `war-version` 확인 후 작업
- 결과: **완료** (GPT 동시 작업 파일(supabase/war/*.sql·war-rules.js·tools/*·tests/*·package.json·state.json)은 건드리지 않았음. functions.sql·package.json·state.json·gpt-report.md의 변경은 GPT 몫)

## 1. 위쪽 큰 탭 두 개 (3줄)

- `war-app.js`: 표시줄 아래 **큰 탭 두 개(지도 / 우리 나라)** 추가 — 「지도」(처음): 지도 + 조작 창(역할 메뉴 중 게임 조작만 작은 탭으로: 내 병력·지휘권 넘기기·노동자·정찰병·개발·수리·건물·생산·외교·무역·도시국가 시장 + 칸 정보), 「우리 나라」: 역할 고르기(역할 없을 때)·튜토리얼 미션·내 예산·나라 정보·역할 현황·첩보 정보
- 역할을 고르기 전에도 지도 탭에 지도가 보이고 맨 위에 「「우리 나라」 탭에서 역할을 골라요」 안내 띠. 역할이 없으면 병력은 고를 수 없음(메뉴 자체가 안 나오고 칸 정보만). 역할을 고르면 지도 탭을 그대로 두고 화면만 다시 그림
- `war.css`: 큰 탭 56px 이상, `.war-view` 높이 계산으로 웨일북(1366×768)에서 스크롤 없이 지도, 안내 띠·미션·플래시 스타일

## 2. 튜토리얼 미션 화면 (3줄)

- 「우리 나라」 탭에서 `war_missions()` 목록을 역할별 순서대로 표시(✔ 완료 / 할 일 / 「곧 열려요」)
- 행동 성공 뒤 기록: `war_move` 성공 시 병력·역할에 맞춰 `army_move`·`navy_move`(배)·`eng_worker_move` 기록, `navy_coast`(우리 해안 도시 옆 도착)·`eng_scout_enemy`(다른 나라 도시 옆 도착)·`air_fly_over`(경로에 다른 나라 병력)는 조건 확인 후 기록, `war_transfer` 성공 시 `army_transfer`·`air_transfer`, 합동참모의장(대행 아님)이 「우리 나라」 탭을 열면 `chief_info`
- 완료되면 「미션 완료!」를 1초 표시(반복 애니메이션 없음), 오류는 콘솔에만. 이미 done인 미션은 다시 부르지 않음

## 3. 관제실 미션 현황 (1줄)

- `war-admin.js`에 `war_admin_missions()` 표 추가: 나라별로 묶어 나라 / 닉네임 / 역할 / 완료 수 ÷ 열린 미션 수 / 완료한 미션 이름(미션 문구로 표시). 실명 없음

## 4. 시장 섬 표시 (2줄)

- `war-app.js`가 poll의 `markets`를 `S.map.setData({ markets })`로 지도에 넘김(처음 지도 그릴 때도 함께) — 그리기는 ①a에서 만든 war-hexmap 코드 사용
- 시장 칸을 누르면 칸 정보에 「도시국가 시장 · 북서 마을(등) · 물물교환은 나중에 열려요」 표시

## 5. 문서 (3줄)

- `docs/war-design.md`: 8-1 학생 화면을 큰 탭 두 개 구조로 교체, 2장에 「2-2 튜토리얼 미션」(결정 내용 + 20개 미션 표 그대로) 추가, 5-1장에 「점령 직후에도 빈칸 병합을 한 번 한다 (E4)」, 10장 E4 행에 빈칸 병합 함수 추가(E5는 턴 끝 병합 유지), **E3.5 행 추가**, 8-3장을 브라우저 PGlite 방식으로 교체, 13장에 「화면 두 탭」「튜토리얼 미션 서버 기록」「점령 직후 병합」「미리보기 가짜 서버 → 브라우저 PGlite」 행 추가
- `docs/tasks/status.md`: 끝난 것에 ②·①a·①b 추가, 잊지 말 것에 「미리보기 열기 전 `npm run war:preview`」, 다음 할 것에 E4(화면: 공격 미리보기·공격 버튼·미션 E4 열기) → E5 명시

## 완료 조건 결과

```
node --check app/war/js/war-app.js     통과 (종료 코드 0)
node --check app/war/js/war-admin.js   통과 (종료 코드 0)
npm run war:preview                     완료 (나라 6 · 칸 1120 · 도시 46 · 병력 54, db.tar.gz 생성)
git status --short                      내 변경: war-app.js·war-admin.js·war.css·status.md·war-design.md·report.md (그 외는 GPT 몫: package.json·functions.sql·state.json·gpt-report.md·e4.test.mjs)
```
- 화면 (Live Server): **미확인** — GPT가 서버 SQL을 바꾸는 중이라 지시서대로 미확인으로 둡니다 (Claude가 둘 다 끝난 뒤 Chrome으로 확인: `?preview=1` 역할 없음 → 지도+안내 띠 / 우리 나라 탭 역할 고르기 → 미션 목록 / `?preview=1&as=1:army` 이동 → 미션 ✔ / `admin.html?preview=1` 미션 현황 표 / 시장 섬 3곳 그림 / 콘솔 오류 없음)

## 막힌 점

- 없음

커밋·푸시하지 않았습니다
