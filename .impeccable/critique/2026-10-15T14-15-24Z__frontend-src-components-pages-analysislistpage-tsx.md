---
target: Analysis 페이지
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/AnalysisListPage.tsx"
target_fingerprint: "sha256:85c6718cbc231225e669900f240d3ee94663c32ef6f7239e3f5ba32cb4e1ddcd"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/AnalysisListPage.tsx
timestamp: 2026-10-15T14-15-24Z
slug: frontend-src-components-pages-analysislistpage-tsx
---
# Analysis 페이지 critique (dual-agent, 소스 기반)

Score 17/40 (Poor). detector 0건, tsc -b/eslint 클린. aria-/role= 0건, isError 0곳, text-10 9곳, 목록 자동 갱신 없음은 detector가 못 잡음.
(A의 "진행률 데이터가 있는데 화면에서 안 쓴다" 주장은 확인 안 됨: 분석 API/모델에 진행률 필드 없음 — P1을 자동 갱신/진행 중 표시로 재작성)

Heuristics: 1=1, 2=3, 3=1, 4=2, 5=2, 6=2, 7=1, 8=3, 9=0, 10=2.

## Priority Issues
- [P0] 조회 실패가 "실행된 분석이 없습니다"/"저장된 분석 결과가 없습니다"로 표시, 성공 0건과 실패 미구분 (AnalysisListPage.tsx:297,419-422; AnalysisDetailPage.tsx:133-138,183,244-247) -> harden
- [P1] 목록 자동 갱신 없음, 진행 중 본문 비어 있음 (List:271-295; Detail:241) -> layout
- [P1] unused_ng_policy 라이브 접속 사전 경고 없음 (unusedNgPolicy.tsx:18; List:216-225) -> clarify
- [P2] 행에 건수/파라미터 없음, 재실행/취소 없음, 클릭 전용 tr (List:437-467) -> adapt, layout
- [P2] 삭제 확인 문구 빈약, 200건 상한 무고지 (Detail:159; List:234,356) -> clarify

## Strengths
모듈 레지스트리, 삭제 확인(프로젝트), 결과와 정책 페이지/Excel 연결.

## Questions
작업 이력 vs 정책 건강 현황, 분석→삭제 워크플로우 연결, 0건의 증거.
