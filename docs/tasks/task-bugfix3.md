# 작업 지시서: 버그 수정 3가지

커밋·푸시 금지. 시험 모두 통과한 뒤 보고만.
earth-war 배포는 하지 않는다 (Claude가 따로 한다).

**고치는 파일**:
- `app/war/js/war-student.js`
- `app/war/css/war.css`
- `tools/war/make-preview.mjs`
- `tests/war/screen.test.mjs`
- `package.json`

---

## 1. 전투기 이름 버그 (`app/war/js/war-student.js`)

### 1-1. 파일 맨 위 `R.UNITS.destroyer` 줄 바로 아래에 전투기 추가

현재 4번째 줄:
```js
  if (!R.UNITS.destroyer) R.UNITS.destroyer = { name: '구축함', era: 4, str: 60, move: 6, sea: true, img: 'destroyer', cost: { coin: 100, steel: 2, fuel: 1, food: 2 } };
```
그 줄 바로 다음에 한 줄 추가:
```js
  if (!R.UNITS.fighter) R.UNITS.fighter = { name: '전투기', str: 40, move: 6, range: 2, fly: true, img: 'fighter', cost: { coin: 70, aluminum: 1, fuel: 1 } };
```

### 1-2. 130~131번째 줄 근처 `unitName` 함수 수정

현재:
```js
  const unitName = k => (R.UNITS[k] || {}).name || UNIT_NAMES[k] || '병력';
```
바꿀 내용:
```js
  const unitName = k => (R.UNITS[k] || {}).name || UNIT_NAMES[k] || (window.WAR_RULES?.EXTRA_UNITS?.[k] || {}).name || '병력';
```

### 1-3. 143번째 줄 근처 `fullMove` 함수 수정

현재:
```js
  const fullMove = u => u.kind === 'worker' ? 0 : u.kind === 'scout' ? R.SCOUT_MOVE : (rule(u).move || 0);
```
바꿀 내용 (`R.UNITS`에 없는 종류는 WAR_RULES.EXTRA_UNITS에서도 찾음):
```js
  const fullMove = u => u.kind === 'worker' ? 0 : u.kind === 'scout' ? R.SCOUT_MOVE : (rule(u).move || (window.WAR_RULES?.EXTRA_UNITS?.[u.kind] || {}).move || 0);
```

---

## 2. 글씨 굵기 버그 (`app/war/css/war.css`)

`.war-big-tab`이 `var(--font-display)` (Black Han Sans, 매우 굵음)를 쓰고 있어서 탭 글씨가 너무 굵어요.
무역 앱처럼 굵기를 400으로 맞춰요.

현재:
```css
.war-big-tab { min-height: 56px; min-width: 150px; font-size: 21px; font-family: var(--font-display); }
```
바꿀 내용 (font-family를 var(--font-ui)로, font-weight: 400 추가):
```css
.war-big-tab { min-height: 56px; min-width: 150px; font-size: 21px; font-family: var(--font-ui); font-weight: 400; }
```

또한 `.war-top-name`도 같은 font-display를 쓰므로:
현재 (48번째 줄 근처):
```css
.war-top-name { font-family: var(--font-display); font-size: 20px; }
```
바꿀 내용:
```css
.war-top-name { font-family: var(--font-ui); font-size: 20px; font-weight: 400; }
```

---

## 3. 가짜 데이터 개선 (`tools/war/make-preview.mjs`)

`war_admin_import`는 나라마다 창병·삼단노선·전투기 1개씩만 줘요.
구축함·추가 병력을 직접 SQL로 삽입해서 더 풍성하게 만들어요.

`await rpc(seed.ADMIN, 'war_admin_import', '초기화');` 바로 아래에 추가:

```js
// 추가 병력: 나라마다 구축함 1척, 창병 2개, 기갑 1개 추가
// war.units 표 직접 삽입 (tile_id: 빈 바다·땅 칸 중 각 나라 수도에서 가장 가까운 칸)
for (let c = 1; c <= 6; c++) {
  const cap = (await db.query(`select t.id from war.cities ci join war.tiles t on t.id = ci.tile_id where ci.country = ${c} and ci.kind = 'capital' limit 1`)).rows[0];
  if (!cap) continue;
  const capId = cap.id;

  // 구축함: 빈 바다 칸
  const seaTile = (await db.query(`
    select t.id from war.tiles t
    where t.terrain in ('ocean','coast')
      and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind not in ('worker','scout'))
    order by priv.tdist(t.id, ${capId}), t.id limit 1`)).rows[0];
  if (seaTile) {
    const nextId = (await db.query(`select coalesce(max(id),0)+1 as nid from war.units`)).rows[0].nid;
    await db.query(`insert into war.units(id,country,kind,tile_id,hp,commander) values (${nextId},${c},'destroyer',${seaTile.id},100,'navy')`);
  }

  // 추가 창병 2개, 기갑 1개: 빈 땅 칸
  for (const kind of ['spear', 'spear', 'tank']) {
    const landTile = (await db.query(`
      select t.id from war.tiles t
      where t.terrain not in ('ocean','coast','mountain')
        and not exists (select 1 from war.cities ci where ci.tile_id = t.id and ci.country is distinct from ${c})
        and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind not in ('worker','scout'))
      order by priv.tdist(t.id, ${capId}), case when t.owner = ${c} then 0 else 1 end, t.id limit 1`)).rows[0];
    if (landTile) {
      const nextId = (await db.query(`select coalesce(max(id),0)+1 as nid from war.units`)).rows[0].nid;
      await db.query(`insert into war.units(id,country,kind,tile_id,hp,commander) values (${nextId},${c},'${kind}',${landTile.id},100,'army')`);
    }
  }
}
```

---

## 4. 화면 자동 시험 추가 (`tests/war/screen.test.mjs`)

기존 시험 맨 끝에 두 가지 시험 추가 (기존 패턴 그대로):

```
시험 N: 전투기 이름이 「전투기」로 나온다
  - ?play=1&preview=1 주소, ?as=1:air (공군 참모총장)로 접속
  - 화면에 전투기 유닛이 있으면 unitName이 「전투기」인지 확인
  - window.WarAPI.state().units 에서 kind='fighter'인 유닛의 화면 이름이 「병력」이 아닌 「전투기」

시험 N+1: 공군 참모총장이 전투기를 고를 수 있다
  - ?play=1&preview=1&as=1:air 주소
  - 화면의 「내 병력」 목록에서 전투기 유닛이 보이는지 확인 (fighter kind가 목록에 있어야 함)
  - window.WAR_RULES.isMyUnit(unit, 1, 'air')가 true인 전투기가 하나 이상 있어야 함
```

**주의**: screen.test.mjs는 Playwright(puppeteer) 형식. 기존 시험 패턴(page.goto, page.evaluate 등)을 그대로 따를 것. 가짜 미리보기(`?preview=1`)는 `app/war/preview/state.json`을 읽으므로, 위 3번 작업 후 `npm run war:preview`를 실행해 DB를 갱신한 뒤 시험을 작성할 것.

---

## 5. `package.json` scripts 추가 (없으면)

`"test:war:screen"` 스크립트가 이미 있으면 건드리지 않는다.
`"test:war:e5"` 스크립트가 없으면 추가: `"node tests/war/e5.test.mjs"`

---

## 순서

1. war-student.js 수정 (버그 1)
2. war.css 수정 (버그 2)
3. make-preview.mjs 수정 (버그 3) → `npm run war:preview` 실행하여 state.json 갱신
4. screen.test.mjs에 시험 추가
5. `npm run test:war:screen` 실행하여 전체 통과 확인
6. 보고

