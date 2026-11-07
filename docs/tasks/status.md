# 진행 상황 (전쟁 버전, 브랜치 `war-version`)

마지막 정리: 2026-11-07

## 끝난 것
- 설계: `docs/war-design.md` (11장까지 확정, 8장 이미지·미리보기 확정)
- W0 테스트 틀 (`npm run test:war`), W1 가져오기 (`npm run test:war:import`)
- W2 학생 화면 뼈대 + 가짜 미리보기: Live Server `app/war/index.html?preview=1`
- 실제 데이터 미리보기 변환 도구: `private/`에 무역 백업 파일을 넣고 `npm run war:preview:real` → `app/war/preview/state-real.json`
  - 백업 파일과 변환 결과는 `.gitignore`로 깃허브에서 제외됨. 변환 결과에는 학생 이름·닉네임이 없음
  - 시험: `npm run test:war:real`
- 실제 데이터 미리보기 화면: Live Server `app/war/index.html?preview=real` (초록 띠, 파일이 없으면 안내 문구)
- 화면의 병력·지형·자원·시설 이름 모두 한글 (영어 대신 「병력」 등으로 표시)
- 의견 보내기 설계: `docs/war-design.md` 12장
- 체험 모드 (미리보기 전용, 브라우저 메모리에서만): 처음 상태로 / 병력 이동(이동력·산·한 칸 한 유닛) / 공격 미리보기 「체험용 계산」 / 턴 넘기기
  - 확인 못 한 것: 클릭 조작은 사람이 직접 눌러 확인해야 함 (자동 확인은 화면 표시·오류 없음까지)
  - 정식 W3·W4에서는 이 체험용 계산을 서버 함수로 옮기고 시험을 붙일 것 (지금은 화면 안 계산)

## 진행 중
- 없음

## 다음에 할 것
순서: **의견 보내기 → W3**

1. 의견 보내기 (`docs/war-design.md` 12장) — F1 서버 SQL·시험 [GPT] → F2 학생 버튼·입력 창 [헬피] → F3 교사 목록·「AI에게 넘기기」 [헬피]
   - 11/9 전에는 미리보기(브라우저 안 저장)로만. F4 서버 연결은 11/9 이후
2. W3 이동과 한 칸 한 유닛 — 서버 함수 [GPT], 화면 [헬피] (설계 4-3, 4-4)
   - 함께 고칠 것: 화면이 클 때 지도 아래 빈 띠
3. 이후 W4~W12 (`docs/war-design.md` 10장)

## 잊지 말 것
- 11/9 공개수업 전까지: 배포(gh-pages, publish-pages.sh) 금지, Supabase에 SQL 실행 금지, `claude/setup`에 커밋 금지
- codex exec에는 `-c 'windows.sandbox="unelevated"'`
- 특수 부대: 설계 11장 변경(전투 참여, 힘 95, 한 번 피해 최대 60). 체험 모드에만 반영됨 → W4에서 `war.admin_import`·서버 전투에 옮기고 시험 추가
