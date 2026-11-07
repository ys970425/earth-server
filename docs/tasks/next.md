# 작업지시서: E3 — 한 칸 한 유닛(G1) + 이동·지휘권 넘기기·화면·미리보기 체험(H1~H6)

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인, 다르면 멈추고 보고)
- 기준 문서: `docs/war-design.md` 2장(역할), 4-1(병과), 4-4(이동)
- **반드시 G1을 먼저 끝내고, G1 완료 조건을 모두 통과한 뒤에 H1로 넘어간다.** G1을 통과하지 못하면 H로 넘어가지 말고 보고서 맨 위에 「실패: G1 — 이유」를 쓰고 멈춘다.

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** Supabase 접속, `private/` 열기, `npm run war:preview:real` 실행 금지.
- 무역 표(`priv.*`)에 쓰지 않는다. 무역 앱 파일(`app/trade/` 아래 js·css·img·html, `supabase/trade*`, `tools/trade`, `tests/trade`)은 고치지 않는다.
- `war.act_start`, `war.bump`의 내용은 바꾸지 않는다 (부르는 것은 됨).

---

## G1. 한 칸 한 유닛을 DB 규칙으로 강제 (원래 GPT 몫 — 그대로 따라 할 것)

**왜:** `act_start`는 자기 나라만 잠근다. 다른 나라 병력 둘이 같은 빈 칸으로 동시에 들어오면 둘 다 통과할 수 있으므로, DB 유일 조건이 마지막 방어선이 된다.

### G1-1. 유일 조건 (`supabase/war/schema.sql` 맨 끝, 표를 다 만든 뒤에)
아래 SQL을 **그대로** 넣는다.
```sql
-- 한 칸에 군사 유닛 하나, 민간 유닛(노동자·정찰병) 하나 (설계 4-4). 동시에 들어오면 늦은 쪽이 막힘
create unique index if not exists war_units_one_military on war.units (tile_id)
  where tile_id is not null and kind not in ('worker', 'scout');
create unique index if not exists war_units_one_civil on war.units (tile_id)
  where tile_id is not null and kind in ('worker', 'scout');
```

### G1-2. 가져오기 순서 바꾸기 (`supabase/war/functions.sql`의 `war.admin_import`)
지금은 ① 모든 병력을 무역의 칸 그대로 넣고(`insert into war.units(id, country, kind, tile_id, hp) select id, country, kind, tile_id, 100 from priv.units;`) ② 그다음 `with ranked as (...) update war.units w set tile_id = null ...`로 겹친 것의 칸을 비운다. **①에서 이미 겹쳐 넣기 때문에 G1-1 조건에 걸려 가져오기가 실패한다.**

이 두 문장(①의 `insert`와 ②의 `with ranked ... update ... set tile_id = null ...;` 전체)을 **아래 한 문장으로 바꾼다.** 판정 규칙은 ②와 완전히 같고, 처음부터 「제자리에 둘 병력만 칸을 넣고 나머지는 null」로 넣는 것만 다르다.
```sql
  -- 원래 칸의 첫 유닛만 제자리에, 나머지(겹친 것·맞지 않는 지형·다른 나라 도시 칸)는 칸을 비워서 넣는다.
  -- (판정은 예전 「insert 뒤 update ... set tile_id = null」과 같음. 한 칸 한 유닛 유일 조건을 어기지 않게 하려고 순서만 바꿈)
  insert into war.units(id, country, kind, tile_id, hp)
  select s.id, s.country, s.kind,
    case when t.id is null then s.tile_id
         when x.n > 1 then null
         when coalesce((cfg->'UNITS'->s.kind->>'sea')::boolean, false)
           then case when t.terrain in ('ocean', 'coast') then s.tile_id else null end
         when t.terrain in ('ocean', 'coast', 'mountain') then null
         when exists (select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from s.country) then null
         else s.tile_id end,
    100
  from priv.units s
  join (select id, row_number() over (
          partition by tile_id, (kind in ('worker', 'scout')) order by id) as n
        from priv.units) x on x.id = s.id
  left join war.tiles t on t.id = s.tile_id;
```
- 주의: 이 문장이 실행되는 시점에 `war.cities`가 이미 채워져 있어야 한다 (지금도 도시를 먼저 넣고 병력을 넣는 순서인지 확인하고, 아니면 도시 `insert`를 이 문장보다 위로 옮긴다).
- 그 아래의 `for u in select w.*, s.tile_id as origin from war.units w join priv.units s ... where w.tile_id is null order by w.id loop ... update war.units set tile_id = destination where id = u.id; ...` 반복문은 **그대로 둔다** (null인 병력을 가장 가까운 빈 칸에 놓는 부분).
- 병과 지급(`insert into war.units(id, country, kind, tile_id, hp, commander) values (new_id, co.id, k, dest_tile, 100, br);`)은 이미 「군사 유닛이 없는 칸」을 골라 넣으므로 그대로 둔다.

### G1-3. 칸 옮기기 공통 함수 (`supabase/war/functions.sql`, `war.bump` 아래)
아래를 **그대로** 넣는다. 오류 문구도 그대로.
```sql
-- 병력의 칸을 바꾸는 유일한 길. 이후 이동·생산·점령 함수는 칸을 바꿀 때 반드시 이 함수를 쓴다.
-- 한 칸 한 유닛 유일 조건에 걸리면(동시에 같은 칸으로 들어온 늦은 쪽) 쉬운 말로 알려 준다.
create or replace function war.place_unit(p_unit int, p_tile int) returns void
language plpgsql as $$
begin
  update war.units set tile_id = p_tile where id = p_unit;
  if not found then
    perform priv.err('NO_UNIT', '없는 병력이에요.');
  end if;
exception when unique_violation then
  perform priv.err('TILE_TAKEN', '먼저 온 병력이 있어요. 다른 칸을 골라 주세요.');
end $$;
revoke all on function war.place_unit(int, int) from public;
```

### G1-4. 시험 `tests/war/place.test.mjs` (새) + `package.json` `"test:war:place": "node tests/war/place.test.mjs"`
W0 틀(`createDb`, `seedTradeState`) → `schema.sql` → `config.sql` → `functions.sql` 설치 → 교사로 `war_admin_import('초기화')`. 아래 항목이 **모두** ✔여야 한다.
1. 가져오기를 두 번 해도 오류가 없다.
2. 가져온 뒤 같은 칸에 군사 유닛 2개 이상인 칸 0곳, 민간 유닛 2개 이상인 칸 0곳.
3. `war.place_unit(병력, 빈 땅 칸)` 성공 → 그 병력의 칸이 바뀜.
4. 다른 나라 군사 유닛이 있는 칸으로 `war.place_unit` → 오류에 `TILE_TAKEN`과 「먼저 온 병력이 있어요」가 들어 있음, 병력 칸은 그대로.
5. 군사 유닛이 있는 칸으로 노동자를 `war.place_unit` → 성공 (군사 1 + 민간 1).
6. 노동자가 있는 칸으로 다른 노동자를 `war.place_unit` → `TILE_TAKEN`.
7. 없는 병력 번호 → `NO_UNIT`.
8. `insert into war.units`로 같은 칸에 군사 유닛을 하나 더 직접 넣으면 DB가 거절함.
- 파일 머리 주석: 「PGlite는 연결이 하나라 진짜 동시 실행은 시험할 수 없다. 설치 후 웨일북 2대로 확인한다.」
- `war.place_unit`은 public이 아니므로 시험에서는 `select war.place_unit(...)`을 직접 부른다.

### G1 완료 조건 (모두 통과해야 H로 넘어감)
```bash
git stash list                        # (참고용, stash 쓰지 말 것)
npm run war:preview && git diff --stat app/war/preview/state.json   # 바뀐 줄 0 — 가져오기 결과가 지금과 완전히 같음
node tests/war/place.test.mjs         # 전체 통과 (8항목)
node tests/war/import.test.mjs        # 전체 통과
node tests/war/import-v2.test.mjs     # 전체 통과
node tests/war/e2.test.mjs            # 전체 통과
node tests/war/act.test.mjs           # 전체 통과
node tests/war/real-preview.test.mjs  # 전체 통과
```
- **`state.json`이 한 줄이라도 바뀌면 G1 실패**다 (가져오기 결과가 달라졌다는 뜻). 보고하고 멈춘다.

---

## H1. 이동 `public.war_move(p_unit int, p_path int[])` (`functions.sql`)
`security definer`, `search_path = war, priv, public`.
1. 병력을 찾는다 (없으면 `NO_UNIT`). 그 병력의 `commander`로 `war.act_start(commander)`를 부른다 → 역할·결석 대행·일시정지 검사와 나라 잠금이 된다. 병력의 나라가 내 나라가 아니면 `NOT_MINE` 「우리 나라 병력이 아니에요」.
2. 병력 행을 `for update`로 잠근다.
3. 경로 검사 (`p_path`는 출발 칸을 뺀 칸 번호 목록):
   - 비어 있으면 `BAD_PATH`. 앞 칸과 다음 칸은 `priv.tdist(a, b) = 1`이어야 함.
   - 길이 ≤ 남은 이동력(`moves_left`). 넘으면 `NO_MOVES` 「이동력이 모자라요 (남은 이동력 ○)」.
   - **지나가는 칸(마지막 칸 포함):**
     - 땅 유닛: 바다·해안·산 금지
     - 배(`sea`): 바다·해안만 (출발 칸은 검사하지 않음 — 점령한 도시에서 나갈 수 있게)
     - 공군(`fly` 또는 병과 `air`): 지형 상관없음, **다른 나라 병력 위를 지나갈 수 있음**
     - 모든 병력: 다른 나라 도시 칸과 시장 칸(`war.markets`)에 들어갈 수 없음
     - 땅·바다 유닛: 다른 나라 병력(군사·민간)이 있는 칸을 지나갈 수 없음
   - **멈추는 칸(마지막 칸):** 공군은 바다·해안에 멈출 수 없음. 같은 종류(군사/민간) 병력이 있으면 안 됨 — 이 판정은 `war.place_unit`의 유일 조건이 최종 결정.
4. `war.place_unit(병력, 마지막 칸)`, `moves_left -= 경로 길이`, `war.bump('units')`. 결과로 병력 정보를 돌려준다.
- **노동자 이동력:** 무역 앱은 노동자 이동력이 0이다. 전쟁의 시간에서는 **노동자 이동력 2**로 한다 (`app/war/js/war-rules.js`에 넣고 `npm run war:config`로 `config.sql` 다시 만들기). 정찰병은 `SCOUT_MOVE`(5).
- **가져올 때 이동력 채우기:** `war.admin_import` 끝에서 모든 병력 `moves_left`를 그 병력의 이동력(무역 `UNITS.move`, 구축함·전투기는 전쟁 규칙, 노동자 2, 정찰병 5)으로 채운다. (턴마다 채우기는 E5)

## H2. 지휘권 넘기기 `public.war_transfer(p_unit int, p_to text)`
- 병력을 찾고 `war.act_start(병력의 commander)`. 내 나라 병력이 아니면 `NOT_MINE`.
- 노동자·정찰병은 넘길 수 없음 (`NOT_MILITARY` 「노동자와 정찰병은 넘길 수 없어요」).
- `p_to`는 `army`/`navy`/`air` 중 하나이고 지금 `commander`와 달라야 함. 병력 종류·이동력은 그대로, `commander`만 바뀜. `war.bump('units')`.

## H3. 시험 `tests/war/e3.test.mjs` (새) + `package.json` `"test:war:e3"`
- 육군 참모총장이 육군 병력을 빈 땅으로 이동 성공, `moves_left` 줄어듦
- 산·바다로 가는 경로 거절, 이동력보다 긴 경로 거절, 이어지지 않은 경로 거절
- 다른 나라 병력 칸을 지나가는 땅 유닛 경로 거절 / 같은 경로를 공군은 지나갈 수 있음 / 공군이 바다 칸에서 멈추면 거절
- 다른 나라 도시 칸, 시장 칸으로 들어가기 거절
- 다른 역할(해군 참모총장)이 육군 병력 이동 거절, 다른 나라 병력 이동 거절
- 결석 대행: 육군 참모총장이 없으면 합참의장이 육군 병력 이동 가능
- 공병사령관이 노동자를 2칸 이동 가능
- 지휘권 넘기기: 육군 → 해군으로 넘긴 뒤 육군 참모총장은 그 병력을 못 움직이고 해군 참모총장은 움직임 / 노동자 넘기기 거절
- 일시정지면 이동 거절
- 기존 시험 모두 통과

## H4. 화면 (`app/war/js/war-app.js`, `war.css`)
- **「내 병력」 탭** (참모총장, 대행 탭 포함): 내가 조종하는 병력 목록(이름·체력·남은 이동력). 누르면 지도에서 그 병력 선택 + **갈 수 있는 칸 표시**(H1과 같은 규칙, 이동력만큼).
- 지도에서 내 병력을 눌러도 선택됨. 표시된 칸을 누르면 `war_move` 호출 → 성공하면 바로 반영, 실패하면 오류 문구를 쉬운 말로 보여 줌 (`TILE_TAKEN`이면 「먼저 온 병력이 있어요…」).
- **「지휘권 넘기기」 탭:** 내 군사 병력 목록 → 받을 참모총장(육·해·공 중 나 말고) 버튼 → `war_transfer`.
- **공병사령관 「노동자」·「정찰병」 탭:** 노동자·정찰병 목록과 같은 방식의 이동.
- 갈 수 있는 칸 계산은 화면과 미리보기가 같은 코드를 쓰도록 `app/war/js/war-rules.js`에 `canPass`·`canStop` 같은 함수로 둔다.
- 버튼 48px 이상, 깜빡임 없음, 영어 노출 없음.

## H5. 미리보기 체험 (`app/war/js/war-api.js` 가짜 서버)
- `war_move`, `war_transfer`를 H1·H2와 **같은 규칙**으로 브라우저 메모리에서 흉내 낸다 (같은 칸 군사 2개 금지 포함). 다음 poll에서 바뀐 병력이 보이게 한다.
- `?preview=real&as=1:army`에서 육군 병력을 눌러 이동, `as=1:engineer`에서 노동자 이동, `as=1:air`에서 공군이 다른 나라 병력 위를 지나 이동해 볼 수 있어야 한다.
- 새로고침하면 처음 상태로 돌아간다 (저장하지 않음).

## H6. 문서
- `docs/war-design.md` 4-4장:
  - 「공군은 지형과 상관없이 날아가고, **다른 나라 병력 위를 지나갈 수 있지만** 바다 위와 다른 나라 병력이 있는 칸에 멈출 수 없습니다」로 고친다.
  - 「다른 나라 병력이 있는 칸은 지나갈 수 없습니다」 문장은 「땅·바다 유닛은」으로 시작하게 고친다.
  - 「노동자 이동력 2(무역 앱은 0), 정찰병 5」 한 줄 추가. 「시장 칸에는 들어갈 수 없음」 한 줄 추가.
- 13장 기록 표에 「공군 통과 A」, 「한 칸 한 유닛을 DB 규칙으로 강제」, 「노동자 이동력 2」 행 추가 (기존 행 그대로).
- `docs/tasks/status.md` 「설치 후 확인」에 추가: 「웨일북 2대에서 **다른 나라 병력 두 개를 같은 빈칸으로 동시에** 이동 → 한쪽만 성공하고 다른 쪽은 「먼저 온 병력이 있어요」」

## 고쳐도 되는 파일 (이것만)
`supabase/war/schema.sql`, `supabase/war/functions.sql`, `supabase/war/config.sql`(다시 만들기), `app/war/js/war-rules.js`, `tests/war/place.test.mjs`(새), `tests/war/e3.test.mjs`(새), `tests/war/rules.test.mjs`(노동자 이동력 검사를 더할 때만), `package.json`(scripts), `app/war/js/war-app.js`, `app/war/js/war-api.js`, `app/war/css/war.css`, `app/war/preview/state.json`(다시 만들기 — G1 단계에서는 바뀌면 안 되고, H1의 이동력 채우기 뒤에는 바뀌어도 됨), `docs/war-design.md`, `docs/tasks/status.md`, `docs/tasks/report.md`

## 전체 완료 조건 (직접 실행)
```bash
node tests/war/place.test.mjs node tests/war/e3.test.mjs  # 각각 실행, 전체 통과
node tests/war/e2.test.mjs; node tests/war/act.test.mjs; node tests/war/import-v2.test.mjs
node tests/war/import.test.mjs; node tests/war/rules.test.mjs; node tests/war/db.test.mjs
node tests/war/real-preview.test.mjs; node tests/trade/db.test.mjs   # 모두 전체 통과
npm run war:config && npm run war:config      # config.sql 두 번 같음
npm run war:preview && npm run war:preview    # state.json 두 번 같음
git status --short                            # 위 목록 밖 변경 없음
```
화면 (Live Server, 못 하면 「미확인」 — Claude가 Chrome으로 다시 확인함): H5의 세 주소에서 이동, 콘솔 빨간 오류 없음.

## 보고 (`docs/tasks/report.md`에 덮어쓰기)
- 맨 위: G1 완료 조건 결과 (특히 「G1 직후 `state.json` 바뀐 줄 0」 확인 결과)
- G1, H1~H6 각각 3줄 이내, 시험 마지막 줄들, 못 한 것은 맨 위 「실패: 이유」, 마지막 줄 「커밋·푸시하지 않았습니다」
