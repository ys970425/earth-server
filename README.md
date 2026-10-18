# 지구 서버: 신발 기업 경영 시뮬레이터

6학년 사회 「시장경제와 국가 간 거래」 수업용 웹앱입니다. 모둠별 신발 기업을 운영하고, 숨겨진 환경점수를 공개해 기업의 사회적(환경적) 책임을 배우도록 설계했습니다.

- 학생 화면: `index.html` (모둠 → 이름 → 캐릭터 고르기)
- 교사 관제실: `admin.html` (학생 화면 오른쪽 아래 「교사」 버튼)
- 전자칠판 화면: `board.html` (관제실 오른쪽 위 링크)

## 처음 한 번만 하는 설정

### 1. Supabase 데이터베이스 만들기
1. Supabase 대시보드 → 왼쪽 **SQL Editor** → New query
2. `supabase/setup.sql` 내용을 전부 붙여넣고 **Run**
   - 여러 번 실행해도 안전합니다. (기존 기록은 지워지지 않음)
3. 새 쿼리 창에서 교사 비밀번호를 설정합니다. **이 줄은 저장소에 올리지 마세요.**
   ```sql
   select priv.set_admin_password('여기에_비밀번호');
   ```

### 2. 익명 로그인 켜기
Supabase 대시보드 → **Authentication → Sign In / Providers** → **Allow anonymous sign-ins** 켜고 저장.
(학생은 계정 없이 기기별로 자동 접속합니다.)

### 3. 접속 주소·키
`app/js/config.js`에 Project URL과 **Publishable key**(`sb_publishable_...`)만 넣습니다.
Secret key·service_role key·DB 비밀번호는 절대 넣지 않습니다.

### 4. Netlify 배포
- 방법 A (자동): Netlify → Add new site → Import from GitHub → 이 저장소 선택 → **Publish directory: `app`**, Build command는 비움
- 방법 B (수동): `app` 폴더를 Netlify Drop(app.netlify.com/drop)에 끌어다 놓기

### 5. 학생 명단
관제실 → **명단·연결** 탭 → `모둠,번호,이름` 형식으로 붙여넣고 저장 (엑셀 세 칸 복사도 됨).

## 수업 진행 (관제실 「진행」 탭의 큰 버튼을 차례로 누르기)

| 단계 | 내용 | 시점 |
|---|---|---|
| 0 기업 등록 → 1 1차 제작 → 2 1차 시장 → 3 1차 결과 | 신발 만들기·사기 | 화요일 |
| 4 2차 경영 → 5 2차 시장 → 6 정산 잠금 | 연구·공장 확장 | 화요일 끝 |
| 7 환경 공개 🚨 | 경보 + 환경 전환 지원금 500 | 공개수업 도입 |
| 8 3차 경영 → 9 3차 시장 | 재료 교체·친환경 투자, ★ 표시 | 활동 1 |
| 10 최종 결과 → 11 경영 원칙 | 지구 게이지 회복, 원칙 쓰기 | 활동 2·정리 |

- 리허설 후: **백업·복구** 탭에서 「초기화」 입력 → 명단·기기 연결은 그대로 두고 게임만 0단계로
- 실수로 단계를 넘겼으면: **백업·복구 → 단계 강제 이동** (정산 없이 숫자만 바뀜)
- 학생이 기기를 바꿨으면: **모둠** 탭 → 해당 학생 「연결 초기화」

## 테스트

```bash
# DB 함수 통합 테스트 (25명 전체 흐름)
npm i @electric-sql/pglite
node tests/db.test.mjs

# 브라우저 전체 흐름 (교사 1 + 학생 2 화면 + 봇 10명)
npm i playwright @supabase/supabase-js@2.116.0 @electric-sql/pglite
node tests/e2e/run.mjs   # 스크린샷: tests/e2e/shots/
```
