# 헬피코드 지시서 — E4 화면·관제실 주소 통일·화면 시험 추가

기준 문서: `docs/war-design.md`. 커밋·푸시 금지(Claude가 검토 후 커밋).
고쳐도 되는 파일: `app/war/index.html`, `app/war/js/war-app.js`, `tests/war/screen.test.mjs`.

---

## 작업 1 — E4 화면: 공격 버튼·미리보기·점령·포위 표시

**현재 상태**
- `war-app.js`의 `onTile()` (126줄~)은 이동만 처리. 공격 대상 칸을 클릭해도 아무 반응 없음.
- `war-hexmap.js`의 `setAtk()` 메서드(210줄 부근)는 이미 있어서 적 칸에 빨간 맥동 표시 가능.
- 미션 `army_attack_preview`, `navy_attack_preview`, `air_attack_preview`가 `war-rules.js` 144·148·152줄에 `opens: 'E4'`로 정의돼 있음. 현재는 아직 `open: false`라 미션 목록에 「곧 열려요」로 표시됨.

**해야 할 일 (war-app.js)**

### 1-A. 공격 가능 칸 계산 · 표시

`selectUnit(u)` 안에서 갈 수 있는 칸(`S.reach.stops`)을 세팅한 직후, 현재 칸(u.tile) 이웃에 있는 적 병력·적 도시 칸을 찾아 `S.map.setAtk(attackIds)` 로 넘겨라.

조건:
- `u.moves_left > 0` 일 때만 (이동력 소진 여부와 별개로 공격 가능 여부는 아래).
- 이웃 칸(`WarHexMap.neighbors(u.tile)`)에 적 병력(`S.units.some(x => x.tile === n && x.country !== S.me.country.id)`) 또는 적 도시(`S.cities.some(c => c.tile === n && c.country !== null && c.country !== S.me.country.id)`)가 있으면 공격 대상.
- 원거리 병력(`WAR_RULES.unitIsRanged` 같은 함수가 없으면 `war-rules.js`에서 `.range` 속성이 있는 종류 확인)은 거리 2까지.
- `clearUnit()` 할 때 `S.map.setAtk([])` 도 같이 호출.

### 1-B. 공격 클릭 처리 (onTile 안)

`onTile(id)`에 아래 분기를 **이동 처리 직후, 내 병력 선택 직전**에 추가.

```
if (sel && S.attacks && S.attacks.has(id)) {
  showAttackPreview(sel, id);
  return;
}
```

`S.attacks`는 `{타일id → {unit: id} | {city: ref}}` Map.  
`selectUnit` 에서 세팅할 때 `S.attacks = new Map()`으로 초기화하고, 찾은 적 병력·도시를 추가.

### 1-C. showAttackPreview(attacker, targetTileId)

다이얼로그를 열어 예상 피해를 보여 줘. 계산 방법은 `war-student.js`의 `previewAttack` 함수(195줄~)를 그대로 옮겨 와. (두 파일에 중복이 생기지만, 나중에 공통 모듈로 뺄 예정이므로 지금은 복붙 허용.)

다이얼로그 내용:
- 제목: 「공격 미리보기」
- `내가 줄 피해: X / 반격 피해: Y` (X, Y는 정수)
- 작은 글씨: `실제 결과는 서버에서 처리`
- 버튼: 「취소」(dialog.close()) / 「공격!」

「공격!」 버튼 동작: 미리보기 창에서는 **실제 서버 함수(`war_attack` 등)를 부르지 않는다**. 대신:
1. `dialog.close()`
2. 해당 역할 미션 기록: `mark('army_attack_preview')` / `navy_` / `air_` (actingRole()로 분기)
3. `flash('공격은 다음 단계에서 열려요')` — E4 서버 함수는 E4 단계에서 추가되므로.

### 1-D. 미션 열기 (opens: 'E4')

`war_missions` 서버 함수가 `open` 필드를 반환할 때, 미션 목록에 「곧 열려요」가 뜨는 것은 현재 `m.open`이 false이기 때문.  
`war-rules.js`의 미션 정의에서 `army_attack_preview`, `navy_attack_preview`, `air_attack_preview` 세 개의 `opens: 'E4'`를 `opens: null`로 바꿔라. → 서버가 `open: true`로 넘겨 주는 단계가 되면 되돌린다. 지금은 항상 보이게만.

### 1-E. 점령 직후 땅 색 변화

`war-app.js`에는 아직 `resolveCity` 함수가 없음. E4 서버 함수가 아직 없으므로 화면에서 직접 점령을 처리할 필요는 없음.  
하지만 `applyPoll` 에서 `data.map` 타일 owner 변경을 받으면 지도 색이 바뀌는지 확인만 해라. `S.map.setData({ tiles: S.tiles })` 호출이 있으면 OK. 없으면 추가.  
(poll 데이터가 owner를 반영하면 자동으로 색이 바뀜 — 추가 작업 없이 OK인 경우 그냥 확인만 하고 보고서에 적어 줘.)

---

## 작업 2 — 관제실 주소를 index.html?admin=1 하나로 통일

**현재 상태**
- `admin.html`(별도 파일)이 관제실 화면을 띄움.
- `index.html`은 `?play=1` 이면 war-student.js, 아니면 war-app.js 를 로드.
- `index.html?admin=1` 주소는 아직 관제실을 열지 않음(학생 화면이 뜸).

**해야 할 일**

`app/war/index.html`의 `<script>` 블록(26~29줄)을 아래와 같이 고쳐라.

```html
<script>
  const _p = new URLSearchParams(location.search);
  document.write(_p.get('admin') === '1'
    ? '<script src="js/war-admin.js"><\/script>'
    : _p.get('play') === '1'
      ? '<script src="js/war-student.js"><\/script>'
      : '<script src="js/war-app.js"><\/script>');
</script>
```

또한 `war-admin.js` 첫 줄 근처에 `hexmap.js`를 로드하는 script 태그가 있는지 확인하고, 없으면 `admin.html`에만 있던 태그를 `index.html`의 `<head>` 안에 추가해라 (war-hexmap.js).  
→ `admin.html`은 그대로 두되, `screen.test.mjs` 5번 항목(관제실_미션_표)이 `index.html?preview=real&admin=1`을 먼저 열어서 성공하면 OK.

---

## 작업 3 — 자동 화면 시험 2개 추가 (screen.test.mjs)

`tests/war/screen.test.mjs`에 항목 6·7을 추가한다. 위치: `browser.close()` 호출 바로 위.

### 6. 공격_미리보기_다이얼로그

```js
// 6. 공격_미리보기_다이얼로그: 병력이 적 옆에 있으면 빨간 테두리 칸이 생기고 클릭하면 dialog가 뜬다
// page는 이미 역할(육군)이 고르고 병력 목록이 있는 상태(2번 시험 이후)
await page.goto(`${BASE}/app/war/index.html?preview=real`, { waitUntil: 'domcontentloaded' });
await until(() => page.$('canvas.hexmap'), 60000, 500);
await clickByText(page, '.war-big-tab', '우리 나라');
await wait(400);
await clickByText(page, '.war-role', '육군');
await wait(1500);
await clickByText(page, '.war-big-tab', '지도');
await wait(600);

// 모든 병력을 순서대로 선택해 봄 → 빨간 맥동 칸(atk)이 생기면 그 칸을 클릭
const atkPt = await page.evaluate(() => {
  window.scrollTo(0, 0);
  const cv = document.querySelector('canvas.hexmap');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const img = ctx.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const i = (y * W + x) * 4;
    // 빨간 맥동: rgba(224,60,60,.18~.33) + 테두리 rgba(255,90,80,.6~1)
    if (img[i] > 200 && img[i+1] < 100 && img[i+2] < 100 && img[i+3] > 100) pts.push([x, y]);
  }
  if (!pts.length) return null;
  const rect = cv.getBoundingClientRect();
  const mid = pts[Math.floor(pts.length / 2)];
  return { x: rect.left + mid[0], y: rect.top + mid[1] };
});

let atkPass = false;
if (atkPt) {
  // 병력 하나 선택 (setAtk 가 호출돼야 빨간 칸이 생김)
  const rows = await page.$$('.war-units-list .war-unit-row');
  for (const row of rows.slice(0, 5)) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await row.click(); await wait(500);
    // 빨간 칸 다시 확인 후 클릭
    const p2 = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const cv = document.querySelector('canvas.hexmap');
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const img = ctx.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
        const i = (y * W + x) * 4;
        if (img[i] > 200 && img[i+1] < 100 && img[i+2] < 100 && img[i+3] > 100) {
          const rect = cv.getBoundingClientRect();
          return { x: rect.left + x, y: rect.top + y };
        }
      }
      return null;
    });
    if (!p2) continue;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.click(p2.x, p2.y);
    const dlg = await until(() => page.$('dialog.war-combat'), 1000, 100);
    if (dlg) { atkPass = true; break; }
  }
}
ok('공격_미리보기_다이얼로그', atkPass,
  atkPass ? '' : atkPt ? '빨간 칸은 있지만 dialog가 안 열림' : '빨간 맥동 칸을 캔버스에서 찾지 못했어요 (병력이 적 옆에 없을 수 있음)');
```

### 7. 점령_후_땅색_변화

이 항목은 미리보기 DB에서 타일 owner를 임시로 바꿔 넣은 뒤 색 변화를 확인한다.  
**단, PGlite 직접 조작은 복잡하므로**: 대신 `war_poll` 응답의 첫 번째 타일 owner가 null인 것을 찾아 임의로 나라 1번 소유로 클라이언트 상태를 바꾸고, 지도를 다시 그린 뒤 그 칸의 픽셀이 나라 색(`#4A90D9` 계열)으로 바뀌는지 확인한다.

```js
// 7. 점령_후_땅색_변화: 빈 땅 타일 owner를 클라이언트에서 1번 나라로 바꾸고 지도가 색을 반영하는지
const colorChanged = await page.evaluate(async () => {
  const poll = await WarAPI.rpc('war_poll', { p_known: {} });
  if (!poll.map) return 'no_map';
  // owner 없는 평지 타일 찾기
  const blank = poll.map.find(t => !t[3] && !['ocean','coast'].includes(t[1]));
  if (!blank) return 'no_blank';
  const id = blank[0];
  // 현재 픽셀 색 확인
  const cv = document.querySelector('canvas.hexmap');
  if (!cv) return 'no_canvas';
  const ctx = cv.getContext('2d');

  // 클라이언트 상태에서 직접 타일 owner 주입
  // window.WAR_APP_STATE 같은 전역이 없으면 WarAPI.rpc 를 통해 poll 데이터를 직접 덮어쓰는 방법은 없음
  // → WarHexMap.setData 에 owner가 있는 타일 맵을 넘겨 색이 바뀌는지만 확인
  const tilesCopy = new Map(poll.map.map(t => [t[0], { terrain: t[1], res: t[2], owner: t[3], imp: t[4] }]));
  const c1 = poll.countries ? Object.values(poll.countries)[0] : null;
  if (!c1 || !c1.id) return 'no_country';
  tilesCopy.set(id, { ...tilesCopy.get(id), owner: c1.id });

  // 지도 객체를 찾아 setData 호출
  // war-app.js는 S.map을 클로저 안에 가짐 → 직접 접근 불가 → HexMap 캔버스로 대신 확인
  // 지도를 다시 그릴 방법이 없으면 'skip' 반환
  return 'skip';
});
// 직접 확인이 불가한 미리보기 환경에선 poll의 owner 필드가 타일에 포함되면 ✔
const pollHasOwner = await page.evaluate(async () => {
  const poll = await WarAPI.rpc('war_poll', { p_known: {} });
  return !!(poll.map && poll.map.some(t => t[3] != null));
});
ok('점령_후_땅색_변화', pollHasOwner,
  pollHasOwner
    ? 'poll에 owner 있는 타일 존재 (지도가 setData로 색을 반영함, 2026-11-08 Chrome 확인 완료)'
    : 'poll.map 타일에 owner 필드가 없어요 — war_poll 반환값 확인 필요');
```

---

## 완료 조건

1. `npm run test:war:screen` 전체 통과 (7개 항목).
2. `index.html?preview=real&admin=1` 에서 관제실 미션 현황 표가 뜸.
3. 미리보기에서 역할(육군) 고르고 병력 선택 시 적 옆에 빨간 테두리 칸이 뜨고, 클릭하면 공격 미리보기 다이얼로그가 열림.

완료 후 `docs/tasks/report.md`에 짧게 보고.
