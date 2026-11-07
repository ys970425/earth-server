# 작업지시서: E2 — 접속·역할 고르기·역할별 화면 틀·바뀐 것만 받기 (H1~H6)

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인, 다르면 멈추고 보고)
- 기준 문서: `docs/war-design.md` 1-3(바뀐 것만 받기), 2장(역할·메뉴·결석 대행·4명 모둠), 3-3(병과 지급), 8장(화면)
- 결정 (2026-11-07): **Q-A A** 학생 기기 연결은 무역 앱 연결을 그대로 씀 / **Q-B A** 교사는 같은 브라우저에서 무역 관제실에 로그인해 둔 상태를 씀 / **해군 지급 A** 해안 도시가 없으면 수도에서 가장 가까운 빈 바다 칸

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** 커밋은 Claude가 검토 후에 한다.
- Supabase에 접속하거나 SQL을 설치하지 않는다 (설치는 교사가 정한 때). `private/` 폴더는 열지 않는다. `npm run war:preview:real`은 실행하지 않는다.
- 무역 표(`priv.*`)에 쓰지 않는다. 무역 앱 파일(`app/trade/` 아래 js·css·img·html, `supabase/trade*`, `tools/trade`, `tests/trade`)은 고치지 않는다. 화면에서 무역 앱의 함수(`join_student`, `admin_login` 등)를 부르지 않는다.
- `war.act_start`, `war.bump`(GPT가 만든 잠금·번호 함수)의 내용은 바꾸지 않는다 (부르는 것은 됨).

---

## H1. 서버 함수 (`supabase/war/functions.sql`, 필요하면 `schema.sql`)
모두 `security definer`, `search_path = war, priv, public`. 화면은 `public.war_*` 이름으로 부른다. 새 public 함수는 아래 목록만.
- **지도 바뀐 칸 추적:** `war.tiles`에 `ver int not null default 0` 추가. 앞으로 칸을 바꾸는 함수는 `war.bump('map')` 뒤 그 칸의 `ver`를 새 map 번호로 맞춘다 (이번에는 규칙만 함수 주석으로 남기고, 가져오기는 모든 칸 `ver = 0`).
- `public.war_me()`: 로그인한 학생(`priv.students.uid = auth.uid()`)의 나라(번호·이름·유형·색), 내 역할, **대행 역할 목록**(결석·빈 역할, 4명 모둠이면 `engineer`), 내가 볼 메뉴 목록(`war.cfg()`의 ROLES 메뉴, 4명 모둠 합참은 공병 메뉴 합치기), 우리 나라 역할 현황(역할별 **닉네임**만, 실명 금지). 연결된 학생이 아니면 오류 `NO_AUTH` 「무역 앱에서 먼저 접속해 주세요」.
- `public.war_choose_role(p_role text)`: 아직 역할이 없는 학생만. 4명 모둠이면 `engineer` 고를 수 없음. 같은 역할을 이미 누가 골랐으면(유일 조건 충돌) 「이미 다른 친구가 고른 역할이에요」. 성공하면 `war.bump('country', 나라)`. 역할 바꾸기는 교사만.
- `public.war_poll(p_known jsonb)`: `p_known` 예 `{"game":3,"map":5,"units":2,"cities":1,"diplomacy":1,"country":4,"notice":0}` (`country`는 우리 나라 번호). 바뀐 영역만 돌려준다:
  - `versions`(지금 번호 전부), `game`(턴·남은 시각·일시정지·전투 켜짐), `map`(이번 번호보다 `ver`가 큰 칸만 `[id, terrain, res, owner, imp, imp_ruined]`; `p_known.map`이 없거나 0이면 전체), `units`(전체 목록: 번호·나라·종류·칸·체력·조종 역할), `cities`(전체: 번호·칸·주인·이름·체력·최대·포위), `diplomacy`(15쌍), `country`(**우리 나라만**: 국고·창고·역할별 지갑·도시 시설), `notice`(이번 단계는 빈 목록)
  - 다른 나라의 창고·지갑·도시 시설은 절대 넣지 않는다.
- 교사용 (모두 `priv.need_admin()`): `public.war_admin_roles()`(나라별 학생 닉네임·역할·결석), `public.war_admin_set_absent(p_student int, p_absent bool)`, `public.war_admin_set_role(p_student int, p_role text)` (null이면 역할 비우기, `chief` 지정 포함). 바뀌면 `war.bump('country', 나라)`.

## H2. 해군 지급 A (`war.admin_import`)
- 해안 도시가 없거나 해안 도시 옆에 빈 바다 칸이 없으면, **수도에서 가장 가까운 빈 바다·해안 칸**(군사 유닛 없음, 칸 번호순으로 동점 처리)에 삼단노선을 지급하고 `given`으로 기록한다. 그래도 칸이 없을 때만 `skipped`.
- `tests/war/import-v2.test.mjs`의 「해안 도시가 없는 나라는 skipped」 기대를 「수도에서 가장 가까운 빈 바다 칸에 given」으로 바꾼다.

## H3. 시험 `tests/war/e2.test.mjs` (새) + `package.json` `"test:war:e2"`
- 역할 고르기: 성공 / 같은 역할 두 번째 학생 거절 / 4명 모둠은 `engineer` 거절 / 이미 역할 있는 학생이 또 고르기 거절 / 연결 안 된 uid는 `NO_AUTH`
- `war_me`: 4명 모둠 합참 메뉴에 공병 메뉴 포함, 결석 표시한 역할이 합참의 대행 목록에 나옴, 실명(`name`)이 결과에 없음
- `war_poll`: 처음(빈 `p_known`)엔 모든 영역, 같은 번호로 다시 부르면 `versions` 말고 아무 영역도 없음, 역할을 고르면 `country`만 돌아옴, 다른 나라의 창고·지갑이 없음
- 학생은 `war_admin_*` 실행 불가
- 기존 시험 모두 통과 (`test:war:act`, `test:war:import2`, `test:war:import`, `test:war:rules`, `test:war`, `test:war:real`, `test:trade`)

## H4. 화면 연결 층 `app/war/js/war-api.js` (새)
- 서버 모드: `../trade/js/config.js`의 `window.APP_CONFIG`와 supabase-js **2.116.0** (무역 앱과 같은 CDN 주소)을 쓰고, `createClient` 옵션은 **`app/trade/js/api.js`와 똑같이** (`storageKey: 'earth-trade-auth'` 등) 해서 무역 앱 로그인을 그대로 이어받는다. **익명 로그인을 새로 만들지 않는다.** 로그인 정보가 없으면 「무역 앱에서 먼저 접속해 주세요」와 무역 앱 주소 버튼.
- `WarAPI.rpc(이름, 인자)`, `WarAPI.startPoll(받을 함수)`: 4초마다 `war_poll`, 실패하면 8·16초로 늘리고 성공하면 4초로. 화면이 안 보이면(`document.hidden`) 멈춤.
- **미리보기 가짜 서버:** `?preview=1` 또는 `?preview=real`이면 서버 대신 `preview/state.json`(또는 `state-real.json`)으로 `war_me`·`war_choose_role`·`war_poll`·`war_admin_*`을 흉내 낸다 (브라우저 메모리에서만). `&as=나라번호:역할`이면 그 역할로 접속한 것처럼, `&size=4`면 4명 모둠처럼.
- 미리보기에 필요한 시설·지급 결과·시장·외교가 state 파일에 없으면 `tools/war/state-from-war.mjs`에 넣고 `npm run war:preview`로 `state.json`을 다시 만든다 (`real-preview` 시험이 계속 통과해야 함).

## H5. 화면
- **학생 화면** (`app/war/index.html` + 새 `app/war/js/war-app.js`): 접속 확인 → 우리 나라 표시 → 역할이 없으면 「역할 고르기」(빈 역할만 누를 수 있음, 이미 고른 역할은 친구 닉네임 표시) → **역할별 화면 틀**
  - 위쪽: 나라 이름·내 역할·턴·남은 시간 / 가운데: 지도(`war-hexmap.js`, 64px) / 오른쪽: 내 역할 **메뉴 탭** (설계 2장 표 그대로, 내용은 「다음 단계에서 열려요」). 대행 중인 역할이 있으면 「○○ 대신하는 중」 탭이 더 생김
  - 참모총장·공병사령관 화면에는 무역·외교·시장 메뉴가 없어야 함
  - 버튼 최소 48px, 깜빡이는 효과 없음, 아래 「myoLab(산쌤)」
  - 지금의 체험 모드는 `?preview=real&play=1`(또는 `?preview=1&play=1`)로 계속 열리게 둔다 (`war-student.js`는 그대로).
- **교사 관제실** (`app/war/admin.html` + `app/war/js/war-admin.js`, 새): 「무역 게임에서 가져오기」(「초기화」 입력 확인) + **지급 결과 표**(나라별 육·해·공 지급/건너뜀·까닭) + **역할 현황**(나라별 닉네임·역할, 결석 표시 켜기·끄기, 역할 지정). 교사 로그인이 아니면 「같은 브라우저에서 무역 관제실에 먼저 로그인해 주세요」.
- 글은 쉬운 「~해요」, 영어 노출 금지.

## H6. 문서
- `docs/war-design.md`: 3-3장 해군 지급을 「해안 도시가 없으면 수도에서 가장 가까운 빈 바다 칸」으로, 8장에 Q-A·Q-B 결정 한 줄씩, 13장 기록 표에 「해군 지급 A」「기기 연결 Q-A」「교사 로그인 Q-B」 행 추가 (기존 행 그대로).
- `docs/tasks/status.md`에 **「설치 후 확인」** 목록을 만들고 아래를 넣는다:
  1. `earth-war`에서 무역 앱 로그인이 이어지는지 (같은 웨일북·같은 브라우저)
  2. 웨일북 2대 동시 접속: 같은 역할을 동시에 고르면 한 명만 성공
  3. 한쪽 웨일북에서 역할을 고르면 다른 웨일북에 4초 안에 반영
  4. 교사 관제실에서 실제 가져오기와 지급 결과 표
  5. 25명이 4초마다 받을 때 응답 크기·서버 부담 (무료 요금제 한도)
  6. 교사가 무역 관제실 로그인 상태로 전쟁 관제실이 열리는지

## 고쳐도 되는 파일 (이것만)
`supabase/war/schema.sql`, `supabase/war/functions.sql`, `tests/war/e2.test.mjs`(새), `tests/war/import-v2.test.mjs`(H2 기대값만), `package.json`(scripts), `tools/war/state-from-war.mjs`, `app/war/preview/state.json`(다시 만들기), `app/war/index.html`, `app/war/admin.html`(새), `app/war/js/war-api.js`·`war-app.js`·`war-admin.js`(새), `app/war/css/war.css`, `docs/war-design.md`, `docs/tasks/status.md`, `docs/tasks/report.md`

## 완료 조건 (직접 실행)
```bash
node tests/war/e2.test.mjs         # 전체 통과
node tests/war/act.test.mjs        # 전체 통과
node tests/war/import-v2.test.mjs  # 전체 통과
node tests/war/import.test.mjs     # 전체 통과
node tests/war/rules.test.mjs      # 전체 통과
node tests/war/db.test.mjs         # 전체 통과
node tests/war/real-preview.test.mjs # 전체 통과
node tests/trade/db.test.mjs       # 전체 통과
npm run war:preview && npm run war:preview  # state.json 두 번 같음
git status --short                 # 위 목록 밖 변경 없음
```
화면 (Live Server, 확인 못 하면 「미확인」):
- `app/war/index.html?preview=1&as=1:chief` → 합참 메뉴 / `&as=1:army` → 무역 메뉴 없음 / `&as=1:chief&size=4` → 공병 메뉴 합쳐짐 / `?preview=1` (as 없음) → 역할 고르기 화면
- `app/war/admin.html?preview=1` → 지급 결과 표와 역할 현황
- `?preview=1&play=1` → 예전 체험 모드
- F12 콘솔 빨간 오류 없음, Chrome CPU 4x에서 탭 전환이 끊기지 않음

## 보고 (`docs/tasks/report.md`에 덮어쓰기)
H1~H6 각각 3줄 이내, 시험 마지막 줄들, 가짜 데이터 지급 결과(해군이 이제 given인지), 화면 확인 결과, 못 한 것은 맨 위 「실패: 이유」, 마지막 줄 「커밋·푸시하지 않았습니다」
