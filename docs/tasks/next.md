# 헬피코드 지시서 — 화면 개편 + 예산 요청 시스템

## 헬피 명령 규칙 (반드시 지킴)
1. 시험은 `npm run ...` 한 줄 명령만. `$env:Path` 수정·`cmd /c`·파이프/리디렉션·`node -e` 금지.
2. 시험은 관련 수정을 모두 끝낸 뒤 한 번에 돌린다. 중간에 돌리지 않는다.
3. npm을 못 찾으면 재시도하지 말고 `docs/tasks/report.md`에 적고 코드 작성을 계속한다.
4. git 명령(commit, push, add 등) 금지.
5. `2>&1`, `|` 파이프 금지.

---

## 작업 목표
- 무역 앱처럼 위쪽 가로 버튼 탭으로 화면 전환 (파트 1)
- 예산 요청·승인·회수·반납·기록 시스템 (파트 2)

기준 문서: `docs/war-design.md` 2-3장·8-1장.

---

## 파트 1 — 위쪽 버튼 화면 개편

### 현재 구조 (바꾸기 전)
`app/war/js/war-app.js`에 `.war-big-tab` 클래스로 「지도」/「우리 나라」 두 큰 탭이 있고,
지도 탭 안 왼쪽에 역할별 세로 작은 탭 패널이 있음.

### 목표 구조
위쪽 가로 버튼 한 줄(클래스 `.war-nav-btn`)로 화면 전체 전환.
버튼 목록: **지도 / 예산 / 요청 / 외교 / 무역 / 시장 / 미션**
역할 대신하기는 nav 오른쪽 구석 `<select>` 작은 선택칸(클래스 `.war-deputy-select`).

### 1-1. `app/war/js/war-app.js` 수정 내용

**상태(S) 변경:**
- `S.view` 가능한 값을 `'map' | 'budget' | 'request' | 'diplomacy' | 'trade' | 'market' | 'mission'`으로 확장

**역할 없을 때 화면:**
- 역할이 없으면 지도 위에 반투명 오버레이(클래스 `war-role-overlay`)로 역할 선택 패널 표시
- 오버레이 안에 역할 선택 버튼들(클래스 `.war-role`, 기존 그대로)
- 역할 선택 후 오버레이 사라지고 nav 버튼 나타남

**위쪽 nav (`war-nav`):**
```js
const NAV = [
  { key: 'map',       label: '지도',  roles: null },        // null = 모든 역할
  { key: 'budget',    label: '예산',  roles: null },
  { key: 'request',   label: '요청',  roles: ['army','navy','air','eng'] },
  { key: 'diplomacy', label: '외교',  roles: ['chief'] },
  { key: 'trade',     label: '무역',  roles: ['chief'] },
  { key: 'market',    label: '시장',  roles: ['chief'] },
  { key: 'mission',   label: '미션',  roles: null },
];
```
- 역할에 맞는 버튼만 표시. roles=null이면 항상 표시.
- 활성 버튼: `.war-nav-btn.on`

**역할 대신하기 선택칸 (`war-deputy-select`):**
- nav 오른쪽 구석 `<select>`
- 옵션: 「본인 역할」(기본) + 대신할 수 있는 역할 목록
- 기존 `S.tab.startsWith('deputy:')` 로직을 대신하기 `<select>` 값으로 대체
- 선택하면 현재 화면에서 그 역할의 콘텐츠를 보여 줌 (지도 탭이면 그 역할 unit 목록 등)

**지도 탭 (map):**
- 현재 지도+조작 창(내부 작은 탭) 그대로 유지. 변경 없음.

**예산 탭 (budget):**
- chief: 기존 `menu:예산` 패널(국고 현황·나눠주기·회수 UI) 그대로 이동
- 참모총장·공병: 내 지갑 현황 테이블만 (반납 버튼은 파트 2에서 추가)

**요청 탭 (request):**
- 참모총장·공병만 볼 수 있음 (다른 역할이 접근하면 nav에 버튼이 없으므로 직접 접근 불가)
- 파트 1에서는 「요청 기능은 곧 열려요」 안내 문구 placeholder

**외교 탭 (diplomacy):** 기존 `menu:외교` 패널 내용 그대로 이동

**무역 탭 (trade):** 기존 `menu:무역` 패널 내용 그대로 이동

**시장 탭 (market):** 기존 `menu:시장` 패널 내용 그대로 이동

**미션 탭 (mission):**
- 기존 「우리 나라」 탭의 미션 목록 + 나라 정보 + 역할 현황 + 첩보 정보 내용 그대로 이동

### 1-2. `app/war/css/war.css` 수정

`.war-big-tabs`·`.war-big-tab`을 `.war-nav`·`.war-nav-btn`으로 교체:
- `.war-nav`: `display: flex; gap: 6px; padding: 6px 8px 0; align-items: center;`
- `.war-nav-btn`: `min-height: 48px; font-size: 18px; font-family: var(--font-ui);`
- `.war-nav-btn.on`: `border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold);`
- `.war-nav-spacer`: `flex: 1;` (버튼과 선택칸 사이 공간)
- `.war-deputy-select`: `font-size: 14px; padding: 4px 8px; max-width: 140px;`
- `.war-role-overlay`: `position: absolute; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 10;`

### 1-3. `tests/war/screen.test.mjs` 수정

`.war-big-tab`·「우리 나라」를 새 클래스·버튼으로 수정:
- `clickByText(page, '.war-big-tab', '우리 나라')` → `clickByText(page, '.war-nav-btn', '미션')`
- `clickByText(page, '.war-big-tab', '지도')` → `clickByText(page, '.war-nav-btn', '지도')`
- `!!document.querySelector('.war-big-tab')` → `!!document.querySelector('.war-nav-btn')`
- 역할 선택(`.war-role` 클릭)은 오버레이 안에 그대로 있으므로 수정 불필요

### 1-4. 파트 1 완료 시험

```
npm run test:all
```
결과를 `docs/tasks/report.md`에 기록.

---

## 파트 2 — 예산 요청·승인·회수·반납·기록

### 2-1. `supabase/war/schema.sql` 테이블 추가

기존 `war.wallets` 테이블 아래에 추가:

```sql
create table if not exists war.budget_requests (
  id bigserial primary key,
  country int not null references war.countries(id) on delete cascade,
  role text not null,
  item text not null,
  qty int not null check (qty > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  turn int not null default 0,
  approved_qty int,
  created_at timestamptz default now()
);

create table if not exists war.budget_log (
  id bigserial primary key,
  country int not null,
  role text not null,
  item text not null,
  requested_qty int,
  given_qty int not null,
  adjusted bool not null default false,
  kind text not null check (kind in ('give','take','return','request_approved','request_rejected')),
  turn int not null default 0,
  created_at timestamptz default now()
);
```

RLS: `war.budget_requests`·`war.budget_log` — 같은 나라 역할이 SELECT, 함수에서만 INSERT/UPDATE.

### 2-2. `supabase/war/functions.sql` 함수 추가

#### `war_budget_request(p_item text, p_qty int) returns jsonb`
- 호출 가능: army, navy, air, eng (chief 불가 — `priv.err('NOT_ALLOWED','...')`)
- 같은 나라 같은 역할 pending 요청 이미 있으면 `priv.err('ALREADY_PENDING','...')`
- `war.budget_requests`에 (country=내 나라, role=내 역할, item=p_item, qty=p_qty, turn=현재 턴) insert
- 반환: `jsonb_build_object('ok',true,'id',새 id)`

#### `war_budget_request_update(p_id bigint, p_item text, p_qty int) returns jsonb`
- 그 요청을 낸 역할 본인만
- status≠'pending'이면 `priv.err('NOT_PENDING','...')`
- item, qty 업데이트
- 반환: `jsonb_build_object('ok',true)`

#### `war_budget_request_cancel(p_id bigint) returns jsonb`
- 그 요청을 낸 역할 본인만
- status≠'pending'이면 `priv.err('NOT_PENDING','...')`
- status='cancelled'로 업데이트
- 반환: `jsonb_build_object('ok',true)`

#### `war_budget_approve(p_id bigint, p_approved_qty int default null) returns jsonb`
- chief만 (priv.role() ≠ 'chief'이면 `priv.err('NOT_ALLOWED','...')`)
- 같은 나라 요청인지 확인 (`NOT_FOUND` 없으면)
- status≠'pending'이면 `priv.err('NOT_PENDING','...')`
- 지급량: `coalesce(p_approved_qty, 요청qty)`
- 의장 국고(`war.wallets where country=내 나라 and role='chief'`) 부족하면 `priv.err('NOT_ENOUGH','...')`
- 국고 차감, 해당 역할 지갑 증가
- status='approved', approved_qty=p_approved_qty 업데이트
- `war.budget_log` insert (kind='request_approved', adjusted=(p_approved_qty is not null and p_approved_qty!=요청qty))
- 반환: `jsonb_build_object('ok',true,'given_qty',지급량)`

#### `war_budget_reject(p_id bigint) returns jsonb`
- chief만
- 같은 나라 요청인지 확인
- status≠'pending'이면 `priv.err('NOT_PENDING','...')`
- status='rejected' 업데이트
- `war.budget_log` insert (kind='request_rejected', given_qty=0)
- 반환: `jsonb_build_object('ok',true)`

#### `war_budget_return(p_item text, p_qty int) returns jsonb`
- army, navy, air, eng만 (chief 불가)
- 역할 지갑에서 p_qty 차감 (부족하면 `priv.err('NOT_ENOUGH','...')`)
- 의장 국고에 p_qty 추가
- `war.budget_log` insert (kind='return', given_qty=p_qty)
- 반환: `jsonb_build_object('ok',true)`

#### 기존 `war_budget_give`·`war_budget_take` 수정
함수 끝에 `war.budget_log` insert 추가:
- war_budget_give: kind='give', given_qty=p_qty
- war_budget_take: kind='take', given_qty=p_qty

#### `war_admin_budget_log(p_country int default null) returns jsonb`
- admin_key 확인
- `select * from war.budget_log where (p_country is null or country=p_country) order by id`
- 반환: jsonb 배열

#### 권한 grant
함수 선언 아래 grant/revoke 블록:
- `war_budget_request`, `war_budget_request_update`, `war_budget_request_cancel`, `war_budget_return`: army, navy, air, eng
- `war_budget_approve`, `war_budget_reject`: chief
- `war_admin_budget_log`: admin

### 2-3. `app/war/js/war-app.js` UI 추가

**요청 탭 (`request`) — 참모총장·공병:**
1. 내 pending 요청 카드 (있으면): 종류·수량·수정 입력란·「수정」버튼·「취소」버튼
2. 없으면 새 요청 폼:
   - 자원 드롭다운: `war-rules.js`의 아이템 목록 (코인+자원 종류)
   - 수량 `<input type="number" min="1">`
   - 유닛 미니 목록: 유닛 클릭 → 그 유닛 생산 비용으로 자원·수량 자동 채우기
   - 「요청」버튼 → `war_budget_request(item, qty)` 호출

**예산 탭 (`budget`) — chief:**
- 받은 요청 목록 테이블 (역할·자원·수량·상태)
  - pending 행: 조정 수량 `<input>` + 「승인」버튼(`war_budget_approve(id, 조정qty)`) + 「거절」버튼(`war_budget_reject(id)`)
- 직접 지급 UI 그대로 유지
- 회수 UI 그대로 유지

**예산 탭 (`budget`) — 참모총장·공병:**
- 내 지갑 현황 테이블
- 반납 폼: 자원 드롭다운 + 수량 + 「반납」버튼(`war_budget_return(item, qty)`)

**교사 화면 (`app/war/admin.html` 또는 관련 JS):**
- 기존 탭 목록에 「분배 기록」탭 추가
- `war_admin_budget_log()` 호출 → 역할·자원·요청량·지급량·조정여부·종류·턴 테이블

### 2-4. `tests/war/budget.test.mjs` 새 파일 작성

`tests/war/e9.test.mjs` 헤더 구조 참고. PGlite 시험 최소 15개:

| 번호 | 시험 이름 | 확인 내용 |
|---|---|---|
| 1 | army 요청 성공 | pending 1건 생성, id 반환 |
| 2 | 대기 1건 제한 | 두 번째 요청 → ALREADY_PENDING |
| 3 | chief가 요청 불가 | war_budget_request 호출 → NOT_ALLOWED |
| 4 | pending 요청 수정 | item·qty 변경 후 DB 반영 |
| 5 | pending 요청 취소 | status=cancelled, 새 요청 가능 |
| 6 | chief가 그대로 승인 | 국고 감소, 지갑 증가, budget_log kind=request_approved, adjusted=false |
| 7 | chief가 조정 후 승인 | approved_qty<요청qty, adjusted=true |
| 8 | chief가 거절 | status=rejected, budget_log kind=request_rejected, given_qty=0 |
| 9 | 국고 부족 시 승인 오류 | NOT_ENOUGH |
| 10 | army가 반납 | 지갑 감소, 국고 증가, budget_log kind=return |
| 11 | 반납 시 지갑 부족 | NOT_ENOUGH |
| 12 | war_budget_give → 기록 | budget_log kind=give 행 생성 |
| 13 | war_budget_take → 기록 | budget_log kind=take 행 생성 |
| 14 | 교사 기록 조회 | war_admin_budget_log 반환 행 수 맞음 |
| 15 | 역할 없는 학생 요청 불가 | 오류 발생 |

### 2-5. `package.json` 수정

`scripts`에 추가:
```json
"test:war:budget": "node tests/war/budget.test.mjs"
```

`test:all` 스크립트 끝에 `&& node tests/war/budget.test.mjs` 추가.

### 2-6. 파트 2 완료 시험

```
npm run test:all
```
결과를 `docs/tasks/report.md`에 기록.
