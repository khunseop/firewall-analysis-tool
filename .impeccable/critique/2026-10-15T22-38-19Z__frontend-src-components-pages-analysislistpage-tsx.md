---
target: analysis
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/AnalysisListPage.tsx"
target_fingerprint: "sha256:f17666f5ef887174cc0cfeea7a27189bfebfba5971f7b967e3854c5f7ba8a9aa"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/AnalysisListPage.tsx
timestamp: 2026-10-15T22-38-19Z
slug: frontend-src-components-pages-analysislistpage-tsx
---
Method: dual-agent (A: af880b6 source-only · B: adcef37 detector; browser metrics re-measured in main tab)

# 분석 페이지 크리틱 (재평가)

Score 27/40 (이전 17/40). 1 시스템상태 3 · 2 현실일치 3 · 3 통제 3 · 4 일관성 2 · 5 오류예방 3 · 6 인식 2 · 7 효율 2 · 8 미니멀 3 · 9 오류복구 4 · 10 도움말 2

Detector: 0 findings (analysis-modules/ 미스캔). 실측: 11px 텍스트 89개, 접근 이름 없는 요소 0, 1440px 가로 넘침 없음, 행 63.5px, 표 앞 탭 정지점 17, tr 포커스 불가(tabIndex -1, cursor pointer). 대비 1.06 "분석 실행"은 그라데이션 거짓 양성.

Specificity: 문구는 제품 특화, 형태는 일반 관리자 화면.

Priority issues
- [P1] 장비별 현황판 기본 접힘 + 접힌 줄에 요약 없음 → 접힌 줄에 "실패·오래됨·미실행" 요약, 첫 방문 펼침 (clarify, layout)
- [P1] 현황판 셀 상태 구분 약함: "—" 모호, 실패는 색+글자뿐 (audit, colorize)
- [P2] 행 클릭 tr 포커스 불가, 재실행·삭제 11px 작은 조작 영역, 표까지 탭 17회 (harden)
- [P2] 장비·기간 필터, 정렬 없음, 클라이언트 페이지네이션 (layout)
- [P3] "기준" 칸이 거의 "기록 없음" 반복 소음, 문구 3종 혼재 (clarify)

Personas: Alex(단축키·필터·정렬·일괄 재실행 없음), Sam(aria-live 틱 재낭독 추정, tr 키보드 불가, 11px), 운영 담당자("30일 넘게 안 본 장비" 질문의 답이 숨은 현황판에 있음)

Minor: 재시도 배너 복붙, 상세 calc(100vh-380px) 취약, Excel 파일명 시각 없음, 그라데이션 주 버튼, 프로젝트 행 열 구조 불일치

Questions: 첫 화면을 "오래됨·실패" 작업 목록으로? / 프로젝트 행은 단계 진행 형태로? / 분모 없는 "정상 0건"을 믿을 수 있나?
