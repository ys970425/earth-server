# 작업 지시서: E5 턴 진행

**이 작업은 task-e8-diplomacy.md 작업이 커밋된 뒤에 시작한다.**

**대상 파일** (이 파일만 수정, 다른 파일 금지):
1. `supabase/war/functions.sql` — 함수 3개 추가
2. `app/war/js/war-admin.js` — 타이머·버튼 추가
3. `app/war/js/war-app.js` — 학생 화면 위쪽 턴 표시 추가
4. `tests/war/e5.test.mjs` — 새 시험 파일

커밋·푸시 금지. 시험을 모두 통과한 뒤 보고만.

---

## 1. `supabase/war/functions.sql` 끝에 추가

### 1-1. `war_next_turn(p_turn int)` — 교사: 다음 턴으로 넘기기

```sql
create or replace function public.war_next_turn(p_turn int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  g war.game;
  cfg jsonb; wcfg jsonb;
begin
  perform priv.need_admin();
  select * into g from war.game where id = 1 for update;
  -- 이미 넘어간 턴이면 무시 (두 번 처리 방지)
  if g.turn <> p_turn then
    return jsonb_build_object('ok', false, 'reason', '이미 다음 턴으로 넘어갔어요');
  end if;
  cfg := priv.cfg(); wcfg := war.cfg();

  -- 턴 끝 처리
  -- ① 모든 병력 이동력·공격 회복
  update war.units set
    moves_left = war.moves_left_full(kind, cfg, wcfg),
    attacked_turn = -1;
  -- ② 수도 포위 해제: besieged=true인 수도를 hp=20으로 회복하고 포위 해제
  update war.cities set hp = 20, besieged = false where kind = 'capital' and besieged = true;
  -- ③ 빈칸 병합
  perform war.merge_empty_tiles();
  -- ④ 보호막은 turn 번호 비교로 자동 처리됨 (shield_until은 절대 턴 번호)

  -- 턴 번호 올리기, turn_end 갱신
  update war.game set
    turn = turn + 1,
    turn_end = case when turn_seconds > 0 then now() + (turn_seconds || ' seconds')::interval else null end
  where id = 1;

  perform war.bump('game');
  perform war.bump('map');
  perform war.bump('units');
  perform war.bump('cities');

  return jsonb_build_object('ok', true, 'turn', g.turn + 1);
end $$;
revoke all on function public.war_next_turn(int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_next_turn(int) to %I', r);
  end if; end loop; end $$;
```

### 1-2. `war_pause(p_pause boolean)` — 교사: 일시정지·다시 시작

```sql
create or replace function public.war_pause(p_pause boolean) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
begin
  perform priv.need_admin();
  update war.game set paused = p_pause where id = 1;
  perform war.bump('game');
  return jsonb_build_object('ok', true, 'paused', p_pause);
end $$;
revoke all on function public.war_pause(boolean) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_pause(boolean) to %I', r);
  end if; end loop; end $$;
```

### 1-3. `war_set_turn_time(p_seconds int)` — 교사: 턴 시간 조절

```sql
create or replace function public.war_set_turn_time(p_seconds int) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
begin
  perform priv.need_admin();
  if p_seconds < 60 or p_seconds > 600 then
    perform priv.err('BAD_TIME', '턴 시간은 60~600초 사이여야 해요');
  end if;
  update war.game set turn_seconds = p_seconds where id = 1;
  perform war.bump('game');
  return jsonb_build_object('ok', true, 'turn_seconds', p_seconds);
end $$;
revoke all on function public.war_set_turn_time(int) from public;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop
  if exists (select 1 from pg_roles where rolname = r) then
    execute format('grant execute on function public.war_set_turn_time(int) to %I', r);
  end if; end loop; end $$;
```

---

## 2. `app/war/js/war-admin.js` — 타이머·버튼 추가

관제실 화면 맨 위(가져오기 섹션 위)에 **턴 관리 섹션** 추가:

```
┌─────────────────────────────────────┐
│ 턴 N   남은 시간 M:SS               │
│ [다음 턴] [일시정지/다시시작] [시간 조절▼] │
└─────────────────────────────────────┘
```

- **턴 번호**: `poll.game?.turn ?? 0`
- **남은 시간**: `poll.game?.turn_end`가 있으면 `setInterval`로 1초마다 갱신. 형식: `M:SS`. 0 이하면 `0:00` 표시. `turn_end`가 없으면 `--:--`
- **다음 턴** 버튼: `WarAPI.rpc('war_next_turn', {p_turn: currentTurn})` 호출. 오류는 alert으로 표시
- **일시정지/다시 시작** 버튼: `poll.game?.paused`가 true면 「다시 시작」, false면 「일시정지」 표시. `WarAPI.rpc('war_pause', {p_pause: !paused})`
- **시간 조절**: `<select>` 드롭다운. 선택지: 60/90/120/180/240/300초 (각각 「1분/1분30초/2분/3분(기본)/4분/5분」). 바꾸면 `WarAPI.rpc('war_set_turn_time', {p_seconds: v})` 호출. 현재 `poll.game?.turn_seconds`에 맞춰 선택 상태 반영

`applyPoll(data)` 에서 `data.game`이 있으면 이 섹션을 다시 렌더링한다. `setInterval`은 렌더링할 때 이전 것을 clearInterval 하고 새로 등록한다.

---

## 3. `app/war/js/war-app.js` — 학생 화면 위쪽 턴 표시

화면 맨 위(탭 바 위쪽)에 **턴 정보 띠** 추가:

```
턴 N  남은 시간 M:SS  [일시정지 중]
```

- `S.poll.game?.turn`이 0이고 `turn_end`가 없으면 표시 안 함(게임 미시작)
- `turn_end`가 있으면 1초마다 카운트다운 갱신
- `paused`가 true이면 「⏸ 일시정지 중」 표시
- 스타일: 기존 `.war-banner` 위에, 간단한 인라인 스타일 (`background: #222; color: #fff; font-size: 0.9em; padding: 4px 12px; display: flex; gap: 12px; align-items: center`)

`applyPoll(data)` 에서 `data.game`이 있으면 갱신한다. 타이머 setInterval은 1초 주기로 화면만 갱신(WarAPI 호출 없음).

---

## 4. `tests/war/e5.test.mjs` — 새 시험

구조: `helpers.mjs`의 `createDb`, `seedTradeState` 사용.

```
실행: node tests/war/e5.test.mjs  (또는 npm run test:war:e5)
```

시험 항목:
1. `준비: DB 설치`
2. `다음_턴_성공`: admin이 `war_next_turn(0)` → ok:true, turn=1
3. `다음_턴_중복_방지`: 다시 `war_next_turn(0)` → ok:false (이미 turn=1)
4. `일시정지_성공`: `war_pause(true)` → paused=true
5. `다시_시작_성공`: `war_pause(false)` → paused=false
6. `시간_조절_성공`: `war_set_turn_time(120)` → turn_seconds=120
7. `시간_범위_오류`: `war_set_turn_time(30)` → BAD_TIME 오류
8. `턴_끝_이동력_회복`: 모든 병력 moves_left = 0으로 만든 뒤 war_next_turn → 모든 병력 moves_left > 0
9. `수도_포위_해제`: 수도 besieged=true로 설정 후 war_next_turn → besieged=false, hp=20
10. `비관리자_거절`: 학생이 war_next_turn → NO_AUTH 또는 ROLE 오류

e5.test.mjs를 package.json의 scripts에 `"test:war:e5": "node tests/war/e5.test.mjs"` 추가.

---

## 주의사항

- 타이머 setInterval 처리: `war-admin.js`와 `war-app.js` 모두에서 모듈 최상위에 `let turnTimer = 0`을 선언하고, 렌더링할 때 `clearInterval(turnTimer); turnTimer = setInterval(() => { /* update display */ }, 1000);` 패턴 사용.
- 학생 화면 타이머는 `WarAPI.rpc` 호출 없이 `setInterval`로 DOM만 갱신한다.
- 기존 `war-app.js`와 `war-admin.js` 패턴(h() 헬퍼, S.poll, 이벤트 핸들러 방식)을 그대로 따른다.
