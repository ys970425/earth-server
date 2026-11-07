# 작업지시서: 역할 변경 마무리 + E0 (규칙 파일·전투기 그림·64px 그림)

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`** (`git branch --show-current`로 확인, 다르면 멈추고 보고)
- 기준 문서: `docs/war-design.md` (「지구 서버: 전쟁의 시간」)

## ⚠️ 꼭 지킬 것
- **커밋과 푸시를 하지 않는다.** 커밋은 Claude가 검토 후에 한다.
- `C:\projects\nation`은 **읽기만** 한다 (사본만 만든다). `private/` 폴더는 열지 않는다.
- `app/trade/` 아래 기존 파일(`img/`, `js/`, `css/` 등)과 `supabase/`, `tools/trade/`, `tests/trade/`는 고치지 않는다. 새 그림은 `app/trade/assets/` 아래에만 만든다.

---

## 1부. 설계 문서 역할 변경 마무리 (`docs/war-design.md`)

역할 변경(첩보부장 없앰, 공병사령관 추가, 4·5명 모둠, 정찰병 첩보 공유)은 2장·2-1·4-1·5-3·8-1·10장·13장에 **이미 반영되어 있다.** 아래만 한다.

1. **특산 공장 수리 규칙 바꾸기 (5-3장):** 지금 「특산 공장은 원래 그 특산을 가진 나라만 수리」를 다음으로 바꾼다.
   - 점령한 나라도 특산 공장을 수리할 수 있다. 단, **그 공장이 만드는 특산 자원 1개**가 더 필요하다 (예: 반도체 공장 → 반도체 1개). 비용은 다른 시설처럼 처음 짓는 비용의 절반 + 특산 1개.
   - 13장 기록 표에도 한 줄로 남긴다.
2. **문서 전체 점검:** 「첩보부장」이 13장 기록 말고 남아 있지 않은지, 노동자·정찰병·수리·건물 짓기를 「합동참모의장」이 한다고 적힌 곳이 남아 있지 않은지 (4명 모둠 설명은 제외) 찾아 고친다. `docs/tasks/status.md`도 같은 기준으로 점검한다.

## 2부. E0 (설계 10장)

### ① 규칙 파일 `app/war/js/war-rules.js` (새)
브라우저(`window.WAR_RULES`)와 Node(`module.exports`) 둘 다에서 쓸 수 있게 `app/trade/js/rules.js`와 같은 방식으로 만든다. 무역 앱 `rules.js`는 고치지 않고, 필요한 값은 그 파일의 `RULES`를 읽어서 계산한다. 넣을 것 (숫자는 설계 문서 2~7장, 11장 기준):
- `ROLES`: 합동참모의장(`chief`), 공병사령관(`engineer`), 육군(`army`)·해군(`navy`)·공군(`air`) 참모총장 — 이름, 할 수 있는 일 목록, 화면 메뉴 목록. 4명 모둠이면 `chief`가 `engineer` 메뉴를 함께 가진다는 표시
- `BRANCH`: 모든 `RULES.UNITS` 종류 + `destroyer`, `fighter` → `army` / `navy` / `air`, 그리고 `worker`·`scout` → `civil`. `t_marine`(상륙 기갑부대)은 `army`
- `EXTRA_UNITS`: 구축함 `destroyer`(근접 바다, 힘 60, 이동 6, 비용 코인 100·강철 2·연료 1·식량 2, 그림 `units/destroyer.png`), 전투기 `fighter`(공군, 힘 40, 이동 6, 사거리 2, 비용 코인 70·알루미늄 1·연료 1, 그림 `units/fighter.png`)
- `BOSS`: 특수 부대 힘 = (특수 부대가 아닌 병력 힘 최댓값 + 5)를 계산하는 함수, 피해 상한 60
- `BUILDING_CLASS`: 기본(시장·병영·곡물 창고·광장·항구) / 공장(`FACTORIES` 전부) / 고등(`ADVANCED` 전부), 그리고 나라별 특산 공장 (`SPECIALTY`에서 읽기)
- `TILE_IMP`: 점령되면 파괴 = 광산·유정·농원 / 그대로 = 농장·벌목장·채석장
- `MARKET`: 특산 = `RULES.STRAT_OF`, 관세 = 기준가의 0.5배(버림), 특산이 없으면 관세 2배, 시작 재고 4개씩, 도시국가 3곳 위치 후보
- `TURN`: 기본 180초, 최소 60, 최대 600 / `POLL_MS`: 4000 / `CAPITAL`: 방어 20, 체력 200 / `REPAIR`: 비용 0.5배, 특산 공장은 특산 1개 더 / `SHIELD_TURNS` 3 / `MAX_CITY_LOSS` 2 / `PEACE_TURNS` 3

### ② 규칙 파일 시험 `tests/war/rules.test.mjs` (새) + `package.json` scripts `"test:war:rules"`
- `RULES.UNITS`의 모든 종류와 `destroyer`, `fighter`가 `BRANCH`에 있음, `t_marine`은 `army`
- 무역 앱의 모든 건물(`BUILDINGS`, `FACTORIES`, `ADVANCED`)이 `BUILDING_CLASS`에 꼭 한 번 들어 있음
- 무역 앱의 모든 타일 시설(`IMPROVE`)이 `TILE_IMP`의 파괴/그대로 중 하나에 들어 있음
- 특수 부대 힘이 95, 역할이 5개
- 마지막 줄 「전체 통과」, 실패하면 종료 코드 1

### ③ 전투기 그림 자르기 → `app/trade/assets/units/fighter.png` (새)
- 원본: `C:\projects\nation\archive\sheet_units_modern_sea_air.png` (위 줄: 구축함·전함·항공모함·잠수함, 아래 줄: **전투기**·수송기·드론·강화복). 아래 줄 맨 왼쪽 전투기만 자른다.
- 결과: 256×256 투명 PNG, 그림이 가운데 아래쪽에 오게. 옆 그림 조각이 섞이면 지운다 (「가장 큰 덩어리만 남기기」 방법). 이미 있는 `app/trade/assets/units/destroyer.png`와 같은 방식.
- Python PIL이 없으면 PowerShell `System.Drawing`을 쓴다. 작업 뒤 `C:\projects\nation`에서 `git status --short`로 바뀐 것이 없음을 확인한다.

### ④ 64px 그림 사본 도구 `tools/war/make-small-images.ps1` (새) + 결과 `app/trade/assets/small/`
- 읽기: `app/trade/img/terrain`, `img/res`, `img/unit`, `img/bld`, `img/city` 의 PNG, 그리고 `app/trade/assets/units/*.png`, `app/trade/assets/cities/neutral_*.png`
- 쓰기: `app/trade/assets/small/` 아래 같은 하위 폴더 이름으로 (`terrain/`, `res/`, `unit/`, `bld/`, `city/`). 긴 변 64px, 비율 유지, 투명 유지. 단 지형(육각) 그림은 가로 64px.
- 두 번 실행해도 같은 결과. 마지막에 파일 수와 전체 용량을 출력한다.
- `app/war/js/war-hexmap.js`의 그림 경로를 `../trade/img/...` → `../trade/assets/small/...`로 바꾼다 (바꾼 줄에 `// war:` 주석). 구축함·전투기도 `small/unit/`에서 읽는다.

## 3. 고쳐도 되는 파일 (이것만)
`docs/war-design.md`, `docs/tasks/status.md`, `app/war/js/war-rules.js`(새), `app/war/js/war-hexmap.js`(그림 경로만), `tests/war/rules.test.mjs`(새), `package.json`(scripts 한 줄), `tools/war/make-small-images.ps1`(새), `app/trade/assets/units/fighter.png`(새), `app/trade/assets/small/`(새), `docs/tasks/report.md`

## 4. 완료 조건 (직접 실행)
```bash
node tests/war/rules.test.mjs        # 전체 통과
node tests/war/db.test.mjs           # 전체 통과
node tests/war/import.test.mjs       # 전체 통과
node tests/war/real-preview.test.mjs # 전체 통과
node tests/trade/db.test.mjs         # 전체 통과
git status --short                   # 3번 목록 밖의 파일 변경 없음
```
- 화면: Live Server `app/war/index.html?preview=1` 지도가 64px 그림으로 보이고, F12 콘솔에 빨간 오류 없음 (확인 못 하면 「미확인」)
- `C:\projects\nation`에서 `git status --short` 결과가 비어 있음

## 5. 보고 (`docs/tasks/report.md`에 덮어쓰기)
1부·2부 각각 바뀐 내용 3줄 이내, 시험 결과 마지막 줄들, `small/` 파일 수·용량, 전투기 그림 확인 결과, 못 한 것은 맨 위 「실패: 이유」, 마지막 줄 「커밋·푸시하지 않았습니다」
