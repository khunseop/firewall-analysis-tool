# Deletion Workflow Module (삭제 워크플로우 모듈)

이 모듈은 방화벽 정책과 신청 시스템(fpat) 정보를 결합하여 삭제 가능한 정책을 식별하고, 예외처리·중복정책·자동연장 등을 분류하는 Config 기반 프로세서 파이프라인입니다.

## 1. 개요 (Overview)

레거시 `fpat` CLI 도구(`fpat/fpat/policy_deletion_processor/`)의 프로세서 로직을 FAT 웹 환경으로 이식한 것입니다. 각 프로세서는 `BaseProcessor`를 상속하며, `Pipeline`이 태스크 ID(0~19) 순서대로 이들을 실행합니다.

## 2. 아키텍처 및 구성 (Architecture)

### `core/` — 파이프라인 엔진
- `pipeline.py`: **`TaskRegistry`**(태스크 ID → 프로세서 매핑)와 **`Pipeline`**(단계 실행 오케스트레이션)을 정의합니다. 전체 태스크 목록과 순서는 이 파일 상단 docstring이 **단일 진실 공급원(source of truth)**입니다 — 다른 문서와 어긋나면 이 docstring을 우선합니다.
- `config_manager.py`: `fpat.yaml` 기반 설정(파싱 패턴, 예외 목록, 기간 등) 로드.
- `input_resolver.py`: 위저드 실행 순서에 따라 각 태스크가 필요로 하는 입력 파일을 자동으로 찾아 연결.
- `workspace_runner.py`: API 환경에서 CLI 기반 프로세서를 실행하기 위해 임시 작업 디렉토리(CWD)를 구성·정리.

### `processors/` — 태스크별 처리 로직 (Task 0~19)

| Task | 프로세서 | 역할 |
|---|---|---|
| 1 | `merge_hitcount.py` | HA 장비 히트카운트 병합 |
| 2, 4 | `request_parser.py` | 정책/중복결과 파일에서 신청정보 파싱 (2회 재사용) |
| 5 | `mis_id_adder.py` | MIS ID 매핑 |
| 6 | `request_extractor.py` | 신청번호 추출 |
| 7 | `application_aggregator.py` | 신청정보 가공 (GSAMS) |
| 8 | `request_info_adder.py` | 신청정보를 정책 파일에 매핑 |
| 9 | `auto_renewal_checker.py` | 자동연장 정책 탐지 |
| 10, 11 | `exception_handler.py` | 예외처리 (PaloAlto / SECUI-MF2) |
| 12 | `policy_usage_processor.py` | 사용이력 반영 |
| 13 | `bottom_latest_policy_validator.py` | 하단 최신정책 검증 |
| 14, 16 | `duplicate_policy_classifier.py` | 중복정책 분류 / 상태 업데이트 |
| 15 | `duplicate_expired_cleaner.py` | 중복 만료셋 예외처리 |
| 17 | `duplicate_exception_applier.py` | 중복 예외 반영 |
| 18 | `notification_classifier.py` | 공지대상 분류 |
| 19 | `auto_renewal_exception_generator.py` | 자동연장예외파일 생성 (Phase 3) |

(Task 0은 파이프라인 외부에서 `export_service.py`가 FAT DB → Excel 변환으로 처리하고, Task 3은 `RedundancyAnalyzer`의 중복정책 분석 결과를 그대로 사용합니다.)

### `utils/` — 공용 유틸리티
- `excel_manager.py`: Excel 파일 읽기/쓰기 공용 로직.
- `file_manager.py`: 임시 작업 파일 저장/정리. 원본 CLI의 대화형 입력(input) 로직은 FAT 웹 환경에서 제거되었습니다.

### 최상위 파일
- `config_bridge.py`: Settings DB(예외 목록 등)와 `config_manager.py`를 연동, Task 15 예외 누적 저장을 담당.
- `export_service.py`: `deletion_workflow.py` 엔드포인트에서 분리된 FAT DB 조회 → DataFrame → xlsx 변환 로직.
- `task_meta.py`: `fpat.yaml` 경로 등 태스크 메타데이터.

## 3. 문서 참고 안내

API 사용법과 상세 운영 가이드는 `backend/DELETION_WORKFLOW.md` / `backend/DELETION_WORKFLOW_GUIDE.md`를 참고하세요. 단, 두 문서는 7단계 체크리스트 기준의 이전 구조(예: `workflow_manager.py`, `final_exporter.py` 등 현재 존재하지 않는 파일 언급)를 설명하고 있어 **현재의 0~19 태스크 파이프라인과 세부 단계 번호가 다릅니다.** 실제 태스크 구성은 이 README와 `core/pipeline.py` docstring을 기준으로 판단하세요.
