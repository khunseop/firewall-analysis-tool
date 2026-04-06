# TODO

Task tracking for FAT (Firewall Analysis Tool).
See `CLAUDE.md` for documentation update rules.

## Status Legend

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Pending |
| `[~]` | In Progress |
| `[x]` | Done |
| `[!]` | Blocked |

---

## Active Tasks

| # | Status | Task | Notes |
|---|--------|------|-------|
| 10 | `[x]` | **UI Quality Improvement — T1: 가독성 기반 정비** | font-mono, Skeleton, EmptyState, AG Grid line-height |
| 11 | `[x]` | **UI Quality Improvement — T2: 정책 페이지 개선** | 태그 렌더러, 미사용 강조, 요약 배너, 컬럼 재조정 |
| 12 | `[x]` | **UI Quality Improvement — T3: 대시보드 개편** | 활성률 bar, 오류 배너, 건강도 테이블, 활동 피드 |
| 13 | `[x]` | **UI Quality Improvement — T4: 오브젝트 Cross-Reference** | 객체 모달에 참조 정책 목록, 멤버 chip 태그 |
| 14 | `[x]` | **UI Quality Improvement — T5: 분석 결과 인사이트** | 요약 카드, 실행 이력, Excel 내보내기 |
| 15 | `[x]` | **UI Quality Improvement — T6: 알림/활동 로그 페이지** | /notifications 신규 페이지, Navbar 링크 |
| 16 | `[x]` | **UI Quality Improvement — T7: 장비 페이지 밀도 개선** | 벤더 뱃지, 상대 시간, 오류 행 강조 |

---

## Backlog
|---|--------|------|-------|
| 1 | `[ ]` | Reimplement `smoke_test.py` | Currently non-functional. Needs server dependency cleanup and proper mock device setup documented. |
| 2 | `[x]` | FAT 정책 삭제 워크플로 기존 코드 전면 제거 | `services/deletion_workflow/`, `models/deletion_workflow.py`, `crud/crud_deletion_workflow.py`, `api/endpoints/deletion_workflow.py`, 라우터 해제, Alembic migration, `DATABASE.md` 업데이트 |
| 3 | `[x]` | fpat deletion_processor 1단계 이관: 파이프라인 기반 구조 | `BaseProcessor` ABC, `Pipeline`, `TaskRegistry`, `ConfigManager` (fpat.yaml 연동), `FileManager`, `ExcelManager` |
| 4 | `[x]` | fpat deletion_processor 2단계 이관: 요청 파싱/추출 (Tasks 1-5) | `RequestParser`, `RequestExtractor`, `MisIdAdder`, `ApplicationAggregator`, `RequestInfoAdder` |
| 5 | `[x]` | fpat deletion_processor 3단계 이관: 예외/중복 처리 (Tasks 6-10) | `ExceptionHandler`(벤더별), `DuplicatePolicyClassifier`(분류+마킹), `MergeHitcount` |
| 6 | `[x]` | fpat deletion_processor 4단계 이관: 사용현황/알림 (Tasks 11-14) | `PolicyUsageProcessor`(추가+갱신), `NotificationClassifier`, `AutoRenewalChecker` |
| 7 | `[x]` | 신규 deletion_workflow API 엔드포인트 재연결 및 E2E 테스트 | 프론트엔드 연동 포함 |
| 8 | `[x]` | fpat firewall_analyzer vs FAT 분석 엔진 비교 및 선별 | `PolicyResolver` 불필요(policy_indexer가 대체). `ShadowAnalyzer` FAT에 없음(analyze_logical이 커버). `RedundancyAnalyzer.analyze_logical()` FAT에 이식 완료. |

---

## Completed Tasks

| # | Completed | Task |
|---|-----------|------|
| — | — | — |

---

> **Claude Code instruction**: When starting a task, set status to `[~]`.
> When done, set to `[x]`, move the row to Completed, fill in the date, and update any related docs per `CLAUDE.md` rules.
