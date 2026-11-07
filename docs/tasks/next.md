# 작업지시서: E2 화면 고치기 (Chrome 확인 결과)

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인)
- 지난 E2 작업은 아직 커밋 전이다. 그 위에서 이어서 고친다.

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** Supabase 접속, `private/` 열기, `npm run war:preview:real` 실행 금지. 무역 앱 파일 수정 금지.

## Claude가 이미 고친 것 (그대로 둘 것)
- `app/war/js/war-api.js`의 `rpc()`: 미리보기 가짜 서버(`makeFake`)가 한 번도 만들어지지 않아 모든 화면이 「Cannot read properties of null (reading 'rpc')」로 멈췄다. 처음 부를 때 `makeFake(await WarData.load())`로 만들도록 한 줄 고쳤다.

## 고칠 것 (Chrome으로 열어 본 결과)
1. **「undefined」 내용은 다음 단계에서 열려요** — 모든 역할 화면. `war-app.js`에서 `S.tab = S.me.role`로 처음 탭을 역할 키(`chief` 등)로 정하는데, 탭 목록의 키와 맞지 않는다. 처음에는 **첫 번째 메뉴 탭**이 열리게 고친다.
2. **합동참모의장 화면의 지도가 비어 있다** — `?preview=1&as=1:chief`와 `?preview=1&as=1:chief&size=4`에서 지도 칸이 검게 비어 있다 (`as=1:engineer`, `as=1:army`는 지도가 보임). 원인을 찾아 고친다. 예상: 합참의장일 때만 poll 결과 처리(나라 정보·대행 탭 그리기 등)에서 오류가 나 지도 데이터가 들어가지 않음. 오류는 `catch`로 숨기지 말고 고친다.
3. **처음 지도 위치:** 역할 화면이 열리면 우리 나라 **수도로 지도가 이동**하게 한다 (지금은 지도의 엉뚱한 곳이 보임).
4. **영어 오류 문구:** 화면에 보여 주는 오류가 자바스크립트 영어 문구면 「문제가 생겼어요. 새로고침해 주세요.」로 바꿔 보여 주고, 영어 원문은 콘솔에만 남긴다.

## 고쳐도 되는 파일
`app/war/js/war-app.js`, `app/war/js/war-api.js`, `app/war/js/war-admin.js`, `app/war/css/war.css`, `docs/tasks/report.md`

## 완료 조건
- `node --check`로 위 js 통과, `node tests/war/e2.test.mjs` 「전체 통과」
- Live Server (가능하면): `?preview=1&as=1:chief`, `&as=1:engineer`, `&as=1:army`, `&as=1:chief&size=4`에서 지도가 우리 수도 근처로 보이고 첫 탭 이름이 제대로 나옴. `admin.html?preview=1` 정상. F12 콘솔 빨간 오류 없음. 못 하면 「미확인」 (Claude가 Chrome으로 다시 확인함)

## 보고 (`docs/tasks/report.md`에 덮어쓰기)
1~4 각각 원인과 고친 내용 2줄, 시험 마지막 줄, 마지막 줄 「커밋·푸시하지 않았습니다」
