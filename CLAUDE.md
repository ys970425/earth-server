# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
상세 설명(설계 세부·예시·긴 목록)은 `docs/claude-detail.md`에 있다. 이 파일은 짧은 규칙만 담는다.

## 긴축 모드
1. 코드 직접 작성 금지 — 거의 모든 코드 작업은 헬피코드(또는 GPT)에게 맡긴다.
2. 검토는 git diff --stat + 시험 결과만. 파일 전체 읽기 금지.
3. Chrome 확인 대신 자동 화면 시험(tests/war/screen.test.mjs) 결과만 본다.
4. 작업지시서는 짧게 — 설계 내용은 "docs/war-design.md X장 참고"로.
5. 보고는 5줄 이내, 표 금지.

## 이 프로젝트
초등 6학년 사회 수업용 웹앱 「지구 서버」. 무역 앱(완성, app/trade)에서 키운 나라를 가져와 역할을 나눠 싸우고 협상하는 전쟁 앱 「지구 서버: 전쟁의 시간」(app/war)을 만드는 중. 기준 문서: `docs/war-design.md`.

## 주요 명령
- `npm run war:preview` — 미리보기 DB 생성 (브라우저 PGlite가 읽음, 깃허브에 없음. 열기 전 필수)
- `npm run war:preview:real` — 실제 백업 → 미리보기 (private/ 필요, Claude만 실행)
- `npm run war:config` — 규칙 숫자를 supabase/war/config.sql로 생성 (두 번 실행해 같아야 함)
- 시험: `npm run test:war:screen`(자동 화면 시험) / `place` / `e3` / `e4` / `e2` / `missions` / `act` / `select` / `import2` / `import` / `rules` / `war` / `real` / `preview-db` / `test:trade` — 전부 「전체 통과」여야 한다

## 아키텍처
**GitHub Pages(새 저장소 earth-war) + Supabase**(무역 앱과 같은 프로젝트의 `war` 스키마). 게임 로직은 전부 Postgres 함수(나라 단위 잠금, 한 칸 한 유닛은 DB 유일 조건), 화면은 `app/war/`, SQL은 `supabase/war/`, 시험은 `tests/war/`(PGlite). 자세한 것: `docs/claude-detail.md`.

## 작업 규칙 (핵심)
- 한국어 쉬운 말(「~해요」), 결론부터 짧게. 계획을 먼저 승인받은 뒤 실행.
- 기준 문서: docs/war-design.md. 설계가 바뀌면 같이 고친다.
- 모든 화면 하단 「myoLab(산쌤)」. 커밋 메시지 한국어로 짧게, 푸시는 사용자가 직접.
- 보고 끝에 「지금 푸시하세요 / 아직 푸시하지 마세요」 한 줄.

## 작업 분담 (핵심)
- Claude: 계획·검토·최종 확인만. 코드는 직접 쓰지 않는다.
- 헬피코드: 단순·분량 많은 일. 지시서는 docs/tasks/next.md에, 보고는 docs/tasks/report.md로 받는다. 커밋·푸시 금지(Claude가 검토 후 커밋).
- GPT(codex exec, `-c 'windows.sandbox="unelevated"'` 필수): 속도가 필요하면 GPT 우선, 헬피는 단순 문서·작은 수정만. 파일 겹치면 동시 진행 금지, 지시서에 상대 파일 명시.
- GPT는 Claude가 터미널에서 codex exec로 직접 실행해 맡긴다. 사용자에게 전달을 부탁하지 않는다. 사용자가 전달하는 건 헬피코드뿐.
- GPT 크레딧이 없으면 GPT 몫도 헬피코드에게 아주 구체적 지시서로.

## 금지 사항
- `app/trade/` 등 무역 앱 파일 수정 금지 (읽기만).
- `gh-pages` 브랜치·`tools/trade/publish-pages.sh` 금지. `claude/setup` 브랜치 직접 커밋 금지.
- Supabase 직접 접속·SQL 실행 금지 (교사가 정한 때에만).
- `C:\projects\nation` 무단 수정 금지. `private/` 폴더 열지 않기.
- 헬피코드·GPT: 커밋과 푸시 금지.

세부 내용: `docs/claude-detail.md`