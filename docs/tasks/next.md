# 작업지시서: E2 화면 고치기 2 — 다른 나라 땅이 검게 보임

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인)
- 지난 E2 작업과 화면 고치기 1은 아직 커밋 전이다. 그 위에서 이어서 고친다.

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** Supabase 접속, `private/` 열기, `npm run war:preview:real` 실행 금지. 무역 앱 파일 수정 금지.

## 확인된 결과 (Claude가 Chrome으로 확인)
- 합동참모의장 화면 지도: 이제 `?preview=real&as=1:chief`, `?preview=1&as=1:chief` 모두 **정상으로 보임**, 콘솔 오류 없음, 첫 탭 이름 정상. (이 부분은 더 고치지 않는다)
- **새 문제:** `?preview=real` 역할 화면에서 다른 나라 땅 칸이 **검게** 칠해진다.
  - 원인: `app/war/js/war-app.js`가 지도에 `countries`로 **우리 나라 하나만** 넘긴다. 다른 나라 땅은 `war-hexmap.js`의 `colorOf()`가 기본색 `'#888'`을 돌려주고, 거기에 `'30'`을 붙여 `'#88830'`(잘못된 색)이 되어 앞 색(어두운 색)이 그대로 칠해진다.

## 고칠 것
1. **서버:** `public.war_me()` 결과에 `countries`(여섯 나라의 **공개 정보만**: 번호, 이름, 유형) 목록을 더한다. 창고·코인·지갑·시설 등은 넣지 않는다. 미리보기 가짜 서버(`war-api.js`)도 같은 모양으로 돌려준다.
2. **화면:** `war-app.js`가 지도에 여섯 나라 모두를 넘긴다 (색은 `RULES.TYPES[유형].color`).
3. **안전장치:** `war-hexmap.js`의 `colorOf()` 기본색을 6자리(`'#888888'`)로 바꿔, 혹시 모르는 나라가 있어도 잘못된 색이 되지 않게 한다 (`// war:` 주석).
4. **시험:** `tests/war/e2.test.mjs`에 「`war_me`의 `countries`가 6개이고 각 항목은 번호·이름·유형만 있음(코인·창고 등 없음)」 검사 추가.

## 고쳐도 되는 파일
`supabase/war/functions.sql`(`war_me`만), `tests/war/e2.test.mjs`, `app/war/js/war-app.js`, `app/war/js/war-api.js`, `app/war/js/war-hexmap.js`(`colorOf` 한 줄), `docs/tasks/report.md`

## 완료 조건
- `node tests/war/e2.test.mjs` 「전체 통과」, `node --check`로 고친 js 통과
- Live Server `?preview=real&as=1:chief`(가능하면): 다른 나라 땅이 그 나라 색으로 옅게 보이고 검은 칸이 없음. 못 하면 「미확인」 (Claude가 Chrome으로 다시 확인함)

## 보고 (`docs/tasks/report.md`에 덮어쓰기)
1~4 각각 1~2줄, 시험 마지막 줄, 마지막 줄 「커밋·푸시하지 않았습니다」
