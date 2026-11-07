# 작업 보고서 — E1 헬피코드 몫 (H0~H4)

- 날짜: 2026-11-07
- 브랜치: `war-version` 확인 후 작업
- 결과: **완료** (`war.act_start`·`war.bump`는 지시서대로 만들지 않았습니다 — GPT 몫)

## H0. 설계 문서 결석 대행 규칙 (3줄)

- 2장 「결석 대비」 줄을 지시서 문구대로 교체: 결석한 학생의 역할은 합동참모의장이 대신(공병사령관·참모총장 모두), 결석 = 교사 표시 또는 역할 미선택, 합참 결석 시 교사가 다른 학생 지정(기본값)
- 13장 기록 표에 「결석 대행」 한 줄 추가 (기존 행은 그대로)

## H1. 표 추가 (`supabase/war/schema.sql`, 3줄)

- `war.game`에 `turn_seconds`(180)·`turn_end`·`paused`·`combat_on` 열 추가
- 새 표 9개: `roles`(나라별 역할 유일), `wallets`, `city_facilities`, `diplomacy`(a<b, peace/war/ally, no_war_until), `offers`, `markets`(1~3)+`market_stock`, `versions`(영역·나라), `grants` — `tiles.imp_ruined`, `units.commander`, `cities.besieged`, `countries.shield_until·cities_lost` 열 추가
- 모두 `if not exists`/`add column if not exists`, 새 표는 익명·학생 권한 revoke (기존 권한 처리 유지)

## H2. 규칙 숫자를 서버로 (3줄)

- `tools/war/build-config.mjs` (새): war-rules.js + trade rules.js를 읽어 역할·병과·구축함/전투기·특수 부대(95/60)·건물·타일 시설 분류·시장·턴(180초)·수도(20/200)·수리·보호막 3·도시 손실 2·평화 3 숫자를 `supabase/war/config.sql`로 생성 (특수 부대 힘이 95가 아니면 생성 중단). 시장 관세 함수는 `{mult:0.5, floor:true}`로 직렬화
- `config.sql`: `war.config` 표(한 행 jsonb) + `war.cfg()` 함수 + 학생 권한 revoke
- `package.json`에 `"war:config"` 추가. 두 번 실행 → 같은 파일 (MD5 비교 True)

## H3. 가져오기 v2 (`supabase/war/functions.sql`, 3줄)

- `war.admin_import`: H1 새 표 9개까지 모두 비우고, 병력 조종 역할(commander) 지정, 공장·고등 건물을 「수도가 아닌 도시(번호순)」에 공장(이름순)→고등(이름순) 돌아가며 배치(없으면 수도), 병과 최소 지급(육 창병=수도 칸 또는 가장 가까운 빈 땅 칸 / 해 삼단노선=해안 도시 옆 빈 바다 칸, 없으면 skipped / 공 전투기=수도 옆 빈 땅 칸)을 `war.grants`에 기록
- 시장 3곳(후보 칸이 쓰이면 가장 가까운 빈 바다 칸으로 이동, 지형 평원·주인 없음, 특산 4개씩 창고), 외교 15쌍 peace, 게임 기본값(180초·정지 아님·전투 켜짐), 요약에 `grants`·`facilities`·`markets` 추가
- `war.admin_grants()`(교사만) + `public.war_admin_grants()` 연결 함수 추가. 모든 결정은 번호순으로 두 번 가져와도 같음

## H4. 시험 (3줄)

- `tests/war/import-v2.test.mjs` (새, 33항목) + `package.json` `"test:war:import2"`: 무역 지문 불변, 두 번 가져오기 동일(행 수·병력 위치·시설 배치·시장 칸·외교·지급), 시설 누락 0·수도 배치 없음, 지급 규칙(4번 나라 육해공 given·창병은 수도 칸 / 5번 나라 창병은 수도 옆 빈 땅 칸·공군 기록 없음 / 3번 나라 해군 skipped 문구), 시장(평원·주인 없음·6종×4개), 외교 15쌍 peace, 학생 차단, 무역 표 변경 SQL 0개
- `tests/war/import.test.mjs`: 설치 순서에 config.sql 추가 + 「무역의 모든 병력을 가져옴」 검사만 「priv.units 수 + grants given 수」로 교체. `make-preview.mjs`·`make-real-preview.mjs`·`real-preview.test.mjs`: 설치 순서만 schema → config → functions로 추가
- `npm run war:preview`로 `app/war/preview/state.json` 재생성 (두 번 같음, 병력 42 → 48: 지급 전투기 6포함)

## 시험 결과 (마지막 줄)

```
npm run war:config && npm run war:config   같은 파일 (MD5 True)
node tests/war/import-v2.test.mjs          전체 통과 (✔ 33개, 종료 코드 0)
node tests/war/rules.test.mjs              전체 통과 (종료 코드 0)
node tests/war/db.test.mjs                 전체 통과 (종료 코드 0)
node tests/war/import.test.mjs             전체 통과 (종료 코드 0)
node tests/war/real-preview.test.mjs       전체 통과 (종료 코드 0)
node tests/trade/db.test.mjs               전체 통과 (종료 코드 0)
npm run war:preview && npm run war:preview state.json 두 번 같음 (MD5 True)
git status --short                         아래 목록(허용 파일)만 변경
```

## 가짜 데이터(시드 상태) 기준 나라별 지급 결과

- 육군: 나라별 지급 없음 — 여섯 나라 모두 창병이 이미 있음
- 해군: 여섯 나라 모두 **skipped, 까닭 「해안 도시가 없어 해군을 줄 수 없어요」** — 시드 상태에서는 어떤 나라도 이웃에 바다가 있는 도시(해안 도시)를 갖고 있지 않음 (규칙대로의 올바른 결과). 해안 도시를 가진 경우의 지급은 import-v2 시험에서 2·4번 나라(해안 도시국가 점령)로 확인: 삼단노선을 옆 빈 바다 칸에 지급
- 공군: 여섯 나라 모두 **전투기 1부대 given** (state.json 병력 48 = 42 + fighter 6)

## 시장 3곳의 실제 칸

- 북서 마을(neutral_village) 칸 **375** · 남쪽 항구(neutral_harbor) 칸 **657** · 동쪽 성곽(neutral_fortress) 칸 **266** — 세 후보 칸 모두 도시·병력·주인이 없어 그대로 사용, 지형 평원으로 바뀜

## 기타

- `git status --short`: `M docs/war-design.md`, `M package.json`, `M supabase/war/schema.sql`, `M supabase/war/functions.sql`, `M tests/war/import.test.mjs`, `M tests/war/real-preview.test.mjs`, `M tools/war/make-preview.mjs`, `M tools/war/make-real-preview.mjs`, `M app/war/preview/state.json`, 신규 `supabase/war/config.sql`, `tests/war/import-v2.test.mjs`, `tools/war/build-config.mjs`, 이 보고서 — 허용 목록 밖 변경 없음
- `private/`는 열지 않았고 `war:preview:real`도 실행하지 않았습니다. 무역 표는 읽기만 했습니다 (시험으로 지문 불변 확인)
- 화면 확인 항목은 이번 지시서에 없음

## 막힌 점

- 없음 (초기 구현에서 config.sql의 표 생성 순서, plpgsql 변수와 열 이름 충돌(r·tile_id·u 별명), 시장 art 값(neutral_*)을 고쳐 해결. 시드 상태에 해안 도시·공장이 없어 시험 준비 단계에서 해안 도시국가 점령과 시설 데이터를 추가해 확인)

커밋·푸시하지 않았습니다
