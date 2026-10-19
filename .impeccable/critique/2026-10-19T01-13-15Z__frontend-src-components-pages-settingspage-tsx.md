---
target: Settings
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/SettingsPage.tsx"
target_fingerprint: "sha256:482f6f49222ea354ed37f28ab641c8523bedf41f4535fcc9357486fbe31838c5"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/SettingsPage.tsx
timestamp: 2026-10-19T01-13-15Z
slug: frontend-src-components-pages-settingspage-tsx
---
Method: dual-agent (A: a743c8b66f6bfc68e · B: a95a70b4b864ed8fd)

# Settings critique — 19/40 (Poor 하단)

Heuristics: 1=2 2=2 3=2 4=1 5=2 6=2 7=2 8=2 9=2 10=2. Detector: 0 findings.

Priority issues
- [P1] 저장 모델이 탭마다 다르고 탭 전환 시 미저장 편집 유실
- [P1] 접근성: tablist/tab ARIA·화살표 이동 없음, 이름 없는 입력(정책 기본값 9, 삭제 워크플로우 5), 포커스 outline 투명, H2 없음
- [P2] 10px 텍스트(삭제 워크플로우 13, 계정 7, 위험 포트 3), 한 탭에 과밀, 로그 '자동 정리'는 즉시 실행 액션
- [P2] 내부 용어/키 원문 노출(Task 17, fpat.yaml, 설정 키)
- [P3] 입력 검증·파괴적 작업 안전(NaN, 포트 형식, 복구 덮어쓰기 확인, 자기 계정 삭제 방지)

Unverified: 입력 후 dirty 표시 실제 동작, 다이얼로그 내부, 다크 테마, 쿼리 실패 상태, 정확한 대비.
