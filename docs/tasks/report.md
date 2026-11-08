Gemini QnA 프록시(3717), 입력 검증·CORS·IP별 분당 3회/일 30회 제한을 구현했습니다.
브라우저에 AI 우선 응답, 3초 타임아웃 후 기존 낱말 봇 대체, 답변 출처 표시를 추가했습니다.
실행 명령: npm run war:qna-proxy (외부 패키지 추가 없음).
검증: npm run test:war:qna 전체 통과, 프록시 모의 검증·문법 검사 통과. 실제 Gemini 호출은 수행하지 않았습니다.
커밋·푸시 및 app/trade/ 수정 없음. 기존 docs/tasks/next.md 변경은 유지했습니다.
