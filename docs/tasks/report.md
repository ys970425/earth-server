# 작업 보고서 — ④ 자동 화면 시험 + CLAUDE.md 압축

- 날짜: 2026-11-08
- 브랜치: `war-version` 확인 후 작업
- 결과: 부분 완료 — **실패: CLAUDE.md 쓰기가 자동 권한 검토에서 두 번 막힘(사용자 승인 후에도 동일)** — 압축본 내용은 준비돼 사용자가 직접 붙여넣기로 완료해야 함. docs/claude-detail.md 작성은 완료

## 1. 자동 화면 시험 (`tests/war/screen.test.mjs`, 새)

- 정적 서버: python이 있어 `python -m http.server 5599`(백그라운드, 종료까지 시험 내에서 처리)로 띄우되, 없으면 node 내장 http 서버로 자동 대체
- 지시서 셀렉터를 실제 화면에 맞게 적용: 지도 `canvas.hexmap`, 병력 목록 `.war-units-list .war-unit-row`, 완료 표시 `.war-flash`(「미션 완료」), 미션 현황은 「튜토리얼 미션 현황」 패널의 표 행 수
- 5항목 결과: ✔ 역할_전_지도 / ✔ 역할_후_내병력(9줄) / ✔ 미션_완료(병력 선택 → 캔버스의 갈 수 있는 칸 픽셀을 찾아 클릭 → 「미션 완료」) / ✔ 시장_섬_그림(markets 3곳) / ✔ 관제실_미션_표(31줄)
- 관제실 주소(산쌤 수정): `index.html?preview=real&admin=1`을 **먼저** 열지만, 앱이 아직 이 주소에서 관제실을 표시하지 않아(학생 화면이 뜸) `admin.html?preview=real`로 확인했음을 출력에 명시 — index.html에 admin=1 지원이 필요하면 별도 지시서가 필요합니다
- Puppeteer는 devDependencies에 추가했고, 브라우저 내려받기가 보안 정책에 막혀 시스템 Chrome(`channel: 'chrome'`)을 사용

## 2. CLAUDE.md 압축

- 상세 내용을 `docs/claude-detail.md`(새)로 옮겼습니다 — 여기에 아키텍처를 **GitHub Pages(새 저장소 earth-war) + Supabase**로 바로잡아 두었습니다 (Netlify 표기 없앰)
- CLAUDE.md 새로 쓰기(긴축 모드·주요 명령·핵심 규칙, 200줄 이내)는 권한 검토에서 막혀 **미완료** — 승인 후 같은 내용으로 다시 시도합니다

## 완료 조건

- `node --check tests/war/screen.test.mjs` 통과, 실제 실행 「전체 통과」(5항목 ✔)
- `CLAUDE.md` 200줄 이하 — **미달 (미수정, 권한 막힘)** / `docs/claude-detail.md` 존재 ✔
- `git status --short`: package.json·package-lock.json(puppeteer 추가)·tests/war/screen.test.mjs·docs/claude-detail.md·report.md — 허용 목록 밖 없음

커밋·푸시하지 않았습니다
