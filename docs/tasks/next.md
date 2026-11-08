# 작업지시서 (헬피코드): ①a 시장 섬 그리기 + 튜토리얼 미션 서버

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인)
- 결정 (2026-11-08): 미션 완료는 **서버에 학생별로 기록**. 지금 할 수 있는 미션부터 열고, 나머지는 기능이 생기는 단계에서 연다.

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** Supabase 접속, `private/` 열기, `npm run war:preview:real` 실행 금지. 무역 앱 파일 수정 금지.
- **같은 시간에 GPT가 `app/war/js/war-api.js`, `war-app.js`, `war-admin.js`, `war-preview-db.js`, `app/war/*.html`, `tools/war/make-*preview.mjs`, `.gitignore`, `package.json`, `tests/war/select.test.mjs`, `tests/war/preview-db.test.mjs`를 고치고 있다. 이 파일들은 절대 건드리지 않는다.** (`package.json`의 시험 명령 등록은 Claude가 나중에 한다)
- 화면 탭·미션 화면·관제실 화면·문서는 **이번에 하지 않는다** (다음 지시서 ①b).

## 1. 시장 섬 그리기 (`app/war/js/war-hexmap.js`)
- `setData({ markets })`로 받은 시장 목록(`[{ id, tile, art, name }]`, `art`는 `neutral_village`/`neutral_harbor`/`neutral_fortress`)을 지도에 그린다.
- 그림은 `../trade/assets/small/city/<art>.png` (이미 있음). 도시를 그리는 방식(`drawImgAnchor`, 이름표)과 같게, 이름표 색은 회색 계열로 「중립」 느낌. 체력 막대·방어 표시는 그리지 않는다.
- 바꾼 곳에 `// war:` 주석. 다른 그리기 동작은 바꾸지 않는다.

## 2. 미션 목록 (`app/war/js/war-rules.js` → `npm run war:config`로 `supabase/war/config.sql` 다시 만들기)
`W.MISSIONS`: `{ key, role, order, text, opens }` 목록. `opens`는 열리는 단계(`now`, `E4`, `E6`, `E7`, `E8`, `E9`, `E10`). `W.OPEN_STAGES = ['now']` (단계가 끝날 때마다 늘림). `tools/war/build-config.mjs`가 이 두 값도 `war.config`에 넣게 한다.

| key | 역할 | 문구 (쉬운 「~해요」) | opens |
|---|---|---|---|
| chief_info | chief | 「우리 나라」 탭에서 나라 정보를 살펴봐요 | now |
| chief_budget | chief | 공병사령관에게 예산을 나눠 줘요 | E6 |
| chief_ally | chief | 다른 나라에 동맹을 제안해요 | E8 |
| chief_market | chief | 도시국가 시장에서 물물교환을 한 번 해요 | E9 |
| eng_worker_move | engineer | 노동자를 한 칸 옮겨요 | now |
| eng_scout_enemy | engineer | 정찰병을 다른 나라 도시 바로 옆까지 보내요 | now |
| eng_build | engineer | 건물을 하나 지어요 | E6 |
| eng_repair | engineer | 부서진 시설을 고쳐요 | E6 |
| army_move | army | 병력 하나를 옮겨 봐요 | now |
| army_transfer | army | 병력 하나의 지휘권을 다른 참모총장에게 넘겨 봐요 | now |
| army_attack_preview | army | 공격 미리보기를 확인해요 | E4 |
| army_build | army | 병력을 하나 만들어요 | E7 |
| navy_move | navy | 배 하나를 옮겨 봐요 | now |
| navy_coast | navy | 배를 우리 해안 도시 옆으로 보내요 | now |
| navy_attack_preview | navy | 공격 미리보기를 확인해요 | E4 |
| navy_build | navy | 배를 하나 만들어요 | E7 |
| air_fly_over | air | 공군을 다른 나라 병력 위로 날려 옮겨요 | now |
| air_transfer | air | 공군 하나의 지휘권을 다른 참모총장에게 넘겨 봐요 | now |
| air_attack_preview | air | 공격 미리보기를 확인해요 | E4 |
| air_build | air | 전투기를 하나 만들어요 | E7 |

## 3. 미션 서버 (`supabase/war/schema.sql`, `supabase/war/functions.sql`)
- 표 `war.mission_done`: 학생 번호, 미션 key, 완료 시각 (기본키 학생·key). 가져오기(`war.admin_import`) 때 비운다.
- `public.war_mission_done(p_mission text)`: 로그인한 학생(`priv.students.uid = auth.uid()`)만. 그 미션이 `war.cfg()`의 MISSIONS에 있고, **내 역할 또는 내가 대행 중인 역할**(결석·빈 역할 대행, 4명 모둠 합참의 공병)의 미션이며, `opens`가 OPEN_STAGES 안에 있어야 함. 아니면 오류 (`BAD_MISSION` 「아직 열리지 않았거나 내 미션이 아니에요」). 이미 했으면 그대로 성공(두 번 기록 안 됨). 성공하면 `war.bump('country', 내 나라)`.
- `public.war_missions()`: 내 미션 목록 `[{ key, role, order, text, opens, open, done }]` (내 역할 + 대행 역할만).
- `public.war_admin_missions()`: 교사만 (`priv.need_admin()`). 학생별 `{ student, country, nick, role, done: [key…], total_open }` — **닉네임만, 실명 금지**.
- 행동을 성공시킨 것을 서버가 직접 확인하지는 않는다 (연습용이라 화면이 알린 대로 기록).

## 4. 시험 `tests/war/missions.test.mjs` (새)
W0 틀 → 전쟁 SQL 설치 → 가져오기 → 학생에게 역할 주기(`war_choose_role`).
- 육군 학생: `army_move` 기록 성공, 두 번 해도 오류 없고 한 줄만 / `army_build`(E7) → `BAD_MISSION` / `navy_move`(남의 역할) → `BAD_MISSION` / 없는 key → `BAD_MISSION`
- `war_missions`: 육군 학생에게 육군 미션 4개만, `army_move`가 `done: true`, `army_build`가 `open: false`
- 결석 대행: 육군 학생을 결석 표시하면 합참의장 `war_missions`에 육군 미션도 나옴
- `war_admin_missions`: 교사만, 결과에 실명(`학생`이라는 글자) 없음
- 가져오기를 다시 하면 완료 기록이 비워짐
- 기존 시험(`place`, `e3`, `e2`, `act`, `import-v2`, `import`, `rules`, `db`, `real-preview`, `trade`) 모두 통과 — 단 `tests/war/select.test.mjs`는 GPT가 고치는 중이라 실행 결과만 적고 고치지 않는다.
- 실행: `node tests/war/missions.test.mjs` (`package.json`에 등록하지 않는다)

## 고쳐도 되는 파일 (이것만)
`app/war/js/war-hexmap.js`, `app/war/js/war-rules.js`, `tools/war/build-config.mjs`, `supabase/war/config.sql`(다시 만들기), `supabase/war/schema.sql`, `supabase/war/functions.sql`, `tests/war/missions.test.mjs`(새), `tests/war/rules.test.mjs`(미션 목록 검사 더할 때만), `docs/tasks/report.md`

## 완료 조건
- 위 시험 모두 통과, `npm run war:config` 두 번 같은 결과, `node --check app/war/js/war-hexmap.js`
- `git status --short`에서 이 작업으로 바뀐 것이 위 목록뿐 (GPT 쪽 파일 변경은 그대로 둔다)

## 보고 (`docs/tasks/report.md`에 덮어쓰기)
1~4 각각 3줄 이내, 시험 마지막 줄들, 못 한 것은 맨 위 「실패: 이유」, 마지막 줄 「커밋·푸시하지 않았습니다」
