# 작업지시서: 전쟁 버전 W2 — 학생 화면 뼈대와 미리보기 모드

- 저장소: `C:\projects\earth-server`
- 브랜치: **`war-version`** (작업 전에 `git branch --show-current`로 확인. 다른 브랜치면 멈추고 보고)
- 참고 문서: `docs/war-design.md` (0장 금지 사항, 7장 문구, **8장 화면·이미지·미리보기 모드**, 10장 W2)

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** (`git commit`, `git push`, `git switch` 모두 금지) 커밋은 Claude가 검토한 뒤에 한다.
- **무역 앱 파일을 고치지 않는다.** (`app/trade/` 아래 전부, `app/index.html` 등 신발 게임 파일 포함)
- Supabase에 접속하지 않는다. `npm install`을 하지 않는다.
- 아래 「고쳐도 되는 파일」 말고는 만들거나 고치지 않는다.

## 1. 작업 범위

전쟁 버전 **학생 화면의 뼈대**를 `app/war/`에 만든다. 아직 Supabase에 설치하지 않으므로, 주소 끝에 `?preview=1`이 있으면 **가짜 데이터 파일**로 화면을 보여 주는 「미리보기 모드」를 넣는다. 이동·전투 기능은 이번 범위가 아니다 (W3~W4).

### ① 가짜 데이터 만들기: `tools/war/make-preview.mjs`
- `tests/war/helpers.mjs`의 `createDb()`, `seedTradeState()`를 **불러 쓴다** (helpers.mjs는 고치지 않는다).
- 무역 SQL 다음에 `supabase/war/schema.sql`, `supabase/war/functions.sql`을 설치하고, 교사 uid로 `public.war_admin_import('초기화')`를 실행한다 (`tests/war/import.test.mjs` 참고).
- 그 결과 **`war` 표**(countries, inventory, tiles, cities, units 등)를 읽어 `app/war/preview/state.json`으로 저장한다.
  - 모양은 무역 앱 학생 화면의 「투명한 정찰병」(`S.obs && S.world`) 경로가 지도에 넘기는 모양을 따른다: `app/trade/js/student.js`의 `updateMap()` 참고.
    - `tiles`: `[id, terrain, res, owner, imp]` 배열들
    - `cities`, `units`, `countries`: `app/trade/js/hexmap.js`가 그릴 때 쓰는 필드 이름에 맞춘다 (hexmap.js에서 `st.cities`, `st.units`를 쓰는 곳을 확인)
  - 그 밖에 오른쪽 창에 쓸 나라별 정보(코인, 창고, 병력 수, 도시 수)도 넣는다.
- **같은 결과가 나와야 한다:** 두 번 실행하면 `state.json`이 똑같아야 한다 (무작위 uid, 시각 같은 값은 빼거나 고정값으로).
- `package.json` scripts에 `"war:preview": "node tools/war/make-preview.mjs"` 추가.

### ② 학생 화면: `app/war/`
- `index.html`: 무역 앱 `app/trade/index.html`처럼 구성한다. 규칙 숫자는 **`../trade/js/rules.js`를 그대로 불러 쓴다** (고치지 않음).
- `css/war.css`: 화면 모양. 무역 앱 `../trade/css/style.css`를 불러 쓰고 필요한 것만 덧붙여도 된다 (원본은 고치지 않음). 폰트도 `../trade/fonts/`를 쓴다.
- `js/war-hexmap.js`: **`app/trade/js/hexmap.js`를 복사**해서, 그림 경로 `img/...`를 `../trade/img/...`로 바꾼다. 그 밖의 변경은 최소로 하고, 바꾼 곳에 `// war:` 주석을 단다. 전역 이름이 무역 앱과 겹치지 않게 `window.WarHexMap`으로 내보낸다.
- `js/war-data.js`: 데이터 불러오기.
  - `?preview=1`이면 `preview/state.json`을 `fetch`로 읽는다.
  - 아니면 화면에 「아직 서버에 연결하기 전이에요. 주소 끝에 ?preview=1 을 붙여 미리보기로 볼 수 있어요.」를 보여 준다 (Supabase 코드는 넣지 않는다).
- `js/war-student.js`: 화면 동작.
  - 맨 위에 「미리보기 모드: 가짜 데이터예요」 띠 (미리보기일 때만)
  - 40×28 육각 지도: 지형, 나라별 땅 색, 수도·도시, 병력. 확대·축소(휠·터치패드), 끌어서 이동
  - 「어느 나라로 볼까요?」 고르기: 6개 나라 중 하나 (미리보기에서만). 고른 나라 수도로 지도 이동
  - 오른쪽 창: 우리 나라 이름·색·코인·병력 수·도시 수 / 칸을 누르면 지형, 주인 나라, 도시 이름, 병력 종류와 체력
  - **모든 화면 하단에 「myoLab(산쌤)」** 고정 표기
- 문구는 5학년 이하가 읽을 수 있는 쉬운 말, 「~해요」 말투 (설계 문서 7장).
- 그림은 `../trade/img/`를 읽기만 한다. `app/war/` 안에 그림 파일을 두지 않는다.

## 2. 고쳐도 되는 파일 (이것만)
- `app/war/` 아래 새 파일 (`index.html`, `css/war.css`, `js/war-*.js`, `preview/state.json`)
- `tools/war/make-preview.mjs` (새)
- `package.json` (scripts 한 줄 추가만)
- `docs/tasks/report.md` (보고서, 내용 덮어쓰기)

## 3. 하지 말아야 할 것
- `app/trade/`, `app/*.html`, `app/js/`, `app/css/`, `supabase/`, `tests/`, `tools/trade/`, `docs/`(report.md 제외), `CLAUDE.md` 수정 금지
- `git commit`, `git push`, 브랜치 바꾸기 금지
- Supabase 접속, `npm install`, 패키지 추가 금지
- 이 저장소 밖의 파일 수정 금지 (`C:\projects\nation` 포함)

## 4. 완료 조건
아래를 **직접 실행해서** 확인한다.

```bash
npm run war:preview          # app/war/preview/state.json 생성
npm run war:preview          # 한 번 더 → git diff --stat 으로 state.json이 바뀌지 않았는지 확인
node tests/war/db.test.mjs       # 「전체 통과」
node tests/war/import.test.mjs   # 「전체 통과」
node tests/trade/db.test.mjs     # 「전체 통과」 (✔ 149개)
git status --short               # app/war/, tools/war/, package.json, docs/tasks/report.md 말고 바뀐 것 없음
```

화면 확인 (VS Code에서 `earth-server` 폴더를 연 상태):
1. `app/war/index.html` 오른쪽 클릭 → 「Open with Live Server」
2. 주소 `http://127.0.0.1:5500/app/war/index.html?preview=1`
3. 확인: 미리보기 띠, 지도·도시·병력 그림, 나라 바꾸기, 칸 누르면 오른쪽 창, 확대·이동, 하단 「myoLab(산쌤)」, **브라우저 콘솔(F12)에 빨간 오류 없음**
4. `?preview=1` 없이 열면 「아직 서버에 연결하기 전이에요…」 안내가 보임

## 5. 보고 (`docs/tasks/report.md`에 덮어쓰기)
- 바뀐 파일과 내용 5줄 요약
- 위 명령들의 마지막 줄 결과, 화면 확인 결과 (확인한 항목에 ✔)
- `war-hexmap.js`에서 원본과 다르게 바꾼 곳 목록
- 못 한 것이나 막힌 것이 있으면 맨 위에 「실패: 이유」
- 마지막 줄: 「커밋·푸시하지 않았습니다」
