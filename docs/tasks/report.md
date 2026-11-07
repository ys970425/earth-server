# 작업 보고서 — E3 한 칸 한 유닛(G1) + 이동·지휘권 넘기기·화면·미리보기 체험(H1~H6)

- 날짜: 2026-11-07
- 브랜치: `war-version` 확인 후 작업
- 결과: **완료** (G1 먼저 끝내고 완료 조건 통과 뒤 H 진행)

## 맨 위: G1 완료 조건 결과

- **G1 직후 `npm run war:preview` → `git diff --stat app/war/preview/state.json` → 바뀐 줄 0** (가져오기 결과가 완전히 같음. 지금 상태 표시 M은 줄바꿈 문자 CRLF/LF 표시 차이뿐, `git diff` 내용 차이 없음)
- `node tests/war/place.test.mjs` 전체 통과(✔ 10개), `import.test`·`import-v2`·`e2`·`act`·`real-preview` 모두 전체 통과 → H로 넘어감

## G1. 한 칸 한 유닛 DB 강제 (3줄)

- `schema.sql` 끝에 유일 부분 인덱스 2개 추가(군사 칸 1개·민간 칸 1개 — 지시서 SQL 그대로)
- `admin_import`: 「전부 넣고 겹친 칸 비우기」를 「제자리에 둘 병력만 칸을 넣고 나머지는 null」 한 문장으로 교체(지시서 SQL 그대로, 판정 규칙 동일). 도시가 병력보다 먼저 채워지는 순서는 기존대로 확인
- `war.place_unit(p_unit, p_tile)` 공용 함수 추가(bump 아래, 유일 조건 위반 시 `TILE_TAKEN` 「먼저 온 병력이 있어요…」) + `tests/war/place.test.mjs`(8항목) + `"test:war:place"`

## H1. 이동 `public.war_move(p_unit, p_path)` (3줄)

- 병력 조회 → `NOT_MINE` → `war.act_start(commander)`(역할·결석 대행·일시정지·나라 잠금) → 병력 `for update` → 경로 한 칸씩 검사(연속성 `tdist=1`, 이동력 초과 `NO_MOVES`, 땅 유닛 바다·해안·산 금지, 배는 바다만, 공군은 지형 무시, 다른 나라 도시·시장 칸 `NO_ENTRY`, 땅·바다 유닛은 다른 나라 병력 칸 통과 `BLOCKED`, 공군은 바다 위 멈춤 `BAD_STOP`) → `war.place_unit`로 마지막 칸 배치(동시 이동 최종 방어선) → `moves_left` 차감 → `bump('units')`
- `war-rules.js`에 `MOVES`(노동자 2·정찰병 5)·`MOVES_OF`·`unitIsSea`·`unitIsAir`·`canPass`·`canStop` 추가, `build-config.mjs`에 MOVES 직렬화 추가 후 `war:config` 재생성(두 번 같음), `rules.test.mjs`에 노동자 이동력 2·canPass/canStop 검사 추가
- `admin_import` 끝에서 모든 병력 `moves_left`를 규칙 이동력으로 채움(노동자 2·정찰병 5·구축함/전투기 전쟁 규칙·나머지 무역 규칙)

## H2. 지휘권 넘기기 `public.war_transfer(p_unit, p_to)` (2줄)

- 병력 조회 → `NOT_MINE` → `act_start(commander)` → 노동자·정찰병 `NOT_MILITARY` → `p_to`는 육·해·공만, 지금 commander와 달라야 함 → `commander`만 변경, 종류·이동력 유지, `bump('units')`

## H3. 시험 `tests/war/e3.test.mjs` (2줄)

- 28항목: 이동 성공·이동력 차감, 산·바다·이동력 초과·끊긴 경로 거절, 다른 나라 병력 칸 통과(땅 거절/공군 통과), 공군 바다 멈춤 거절, 다른 나라 도시·시장 칸 거절, 다른 역할·다른 나라 거절, 결석 대행 이동, 공병 노동자 2칸 이동, 지휘권 넘기기(넘긴 뒤 권한 바뀜·같은 병과·없는 병과·노동자 거절), 일시정지 거절 + `"test:war:e3"`

## H4. 화면 (3줄)

- 「내 병력」 탭(참모총장·대행 탭): 조종 병력 목록(한글 이름·체력·남은 이동력) → 누르면 지도 선택 + `war-rules.js`의 `canPass`·`canStop`으로 **갈 수 있는 칸 표시**(이동력만큼 BFS) → 표시 칸 클릭 시 `war_move`(경로 자동 구성) → 성공하면 즉시 반영, 실패하면 쉬운 말 메시지 표시
- 「지휘권 넘기기」 탭: 내 군사 병력 + 육·해·공 버튼 → `war_transfer`. 공병사령관 「노동자」·「정찰병」 탭도 같은 이동 방식. 버튼 48px 이상·깜빡임 없음·영어 노출 없음
- 서버 `war_poll`의 병력 목록에 `moves_left`, 지도 영역에 시장 칸(공개 정보) 목록을 추가해 화면과 미리보기가 같은 규칙 코드를 쓰게 함

## H5. 미리보기 체험 (2줄)

- 가짜 서버가 `war_move`·`war_transfer`를 같은 규칙(`canPass`·`canStop`·같은 칸 군사 2개 금지·`fakeAct` 역할 검사)으로 브라우저 메모리에서 처리, `bump('units')`로 다음 poll에 반영. 병력 이동력도 전쟁 규칙대로 초기화
- `?preview=real&as=1:army` 이동, `as=1:engineer` 노동자 이동, `as=1:air` 공군 통과 이동 가능. 새로고침하면 처음 상태

## H6. 문서 (2줄)

- `docs/war-design.md` 4-4장: 공군 통과 문구 교체, 「땅·바다 유닛은」 시작으로 수정, 노동자 이동력 2·시장 칸 진입 금지 추가, 한 칸 한 유닛 DB 강제 문구. 13장에 「공군 통과 A」「한 칸 한 유닛을 DB 규칙으로 강제」「노동자 이동력 2」 행 추가(기존 행 그대로)
- `docs/tasks/status.md` 설치 후 확인에 7번(웨일북 2대 동시 이동 → 한쪽만 성공) 추가

## 시험 결과 (마지막 줄, 모두 종료 코드 0)

```
node tests/war/place.test.mjs        전체 통과 (✔ 10개)
node tests/war/e3.test.mjs           전체 통과 (✔ 28개)
node tests/war/e2.test.mjs           전체 통과
node tests/war/act.test.mjs          전체 통과
node tests/war/import-v2.test.mjs    전체 통과
node tests/war/import.test.mjs       전체 통과
node tests/war/rules.test.mjs        전체 통과
node tests/war/db.test.mjs           전체 통과
node tests/war/real-preview.test.mjs 전체 통과
node tests/trade/db.test.mjs         전체 통과
npm run war:config && npm run war:config    config.sql 두 번 같음 (MD5 True)
npm run war:preview && npm run war:preview  state.json 두 번 같음 (MD5 True)
git status --short                   허용 목록 밖 변경 없음
```

## 화면 확인

- 코드 수준: 새 JS 문법 검사 통과, 가짜 DOM 실행 재현으로 화면 흐름(탭·지도 데이터) 점검
- **미확인** (Live Server): `?preview=real&as=1:army` 이동, `as=1:engineer` 노동자 이동, `as=1:air` 공군 통과 이동, 콘솔 빨간 오류 없음 — Claude가 Chrome으로 다시 확인함

## 막힌 점

- 없음 (시험 준비에서 적군 창병이 수도 도시 칸 위에 있어 `NO_ENTRY`가 먼저 나온 것을 도시 밖 유닛으로 바꾸고, 테스트가 오래된 병력 좌표를 쓰던 부분을 현재 칸 조회로 고침)

커밋·푸시하지 않았습니다
