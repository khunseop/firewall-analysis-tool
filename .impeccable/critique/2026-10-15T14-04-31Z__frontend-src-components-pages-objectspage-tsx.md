---
target: Objects 페이지
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/ObjectsPage.tsx"
target_fingerprint: "sha256:b9f486348dc2b78778b1ae653369adad466eeadc07ce893ec46bbfa37e955d90"
target_path: /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/ObjectsPage.tsx
timestamp: 2026-10-15T14-04-31Z
slug: frontend-src-components-pages-objectspage-tsx
---
# Objects 페이지 critique (dual-agent, 소스 기반)

Score 20/40 (Acceptable). detector 0건, tsc -b/eslint 클린. useQuery 9개 모두 isError 미처리, aria-/role= 0건, text-10/9 12곳, 고정 noRowsText는 detector가 못 잡음.

Heuristics: 1=2, 2=2, 3=3, 4=2, 5=2, 6=2, 7=2, 8=3, 9=1, 10=1.

## Priority Issues
- [P0] 조회 실패가 "미사용"(전 객체 빨간 배지)/"결과 없음"으로 오표시 (ObjectsPage.tsx:33-52, 79, 168-176, 365) -> harden
- [P1] 범위 기반 IP/포트 검색 부재, searchObjects API 미사용 (api/firewall.ts:77) -> layout, clarify
- [P1] 빈 상태/문구 오류 ("사이드바", 장비 0대/0건/필터 0건 미구분, 영어 제목) (:365, 309) -> clarify, onboard
- [P2] hover 전용 정책 버튼, DeviceSelector aria/Esc 부재 (:62) -> audit, polish
- [P3] 요약 줄 없음, 탭 건수, 컬럼 순서, 정책 점프 진입점 불일치 -> distill

## Strengths
미사용 우선 정렬, 모달 멤버 트리와 정책 점프, 장비 선택기 기본기.

## Questions
탐색 vs 검색 페이지, 실패 시 전부 미사용 문제, 장비 간 비교 뷰.
