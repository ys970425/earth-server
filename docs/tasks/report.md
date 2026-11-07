# W0 작업 보고서 — PGlite 테스트 틀 만들기

- 날짜: 2026-11-07
- 브랜치: `war-version` 확인 후 작업 (git branch --show-current → war-version)
- 결과: **완료**

## 바뀐 파일

| 파일 | 내용 |
|---|---|
| `tests/war/helpers.mjs` (새) | `createDb()` — PGlite 생성 → 가짜 auth → `supabase/trade_setup.sql` 2회 실행 → `set_admin_password`, `ok`·`fail`·`rpc`·`one`·`summary`는 `tests/trade/db.test.mjs`와 같은 동작 |
| | `seedTradeState(ctx)` — 학생 25명(1모둠 5, 2~6모둠 4) 등록·접속, 나라마다 대표 지정, 1번 나라에 농장 개발 1회·수도에 시장 건설·튜토리얼 도시국가 점령, `admin_next_turn` 2회. 겹친 병력이 없으면 2번 나라 창병 2개를 `unit_move`로 같은 칸에 세움. 반환 `{ ADMIN, students, leaderOf(c) }` |
| | `tradeFingerprint(db)` — `priv`·`public`의 모든 표(24개)를 표 이름순으로, 각 표의 모든 행을 `to_jsonb` 문자열 순으로 정렬해 md5 요약 (`{ 표이름: md5 }`). `war` 스키마는 넣지 않음 |
| `tests/war/db.test.mjs` (새) | 검사 a(나라 6개·25명 기기 연결), b(점령 도시국가 1곳 이상), c(같은 칸 군사 유닛 2개 이상), d(지문 두 번 같음·`priv.units` 한 행 변경 시 units 표만 달라짐→되돌림) |
| `package.json` | `scripts`에 `test:war`, `test:trade`만 추가 (devDependencies 그대로) |

`package-lock.json`: 바뀌지 않았음 (git diff 없음). `.gitignore`: 고치지 않음.

## 완료 조건 실행 결과 (마지막 3줄씩)

`node tests/war/db.test.mjs`
```
  ✔ 되돌리면 지문도 원래대로
전체 통과
종료코드 0
```

`node tests/trade/db.test.mjs`
```
  ✔ 전체 초기화: 게임판도 처음으로
전체 통과
종료코드 0
```
(현재처럼 ✔ 149개 모두 통과)

`npm run test:war` / `npm run test:trade` — 두 명령 모두 같은 결과로 「전체 통과」, 종료 코드 0 확인.

## 막힌 점

- 없음 (처음 실행에서 창병이 설 자리를 도시국가 반대편에서 골라 `TOO_FAR`로 1회 실패 → 가장 가까운 칸으로 고르게 고쳐 해결)

## 제안

- 이 컴퓨터 터미널(PowerShell)의 PATH에 `git`과 `node`가 없어서 전체 경로(`C:\Program Files\Git`, `C:\Program Files\nodejs`)로 실행했습니다. 다음 작업자(GPT)나 Claude도 같은 상황일 수 있으니 참고하세요.

## 아직 푸시하지 마세요 — 커밋·푸시를 하지 않았습니다. Claude 검토 후 처리 바랍니다.
