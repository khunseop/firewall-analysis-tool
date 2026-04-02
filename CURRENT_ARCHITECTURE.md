# 시스템 아키텍처 및 데이터 흐름 (System Architecture)

본 시스템은 방화벽 정책의 수집, 인덱싱, 그리고 지능형 분석을 위해 계층화된 비동기 아키텍처를 채택하고 있습니다.

---

## 1. 데이터 동기화 단계 (Synchronization Phase)

`firewall_manager/app/services/sync/tasks.py`의 `run_sync_all_orchestrator`가 전체 흐름을 제어합니다.

### 1.1. 동작 순서 및 로직
1.  **세마포어 획득**: `sync_parallel_limit` 설정에 따라 동시 실행 작업을 제한합니다.
2.  **장비 연결**: 벤더별 Collector가 접속(API/SSH)을 시도하며 상태를 `Connected`로 업데이트합니다.
3.  **데이터 수집 (Export)**:
    - 네트워크 객체 -> 네트워크 그룹 -> 서비스 -> 서비스 그룹 -> 정책 순으로 수집합니다.
    - 수집된 데이터는 Pandas DataFrame 형태로 메모리에 유지됩니다.
4.  **히트 정보 통합 (Usage History)**:
    - **Palo Alto**: 메인과 HA Peer 장비에서 `asyncio.gather`를 통해 병렬로 히트 정보를 수집합니다. 이후 두 장비 중 더 최신의 `last_hit_date`를 선택하여 병합합니다.
    - **NGF**: 정책 수집 시 데이터에 포함된 이력을 즉시 사용합니다.
5.  **DB 동기화 (Upsert/Delete)**:
    - 기존 DB 레코드와 비교하여 생성, 수정, 삭제를 수행합니다.
    - 정책 내용이 실질적으로 변경된 경우에만 `is_indexed = False`로 마킹하여 재인덱싱을 유도합니다.
    - 모든 변경 내역은 `change_logs` 테이블에 기록됩니다.

---

## 2. 정책 인덱싱 단계 (Policy Indexing Phase)

검색 성능 극대화를 위해 복잡한 정책 멤버를 숫자 범위로 변환하는 단계입니다.

### 2.1. 핵심 알고리즘
- **재귀적 그룹 확장 (Recursive Expansion)**: `Resolver` 클래스가 깊이 우선 탐색(DFS)을 통해 중첩된 그룹을 최하위 객체로 전개합니다. 순환 참조 방지를 위해 방문 노드 추적 및 메모이제이션을 사용합니다.
- **IP 범위 병합 (IP Range Merging)**: 파편화된 IP/CIDR을 숫자 범위로 변환 후, 연속되거나 중첩된 범위를 통합하여 저장 공간을 절약하고 검색 효율을 높입니다.
- **벌크 인덱싱**: 분석된 멤버 데이터를 `policy_address_members`, `policy_service_members`에 `bulk_insert_mappings`로 고속 저장합니다.

---

## 3. 정책 검색 및 분석 (Search & Analysis)

### 3.1. 인덱스 기반 검색
사용자가 IP '1.1.1.1'을 검색할 경우, 시스템은 인덱스 테이블에서 `ip_start <= 1.1.1.1_num <= ip_end` 조건으로 조회하여 수만 건의 정책 중 해당 정책을 실시간으로 찾아냅니다.

### 3.2. 비동기 분석 서비스
- **중복 탐지 (Redundancy)**: 정책 간 포함 관계를 비교하여 불필요한 정책을 식별합니다.
- **위험 분석 (Risky Ports)**: 위험 포트 DB와 정책의 서비스 항목을 대조합니다.
- 모든 분석 결과는 `AnalysisTask`를 통해 비동기적으로 수행되며, 결과는 JSON 포맷으로 `analysis_results`에 저장됩니다.

---

## 4. 프론트엔드 연동

- **WebSocket**: 동기화 및 분석의 모든 단계(Connecting, Collecting, Syncing, Indexing 등)를 실시간으로 브로드캐스트하여 UI에 반영합니다.
- **Ag-Grid**: 대용량 정책 데이터를 가로/세로 스크롤 없이 유연하게 브라우징할 수 있도록 지원합니다.
