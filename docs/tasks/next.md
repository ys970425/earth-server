# 작업지시서: E1 헬피코드 몫 (H0~H4) — 서버 표, 규칙 숫자, 가져오기 v2, 시험

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인, 다르면 멈추고 보고)
- 기준 문서: `docs/war-design.md` 2장(역할·예산), 3장(가져오기), 5장, 6장, 7장(시장), 11장(숫자)
- 이 작업이 끝나면 GPT가 `war.act_start`(행동 시작·잠금)와 `war.bump`(바뀜 번호 올리기)를 만든다. **이 두 함수는 만들지 않는다.**

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** 커밋은 Claude가 검토 후에 한다.
- `private/` 폴더는 열지 않는다. `npm run war:preview:real`은 실행하지 않는다.
- 무역 표(`priv.*`, `public.game` 등)에는 쓰지 않는다 (읽기만). 무역 앱 파일(`app/trade/js`, `css`, `img`, `supabase/trade*`, `tools/trade`, `tests/trade`)은 고치지 않는다.

---

## H0. 설계 문서: 결석 대행 규칙 (`docs/war-design.md` 2장)
지금 2장 「결석 대비」 줄을 아래로 바꾼다.
- **결석한 학생의 역할은 합동참모의장이 대신 맡는다.** 공병사령관·참모총장 모두 해당.
- 결석은 (1) 교사가 관제실에서 그 학생을 「결석」으로 표시했거나, (2) 그 역할을 아무도 고르지 않은 경우.
- 합동참모의장이 결석하면 교사가 관제실에서 그 나라의 다른 학생을 합동참모의장으로 지정한다 (기본값).
- 13장 기록 표에 「결석 대행: 결석한 학생의 역할은 합동참모의장이 대신」 한 줄 추가 (기존 행은 그대로 두기).

## H1. 표 추가 (`supabase/war/schema.sql`)
여러 번 실행해도 안전하게(`if not exists`, `add column if not exists`). `war` 표에 학생이 직접 쓰지 못하게 하는 기존 권한 처리 유지.
- `war.game`에 열 추가: `turn_seconds`(기본 180), `turn_end`(시각), `paused`(기본 false), `combat_on`(기본 true)
- `war.roles`: 학생 번호, 나라, 역할(`chief`/`engineer`/`army`/`navy`/`air`), `absent`(결석, 기본 false). 한 나라에서 한 역할은 한 명 (유일 조건)
- `war.wallets`: 나라, 역할, 물건, 개수 (기본키 나라·역할·물건). 국고는 지금처럼 `war.countries.coin` + `war.inventory`
- `war.city_facilities`: 도시, 시설 종류, 분류(`factory`/`advanced`), `ruined`(파괴, 기본 false), `origin_country`(원래 나라)
- `war.tiles`에 `imp_ruined`(기본 false)
- `war.units`에 `commander`(조종하는 역할: `army`/`navy`/`air`/`engineer`)
- `war.cities`에 `besieged`(기본 false)
- `war.countries`에 `shield_until`(보호막 끝나는 턴, 기본 0), `cities_lost`(기본 0)
- `war.diplomacy`: 나라 a, 나라 b (a < b), 상태(`peace`/`war`/`ally`), 바뀐 턴, `no_war_until`(평화 뒤 선포 금지 끝나는 턴, 기본 0)
- `war.offers`: 번호, 종류(`ally`/`peace`/`trade`), 보낸 나라, 받는 나라, 내용(jsonb), 상태, 턴
- `war.markets`: 번호(1~3), 칸, 그림(`neutral_village`/`neutral_harbor`/`neutral_fortress`), 이름 / `war.market_stock`: 시장, 물건, 개수
- `war.versions`: 영역(`game`/`map`/`units`/`cities`/`diplomacy`/`country`/`notice`), 나라(전체면 0), 번호 (기본키 영역·나라). **번호를 올리는 함수는 만들지 않는다 (GPT 몫).**
- `war.grants`: 나라, 병과, 병력 종류, 병력 번호, 결과(`given`/`skipped`), 까닭

## H2. 규칙 숫자를 서버로 (`tools/war/build-config.mjs` → `supabase/war/config.sql`)
- `app/war/js/war-rules.js`와 `app/trade/js/rules.js`를 읽어 `war.config`(한 행, jsonb)에 넣는 SQL을 만든다. 무역 앱 `tools/trade/build-sql.mjs`가 `priv.config`를 만드는 방식을 따른다.
- 넣을 것: 역할, 병과 분류, 추가 병력(구축함·전투기), 특수 부대 힘(95)·피해 상한(60), 건물·타일 시설 분류, 시장 숫자, 턴·수도·수리·보호막·도시 손실·평화 숫자.
- `war.cfg()` 함수: `war.config`의 jsonb를 돌려줌.
- `package.json` scripts에 `"war:config": "node tools/war/build-config.mjs"`. 두 번 실행해도 같은 파일.

## H3. 가져오기 v2 (`supabase/war/functions.sql`의 `war.admin_import`)
W1 규칙(겹친 병력 펼치기, 특수 도시 처리, 체력 100, 무역 표 읽기만)은 그대로 두고 아래를 더한다. 모든 결정은 **정해진 순서**(번호순)로 해서 두 번 가져와도 결과가 같게 한다.
1. **새 표 비우기:** 가져올 때 H1의 새 표도 모두 비운다 (`war.roles`는 비움, 역할은 E2에서 학생이 고름).
2. **공장·고등 건물 배치:** 나라마다 `priv.factories` → `priv.advanced` 순서(각각 종류 이름순)로, 그 나라의 **수도가 아닌 도시**(도시 번호순)에 하나씩 돌아가며 `war.city_facilities`에 넣는다. 수도 말고 도시가 없으면 수도에. 분류는 `war.cfg()`의 건물 분류.
3. **병력 조종 역할:** 군사 유닛은 병과에 따라 `army`/`navy`/`air`, 노동자·정찰병은 `engineer`. 상륙 기갑부대(`t_marine`)는 `army`.
4. **병과 최소 지급:** 나라마다 육군·해군·공군 군사 유닛이 하나도 없으면 1부대 지급하고 `war.grants`에 기록 (있으면 기록 안 함).
   - 육군 → 창병: 수도 칸에 군사 유닛이 없으면 수도 칸, 있으면 수도에서 가장 가까운 빈 땅 칸(우리 땅 우선, 바다·산·다른 나라 도시 제외)
   - 해군 → 삼단노선: 그 나라 해안 도시(이웃에 바다·해안 칸이 있는 도시, 수도 먼저, 그다음 도시 번호순) 옆의 빈 바다·해안 칸. 해안 도시가 없으면 지급하지 않고 `skipped`, 까닭 「해안 도시가 없어 해군을 줄 수 없어요」
   - 공군 → 전투기(`fighter`): 수도 옆 빈 땅 칸
   - 「빈 칸」은 군사 유닛이 없는 칸. 지급한 병력도 체력 100.
5. **시장 3곳:** 칸 번호 = 행 × 40 + 열. 후보 (15,9) 북서 마을 `neutral_village`, (17,16) 남쪽 항구 `neutral_harbor`, (26,6) 동쪽 성곽 `neutral_fortress`. 후보 칸에 도시·병력이 있거나 주인이 있으면, 가장 가까운 주인 없는·도시 없는·병력 없는 바다/해안 칸으로 옮긴다. 고른 칸은 `war.tiles`에서 지형을 평원(`plains`)으로 바꾸고 주인 없음. 창고는 여섯 나라 특산(`STRAT_OF`) 4개씩.
6. **외교:** 여섯 나라 모든 쌍을 `peace`로 넣는다 (15쌍).
7. **게임:** `turn_seconds` 180, `paused` false, `combat_on` true, `turn_end` 비움.
8. 돌려주는 요약에 `grants`(지급 수), `facilities`(배치 수), `markets` 추가.
9. **지급 결과 표 함수:** `war.admin_grants()` (교사만, 무역 앱 관리자 확인 함수 사용) → 나라별 행 목록, 그리고 앱이 부를 `public.war_admin_grants()` 연결 함수. public에는 이것 말고 새 함수를 만들지 않는다.

## H4. 시험
- `tests/war/import-v2.test.mjs` (새) + `package.json` `"test:war:import2"`. W0 틀(`createDb`, `seedTradeState`, `tradeFingerprint`)을 쓴다:
  - 가져오기 전후·두 번째 가져오기 뒤 무역 표 지문 그대로
  - 두 번 가져와도 모든 `war` 표 행 수와 내용(병력 위치, 시설 배치, 시장 칸)이 같음
  - 공장·고등 건물이 하나도 빠짐없이 `war.city_facilities`에 있고, 수도 말고 도시가 있는 나라는 수도에 하나도 없음
  - 병과 지급: 지급 뒤 모든 나라가 육·해·공 각 1부대 이상 (해안 도시가 없어 `skipped`인 경우 제외), 지급된 병력이 규칙에 맞는 칸(땅/바다, 겹침 없음)
  - 시험용 준비로 「한 나라의 해군을 모두 없앤 상태」와 「해안 도시가 없는 나라」를 만들어 지급·`skipped`를 각각 확인 (준비용 직접 `update`/`delete`는 `priv` 표에 지문 기준값을 만들기 **전에** 해도 됨)
  - 시장 3곳: 지형 평원, 주인 없음, 창고 6종×4개, 서로 다른 칸
  - 외교 15쌍 모두 `peace`
  - 학생은 `war_admin_grants` 실행 불가
  - SQL 검사: `supabase/war/*.sql`에 무역 표를 만들거나 고치는 문장 0개 (W1 시험의 정규식 재사용)
- **기존 시험 고치기:** 병과 지급 때문에 `tests/war/import.test.mjs`의 「무역의 모든 병력을 가져옴」(병력 수 = `priv.units` 수)이 맞지 않게 된다. 이 검사만 「`war.units` 수 = `priv.units` 수 + `war.grants`의 `given` 수」로 고친다. 그 밖의 기존 시험은 고치지 않는다.
- `tools/war/make-real-preview.mjs`와 `tests/war/real-preview.test.mjs`도 `config.sql`을 설치해야 하면 설치 순서만 더한다 (`schema.sql` → `config.sql` → `functions.sql`). `tools/war/make-preview.mjs`, `tests/war/import.test.mjs`도 같은 순서.
- 가짜 미리보기 다시 만들기: `npm run war:preview`로 `app/war/preview/state.json`을 다시 만든다 (지급 병력이 들어감).

## 고쳐도 되는 파일 (이것만)
`docs/war-design.md`(2장·13장), `supabase/war/schema.sql`, `supabase/war/functions.sql`, `supabase/war/config.sql`(새), `tools/war/build-config.mjs`(새), `tools/war/make-preview.mjs`·`tools/war/make-real-preview.mjs`(설치 순서만), `tests/war/import-v2.test.mjs`(새), `tests/war/import.test.mjs`(위 한 검사만), `tests/war/real-preview.test.mjs`(설치 순서만), `package.json`(scripts 두 줄), `app/war/preview/state.json`(다시 만들기), `docs/tasks/report.md`

## 완료 조건 (직접 실행)
```bash
npm run war:config && npm run war:config   # 두 번 실행, git diff로 config.sql 같음
node tests/war/import-v2.test.mjs          # 전체 통과
node tests/war/rules.test.mjs              # 전체 통과
node tests/war/db.test.mjs                 # 전체 통과
node tests/war/import.test.mjs             # 전체 통과
node tests/war/real-preview.test.mjs       # 전체 통과
node tests/trade/db.test.mjs               # 전체 통과
npm run war:preview && npm run war:preview # state.json 두 번 같음
git status --short                         # 위 목록 밖 변경 없음
```

## 보고 (`docs/tasks/report.md`에 덮어쓰기)
H0~H4 각각 3줄 이내, 시험 마지막 줄들, 가짜 데이터 기준 나라별 지급 결과(육·해·공 지급/건너뜀), 시장 3곳의 실제 칸, 못 한 것은 맨 위 「실패: 이유」, 마지막 줄 「커밋·푸시하지 않았습니다」
