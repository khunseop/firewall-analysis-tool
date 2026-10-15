---
target: Devices 페이지
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/DevicesPage.tsx"
target_fingerprint: "sha256:a78234a746fe94bec98a99448b48beeb92d89d680e3b985a18bd335e4aeaeeec"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/DevicesPage.tsx
timestamp: 2026-10-15T13-44-57Z
slug: frontend-src-components-pages-devicespage-tsx
---
# Devices 페이지 critique (dual-agent, 소스 기반)

Score 24/40 (Acceptable). detector 0건, tsc/eslint 클린. 단 9~10px 텍스트 26곳, aria-label 0개, 하드코딩 색상 32회는 detector가 못 잡음.

Heuristics: 1=3, 2=3, 3=2, 4=2, 5=2, 6=2, 7=2, 8=2, 9=2, 10=2.

## Priority Issues
- [P1] 선택 툴바 위계 붕괴 (DevicesPage.tsx:524-580) -> distill, layout
- [P1] 고위험 작업(삭제/연결 테스트/일괄 동기화) 영향 범위·결과표 부재 (DevicesPage.tsx:288-323) -> harden, clarify
- [P1] 장비 등록: 저장 전 검증/연결 확인 없음, 31필드 4탭 (DeviceFormDialog.tsx) -> onboard, harden
- [P2] 동기화 실패 사유가 title 툴팁에만, KPI 비클릭 (deviceColumns.tsx:15-29) -> clarify, quieter
- [P2] 컬럼 11개 동일 비중 (deviceColumns.tsx) -> distill
- [P3] 접근성/일관성 정리 -> polish, typeset

## Strengths
직접 추출 상태 패널, *_manual 패턴, 장비 중심 컨텍스트 이동.

## Questions
건강 상태 판단 vs CRUD, 연결 확인 후 저장, 삭제 시 영향 범위 한 줄.
