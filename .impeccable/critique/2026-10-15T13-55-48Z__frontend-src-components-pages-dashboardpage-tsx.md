---
target: Dashboard 페이지
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/DashboardPage.tsx"
target_fingerprint: "sha256:9cfc20b13a36e0720c686f3ebf3cbbabb23252810599ba152a2068ed9ea26875"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/DashboardPage.tsx
timestamp: 2026-10-15T13-55-48Z
slug: frontend-src-components-pages-dashboardpage-tsx
---
# Dashboard 페이지 critique (dual-agent, 소스 기반)

Score 21/40 (Acceptable). detector 0건, tsc -b/eslint 클린. text-10 15곳, aria-/role= 0건, 차트 접근성 옵션 없음, hex 1곳은 detector가 못 잡음.
(Assessment A 본문은 22로 적었으나 항목 합은 21: 2+3+2+3+2+2+2+2+1+2)

Heuristics: 1=2, 2=3, 3=2, 4=3, 5=2, 6=2, 7=2, 8=2, 9=1, 10=2.

## Priority Issues
- [P0] 조회 실패가 "장비 0/등록된 장비가 없습니다"로 표시 (DashboardPage.tsx:215-219, 314-319, 542) -> harden
- [P1] 동기화 상태 컬럼 없음, 경보에서 장비로 직행 불가, stale/미동기화 경보 누락, 테이블이 폴드 아래 (:182-206, 309, 321) -> layout, clarify
- [P2] KPI/칩 카드 인지 부하 (:378-462) -> distill
- [P2] 추이 차트 제목/내용 불일치, smooth curve, 임계치 선 없음, 기본값 비어 있음 (:468, 282, 291, 494) -> colorize, clarify
- [P3] aria-label/label/aria-live, 대비 (:380, 520, 527) -> audit

## Strengths
경보 카드 도메인 로직, CapacityCell, 폐쇄망 대응 실시간 갱신.

## Questions
첫 화면의 첫마디, 칩 카드의 수혜자, 임계치가 차트·경보에 없는 이유.
