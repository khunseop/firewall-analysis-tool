---
target: policies 편집모드 모달
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/policy-builder"
timestamp: 2026-10-19T00-52-42Z
slug: frontend-src-components-pages-policy-builder
---
Method: dual-agent (A: aac22f7f22aa964cb · B: af56d2df4524e62a1)

# Policies 편집모드 모달 critique — 24/40 (Acceptable)

Heuristics: 1=3 2=3 3=2 4=2 5=2 6=2 7=3 8=2 9=3 10=2. Detector: 0 findings.

Priority issues
- [P1] 붙여넣은 정책 순서 미보장 (Promise.all 저장 + 패널 id순 표시) — 순차 저장 + 패널 정렬로 수정, 순번 표시는 남음
- [P1] 편집 메뉴 구조/시각 완성도 (항목별 상이한 스타일, w-40 고정, 서브메뉴 이탈, 비활성 사유 없음, 닫은 뒤 포커스 미복귀)
- [P2] 붙여넣기 모달이 모든 단계를 한 스크롤에 평면 나열
- [P2] 접근성: 이름 없는 input 2개, label htmlFor 누락, 아이콘 버튼 aria-label 누락, radiogroup 없음, 영어 "Close"
- [P3] 타이포 위계/카피 용어 불일치 (생성/추가, 대기중/예약/변경 계획)

Unverified: 확인·제출 단계(ObjectGapPanel/PlanResultPanel/MoveTargetPicker), 대량 입력 시 스크롤.
