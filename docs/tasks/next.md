# 작업지시서: 전쟁 버전 W0 — PGlite 테스트 틀 만들기

- 저장소: `C:\projects\earth-server`
- 브랜치: **`war-version`** (작업 전에 `git branch --show-current`로 확인. 다른 브랜치면 멈추고 보고)
- 참고 문서: `docs/war-design.md` (특히 0장, 2장, 10장의 W0·W1)

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** (`git commit`, `git push`, `git switch` 모두 금지) 커밋은 Claude가 검토한 뒤에 한다.
- 아래 「고쳐도 되는 파일」 말고는 만들거나 고치지 않는다.

## 1. 작업 범위

이 컴퓨터 안의 가짜 데이터베이스(PGlite)에 무역 게임을 설치하고, 학생 25명이 무역 게임을 조금 진행한 상태를 자동으로 만드는 **테스트 틀**을 만든다. 다음 단계(W1 「무역 게임에서 가져오기」)가 이 틀 위에서 시험된다.

### 이미 준비된 것 (그대로 쓴다)
- `@electric-sql/pglite` **0.5.15**가 이미 설치되어 있다 (`node_modules`, `package.json`의 devDependencies, `package-lock.json`).
- **다시 설치하거나 버전을 바꾸지 않는다.** `npm install`을 실행하지 않는다.
- 기존 무역 테스트 `tests/trade/db.test.mjs`의 방식을 그대로 따른다:
  PGlite 생성 → `auth` 스키마와 가짜 `auth.uid()` 함수 → `supabase/trade_setup.sql` 실행 → `priv.set_admin_password` → `rpc(uid, fn, ...args)`로 `public` 함수 호출.

### 만들 것

**① `tests/war/helpers.mjs`** (ES module, export)
- `createDb()`: PGlite를 만들고 가짜 auth 설치, `supabase/trade_setup.sql` 실행, 관리자 비밀번호 설정. 반환 `{ db, rpc, one, ok, fail, summary }`
  - `ok`, `fail`, `rpc`, `one`은 `tests/trade/db.test.mjs`와 같은 동작
  - `summary()`: 실패가 없으면 「전체 통과」 출력 후 종료 코드 0, 있으면 실패 수 출력 후 종료 코드 1
- `seedTradeState(ctx)`: 학생 25명(1모둠 5명, 2~6모둠 4명) 명단 등록·접속, 나라마다 대표 지정. 그리고 무역 게임을 조금 진행한 상태를 만든다:
  - 적어도 한 나라는 노동자 개발 1회, 도시 건물 1개, 튜토리얼 도시국가 1곳 점령, 턴 넘김 2회 이상
  - `public` 함수(`worker_build`, `city_build`, `unit_move`, `unit_attack`, `admin_next_turn` 등)를 먼저 쓰고, 꼭 필요할 때만 테스트 준비용으로 직접 `update`한다 (`tests/trade/db.test.mjs`도 그렇게 함)
  - 반환: 이후 테스트에 쓸 값 (예: `{ ADMIN, students, leaderOf(countryId) }`)
- `tradeFingerprint(db)`: 스키마 `priv`와 `public`의 **모든 표**를 표 이름순으로, 각 표의 모든 행을 정해진 순서로 문자열로 만들어 md5로 요약한 값을 표별로 돌려준다 (`{ 표이름: md5 }`). 나중에 `war` 스키마가 생겨도 `war`는 넣지 않는다.

**② `tests/war/db.test.mjs`**
helpers로 준비한 뒤 아래를 검사한다 (`ok`로 한글 메시지 출력, 마지막에 `summary()`):
- a. 나라 6개, 학생 25명 모두 기기 연결됨
- b. 점령된 도시국가(`priv.cities`에서 `kind = 'cs' and country is not null`)가 1곳 이상
- c. 같은 칸에 군사 유닛(`worker`, `scout` 제외)이 2개 이상 있는 칸이 1곳 이상
  - 자연스럽게 생기지 않으면 seed에서 `unit_move`로 만들어 둔다 (W1의 「겹친 병력 펼치기」 시험용)
- d. `tradeFingerprint`를 두 번 만들면 완전히 같다. 그리고 `priv.units`의 한 행을 바꾸면 그 표의 값만 달라진다 (검사 뒤 원래대로 되돌리거나 새 PGlite를 쓴다)

**③ `package.json`에 scripts 추가** (devDependencies는 그대로)
```json
"scripts": {
  "test:war": "node tests/war/db.test.mjs",
  "test:trade": "node tests/trade/db.test.mjs"
}
```

## 2. 고쳐도 되는 파일 (이것만)
- `tests/war/` 아래 새 파일
- `package.json` (scripts 추가만)
- `package-lock.json` (바뀌지 않는 것이 정상)
- `.gitignore` (필요할 때만)
- `docs/tasks/report.md` (보고서, 새로 만듦)

## 3. 하지 말아야 할 것
- `supabase/`, `app/`, `tools/`, `tests/trade/`, `docs/`(report.md 제외), `CLAUDE.md` 수정 금지
- `git commit`, `git push`, 브랜치 바꾸기 금지
- Supabase 접속, `npm install`, 패키지 추가 금지
- `C:\projects\nation` 등 이 저장소 밖의 파일 수정 금지

## 4. 완료 조건
아래 두 명령을 **직접 실행해서** 확인한다.

```bash
node tests/war/db.test.mjs     # 모두 ✔, 마지막 줄 「전체 통과」, 종료 코드 0
node tests/trade/db.test.mjs   # 지금처럼 「전체 통과」 (현재 ✔ 149개)
```

`npm run test:war`, `npm run test:trade`로도 같은 결과가 나와야 한다.

## 5. 보고 (`docs/tasks/report.md`에 작성)
- 바뀐 파일과 내용 5줄 요약
- 두 테스트 명령의 마지막 3줄 결과
- 못 한 것이나 막힌 것이 있으면 맨 위에 「실패: 이유」
