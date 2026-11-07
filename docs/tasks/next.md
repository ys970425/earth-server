# 작업지시서: 실제 데이터 미리보기 화면 (`?preview=real`)과 한글 이름

- 저장소: `C:\projects\earth-server`
- 브랜치: **`war-version`** (작업 전에 `git branch --show-current`로 확인. 다른 브랜치면 멈추고 보고)
- 참고: `docs/war-design.md` 7장(문구)·8장(미리보기 모드), 지금 화면 코드 `app/war/js/war-data.js`, `app/war/js/war-student.js`

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** (`git commit`, `git push`, `git switch` 모두 금지) 커밋은 Claude가 검토한 뒤에 한다.
- **`private/` 폴더를 열거나 읽지 않는다.** (학생 데이터가 들어 있음) `npm run war:preview:real`도 실행하지 않는다.
- 같은 시간에 다른 작업자가 `tools/war/`, `tests/war/`, `package.json`을 고치고 있다. **이 파일들은 건드리지 않는다.**

## 1. 작업 범위

### ① `?preview=real` 읽기 — `app/war/js/war-data.js`
- 주소에 `?preview=real`이 있으면 `preview/state-real.json`을 읽는다. (이 파일은 다른 작업자가 만드는 `npm run war:preview:real`이 만든다. 깃허브에는 올라가지 않는 파일이다.)
- `?preview=1` 등 그 밖의 `preview` 값은 지금처럼 `preview/state.json`(가짜 데이터)을 읽는다.
- `state-real.json`이 없으면(404) 화면에 이 안내를 보여 준다:
  「실제 데이터 미리보기 파일이 없어요. private 폴더에 무역 백업 파일을 넣고, 터미널에서 npm run war:preview:real 을 실행해 주세요.」
- 화면 코드가 어느 모드인지 알 수 있게 `WarData.mode()` 같은 함수로 `'real'` / `'fake'` / `null`을 돌려준다.

### ② 맨 위 띠 — `app/war/js/war-student.js`
- 가짜: 「미리보기 모드: 가짜 데이터예요」 (지금 그대로)
- 실제: 「실제 데이터 미리보기: 우리 반 무역 게임 기록이에요 (여기서 바꿔도 저장되지 않아요)」
- 실제 데이터일 때 띠 색을 가짜와 다르게 해서 한눈에 구분되게 한다 (`app/war/css/war.css`).

### ③ 영어 이름 없애기 — `app/war/js/war-student.js`
화면에 영어 이름(`scout`, `worker` 등)이 **하나도** 나오지 않게 한다.
- 병력 이름표를 만든다. `RULES.UNITS`의 한글 이름을 먼저 쓰고, 거기에 없는 것은 아래 이름을 쓴다:

| 영어 | 한글 |
|---|---|
| worker | 노동자 |
| scout | 정찰병 |
| ballista | 발리스타 |
| archer | 궁수 |
| swordsman | 검병 |
| boat, ship | 배 |

- 이름표에도 없으면 영어 대신 「병력」이라고 쓴다.
- 지형·자원·시설도 같은 방식: `RULES.TERRAIN`, `RULES.ITEMS`, `RULES.IMPROVE`에 없으면 각각 「땅」, 「자원」, 「시설」.
- 실제 데이터에 나오는 병력 종류(참고): `scout trireme spear worker musket catapult cannon infantry a_stealth frigate c_jet n_hyper k_missile battleship artillery j_patrol t_marine cruiser` — 모두 한글로 나오는지 확인한다.

## 2. 고쳐도 되는 파일 (이것만)
- `app/war/js/war-data.js`, `app/war/js/war-student.js`, `app/war/css/war.css`
- `docs/tasks/report.md` (보고서, 내용 덮어쓰기)

## 3. 하지 말아야 할 것
- `private/` 읽기, `npm run war:preview:real` 실행
- `tools/`, `tests/`, `package.json`, `.gitignore`, `app/war/preview/`, `app/war/js/war-hexmap.js`, `app/trade/`, `supabase/`, `docs/`(report.md 제외), `CLAUDE.md` 수정
- `git commit`, `git push`, 브랜치 바꾸기, Supabase 접속, `npm install`

## 4. 완료 조건
- `node --check app/war/js/war-data.js`, `node --check app/war/js/war-student.js` 통과
- `app/war/preview/state.json`(가짜)의 모든 `units[].kind`, `tiles`의 지형·자원·시설 값에 대해 이름표 함수가 영어가 아닌 한글을 돌려줌 (짧은 node 스크립트로 확인하고 결과를 보고서에 적기. 스크립트 파일은 저장소에 남기지 않기)
- 위 「실제 데이터에 나오는 병력 종류」 목록도 모두 한글로 나옴
- 화면 확인 (Live Server, 가능하면):
  - `http://127.0.0.1:5500/app/war/index.html?preview=1` → 지금처럼 가짜 데이터, 칸을 눌러 노동자·정찰병이 한글로 나옴
  - `http://127.0.0.1:5500/app/war/index.html?preview=real` → `state-real.json`이 없으면 위 안내가 나옴
  - 브라우저 콘솔(F12)에 빨간 오류 없음
- `git status --short`에 위 「고쳐도 되는 파일」 말고 이 작업으로 바뀐 것이 없음 (다른 작업자의 `tools/war/`, `tests/war/`, `package.json` 변경은 그대로 둔다)

## 5. 보고 (`docs/tasks/report.md`에 덮어쓰기)
- 바뀐 파일과 내용 5줄 요약
- 한글 이름 확인 결과 (병력·지형·자원·시설 각각 몇 종류 확인했는지)
- 화면 확인 결과 (확인 못 한 것은 「미확인」)
- 못 한 것이 있으면 맨 위에 「실패: 이유」
- 마지막 줄: 「커밋·푸시하지 않았습니다」
