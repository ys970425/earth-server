# 진행 상황 (「지구 서버: 전쟁의 시간」, 브랜치 `war-version`)

마지막 정리: 2026-11-09

## 끝난 것
- 설계: `docs/war-design.md` (「전쟁의 시간」, 바뀐 점은 13장)
- W0 테스트 틀, W1 가져오기, 실제 데이터 미리보기(`npm run war:preview:real` → `?preview=real`, 깃허브 제외), 체험 모드(`&play=1`)
- **E0** 규칙 파일 `war-rules.js`, 전투기·구축함 그림, 64px 그림 사본
- **버그 수정** 전투기 이름 「병력」→「전투기」, 탭 글씨 굵기, 미리보기 병력 78개로 확대 (screen 11개 통과)
- **E1** war 표 확장, 규칙 숫자 서버로(`npm run war:config`), 가져오기 v2(시설 배치·병과 지급·해군 지급 A·시장 3곳·평화로 시작), 행동 시작·잠금 `act_start`(두 나라는 번호순 한 번에), 바뀜 번호 `bump`
- **E2** 접속·역할 고르기·역할별 화면 틀, 바뀐 것만 받기(`war_poll`), 교사 관제실 틀(가져오기·지급 결과·역할 현황·결석), 미리보기 가짜 서버(`&as=나라:역할`, `&size=4`)
- **②** 미리보기를 **브라우저 PGlite(진짜 SQL)**로 전환 (가짜 서버 삭제, 열기 전 `npm run war:preview`)
- **E3** 한 칸 한 유닛 DB 강제(`war.place_unit`, 「먼저 온 병력이 있어요」), 이동 `war_move`(땅·바다·공군 규칙, 공군은 적 병력 위 통과 A, 노동자 이동력 2), 지휘권 넘기기 `war_transfer`, 내 병력·지휘권 탭, 미리보기에서 눌러서 이동
  - 2026-11-08 Chrome 원격 조작으로 `?preview=real&as=1:army`에서 창병 이동 확인 (남은 이동 3 → 2, 콘솔 오류 0)
- **①a** 시장 섬 그리기(`setData({ markets })`), 미션 목록 20개(`war-rules.js`→`war.config`), 미션 서버(`war_mission_done`·`war_missions`·`war_admin_missions`, `war.mission_done` 표)
- **①b** 화면 두 탭(지도 / 우리 나라), 역할 고르기 전에도 지도 표시, 튜토리얼 미션 화면(행동 성공 뒤 기록·「미션 완료!」), 관제실 미션 현황 표, 지도에 시장 섬 넘기기·칸 정보에 시장 표시
- 시험: `test:war:place`·`e3`·`e2`·`act`·`import2`·`import`·`rules`·`war`·`real`·`trade` 모두 통과
- **QnA AI 봇** (`app/war/qna/`, `tools/war/qna-proxy.mjs`): 낱말 봇을 예비로 두고 Gemini AI 답변 추가. 프록시(`npm run war:qna-proxy`, 포트 3717)가 낱말 봇으로 FAQ 찾아 AI에게 전달 → 쉬운 말로 답변. 모델: `gemini-3.1-flash-lite`. 키: `.env`의 `GEMINI_API_KEY`. 시험: `npm run test:war:qna` 23개 통과. 11/9 이후: Supabase Edge Function으로 이전 예정(`docs/tasks/qna-edge-fn.md` 참고)

## 진행 중
- 없음

## 확인할 것 (다음 시작할 때)
- 점령 시험(`점령_후_땅색_변화`): 전쟁 선포(E8) 전이라 NOT_AT_WAR 반환 → poll 타일 owner 필드 확인으로 대체 중, E8 완성 후 실제 점령으로 교체.
- OPEN_STAGES에 E4 추가 필요: 현재 E4 단계가 열린 단계 목록에 포함 안 됨, 배포 전 확인 요.
- (해결 2026-11-08) 「내 병력」 62줄·남의 병력 선택 버그: 화면 목록이 나라를 확인하지 않았음 → `WAR_RULES.isMyUnit`(우리 나라 + 내 조종 역할)으로 통일, 남의 병력을 누르면 「칸 정보」에 까닭만 표시. 시험 `npm run test:war:select`. Chrome으로 육군 9줄 = 1번 나라 육군 9부대, 다른 나라·우리 해군 선택 안 됨 확인
- `?preview=real` 실제 데이터 파일은 서버 쪽이 바뀌면 `npm run war:preview:real`로 다시 만들어야 함 (헬피코드는 `private/`를 열 수 없으므로 Claude가 만듦)

## 다음에 할 것 (`docs/war-design.md` 10장)
1. **E5 턴 진행** — `war_next_turn`, 타이머·다음 턴·일시정지·시간 조절(관제실), 학생 화면 위쪽 턴 번호·남은 시간 (지시서: docs/tasks/task-e5-turn.md)
3. E6 합참 예산·공병사령관 / E7 병력 생산 / E8 외교 나머지(동맹·무역) / E9 시장 / E10 첩보 / E11 칠판·의견 보내기 / E12 25명 모의 실행 / E13 배포
- GPT 크레딧이 없으면 GPT 몫도 헬피코드에게 아주 구체적인 지시서로 (CLAUDE.md)

### QnA 봇 개선 (나중에)
- AI에게 넘기는 자료를 faq 일부 → 설계 문서 요약 전체 + 병력·건물 표로 확대 (특수부대 생산 같은 질문 답변)
- 횟수 제한: 교사 무제한, 학생 1분 5회로 조정 검토
- 더 좋은 무료 모델이 나오면 `gemini-3.1-flash-lite`에서 교체

## 잊지 말 것
- **미리보기를 열기 전에 `npm run war:preview`** (브라우저 PGlite가 쓰는 DB 파일, 깃허브에 없음)
- Supabase 설치(`war`·`feedback` 스키마)는 교사가 정한 때에만. gh-pages·`publish-pages.sh`·`claude/setup` 건드리지 않기
- 배포는 새 저장소 `earth-war` (생성 승인됨, E13에서 만듦)
- 담당은 헬피코드 우선, 어려운 것(여러 표·잠금이 얽힌 서버 함수, 모의 실행)만 GPT. codex exec에는 `-c 'windows.sandbox="unelevated"'`
- 웨일북 확인: Chrome CPU 4x 느리게, 또는 Live Server Host 0.0.0.0 + PC IP (설계 8-4)

## 설치 후 확인 (E2 이후, 실제 Supabase에 설치한 뒤에 하는 목록)
1. `earth-war`에서 무역 앱 로그인이 이어지는지 (같은 웨일북·같은 브라우저)
2. 웨일북 2대 동시 접속: 같은 역할을 동시에 고르면 한 명만 성공
3. 한쪽 웨일북에서 역할을 고르면 다른 웨일북에 4초 안에 반영
4. 교사 관제실에서 실제 가져오기와 지급 결과 표
5. 25명이 4초마다 받을 때 응답 크기·서버 부담 (무료 요금제 한도)
6. 교사가 무역 관제실 로그인 상태로 전쟁 관제실이 열리는지
7. 웨일북 2대에서 **다른 나라 병력 두 개를 같은 빈칸으로 동시에** 이동 → 한쪽만 성공하고 다른 쪽은 「먼저 온 병력이 있어요」
