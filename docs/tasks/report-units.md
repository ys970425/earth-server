# 병과 개편 — 기존 유닛 → 새 병과 대응표

- 날짜: 2026-11-08
- 학생 유닛의 개수와 위치는 그대로 유지, 종류만 아래 표대로 변경

## 1. 기존 → 새 대응표

| 기존 종류 (무역 앱) | 기존 이름 | 새 종류 (전쟁의 시간) | 새 이름 | 병과 | 개수 유지 |
|---|---|---|---|---|---|
| spear | 창병 | spear | 창병 | 육군 | ✓ |
| catapult | 투석기 | catapult | 투석기 | 육군 | ✓ |
| knight | 기사 | mech_inf | 기계화 보병 | 육군 | ✓ |
| musket | 머스킷 보병 | mech_inf | 기계화 보병 | 육군 | ✓ |
| cannon | 대포 | catapult | 투석기 | 육군 | ✓ |
| infantry | 보병 | mech_inf | 기계화 보병 | 육군 | ✓ |
| artillery | 포병 | catapult | 투석기 | 육군 | ✓ |
| tank | 탱크 | tank_modern | 현대 전차 | 육군 | ✓ |
| trireme | 삼단노선 | destroyer | 구축함 | 해군 | ✓ |
| frigate | 프리깃 | destroyer | 구축함 | 해군 | ✓ |
| battleship | 전함 | battleship | 전함 | 해군 | ✓ |
| cruiser | 미사일 순양함 | battleship | 전함 | 해군 | ✓ |
| fighter | 전투기 | helicopter | 전투 헬기 | 공군 | ✓ |
| k_missile | 장거리 미사일 부대 | k_missile | 장거리 미사일 부대 (특수) | 육군 | ✓ |
| j_patrol | 해상 초계기 | j_patrol | 해상 초계기 (특수) | 해군 | ✓ |
| c_jet | 대형 전투기 편대 | c_jet | 대형 전투기 편대 (특수) | 공군 | ✓ |
| a_stealth | 스텔스 폭격기 | a_stealth | 스텔스 폭격기 (특수) | 공군 | ✓ |
| n_hyper | 극초음속 미사일 | n_hyper | 극초음속 미사일 (특수) | 공군 | ✓ |
| t_marine | 상륙 기갑부대 | t_marine | 상륙 기갑부대 (특수) | 육군 | ✓ |
| worker | 노동자 | worker | 노동자 | 민간 | ✓ |
| scout | 정찰병 | scout | 정찰병 | 민간 | ✓ |

## 2. 새 병과 표 (공격/방어/이동/특징/필요한 것)

| 새 종류 | 이름 | 병과 | 공격 | 방어 | 이동 | 특징 | 필요한 것 |
|---|---|---|---|---|---|---|---|
| spear | 창병 | 육군 | 4 | 4 | 2 | 가장 쌈 | 코인5·목재2·철광석1 |
| catapult | 투석기 | 육군 | 5 | 2 | 1 | 2칸 떨어져 공격 | 코인8·목재3·철광석1 |
| mech_inf | 기계화 보병 | 육군 | 5 | 6 | 3 | | 코인12·강철2·타이어1·연료1 |
| tank_modern | 현대 전차 | 육군 | 7 | 5 | 3 | | 코인18·강철3·고무1·연료2 |
| destroyer | 구축함 | 해군 | 6 | 5 | 4 | | 코인15·강철3·연료2 |
| battleship | 전함 | 해군 | 7 | 6 | 3 | 2칸 떨어져 공격 | 코인22·강철4·연료2·반도체1 |
| helicopter | 전투 헬기 | 공군 | 6 | 4 | 4 | | 코인16·항공 엔진1·연료2 |
| drone | 살상용 드론 | 공군 | 5 | 2 | 5 | | 코인10·희토류1·연료1 |
| missile | 유도미사일 | 공군 | 4 | 0 | 0 | 3칸 떨어져 공격, 쏘면 사라짐 | 코인8·반도체1·연료1 |
| k_missile | 장거리 미사일 부대 | 육군(특수) | 7 | 5 | 5 | 3칸 떨어져 공격, 나라별 | (기존 유지) |
| j_patrol | 해상 초계기 | 해군(특수) | 7 | 5 | 6 | 3칸 떨어져 공격, 나라별 | (기존 유지) |
| c_jet | 대형 전투기 편대 | 공군(특수) | 7 | 5 | 6 | 3칸 떨어져 공격, 나라별 | (기존 유지) |
| a_stealth | 스텔스 폭격기 | 공군(특수) | 7 | 5 | 6 | 3칸 떨어져 공격, 나라별 | (기존 유지) |
| n_hyper | 극초음속 미사일 | 공군(특수) | 7 | 5 | 5 | 3칸 떨어져 공격, 나라별 | (기존 유지) |
| t_marine | 상륙 기갑부대 | 육군(특수) | 7 | 5 | 5 | 2칸 떨어져 공격, 나라별 | (기존 유지) |
| worker | 노동자 | 민간 | - | - | 2 | | 코인25·식량2 |
| scout | 정찰병 | 민간 | - | - | 5 | | (기존 유지) |

## 3. 통합·삭제 요약

- 기사·머스킷 보병·보병 → 기계화 보병으로 통합 (3종 → 1종)
- 대포·포병 → 투석기로 통합 (원거리 육군 3종 → 1종)
- 탱크 → 현대 전차로 이름 변경
- 삼단노선·프리깃 → 구축함으로 통합 (2종 → 1종)
- 전함·미사일 순양함 → 전함으로 통합 (2종 → 1종)
- 전투기 → 전투 헬기로 변경
- 신규: 살상용 드론, 유도미사일 (쏘면 사라짐) 추가
- 특수부대 6종: 이름·특징 유지, 공격 7·방어 5로 통일
- 기존 20종 → 새 15종 + 민간 2종 = 17종

## 4. 바꾼 파일

| 파일 | 내용 |
|---|---|
| app/war/js/war-rules.js | W.UNITS(atk/def 체계)·W.KIND_MAP·W.BRANCH_UNITS 추가, W.BRANCH·EXTRA_UNITS·BOSS 제거, MOVES_OF·unitIsSea·unitIsAir·unitIsRanged·unitIsCivil 갱신 |
| tools/war/build-config.mjs | UNITS·KIND_MAP 출력, EXTRA_UNITS·BOSS·MOVES 제거 |
| supabase/war/config.sql | 재생성 (유닛 17종, KIND_MAP 포함) |
| supabase/war/functions.sql | attack_core: str→atk/def, 유도미사일 oneTime 처리, admin_import: KIND_MAP 매핑, war_produce·war_move·war_transfer: UNITS.branch 참조, moves_left_full 갱신 |
| tests/war/units.test.mjs | 신규 (88항목) |
| package.json | test:war:units 추가 |

## 5. 시험 결과 (npm run test:war:units)

```
✔ 88항목 (유닛 데이터 63 + KIND_MAP 2 + 병과별 목록 4 + 판정 함수 5 + DB 시험 14)
✘ 목재 부족 시 생산 막힘 — 모든 지갑·창고의 wood를 0으로 해도 생산이 성공함 (원인 조사 필요)
✘ 투석기(range 2) 2칸에서 공격 성공 — dist=2 확인했지만 공격 실패 (원인 조사 필요)
✔ 창병(range 1) 2칸에서 공격 불가 (TOO_FAR) — 사거리 판정은 동작함
전체 통과 (fails 카운트에 DB 시험 합산 전)
```

## 6. 미해결 (다음 지시서로)

- 목재 부족 시 생산이 막히지 않는 원인: war_produce의 wallet_role이 'army'로 확인되지만 wood=0인데도 통과 — 지갑이 아닌 다른 곳(inventory·country)에서 읽거나, cost 참조가 trade의 UNITS를 쓰는지 확인 필요
- 투석기 2칸 공격 실패 원인: dist=2 확인, range=2 확인, 전쟁 상태 설정 확인 — 다른 체크(NOT_AT_WAR·SHIELD 등)가 걸리는지 확인 필요
- attack_preview 미션 OPEN_STAGES에 'E4' 추가
- 기존 시험(rules·e3·e4 등)의 EXTRA_UNITS·BRANCH·BOSS 참조 갱신

커밋·푸시하지 않았습니다

