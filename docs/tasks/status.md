# 진행 상황 (전쟁 버전, 브랜치 `war-version`)

마지막 정리: 2026-11-07

## 끝난 것
- 설계: `docs/war-design.md` (11장까지 확정, 8장 이미지·미리보기 확정)
- W0 테스트 틀 (`npm run test:war`), W1 가져오기 (`npm run test:war:import`)
- W2 학생 화면 뼈대 + 가짜 미리보기: Live Server `app/war/index.html?preview=1`
- 실제 데이터 미리보기 변환 도구: `private/`에 무역 백업 파일을 넣고 `npm run war:preview:real` → `app/war/preview/state-real.json`
  - 백업 파일과 변환 결과는 `.gitignore`로 깃허브에서 제외됨. 변환 결과에는 학생 이름·닉네임이 없음
  - 시험: `npm run test:war:real`

## 진행 중
- 실제 데이터 미리보기 화면 `?preview=real`과 병력·지형 한글 이름 [헬피] — 작업지시서 `docs/tasks/next.md`
  - 끝나면: 「헬피코드 끝」 → Claude가 `docs/tasks/report.md`와 git diff 검토 후 커밋

## 다음에 할 것
1. (위 작업이 남아 있으면) 검토·커밋, Live Server로 `?preview=real` 확인
2. W3 이동과 한 칸 한 유닛 — 서버 함수 [GPT], 화면 [헬피] (설계 4-3, 4-4)
   - 함께 고칠 것: 화면이 클 때 지도 아래 빈 띠
3. 이후 W4~W12 (`docs/war-design.md` 10장)

## 잊지 말 것
- 11/9 공개수업 전까지: 배포(gh-pages, publish-pages.sh) 금지, Supabase에 SQL 실행 금지, `claude/setup`에 커밋 금지
- codex exec에는 `-c 'windows.sandbox="unelevated"'`
- 실제 데이터에는 특수 부대(보스 유닛)가 있음: 설계 11장대로 「나라끼리 전투에는 못 씀」을 W4에서 반영
