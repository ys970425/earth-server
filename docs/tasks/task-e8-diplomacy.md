# 작업 지시서: 외교 최소 기능 (E8 일부)

**대상 파일** (이 파일만 수정, 다른 파일 금지):
1. `supabase/war/functions.sql` — 함수 4개 추가, war_poll 수정
2. `app/war/js/war-rules.js` — OPEN_STAGES 수정
3. `app/war/js/war-student.js` — 외교 탭(합동참모의장만)
4. `app/war/js/war-admin.js` — 전쟁 현황 + 강제 휴전 버튼
5. `tests/war/e8.test.mjs` — 새 시험 파일
6. `tests/war/screen.test.mjs` — 시험 7번만 수정

커밋·푸시 금지. 시험을 모두 통과한 뒤 보고만.

---

## 1. `supabase/war/functions.sql` 끝에 추가

### 1-1. `war_declare(p_other int)` — 합동참모의장이 선전포고

```sql
create or replace function public.war_declare(p_other int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; a int; b int;
begin
  perform war.act_start('chief');
  select country_id into me from priv.students where uid = auth.uid();
  select turn into turn_ from war.game where id = 1;
  if me = p_other then perform priv.err('BAD_TARGET', '자기 나라에는 선전포고할 수 없어요'); end if;
  if not exists (select 1 from war.countries where id = p_other) then
    perform priv.err('NO_COUNTRY', '없는 나라예요'); end if;
  a := least(me, p_other); b := greatest(me, p_other);
  if not exists (select 1 from war.diplomacy where war.diplomacy.a = a and war.diplomacy.b = b) then
    perform priv.err('NO_DIPLO', '외교 관계가 없어요'); end if;
  if exists (select 1 from war.diplomacy where war.diplomacy.a = a and war.diplomacy.b = b and status = 'war') then
    perform priv.err('ALREADY_AT_WAR', '이미 전쟁 중이에요'); end if;
  if exists (select 1 from war.diplomacy where war.diplomacy.a = a and war.diplomacy.b = b and no_war_until > turn_) then
    perform priv.err('NO_WAR_BAN', '평화 조약 뒤 3턴이 지나지 않았어요'); end if;
  -- 동맹이면 바로 깨고 전쟁
  update war.diplomacy set status = 'war', changed_turn = turn_ where war.diplomacy.a = a and war.diplomacy.b = b;
  -- 기존 pending 평화 제안 취소
  update war.offers set status = 'cancelled' where kind = 'peace' and status = 'pending'
    and ((from_c = me and to_c = p_other) or (from_c = p_other and to_c = me));
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'status', 'war');
end $$;
revoke all on function public.war_declare(int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_declare(int) to %I', r);
  end if; end loop; end $$;
```

### 1-2. `war_propose(p_other int, p_kind text)` — 평화 제안

```sql
create or replace function public.war_propose(p_other int, p_kind text default 'peace') returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; a int; b int; oid bigint;
begin
  if p_kind not in ('peace') then perform priv.err('BAD_KIND', '지원하지 않는 제안 종류예요'); end if;
  perform war.act_start('chief');
  select country_id into me from priv.students where uid = auth.uid();
  select turn into turn_ from war.game where id = 1;
  if me = p_other then perform priv.err('BAD_TARGET', '자기 나라에 제안할 수 없어요'); end if;
  if not exists (select 1 from war.countries where id = p_other) then
    perform priv.err('NO_COUNTRY', '없는 나라예요'); end if;
  a := least(me, p_other); b := greatest(me, p_other);
  -- 평화 제안: 전쟁 중이어야 함
  if p_kind = 'peace' and not exists (
    select 1 from war.diplomacy where war.diplomacy.a = a and war.diplomacy.b = b and status = 'war') then
    perform priv.err('NOT_AT_WAR', '전쟁 중인 나라에만 평화를 제안할 수 있어요'); end if;
  -- 이미 같은 종류의 pending 제안이 있으면 취소
  update war.offers set status = 'cancelled'
    where kind = p_kind and status = 'pending'
      and ((from_c = me and to_c = p_other) or (from_c = p_other and to_c = me));
  insert into war.offers(kind, from_c, to_c, turn) values (p_kind, me, p_other, turn_) returning id into oid;
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'offer_id', oid);
end $$;
revoke all on function public.war_propose(int, text) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_propose(int, text) to %I', r);
  end if; end loop; end $$;
```

### 1-3. `war_accept_offer(p_offer bigint)` — 평화 수락

```sql
create or replace function public.war_accept_offer(p_offer bigint) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  me int; turn_ int; o war.offers; a int; b int;
begin
  perform war.act_start('chief');
  select country_id into me from priv.students where uid = auth.uid();
  select * into o from war.offers where id = p_offer;
  if not found then perform priv.err('NO_OFFER', '없는 제안이에요'); end if;
  if o.to_c <> me then perform priv.err('NOT_FOR_ME', '이 제안은 우리 나라에 온 게 아니에요'); end if;
  if o.status <> 'pending' then perform priv.err('OFFER_DONE', '이미 처리된 제안이에요'); end if;
  select turn into turn_ from war.game where id = 1;
  a := least(me, o.from_c); b := greatest(me, o.from_c);
  if o.kind = 'peace' then
    if not exists (select 1 from war.diplomacy where war.diplomacy.a = a and war.diplomacy.b = b and status = 'war') then
      perform priv.err('NOT_AT_WAR', '전쟁 중이 아니에요'); end if;
    update war.diplomacy set status = 'peace', no_war_until = turn_ + 3, changed_turn = turn_
      where war.diplomacy.a = a and war.diplomacy.b = b;
    -- 관련 pending 제안 모두 취소
    update war.offers set status = 'cancelled'
      where kind = 'peace' and status = 'pending'
        and ((from_c = me and to_c = o.from_c) or (from_c = o.from_c and to_c = me));
  end if;
  update war.offers set status = 'accepted' where id = p_offer;
  perform war.bump('diplomacy');
  return jsonb_build_object('ok', true, 'status', 'peace', 'no_war_until', turn_ + 3);
end $$;
revoke all on function public.war_accept_offer(bigint) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_accept_offer(bigint) to %I', r);
  end if; end loop; end $$;
```

### 1-4. `war_admin_ceasefire(p_a int, p_b int default null)` — 교사 강제 휴전

```sql
create or replace function public.war_admin_ceasefire(p_a int, p_b int default null) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  turn_ int; cnt int;
begin
  perform priv.need_admin();
  select turn into turn_ from war.game where id = 1;
  if p_b is null then
    -- 그 나라가 포함된 전쟁 모두 휴전
    update war.diplomacy set status = 'peace', no_war_until = turn_ + 3, changed_turn = turn_
      where status = 'war' and (a = p_a or b = p_a);
  else
    -- 특정 쌍 휴전
    update war.diplomacy set status = 'peace', no_war_until = turn_ + 3, changed_turn = turn_
      where status = 'war' and a = least(p_a, p_b) and b = greatest(p_a, p_b);
  end if;
  get diagnostics cnt = row_count;
  update war.offers set status = 'cancelled'
    where kind in ('peace') and status = 'pending'
      and (p_b is null
        or (a = least(p_a, p_b) and b = greatest(p_a, p_b)));
  if cnt > 0 then perform war.bump('diplomacy'); end if;
  return jsonb_build_object('ok', true, 'ceasefire_count', cnt);
end $$;
revoke all on function public.war_admin_ceasefire(int, int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_admin_ceasefire(int, int) to %I', r);
  end if; end loop; end $$;
```

### 1-5. `war_poll` 수정 — diplomacy 응답에 pending 제안 추가

기존 `war_poll`의 diplomacy 절을 찾아서, `out := out || jsonb_build_object('diplomacy', ...)` 뒤에 다음을 추가:

```sql
    out := out || jsonb_build_object('offers', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'kind', kind, 'from_c', from_c, 'to_c', to_c, 'turn', turn) order by id), '[]'::jsonb)
      from war.offers where to_c = my_country and status = 'pending'));
```

즉, diplomacy 블록의 `if k is null or k is distinct from v_dip then` 블록 안에서, `out := out || jsonb_build_object('diplomacy', ...)` 한 줄 뒤에 offers 줄을 같이 넣는다.

---

## 2. `app/war/js/war-rules.js` — OPEN_STAGES 수정

```js
// 기존:
W.OPEN_STAGES = ['now'];
// 변경:
W.OPEN_STAGES = ['now', 'E4', 'E8'];
```

---

## 3. `app/war/js/war-student.js` — 외교 탭 (합동참모의장만)

**지도 탭의 작은 탭 목록**에 `외교` 탭을 추가한다. `me.role === 'chief'`일 때만 보인다.

외교 탭 내용:
- 나라별 관계(평화/전쟁) 목록: `S.poll.diplomacy` 사용, 각 쌍에서 상대 나라 이름 표시
  - 전쟁 중인 쌍: 빨간색, 「⚔ 전쟁 중」
  - 평화인 쌍: 녹색, 「🕊 평화」
  - `no_war_until > current_turn`: 「🕊 평화 (X턴 선포 금지)」
- 선전포고 버튼: 평화 상태인 나라에만 표시. 누르면 confirm 대화상자(`선전포고하면 바로 전쟁이 시작돼요. 계속할까요?`) 후 `WarAPI.rpc('war_declare', {p_other: countryId})` 호출
- 평화 제안 버튼: 전쟁 중인 나라에만 표시. 누르면 `WarAPI.rpc('war_propose', {p_other: countryId, p_kind: 'peace'})`
- 받은 제안 목록: `S.poll.offers`에서 `to_c === S.me.country.id`인 것. 각 제안에 「수락」 버튼 → `WarAPI.rpc('war_accept_offer', {p_offer: offer.id})`
- 오류는 화면에 짧게 표시 (`S.msg = 오류메시지`)

현재 turn은 `S.poll.game?.turn ?? 0`으로 얻는다.

---

## 4. `app/war/js/war-admin.js` — 전쟁 현황 + 강제 휴전

**교사 관제실**에 외교 현황 섹션 추가:
- 전쟁 중인 쌍 목록: `나라A ⚔ 나라B` + 「강제 휴전」 버튼 → `WarAPI.rpc('war_admin_ceasefire', {p_a: a, p_b: b})`
- 전쟁 중인 쌍이 없으면 「전쟁 없음」 표시

`applyPoll` 함수에서 `data.diplomacy`가 있을 때 이 섹션을 다시 그린다.

---

## 5. `tests/war/e8.test.mjs` — 새 시험

구조: `helpers.mjs`의 `createDb`, `seedTradeState` 사용, 기존 e3/e4 시험과 같은 방식.

```
실행: node tests/war/e8.test.mjs  (또는 npm run test:war:e8)
```

시험 항목:
1. `준비: DB 설치 + 역할 배정 (chief 2명: 1번·2번 나라)`
2. `선전포고_성공`: 1번 나라 chief가 2번 나라에 `war_declare(2)` → ok:true, diplomacy status='war'
3. `선전포고_중복`: 이미 전쟁 중에 다시 `war_declare(2)` → ALREADY_AT_WAR 오류
4. `평화_제안_성공`: 전쟁 중에 2번 chief가 1번에게 `war_propose(1, 'peace')` → ok:true, offer 생성
5. `평화_수락_성공`: 1번 chief가 `war_accept_offer(offer_id)` → ok:true, status='peace', no_war_until=turn+3
6. `평화_기간_선포_금지`: 평화 직후 1번이 다시 `war_declare(2)` → NO_WAR_BAN 오류
7. `비합동참모의장_선전포고_거절`: army 역할이 `war_declare(2)` → ROLE_ONLY 오류
8. `강제_휴전`: 전쟁 상태 만들고 admin이 `war_admin_ceasefire(1, 2)` → ok:true, status='peace'
9. `poll_외교_포함`: war_poll이 diplomacy + offers 반환 확인

e8.test.mjs를 package.json의 scripts에 `"test:war:e8": "node tests/war/e8.test.mjs"` 추가.

---

## 6. `tests/war/screen.test.mjs` — 시험 7번만 수정

현재 시험 7번은 `NOT_AT_WAR` 오류로 fallback 처리. 아래로 교체:

**수정 내용**: 시험 7번 블록 전체를 아래 로직으로 교체한다.

```
// 7. 점령_후_땅색_변화: 선전포고 → 공격 → 점령 → 땅 주인 바뀜
// chief 역할로 새 페이지 열기: 선전포고 + 공격 모두 chief가 함 (역할 없는 나라 대행)
await page.goto(`${BASE}/app/war/index.html?preview=real&as=1:chief`, { waitUntil: 'domcontentloaded' });
// PGlite 준비 대기
const canvas7 = await until(() => page.$('canvas.hexmap'), 90000, 500);
if (!canvas7) { ok('점령_후_땅색_변화', false, 'DB 준비 실패'); }
else {
  // 선전포고: 1번 나라가 2번 나라에 선전포고
  const decl = await page.evaluate(async () => {
    try {
      const poll = await WarAPI.rpc('war_poll', { p_known: {} });
      const me = await WarAPI.rpc('war_me');
      const myC = me.country.id;
      const otherC = poll.cities.find(c => c.country && c.country !== myC)?.country;
      if (!otherC) return { ok: false, why: '상대 나라를 찾지 못했어요' };
      await WarAPI.rpc('war_declare', { p_other: otherC });
      return { ok: true, otherC };
    } catch (e) { return { ok: false, why: e.message }; }
  });
  if (!decl.ok) { ok('점령_후_땅색_변화', false, '선전포고 실패: ' + decl.why); }
  else {
    // 공격: 비수도 적 도시가 보일 때까지 attack 반복(최대 20회), 점령 성공하면 poll로 확인
    const capResult = await page.evaluate(async ({ otherC }) => {
      const poll0 = await WarAPI.rpc('war_poll', { p_known: {} });
      const me = await WarAPI.rpc('war_me');
      const myC = me.country.id;
      // 비수도 적 도시 중 HP가 가장 낮은 것
      const targetCity = poll0.cities
        .filter(c => c.country === otherC && c.kind !== 'capital')
        .sort((a, b) => a.hp - b.hp)[0];
      if (!targetCity) return { ok: false, why: '비수도 적 도시가 없어요' };
      // 내 근접 군사 병력 중 가장 가까운 것 찾기
      const myUnits = poll0.units.filter(u => u.country === myC && !['worker','scout','fighter'].includes(u.kind) && u.tile != null);
      if (!myUnits.length) return { ok: false, why: '근접 병력이 없어요' };
      // 거리와 무관하게 첫 번째 병력 사용 (move는 이미 충분하다고 가정)
      let u = myUnits[0];
      // 도시 HP를 1로 낮추기 위해 attack을 반복
      let guard = 20;
      while (guard-- > 0) {
        const poll = await WarAPI.rpc('war_poll', { p_known: {} });
        const city = poll.cities.find(c => c.id === targetCity.id);
        if (!city || city.country === myC) return { ok: true, cityId: targetCity.id, tile: targetCity.tile };
        const unit = poll.units.find(x => x.id === u.id);
        if (!unit) return { ok: false, why: '병력이 없어졌어요' };
        const dist = WarHexMap.hexDist(unit.tile, city.tile);
        if (dist > 1) {
          // 한 칸 이동
          const tiles = new Map(poll.map.map(t => [t[0], {terrain: t[1], owner: t[3]}]));
          const occ = id => poll.units.filter(x => x.tile === id);
          const info = id => ({
            market: (poll.markets||[]).some(m=>m.tile===id),
            enemyCity: (() => { const c2 = poll.cities.find(x=>x.tile===id); return !!(c2 && c2.country !== myC); })(),
            enemyUnit: occ(id).some(x=>x.country!==myC),
            sameKind: occ(id).some(x=>!['worker','scout'].includes(x.kind)===!['worker','scout'].includes(unit.kind))
          });
          const prev = new Map([[unit.tile, null]]); const q = [unit.tile]; let found = null;
          while (q.length && !found) { const cur = q.shift();
            for (const n of WarHexMap.neighbors(cur)) {
              if (n<0||prev.has(n)||!tiles.has(n)) continue;
              if (!WAR_RULES.canPass(unit.kind,tiles.get(n),info(n))) continue;
              prev.set(n,cur);
              if (n===city.tile||WarHexMap.hexDist(n,city.tile)===1) { found=n; break; }
              q.push(n);
            }
          }
          if (!found) { await new Promise(r=>setTimeout(r,200)); continue; }
          const path=[]; for(let p=found;p!==unit.tile;p=prev.get(p)) path.unshift(p);
          const step=Math.min(unit.moves_left,path.length); if(!step) { await new Promise(r=>setTimeout(r,200)); continue; }
          try { await WarAPI.rpc('war_move',{p_unit:unit.id,p_path:path.slice(0,step)}); } catch(e) {}
        } else {
          try {
            const r = await WarAPI.rpc('war_attack', { p_unit: unit.id, p_tile: city.tile });
            if (r.captured) return { ok: true, cityId: targetCity.id, tile: targetCity.tile };
          } catch(e) { return { ok: false, why: '공격 오류: ' + e.message }; }
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return { ok: false, why: '20번 반복에도 점령 안 됨' };
    }, { otherC: decl.otherC });
    if (!capResult.ok) { ok('점령_후_땅색_변화', false, capResult.why); }
    else {
      const ownerPass = await page.evaluate(async ({ cityId, tile }) => {
        const poll = await WarAPI.rpc('war_poll', { p_known: {} });
        const me = await WarAPI.rpc('war_me');
        const city = poll.cities.find(c => c.id === cityId);
        const tileOwner = (poll.map.find(x => x[0] === tile) || [])[3];
        return city && city.country === me.country.id && tileOwner === me.country.id;
      }, capResult);
      ok('점령_후_땅색_변화', ownerPass, ownerPass ? '선전포고 → 공격 → 점령 — 도시 주인·땅 색 바뀜' : '점령했지만 poll 확인 실패');
    }
  }
}
```

**이 블록은 기존 시험 7번 블록(`// 7. 점령_후_땅색_변화`로 시작해서 `ok('점령_후_땅색_변화', ownerPass, note7);`로 끝나는 부분) 전체를 대체한다.**

---

## 주의사항

- `war_poll`의 diplomacy 절 수정 시, 기존 offers 반환이 없으니 `out := out || jsonb_build_object('offers', ...)` 한 줄만 추가. war_poll 함수 전체를 다시 쓰지 말 것.
- e8 시험에서 각 시험 사이에 DB 상태를 적절히 초기화(INSERT/UPDATE)해서 독립적으로 돌아가게.
- 화면(war-student.js, war-admin.js) 수정은 최소한으로: 기존 패턴(h(), S.poll, S.msg)을 그대로 따름.
- `app/war/js/war-data.js`는 수정하지 않는다.
