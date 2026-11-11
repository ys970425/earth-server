# 작업 지시서: E8 나머지 — 동맹·나라 간 무역·미션

커밋·푸시 금지. 시험을 모두 통과한 뒤 `docs/tasks/report.md`에 보고만.

**수정 대상 파일:**
1. `supabase/war/functions.sql` — `war_propose` 수정, `war_accept_offer` 수정, `attack_core` 수정, `war_trade` 추가
2. `app/war/js/war-student.js` — 외교 탭 동맹 UI + 무역 탭 추가
3. `tests/war/e8.test.mjs` — 동맹·무역 시험 추가

---

## 1. `supabase/war/functions.sql`

### 1-1. `war_propose` 수정 — 'ally' 종류 추가

현재 `war_propose`는 `p_kind not in ('peace')`일 때 오류를 냅니다.  
아래 두 곳을 수정합니다.

**① 종류 검사 (line 977 근처)**
```sql
-- 기존:
if p_kind is null or p_kind not in ('peace') then ...
-- 변경:
if p_kind is null or p_kind not in ('peace','ally') then ...
```

**② 동맹 제안 조건 추가** — `p_kind = 'peace'` 조건 블록 바로 다음에 추가:
```sql
  -- 동맹 제안: 전쟁 중이면 안 됨, 이미 동맹이면 안 됨
  if p_kind = 'ally' and exists (
    select 1 from war.diplomacy
    where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b
      and status in ('war','ally')) then
    if exists (select 1 from war.diplomacy
      where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and status = 'war') then
      perform priv.err('AT_WAR', '전쟁 중인 나라에는 동맹을 제안할 수 없어요');
    else
      perform priv.err('ALREADY_ALLY', '이미 동맹이에요');
    end if;
  end if;
```

### 1-2. `war_accept_offer` 수정 — 'ally' 처리 추가

현재 `if o.kind = 'peace' then ... end if;` 블록 바로 다음에 아래 블록을 추가합니다 (`update war.offers set status = 'accepted'` 줄 **앞**에):

```sql
  if o.kind = 'ally' then
    if exists (select 1 from war.diplomacy
      where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and status = 'war') then
      perform priv.err('AT_WAR', '전쟁 중엔 동맹을 맺을 수 없어요'); end if;
    update war.diplomacy set status = 'ally', changed_turn = turn_
      where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b;
    update war.offers set status = 'cancelled'
      where kind = 'ally' and status = 'pending'
        and ((from_c = me and to_c = o.from_c) or (from_c = o.from_c and to_c = me));
  end if;
```

그리고 함수 마지막 `return` 줄을 아래로 교체합니다 (기존은 항상 'peace'·no_war_until을 반환):
```sql
  update war.offers set status = 'accepted' where id = p_offer;
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'status', case when o.kind='peace' then 'peace' else 'ally' end,
    'no_war_until', case when o.kind='peace' then turn_ + 3 else null end);
```
(기존의 `update war.offers …` + `perform war.bump('diplomacy')` + `return …` 세 줄을 위 세 줄로 대체)

### 1-3. `attack_core` 수정 — 동맹 나라 공격 불가 오류 메시지

현재 `line 879` 근처:
```sql
  if not exists(select 1 from war.diplomacy where a=least(mine,other) and b=greatest(mine,other) and status='war') then
    perform priv.err('NOT_AT_WAR','전쟁 중인 나라만 공격할 수 있어요'); end if;
```

이 블록을 아래로 교체합니다:
```sql
  if exists(select 1 from war.diplomacy where a=least(mine,other) and b=greatest(mine,other) and status='ally') then
    perform priv.err('ALLY','동맹 나라를 공격할 수 없어요'); end if;
  if not exists(select 1 from war.diplomacy where a=least(mine,other) and b=greatest(mine,other) and status='war') then
    perform priv.err('NOT_AT_WAR','전쟁 중인 나라만 공격할 수 있어요'); end if;
```

### 1-4. `war_trade` 함수 추가 — 나라 간 무역 (합동참모의장만, 전쟁 중 불가)

`functions.sql` 끝에 추가합니다.

**war_trade_propose** — 무역 제안 (내가 줄 것 / 받을 것 지정):
```sql
create or replace function public.war_trade_propose(
  p_other int, p_give jsonb, p_want jsonb) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; pair_a int; pair_b int; oid bigint;
  item text; qty int;
begin
  perform war.act_start('chief', false, p_other);
  select country_id into me from priv.students where uid = auth.uid();
  select turn into turn_ from war.game where id = 1;
  if me = p_other then perform priv.err('BAD_TARGET', '자기 나라에 무역을 제안할 수 없어요'); end if;
  if not exists (select 1 from war.countries where id = p_other) then
    perform priv.err('NO_COUNTRY', '없는 나라예요'); end if;
  pair_a := least(me, p_other); pair_b := greatest(me, p_other);
  -- 전쟁 중이면 무역 불가
  if exists (select 1 from war.diplomacy
    where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and status = 'war') then
    perform priv.err('AT_WAR', '전쟁 중인 나라와는 무역할 수 없어요'); end if;
  -- give 항목이 내 창고에 있는지 확인
  for item, qty in select key, (value::text)::int from jsonb_each_text(p_give) loop
    if coalesce((select amount from war.wallets where country=me and role='chief' and item=item),0) < qty then
      perform priv.err('NO_ITEM', item||'이 부족해요'); end if;
  end loop;
  -- 기존 pending 무역 제안 취소
  update war.offers set status = 'cancelled'
    where kind = 'trade' and status = 'pending'
      and ((from_c = me and to_c = p_other) or (from_c = p_other and to_c = me));
  insert into war.offers(kind, from_c, to_c, data, turn)
    values ('trade', me, p_other, jsonb_build_object('give', p_give, 'want', p_want), turn_)
    returning id into oid;
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'offer_id', oid);
end $$;
revoke all on function public.war_trade_propose(int, jsonb, jsonb) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_trade_propose(int, jsonb, jsonb) to %I', r);
  end if; end loop; end $$;
```

**war_trade_accept** — 무역 수락 (창고 이전):
```sql
create or replace function public.war_trade_accept(p_offer bigint) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; o war.offers; pair_a int; pair_b int;
  item text; qty int;
begin
  select * into o from war.offers where id = p_offer;
  perform war.act_start('chief', false, o.from_c);
  select country_id into me from priv.students where uid = auth.uid();
  select * into o from war.offers where id = p_offer for update;
  if not found or o.kind <> 'trade' then perform priv.err('NO_OFFER', '없는 무역 제안이에요'); end if;
  if o.to_c <> me then perform priv.err('NOT_FOR_ME', '이 제안은 우리 나라에 온 게 아니에요'); end if;
  if o.status <> 'pending' then perform priv.err('OFFER_DONE', '이미 처리된 제안이에요'); end if;
  select turn into turn_ from war.game where id = 1;
  pair_a := least(me, o.from_c); pair_b := greatest(me, o.from_c);
  if exists (select 1 from war.diplomacy
    where war.diplomacy.a = pair_a and war.diplomacy.b = pair_b and status = 'war') then
    perform priv.err('AT_WAR', '전쟁 중엔 무역할 수 없어요'); end if;
  -- 수락자(me)가 want 항목을 갖고 있는지 확인 (제안자의 want = 수락자가 줄 것)
  for item, qty in select key, (value::text)::int from jsonb_each_text(o.data->'want') loop
    if coalesce((select amount from war.wallets where country=me and role='chief' and item=item),0) < qty then
      perform priv.err('NO_ITEM', item||'이 부족해요'); end if;
  end loop;
  -- give: 제안자 → 수락자
  for item, qty in select key, (value::text)::int from jsonb_each_text(o.data->'give') loop
    update war.wallets set amount = amount - qty where country = o.from_c and role = 'chief' and item = item;
    insert into war.wallets(country, role, item, amount) values (me, 'chief', item, qty)
      on conflict (country, role, item) do update set amount = war.wallets.amount + qty;
  end loop;
  -- want: 수락자 → 제안자
  for item, qty in select key, (value::text)::int from jsonb_each_text(o.data->'want') loop
    update war.wallets set amount = amount - qty where country = me and role = 'chief' and item = item;
    insert into war.wallets(country, role, item, amount) values (o.from_c, 'chief', item, qty)
      on conflict (country, role, item) do update set amount = war.wallets.amount + qty;
  end loop;
  update war.offers set status = 'accepted' where id = p_offer;
  perform war.bump('diplomacy');
  perform war.bump('country', me); perform war.bump('country', o.from_c);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.war_trade_accept(bigint) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_trade_accept(bigint) to %I', r);
  end if; end loop; end $$;
```

---

## 2. `app/war/js/war-student.js` — 외교 탭 동맹 UI + 무역 탭

### 2-1. 외교 탭에 동맹 UI 추가

현재 외교 탭에는 선전포고·평화 제안·평화 수락이 있습니다.  
각 나라 행에 아래를 추가합니다:

- 동맹 제안 버튼: `status === 'peace'` 또는 `status === null`(초기 평화)이고 동맹이 아닐 때 표시. 누르면 `WarAPI.rpc('war_propose', {p_other: countryId, p_kind: 'ally'})`.
- 동맹 상태 표시: `status === 'ally'`일 때 「🤝 동맹」(파란색).
- 받은 제안 목록에서 `kind === 'ally'`인 것도 「동맹 제안 수락」 버튼으로 표시 → `WarAPI.rpc('war_accept_offer', {p_offer: offer.id})`.

동맹 상태 판별: `S.poll.diplomacy`에서 해당 나라 쌍의 `status`를 읽습니다.

### 2-2. 무역 탭 추가 (합동참모의장만)

지도 탭 작은 탭 목록에 `무역` 탭을 추가합니다 (`me.role === 'chief'`일 때만 보임).

무역 탭 내용:
- **무역 제안 보내기 폼:**
  - 상대 나라 선택 (`<select>`, 현재 전쟁 중인 나라는 비활성화·회색 표시)
  - 줄 것: 품목 + 수량 (내 chief 지갑에 있는 품목만)
  - 받을 것: 품목 + 수량 (자유 입력)
  - 「무역 제안」 버튼 → `WarAPI.rpc('war_trade_propose', {p_other, p_give: {item:qty}, p_want: {item:qty}})`
- **받은 무역 제안 목록:**
  - `S.poll.offers`에서 `kind === 'trade'`이고 `to_c === S.me.country.id`인 것
  - 각 제안: 「X나라가 [품목A N개]를 주고 [품목B M개]를 원해요」 형식
  - 「수락」 버튼 → `WarAPI.rpc('war_trade_accept', {p_offer: offer.id})`
- 오류는 `S.msg`로 표시

품목 목록은 `Object.keys(S.poll.country?.wallet?.chief ?? {})` 또는 `WAR_RULES.cfg.ITEMS`에서 얻습니다.

---

## 3. `tests/war/e8.test.mjs` — 동맹·무역 시험 추가

기존 e8.test.mjs 끝에 아래 시험 항목들을 추가합니다 (기존 시험은 건드리지 않음):

```
10. 동맹_제안_성공: 1번 나라 chief가 2번 나라에 war_propose(2, 'ally') → ok:true, offer 생성
11. 동맹_수락_성공: 2번 chief가 war_accept_offer(offer_id) → ok:true, status='ally'
12. 동맹_나라_공격_불가: 1번 army가 2번 나라 병력 attack → ALLY 오류
13. 동맹_중_선전포고: 1번 chief가 war_declare(2) → 성공 (동맹 깨고 전쟁)
14. 동맹_재제안_전쟁중_불가: 전쟁 중에 war_propose(2, 'ally') → AT_WAR 오류
15. 무역_제안_성공: 1번 나라 chief가 war_trade_propose(2, {food:2}, {iron:1}) → ok:true
16. 무역_수락_성공: 2번 chief가 war_trade_accept(offer_id) → ok:true, 창고 이전 확인
17. 전쟁중_무역_불가: 전쟁 중 상태에서 war_trade_propose → AT_WAR 오류
```

각 시험 사이에 필요한 외교 상태를 직접 INSERT/UPDATE로 초기화합니다.

---

## 주의사항

- `war_propose`·`war_accept_offer`는 **함수 전체를 다시 쓰지 말고**, 지시한 줄만 수정·추가합니다.
- `attack_core`는 `war` 스키마 내부 함수입니다 (`public`이 아님). 함수 선언 줄은 그대로 두고 오류 처리 두 줄만 교체합니다.
- `war_trade_propose`에서 창고 확인 쿼리의 `item=item`은 컬럼명과 변수명이 같아 모호합니다. `war.wallets.item = item`으로 명시하세요.
- 기존 시험(`npm run test:war:e8`, `rules`, `war`, `real`)이 모두 통과해야 합니다. 새 시험도 같은 파일에 번호 이어서 추가합니다.
- 커밋·푸시 금지.
