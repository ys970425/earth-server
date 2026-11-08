# E4 서버 작업 결과

- 브랜치: `war-version` 확인.
- `war.admin_import`: 수도 방어 20, 체력·최대 체력 200을 `war.cfg().CAPITAL`에서 적용. 미리보기 state.json 재생성.
- 새 공개 함수: `public.war_attack(int,int)`, `public.war_attack_preview(int,int)`.
- 새 내부 함수: `war.attack_core(int,int,boolean)`(검사·처리 공유), `war.combat_calc(...)`(피해·반격 공유), `war.merge_empty_tiles()`(E5에서도 호출 예정).
- 전쟁·역할·보호막·공격 횟수·거리 검사, 체력 반영 힘·지형 보너스·특수 부대 상한, 사망 삭제, 수도 포위, 근접 육군·해안 근접 함선 점령, 시설 파괴, 상실 도시 2곳 제한, 3턴 보호막 구현.
- 점령 이동은 `war.place_unit` 사용. 지도 변경은 map bump 뒤 변경 칸 ver 갱신. 빈칸 병합은 전체 후보를 먼저 계산하고 한 겹만 적용.
- 미리보기는 실제 공격과 같은 검사·계산을 사용하며 데이터 변경 없이 결과를 반환. 거절 reason에서 오류 코드 접두어를 제거하여 쉬운 안내만 반환.

## 잠금 순서

`war.act_start(commander,true,상대 나라)`가 game SHARE → 두 나라 id 오름차순 UPDATE 잠금을 담당한다. 이후 병력 id 오름차순 UPDATE → 도시 id 오름차순 UPDATE 잠금 뒤 행을 다시 읽는다. 상대 소유권이 바뀌었으면 거절한다. 미리보기도 같은 잠금·검사를 거치며 쓰기는 하지 않는다.

## 직접 실행 결과

새 시험 `tests/war/e4.test.mjs`, 스크립트 `test:war:e4` 추가. 수도 가져오기 수치, 거절 조건, 미리보기 일치·읽기만, 병력 사망, 반격 사망, 원거리 반격, 특수 부대 상한, 언덕 방어, 수도 포위, 점령·주변 소유권·파괴·보호막, 원거리·공군 점령 제한, 함선 해안 조건, 수비 병력 점령 차단, 중립 도시·시장 공격 제한, 멸망 방지, 병합 제외 대상·3:3·한 겹·지도 ver 검증.

각 시험 마지막 줄(모두 종료 코드 0):
- e4: 전체 통과
- missions: 전체 통과
- select: 전체 통과
- preview-db: 전체 통과
- place: 전체 통과
- e3: 전체 통과
- e2: 전체 통과
- act: 전체 통과
- import-v2: 전체 통과
- import: 전체 통과
- rules: 전체 통과
- db: 전체 통과
- real-preview: 전체 통과
- trade: 전체 통과

- `npm run war:config` 두 번: config.sql SHA256 동일 (`config identical: True`).
- `npm run war:preview` 두 번: state.json SHA256 동일 (`preview identical: True`). 마지막 출력: 나라 6 · 칸 1120 · 도시 46 · 병력 54 (턴 3).
- config.sql은 재생성 결과 기존 내용과 동일하여 Git 변경 없음.
- `git diff --check` 통과. `git status --short` 변경은 허용 목록 내 functions.sql, package.json, state.json, e4.test.mjs, 본 보고서뿐.
- Supabase 접속, private/ 접근, 무역 표 쓰기·무역 앱 파일 수정 없음. W0 시험 준비의 무역 데이터 생성은 기존 시험 도우미만 사용.
- 동시 작업 UI·다른 docs 파일은 수정하지 않음.

못 함: PGlite는 연결 하나라 실제 동시 공격 경합은 시험하지 못함. 시험 머리 주석에 설치 후 두 연결로 확인할 항목으로 명시함.
커밋·푸시하지 않았습니다
