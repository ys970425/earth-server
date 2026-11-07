# 진행 상황 (「지구 서버: 전쟁의 시간」, 브랜치 `war-version`)

마지막 정리: 2026-11-07

## 끝난 것
- 설계: `docs/war-design.md` — 2026-11-07 「전쟁의 시간」 기준으로 전면 개정 (역할, 동시 턴제, 점령·파괴·수리, 외교, 물물교환, 배포 `earth-war`). 바뀐 점은 13장
- W0 테스트 틀 (`npm run test:war`), W1 가져오기 (`npm run test:war:import`)
- 학생 화면 뼈대 + 가짜 미리보기: Live Server `app/war/index.html?preview=1`
- 실제 데이터 미리보기: `private/`에 무역 백업 → `npm run war:preview:real` → `?preview=real` (깃허브 제외, 학생 이름 없음, 시험 `npm run test:war:real`)
- 체험 모드 (브라우저 메모리에서만): 이동, 공격 미리보기, 도시 공격·점령·수도 포위, 근접 배 해안 도시 점령, 병력 목록, 특수 부대 95·피해 60, 턴 넘기기, 처음 상태로
- 구축함 그림 `app/trade/assets/units/destroyer.png`

## 진행 중
- 없음

## 다음에 할 것 (`docs/war-design.md` 10장 순서)
1. **E0** 규칙 파일 `app/war/js/war-rules.js` + 전투기 그림 자르기(nation archive 사본만) + 64px 그림 사본 도구 [헬피]
2. **E1** 서버 기반 + 가져오기 v2 (공장 배치, 병과 지급, 특수 부대 수치) [GPT]
3. E2~E13 (역할 화면, 이동, 전투·파괴, 턴 타이머, 합참의장, 생산, 외교, 시장, 첩보, 칠판·의견 보내기, 모의 실행, 배포)
- 체험 모드의 계산은 E3·E4에서 서버 함수로 옮기고 시험을 붙인다

## 잊지 말 것
- Supabase 설치(`war`·`feedback` 스키마)는 교사가 정한 때에만. gh-pages·`publish-pages.sh`·`claude/setup` 건드리지 않기
- 배포는 새 저장소 `earth-war` (생성 승인됨, E13에서 만듦)
- 담당은 헬피코드 우선, 어려운 것(여러 표·잠금이 얽힌 서버 함수, 모의 실행)만 GPT. codex exec에는 `-c 'windows.sandbox="unelevated"'`
- 웨일북 확인: Chrome CPU 4x 느리게, 또는 Live Server Host 0.0.0.0 + PC IP (설계 8-4)
