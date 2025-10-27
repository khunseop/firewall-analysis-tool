# Project Tasks

This document tracks the development progress of the Firewall Analysis Tool.

## Future Tasks (To Do)

- [x] Sync-All 전용 오케스트레이션으로 일원화
  - 개별 타입 동기화 엔드포인트는 내부용으로만 유지하거나 비활성화 (Swagger 숨김 처리)
  - 순서 고정: network_objects → network_groups → services → service_groups → policies
  - 모든 동기화 완료 이벤트 이후에만 정책 파싱/인덱싱 진행 (자동 트리거 추가)

- [x] 정책 파싱/인덱싱 시점 분리 (Sync와 별개)
  - 새로운 전용 엔드포인트/잡 추가: `POST /firewall/parse-index/{device_id}`
  - sync-all 성공 후 자동 트리거되며, 실패 시 재시도 가능

- [x] `policies.flattened_*` 컬럼 제거 (마이그레이션)
  - 코드에서 완전 제거 및 하위호환 분기 삭제
  - 문서(DATABASE.md) 업데이트 완료

- [x] network_objects/services 동기화 시 숫자화 파싱 제거
  - 파싱은 정책 인덱싱 단계에서 일괄 수행
  - 동기화는 원문 보존 중심으로 단순화

- [ ] Policy Indexer 캐싱 최적화
  - 그룹 전개 캐시: 그룹 폐포(closure) 메모이제이션, 깊이 제한, 사이클 가드
  - 값 치환 캐시: 객체명→값, 서비스명→프로토/포트 토큰 캐시
  - 토큰→숫자 범위 파싱 캐시: 동일 토큰 재사용 시 즉시 히트
  - 장비 단위 LRU 캐시 도입 및 파서 단계별 캐시 적중률 로깅

- [x] 불필요 업데이트 발생 개선
  - dirty-check 강화: 문자열 트림/정규화 후 비교, 데이터 타입 캐스팅 일치화
  - 동일 데이터면 update 호출/변경 로그 생략
  - 비교 키: `policies.rule_name`, 기타 `name` 고정

- [ ] 타임스탬프 기준 수정
  - 시스템 시간(대한민국 서울 시간)으로 일원화

- [ ] 불필요 코드/파일/컬럼 정리
  - 외부 `policy_resolver.py` 의존 제거 완료에 따라 관련 동적 로딩 코드 삭제
  - 레거시 평탄화 문자열 경로/주석 제거
  - 사용하지 않는 유틸/마이그레이션 스텁 정리

- [x] 테스트/운영 가이드 보강
  - sync-all → parse-index 흐름의 API/순서/에러 처리 문서화
  - 대규모 장비/정책에서의 성능 벤치 시나리오 추가
  - 캐시 무효화/리빌드 가이드

## Completed Tasks
- [x] **Implement Sync Status Tracking:**
    - [x] **Add Status Endpoint:** Created a new `GET /firewall/sync/{device_id}/status` endpoint to allow polling for the current synchronization status.
    - [x] **Update Sync Logic:** Modified the synchronization task to update the `last_sync_status` to "in_progress" at the start and "success" or "failure" upon completion.
    - [x] **Add Pydantic Schema:** Created a `DeviceSyncStatus` schema for the new endpoint.
    - [x] **Update Documentation:** Added the new endpoint to `AGENTS.md`.

- [x] **Implement Change Tracking for Data Synchronization (Overwrite-and-Log):**
    - [x] **Architectural Shift:** Replaced the previous "soft-delete" model with a more robust "overwrite-and-log" strategy to provide a clear audit trail of all changes.
    - [x] **Remove Soft-Delete Columns:** Deleted the `is_active` and `last_seen_at` columns from the `Policy`, `NetworkObject`, `NetworkGroup`, `Service`, and `ServiceGroup` models and created a database migration to apply these changes.
    - [x] **Add Change Log Feature:**
        - [x] Created a new `ChangeLog` model to store the history of created, updated, and deleted objects.
        - [x] Implemented a corresponding Pydantic schema and CRUD functions for the change log.
        - [x] Created a database migration to add the new `change_logs` table.
    - [x] **Rewrite Synchronization Logic:**
        - [x] Overhauled the `_sync_data_task` to compare firewall data with the database.
        - [x] Implemented logic to create new items, delete old items, and update existing items.
        - [x] For every change (create, update, delete), a detailed entry is now recorded in the `change_logs` table.
    - [x] **Simplify CRUD:** Refactored the CRUD functions for policies and objects to use simple `delete` operations, removing the now-obsolete soft-delete logic.
    - [x] **Update Documentation:** Updated `DATABASE.md` to reflect the removal of old columns and the addition of the `change_logs` table.

- [x] **Initial Project Setup:**
    - [x] Established the core FastAPI application structure.
    - [x] Implemented the initial database schema for Devices.
    - [x] Set up basic CRUD operations and API endpoints for device management.

- [x] **Schema and Feature Expansion:**
    - [x] Expanded the `Policy` model with detailed columns to match vendor specifications.
    - [x] Created new database models, Pydantic schemas, and CRUD functions for `NetworkObject`, `NetworkGroup`, `Service`, and `ServiceGroup`.
    - [x] Updated the `DATABASE.md` documentation to reflect the complete schema.
    - [x] Created a single, clean initial database migration file.
    - [x] Implemented a generic, background-task-based API endpoint for synchronizing all data types from firewalls.
    - [x] Added a data transformation layer to handle differences between vendor data formats and the application's Pydantic models.
