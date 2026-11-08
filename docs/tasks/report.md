FAQ 전체와 war-rules.js의 핵심 규칙 수치를 시작 시 한 번 읽어 시스템 프롬프트에 포함했습니다.
지시된 행동 규칙을 적용하고 모델을 gemini-3-flash-preview로 변경했으며 {ROLE} 치환을 유지했습니다.
검증: npm run test:war:qna 전체 통과, 문법 검사·모의 프록시 요청 검증 통과.
실제 Gemini API 호출은 수행하지 않았으며 API 키와 .env 내용은 출력하지 않았습니다.
커밋·푸시 및 app/trade/ 수정 없음. 기존 docs/tasks/next.md 변경을 유지했습니다.
