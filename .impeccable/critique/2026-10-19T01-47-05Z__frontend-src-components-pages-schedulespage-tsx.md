---
target: schedules
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/SchedulesPage.tsx"
target_fingerprint: "sha256:3c25ee09a5faa4cc1327d8443be6539de7ca8c5fa765c5c428575c1bce64c675"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/SchedulesPage.tsx
timestamp: 2026-10-19T01-47-05Z
slug: frontend-src-components-pages-schedulespage-tsx
---
Method: dual-agent (A: aa2cf2864dd9938ef · B: a042b95dddb5c50d2)

# Schedules critique — 16/40 (Poor)

Heuristics: 1=1 2=2 3=1 4=3 5=1 6=2 7=1 8=3 9=1 10=1. Detector: 0 findings.

Priority issues
- [P0] 요일 규약 불일치: UI 일=0 vs 서버 0=월요일 → 선택한 요일이 하루씩 밀려 실행 (코드+APScheduler 실험으로 확인)
- [P1] 스케줄러가 장비 실패를 삼키고 항상 success 기록, 다음 실행·진행·장비별 결과 없음
- [P1] 목록에 활성 스위치·지금 실행 없음, 아이콘 버튼 이름 약함
- [P2] 인라인 검증·label 연결·aria-pressed 없음, 다이얼로그 닫힘 후 포커스 유실, 시간대/순차 실행 안내 없음
- [P3] 영문 제목, 11px·낮은 투명도 텍스트, 장비 이름 미표시

Unverified: 수정/삭제 다이얼로그·빈 상태, 서버 재시작 복원, 기존 저장 스케줄의 요일 규약.
