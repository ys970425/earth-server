# GPT 작업지시서: ③ E4 서버 — 전투·도시 공격·점령·파괴·멸망 방지·빈칸 병합

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인)
- 기준 문서: `docs/war-design.md` 4-5(전투), 5장(도시 공격·점령·파괴·수리·멸망 방지), 13장(빈칸 병합 기준 B), 11장(숫자)
- **같은 시간에 헬피코드가 `app/war/js/war-app.js`, `app/war/js/war-admin.js`, `app/war/css/war.css`, `app/war/*.html`, `docs/`를 고치고 있다. 이 파일들은 건드리지 않는다.** 보고서는 `docs/tasks/gpt-report.md`에만 쓴다.
- 커밋·푸시 금지, Supabase 접속 금지, `private/` 금지, 무역 표(`priv.*`)에 쓰기 금지, 무역 앱 파일 수정 금지.

## 쓸 수 있는 장치 (이미 있음)
- `war.act_start(p_role, p_combat, p_other)`: 역할·결석 대행·일시정지·전투 꺼짐(`p_combat=true`) 검사 + 자기 나라와 `p_other` 나라를 **id 순서로 한 번에** 잠금. 두 나라가 얽힌 행동은 반드시 이걸로 잠근다.
- `war.place_unit(unit, tile)`: 병력 칸 바꾸기의 유일한 길 (한 칸 한 유닛 DB 조건, 늦은 쪽 `TILE_TAKEN`).
- `war.bump(영역, 나라)`, `war.cfg()`(전쟁 규칙), `priv.cfg()`(무역 규칙 `UNITS`, `CS_TIERS`, `COMBAT`), `priv.tdist`.
- 지도 칸 주인·시설을 바꾸면 `war.bump('map')` 뒤 그 칸의 `war.tiles.ver`를 새 map 번호로 (E2 규칙).

## 만들 것 (`supabase/war/functions.sql`, 필요하면 `schema.sql`, `app/war/js/war-rules.js` + `npm run war:config`)

### 0. 가져오기 보완
- `war.admin_import`에서 **수도**(`kind = 'capital'`)의 방어·체력을 `war.cfg()`의 CAPITAL 값(방어 20, 체력·최대 체력 200)으로 맞춘다. 결과가 바뀌므로 `npm run war:preview`로 `state.json`을 다시 만든다.

### 1. `public.war_attack(p_unit int, p_tile int)` — 병력 또는 도시 공격
1. 공격 병력을 찾고 내 나라 병력인지 (`NOT_MINE`), 군사 유닛인지 (노동자·정찰병 → `NOT_MILITARY`).
2. 대상 칸의 **도시**(다른 나라 소유) 또는 **군사 유닛**(다른 나라)을 찾는다. 도시가 있으면 도시 공격. 노동자·정찰병만 있는 칸, 시장 칸, 주인 없는 도시국가는 공격 대상이 아님 (`NO_TARGET` 「공격할 수 있는 상대가 없어요」).
3. `war.act_start(공격 병력의 commander, true, 상대 나라)`.
4. 검사:
   - 두 나라가 `war.diplomacy`에서 `war` 상태 (아니면 `NOT_AT_WAR` 「전쟁 중인 나라만 공격할 수 있어요」. 동맹·평화 모두 거절)
   - 상대 나라 보호막 (`shield_until >= 지금 턴`) → `SHIELD` 「보호막이 있어요 (○턴 남음)」
   - 이번 턴에 이미 공격함 (`attacked_turn = 지금 턴`) → `ATTACKED`
   - 거리: 근접은 1, 원거리(`range`)는 range 이하 → 아니면 `TOO_FAR`
5. 병력·도시 행을 id 오름차순으로 `for update`.
6. **피해 계산 (설계 4-5, 무역 `priv.combat`과 같은 식):** 실제 힘 = 힘 × (0.5 + 0.5 × 체력/100). 특수 부대 힘은 `war.cfg()` BOSS 값(95). 막는 쪽이 유닛이고 언덕·숲·정글 칸이면 ×1.25. 도시의 막는 힘 = 도시 `def`. 비율 = 공격 ÷ 막기. 상대 피해 = clamp(round(30×비율), 3, 100), **특수 부대가 공격하면 상한 60**. 반격 = clamp(round(30×0.6÷비율), 1, 100), 원거리(거리 > 1)면 반격 × 0.25 반올림. 숫자는 `priv.cfg()->'COMBAT'`.
7. 유닛 공격: 체력 감소, 0 이하면 삭제. 공격 병력: 체력 감소(0 이하면 삭제), `moves_left = 0`, `attacked_turn = 지금 턴`.
8. 도시 공격: 도시 hp 감소 (0 아래로 안 감). **상대 나라 `cities_lost`가 2 이상이면 그 나라 도시 hp는 1 아래로 안 감** (멸망 방지).
   - **수도**: hp 0 → `besieged = true` (점령 안 됨).
   - **일반 도시** hp 0 이고 공격 병력이 살아 있고 **근접**이며 (**땅 유닛**, 또는 **배이고 해안 도시**: 도시 칸 이웃에 바다·해안 칸), 공군이 아니고, 도시 칸에 상대 군사 유닛이 없으면 → **점령**:
     - `war.place_unit(공격 병력, 도시 칸)`
     - 도시 `country` = 공격 나라, hp = 최대의 절반, `besieged = false`
     - 도시 칸과 이웃 땅 칸(바다·해안·다른 도시·시장 칸 제외)의 주인 = 공격 나라. 그 칸들 중 타일 시설이 `war.cfg()` TILE_IMP의 파괴 목록(광산·유정·농원)이면 `imp_ruined = true`
     - 그 도시의 `war.city_facilities` 전부 `ruined = true` (공장·고등 건물, 특산 공장 포함)
     - 상대 나라 `cities_lost += 1`, `shield_until = 지금 턴 + 3` (SHIELD_TURNS)
     - `war.merge_empty_tiles()` 한 번
   - 원거리·공군으로 hp 0 → 점령하지 않음 (결과에 `need_melee: true`)
9. 바뀐 영역 `bump` (units, cities, map, 두 나라 country), 결과 jsonb: `{ damage, counter, attacker_hp, defender_hp, killed, attacker_killed, besieged, captured, need_melee }`.

### 2. `public.war_attack_preview(p_unit int, p_tile int)` — 미리보기 (읽기만)
1번의 1~6 검사·계산을 그대로 하되 바꾸지 않고 `{ damage, counter, can_attack, reason }`을 돌려준다 (못 하면 `can_attack=false`와 쉬운 말 `reason`). 1번과 **같은 계산 함수**를 공유한다 (예: `war.combat_calc(...)`).

### 3. `war.merge_empty_tiles()` — 빈칸 자동 병합 (설계 13장 기준 B)
- 대상: 주인 없는 칸 중 지형이 바다·해안이 아니고, 도시 칸·시장 칸이 아닌 칸.
- 이웃 6칸(지도 밖 제외) 중 **같은 나라 땅이 4칸 이상**이면 그 나라 땅. (4칸 이상인 나라는 하나뿐이므로 두 나라 사이 빈칸은 그대로)
- **먼저 모든 대상 칸을 계산한 뒤 한꺼번에 적용** (한 번에 한 겹, 새로 합친 칸으로 이어서 합치지 않음). 합친 칸이 있으면 `bump('map')`과 `ver`. 합친 칸 수를 돌려준다.
- public이 아님. E5(턴 끝)에서도 부를 예정이라고 머리 주석에.

## 시험 `tests/war/e4.test.mjs` (새) + `package.json` `"test:war:e4"`
준비: W0 틀 → 전쟁 SQL → 가져오기 → 역할 주기. 두 나라를 `war` 상태로 직접 바꾸는 것은 시험 준비로 허용.
- 평화·동맹 상태면 `NOT_AT_WAR` / 보호막이면 `SHIELD` / 같은 턴 두 번째 공격 `ATTACKED` / 거리 초과 `TOO_FAR` / 노동자로 공격 `NOT_MILITARY` / 노동자만 있는 칸 `NO_TARGET`
- 미리보기 숫자 = 실제 공격 피해 (같은 상태에서)
- 유닛 체력 0 → 삭제, 원거리 반격 25%, 특수 부대 피해 ≤ 60, 언덕 방어 보너스로 피해가 줄어듦
- 수도 hp 0 → `besieged`, 점령 안 됨
- 일반 도시 hp 0 + 근접 땅 유닛 → 점령: 주인·hp 절반·병력이 도시 칸으로·주변 땅 주인·광산/유정/농원 `imp_ruined`·농장은 그대로·도시 시설 모두 `ruined`·상대 `cities_lost`+1·보호막 3턴
- 원거리로 hp 0 → 점령 안 됨 `need_melee`; 해안 도시를 근접 배로 점령 / 해안이 아닌 도시는 배로 점령 불가
- 상대가 이미 2곳 잃었으면 도시 hp가 1에서 멈춤
- 병합: 4칸 이상 둘러싸인 빈칸만 합쳐지고, 3칸이면 그대로, 두 나라 사이(3:3)는 그대로, 바다·해안·도시·시장 칸은 안 합쳐짐, 한 번에 한 겹
- 기존 시험 모두 통과 (`missions`, `select`, `preview-db`, `place`, `e3`, `e2`, `act`, `import-v2`, `import`, `rules`, `db`, `real-preview`, `trade`)
- 머리 주석: PGlite는 연결 하나라 동시 공격은 시험 못 함 (설치 후 확인)

## 고쳐도 되는 파일
`supabase/war/functions.sql`, `supabase/war/schema.sql`, `app/war/js/war-rules.js`, `supabase/war/config.sql`(다시 만들기), `tools/war/build-config.mjs`(필요할 때만), `tests/war/e4.test.mjs`(새), 기존 시험은 가져오기의 수도 수치 변경으로 깨지는 **기대값만**, `package.json`(scripts), `app/war/preview/state.json`(다시 만들기), `docs/tasks/gpt-report.md`

## 완료 조건 (직접 실행)
위 시험 전부 「전체 통과」, `npm run war:config`·`npm run war:preview` 두 번 같은 결과, `git status --short`에 위 목록 밖 변경 없음 (헬피코드 쪽 파일 변경은 그대로 둠).

## 보고 (`docs/tasks/gpt-report.md`에 덮어쓰기)
만든 함수, 잠금 순서, 시험 결과 마지막 줄들, 못 한 것은 「못 함:」, 마지막 줄 「커밋·푸시하지 않았습니다」
