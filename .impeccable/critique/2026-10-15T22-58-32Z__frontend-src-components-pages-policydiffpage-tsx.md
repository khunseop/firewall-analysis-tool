---
target: policy diff 페이지
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/PolicyDiffPage.tsx"
target_fingerprint: "sha256:d59fd267c10e0389686c21fe29141f36c292f61407ed651912b7280ded7a7ece"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/PolicyDiffPage.tsx
timestamp: 2026-10-15T22-58-32Z
slug: frontend-src-components-pages-policydiffpage-tsx
---
Method: dual-agent (A: a1c84af7cf424f13a · B: ab938a566f70cd132)

# Policy Diff 페이지 critique — 22/40 (Acceptable, 55%)

한계: 0건 결과 구간만 화면 확인. 변경 있는 diff, 필터, 엑셀, 실시간 비교는 소스 분석만.

Heuristics: 1=2, 2=3, 3=2, 4=2, 5=2, 6=3, 7=2, 8=2, 9=2, 10=2.

Specificity: 범용 SaaS 어드민 문법. 도메인 가치(토큰 diff 칩, Running/Candidate 비교, 4시트 엑셀)를 시각 위계가 받쳐주지 못함.
Detector: CLI 0건. 브라우저 10건(low-contrast 5, undersized-ui-text 4, overused-font 1) — 모두 장비 선택 영역, 공유 DeviceSelector 가능성(추정). 소스의 text-10, /60 투명도, tr onClick은 미탐지.

Strengths: 토큰 단위 diff 칩; Running/Candidate 자동 짝짓기 + 4시트 엑셀; 선형 흐름.

Priority issues:
- [P1] 결과 위계 평평, 0건에서도 KPI 4칸 낭비 → 0건 한 줄 요약, KPI를 탭 배지로 통합 (layout, distill)
- [P1] 시점 선택 비효율 → 프리셋, From/To 교환, 변경 N건 힌트 (shape, harden)
- [P2] 위험도·순서 이동·장비 맥락 부재 → 위험 변경 강조, seq 이동 표기 (shape, bolder)
- [P2] 상태 피드백·오류 복구 부족 → 로딩 상태, 사용자 문장 오류, 재시도, 낡은 결과 배너 (harden, clarify)
- [P2] 접근성·가독성 → 12px 이상 실색 4.5:1, 행 button aria-expanded, combobox 패턴 (audit, typeset)

Personas: Alex(프리셋/URL 공유/키보드 없음), Sam(옵션 role 없음, 행 마우스 전용, 10px 저대비), 방화벽 운영 담당자(위험도 강조 없음, select-none).

Minor: (+0) 에메랄드, DiffRow key 충돌, /30 배경, 영/한 혼재, 엑셀 버튼=필터 pill 오인, 가상화 없음.
