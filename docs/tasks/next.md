# 작업지시서 (헬피코드): ④ 자동 화면 시험 + CLAUDE.md 압축

- 저장소: `C:\projects\earth-server`, 브랜치 **`war-version`**
- 커밋·푸시 금지, Supabase 접속 금지, 무역 앱 파일 수정 금지.

---

## 1. 자동 화면 시험 (`tests/war/screen.test.mjs`)

headless Chrome(Puppeteer)으로 `http://localhost:5599/app/war/index.html?preview=real`을 열고,
아래 5가지를 순서대로 확인해서 결과를 한 줄씩 출력한다.

**서버 시작 방법**: 시험 시작 전 `python -m http.server 5599 --directory C:/projects/earth-server` 를 백그라운드로 띄우고,
시험 끝나면 종료. Puppeteer는 `import puppeteer from 'puppeteer'` (npm install puppeteer 필요하면 package.json devDependencies에 추가).

**확인 항목:**
1. `역할_전_지도`: 페이지 열자마자(역할 선택 없이) `.hex-map canvas` 또는 `#map canvas`가 존재하면 ✔
2. `역할_후_내병력`: 「우리 나라」 탭 클릭 → 나라1 클릭 → 「육군」 클릭 → 2초 대기 → 역할 목록 UI에서 `.unit-list li` 개수 > 0 이면 ✔
3. `미션_완료`: 역할 고른 뒤 지도에서 아무 내 병력 클릭 → 이웃 칸으로 이동 → `.toast` 또는 텍스트 「미션 완료」가 1초 안에 보이면 ✔. **실패해도 나머지 항목은 계속 진행.**
4. `시장_섬_그림`: 지도 canvas 위에서 `S.map` 또는 poll data에 `markets` 배열 길이 3 이면 ✔ (window 변수로 확인)
5. `관제실_미션_표`: `admin.html?preview=real` 열기 → `table tbody tr` 개수 > 0 이면 ✔

출력 형식:
```
  ✔ 역할_전_지도
  ✔ 역할_후_내병력
  ...
전체 통과  (또는)  실패 N개
```

`process.exit(실패수 ? 1 : 0)`.

`package.json` scripts에 `"test:war:screen": "node tests/war/screen.test.mjs"` 추가.

---

## 2. CLAUDE.md 압축

현재 `CLAUDE.md`는 너무 길어서 매 세션 토큰을 낭비한다. 다음과 같이 줄인다.

**작업:**
1. 현재 `CLAUDE.md`를 읽고, 상세 설명(설계 세부·예시·긴 목록)을 `docs/claude-detail.md`로 옮긴다.
2. `CLAUDE.md`를 아래 구조로 **새로 쓴다** (200줄 이내):

```
# CLAUDE.md
...세션 시작 시 읽는 짧은 규칙...
```

포함할 내용:
- **긴축 모드 규칙** (맨 위):
  ```
  ## 긴축 모드
  1. 코드 직접 작성 금지 — 거의 모든 코드 작업은 헬피코드(또는 GPT)에게 맡긴다.
  2. 검토는 git diff --stat + 시험 결과만. 파일 전체 읽기 금지.
  3. Chrome 확인 대신 자동 화면 시험(tests/war/screen.test.mjs) 결과만 본다.
  4. 작업지시서는 짧게 — 설계 내용은 "docs/war-design.md X장 참고"로.
  5. 보고는 5줄 이내, 표 금지.
  ```
- 프로젝트 한 줄 소개 (무엇인지)
- 주요 명령 (`npm run war:preview`, `npm run war:preview:real`, `npm run war:config`, 각 시험 명령)
- 아키텍처 한 줄 (Netlify + Supabase, app/war, supabase/war, tests/war)
- 작업 규칙 핵심만 (한국어 쉬운 말, 계획 먼저 승인 뒤 실행, design.md 기준, 하단 myoLab 표기)
- 작업 분담 핵심만 (헬피=단순 고량, GPT=동시성·서버 핵심, 헬피 지시서→docs/tasks/next.md)
- 금지 사항 (무역 앱 수정 금지, gh-pages 커밋 금지, Supabase 직접 접속 금지, nation 무단 수정 금지)
- 세부 내용은 `docs/claude-detail.md` 참고 링크

---

## 고쳐도 되는 파일
`tests/war/screen.test.mjs` (새 파일), `package.json` (scripts + devDependencies), `CLAUDE.md`, `docs/claude-detail.md` (새 파일), `docs/tasks/report.md`

## 완료 조건
- `node --check tests/war/screen.test.mjs` 통과 (실제 실행은 선택)
- `CLAUDE.md` 200줄 이하
- `docs/claude-detail.md` 존재
- `git status --short`에 위 목록 밖 변경 없음

## 보고 (`docs/tasks/report.md` 덮어쓰기)
5줄 이내, 못 한 것은 맨 위 「실패: 이유」, 마지막 줄 「커밋·푸시하지 않았습니다」
