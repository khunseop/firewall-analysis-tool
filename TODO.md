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
| 1 | `[ ]` | Reimplement `smoke_test.py` | Currently non-functional. Needs server dependency cleanup and proper mock device setup documented. |
| 2 | `[ ]` | FAT 정책 삭제 워크플로 기존 코드 전면 제거 | `services/deletion_workflow/`, `models/deletion_workflow.py`, `crud/crud_deletion_workflow.py`, `api/endpoints/deletion_workflow.py`, 라우터 해제, Alembic migration, `DATABASE.md` 업데이트 |
| 3 | `[ ]` | fpat deletion_processor 1단계 이관: 파이프라인 기반 구조 | `BaseProcessor` ABC, `Pipeline`, `TaskRegistry`, `ConfigManager` (fpat.yaml 연동), `FileManager`, `ExcelManager` |
| 4 | `[ ]` | fpat deletion_processor 2단계 이관: 요청 파싱/추출 (Tasks 1-5) | `RequestParser`, `RequestExtractor`, `MisIdAdder`, `ApplicationAggregator`, `RequestInfoAdder` |
| 5 | `[ ]` | fpat deletion_processor 3단계 이관: 예외/중복 처리 (Tasks 6-10) | `ExceptionHandler`(벤더별), `DuplicatePolicyClassifier`(분류+마킹), `MergeHitcount` |
| 6 | `[ ]` | fpat deletion_processor 4단계 이관: 사용현황/알림 (Tasks 11-14) | `PolicyUsageProcessor`(추가+갱신), `NotificationClassifier`, `AutoRenewalChecker` |
| 7 | `[ ]` | 신규 deletion_workflow API 엔드포인트 재연결 및 E2E 테스트 | 프론트엔드 연동 포함 |
| 8 | `[ ]` | fpat firewall_analyzer vs FAT 분석 엔진 비교 및 선별 | `PolicyResolver`, `RedundancyAnalyzer` 대 FAT `analysis/` 엔진 비교. 출력 포맷은 fpat 기준. `ShadowAnalyzer`는 제거 대상. |

---

## Completed Tasks

| # | Completed | Task |
|---|-----------|------|
| — | — | — |

---

> **Claude Code instruction**: When starting a task, set status to `[~]`.
> When done, set to `[x]`, move the row to Completed, fill in the date, and update any related docs per `CLAUDE.md` rules.
