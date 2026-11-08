# 작업지시서: ② 미리보기를 브라우저 안 PGlite(진짜 SQL)로 바꾸고 가짜 서버 삭제

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인)
- 결정 (2026-11-08, 1번 A): 미리보기에서 가짜 서버(`war-api.js`의 `makeFake`)가 진짜 서버와 따로 놀아 버그가 두 번 났다 (남의 병력 선택, 역할 고른 뒤 빈 화면). **미리보기도 진짜 SQL을 그대로 실행**하게 바꾼다.

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** Supabase 접속 금지. 무역 앱 파일 수정 금지.
- `private/` 폴더는 열지 않는다. `npm run war:preview:real`은 실행하지 않는다 (실제 데이터 쪽은 코드만 고치고, 실행 확인은 Claude가 한다).
- 실제 학생 데이터에서 나온 파일은 **반드시 `.gitignore`로 막힌 이름**으로만 만든다. 학생 실명은 어떤 파일에도 쓰지 않는다.
- `supabase/war/*.sql`의 규칙은 바꾸지 않는다 (미리보기용 SQL을 따로 만들지 않는다).

## 1. 미리보기 DB 파일 만들기
- `tools/war/make-preview.mjs`: 지금처럼 PGlite에 무역 SQL + 전쟁 SQL(schema → config → functions)을 설치하고 학생 25명 진행 상태를 만든 뒤 `war_admin_import('초기화')`. 그다음:
  - `await db.dumpDataDir('gzip')` 결과를 **`app/war/preview/db.tar.gz`** 로 저장
  - **`app/war/preview/db.json`** (메타): `{ admin_uid, students: [{ id, country, uid }] }` — 이름·닉네임 넣지 않음
  - 체험 모드(`&play=1`)가 쓰는 `state.json`은 지금처럼 계속 만든다
- `tools/war/make-real-preview.mjs`: 지금의 `convert()` 과정(백업 복원 → 가져오기)을 마친 DB에서
  - 학생 행에 미리보기용 가짜 uid를 넣는다 (`update priv.students set uid = gen_random_uuid()` 같은 것 — 이 DB는 이 컴퓨터 안의 복사본이라 괜찮음). 교사용 uid도 하나 만들어 `admin_login('test-pw')` 상태로 둔다.
  - **`app/war/preview/db-real.tar.gz`**, **`app/war/preview/db-real.json`** 으로 저장 (메타 형식은 위와 같음)
  - 지금처럼 `state-real.json`도 만든다
- `.gitignore`: `app/war/preview/db.tar.gz`, `app/war/preview/db.json`, `app/war/preview/*real*` 추가 (DB 파일은 몇 MB라 커밋하지 않고 `npm run war:preview`로 만든다). 추가 뒤 `git check-ignore`로 네 이름 모두 막히는지 확인.

## 2. 브라우저에서 PGlite로 실행 — `app/war/js/war-preview-db.js` (새, ES module)
- PGlite **0.5.15**를 CDN에서 불러온다: `https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.15/dist/index.js`
- `?preview=1` → `preview/db.tar.gz` + `db.json`, `?preview=real` → `preview/db-real.tar.gz` + `db-real.json`을 `fetch` → `new PGlite({ loadDataDir: blob })`
- 접속 흉내 (`set_config('request.uid', uid, false)`):
  - 학생 화면: `&as=나라번호:역할` → 그 나라 학생 중 한 명의 uid로 접속하고, 그 학생에게 그 역할을 준다 (미리보기 DB 안에서만 `war.roles`에 직접 넣기). `&as=나라번호`(역할 없음)나 `as` 없음(1번 나라) → 역할이 없는 학생으로 접속 → **진짜 `war_choose_role`로 역할 고르기**
  - `&size=4` → 그 나라 학생을 4명이 되게 미리보기 DB에서 한 명 지운다
  - 교사 관제실(`admin.html?preview=…`) → `admin_uid`로 접속
- `rpc(이름, 인자)`: `select public.이름(p_a => $1, p_b => $2) as r` 처럼 **이름 붙인 인자**로 부르고 `r`을 돌려준다. 오류는 지금 `war-api.js`의 `cleanError`와 같은 모양(`code`, 쉬운 말 `message`)으로.
- 처음 여는 동안 화면에 「미리보기를 준비하고 있어요 (몇 초 걸려요)」. 파일이 없으면 「터미널에서 npm run war:preview 를 먼저 실행해 주세요」 (real이면 `war:preview:real`).
- 새로고침하면 처음 상태로 돌아간다 (저장하지 않음).

## 3. `app/war/js/war-api.js`
- **가짜 서버(`makeFake`와 그 안의 흉내 함수 전부)를 지운다.** 미리보기 모드의 `rpc`는 `war-preview-db.js`의 `rpc`를 쓴다. 서버 모드는 지금 그대로.
- `start()`(`war-app.js`)와 `war-admin.js`에서 `makeFake`를 부르는 곳도 정리한다. 화면 쪽 다른 동작은 바꾸지 않는다.
- `index.html`, `admin.html`에 `war-preview-db.js`를 `type="module"`로 싣는다 (미리보기일 때만 실제로 불러와도 됨).

## 4. 시험
- `tests/war/preview-db.test.mjs` (새) + `package.json` `"test:war:preview-db"`:
  - `npm run war:preview`로 만든 `db.tar.gz`·`db.json`을 Node PGlite로 불러와서 (`new PGlite({ loadDataDir })`)
  - 역할 없는 학생 uid로 `war_choose_role('army')` 뒤 `war_me`의 메뉴가 1개 이상, 역할이 `army` (**어제의 빈 화면 버그가 진짜 SQL로는 안 생김**)
  - 그 학생이 자기 육군을 빈 칸으로 `war_move` 성공 / 다른 나라 병력 → `NOT_MINE` / 우리 해군 → `ROLE_ONLY`
  - `db.json`에 이름·닉네임 키가 없음
- `tests/war/select.test.mjs`: 가짜 서버(`war-api.js`를 eval하던 부분)를 지우고, 같은 두 거절(다른 나라 → `NOT_MINE`, 우리 해군 → `ROLE_ONLY`)을 위 PGlite 방식으로 확인하게 바꾼다. `isMyUnit` 검사와 화면 코드 검사는 그대로 둔다.
- 기존 시험 모두 통과.

## 5. 문서
- `docs/war-design.md` 8-3장: 「미리보기는 브라우저 안 PGlite로 진짜 SQL을 실행한다 (가짜 서버 없음). DB 파일은 `npm run war:preview`(가짜)·`npm run war:preview:real`(실제, 깃허브 제외)로 만든다」로 고친다. 13장 기록 표에 「미리보기 가짜 서버 → 브라우저 PGlite (2026-11-08)」 행 추가.
- `docs/tasks/status.md` 「잊지 말 것」에 「미리보기 열기 전 `npm run war:preview` 실행 (DB 파일은 깃허브에 없음)」 추가.

## 고쳐도 되는 파일
`tools/war/make-preview.mjs`, `tools/war/make-real-preview.mjs`, `app/war/js/war-preview-db.js`(새), `app/war/js/war-api.js`, `app/war/js/war-app.js`(`makeFake` 부르는 곳만), `app/war/js/war-admin.js`(같음), `app/war/index.html`, `app/war/admin.html`, `.gitignore`, `tests/war/preview-db.test.mjs`(새), `tests/war/select.test.mjs`, `package.json`, `docs/war-design.md`, `docs/tasks/status.md`, `docs/tasks/report.md`

## 완료 조건 (직접 실행)
```bash
npm run war:preview                       # db.tar.gz, db.json, state.json 생성
git check-ignore app/war/preview/db.tar.gz app/war/preview/db.json app/war/preview/db-real.tar.gz app/war/preview/db-real.json   # 네 줄 모두 나옴
node tests/war/preview-db.test.mjs        # 전체 통과
node tests/war/select.test.mjs            # 전체 통과
# 기존: place, e3, e2, act, import-v2, import, rules, db, real-preview, trade 모두 전체 통과
git status --short                        # 위 목록 밖 변경 없음, db*.tar.gz·db*.json은 목록에 안 나옴
grep -c "makeFake" app/war/js/*.js        # 모두 0
```
화면 (Live Server, 못 하면 「미확인」 — Claude가 Chrome으로 다시 확인함): `index.html?preview=1` → 역할 고르기 → 육군 고르면 지도와 메뉴가 나옴 / `?preview=1&as=1:army`에서 병력 이동 / `admin.html?preview=1` 정상 / 콘솔 빨간 오류 없음

## 보고 (`docs/tasks/report.md`에 덮어쓰기)
1~5 각각 3줄 이내, `db.tar.gz` 크기와 브라우저에서 처음 여는 데 걸린 시간(잰 경우), 시험 마지막 줄들, 못 한 것은 맨 위 「실패: 이유」, 마지막 줄 「커밋·푸시하지 않았습니다」
