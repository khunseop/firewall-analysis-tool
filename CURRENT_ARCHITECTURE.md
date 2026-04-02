# 시스템 아키텍처 (System Architecture)

본 시스템은 방화벽 장비의 정책 데이터를 수집, 분석 및 시각화하기 위한 계층화된 아키텍처를 가집니다. 데이터의 수집부터 검색 인덱싱까지의 전 과정은 비동기(Asynchronous) 방식으로 설계되어 대규모 환경에서도 안정적인 성능을 보장합니다.

## 1. 전체 데이터 흐름 (Overall Data Flow)

시스템은 크게 **수집(Collection) -> 정규화(Normalization) -> 동기화(Sync) -> 인덱싱(Indexing) -> 분석(Analysis)**의 5단계 프로세스로 동작합니다.

### 1.1. 데이터 동기화 단계 (Synchronization)
`firewall_manager/app/services/sync/tasks.py`의 `run_sync_all_orchestrator` 함수가 전체 과정을 제어합니다.

1.  **연결(Connection)**: 벤더별 팩토리를 통해 생성된 Collector가 장비에 접속합니다.
2.  **수집(Export)**: 네트워크 객체, 서비스, 보안 정책을 순차적으로 수집하여 Pandas DataFrame으로 변환합니다.
3.  **히트 정보 통합(Usage History)**: 
    - Palo Alto의 경우 메인 장비와 HA Peer에서 병렬(`asyncio.gather`)로 히트 일자를 수집하여 최신값으로 병합합니다.
4.  **DB 동기화(Sync)**:
    - 신규 생성(Create), 수정(Update), 삭제(Delete)를 판단하여 DB에 반영합니다.
    - 모든 변경 사항은 `change_logs` 테이블에 기록됩니다.
    - 정책 내용 변경 시 `is_indexed` 플래그를 `False`로 설정합니다.

### 1.2. 정책 인덱싱 단계 (Policy Indexing)
`firewall_manager/app/services/policy_indexer.py`가 담당하며, 복잡한 정책 멤버를 검색 가능한 숫자 범위로 변환합니다.

1.  **재귀적 확장(Recursive Expansion)**: 중첩된 주소/서비스 그룹을 최하위 기본 객체로 모두 풀어냅니다.
2.  **IP 범위 병합(IP Range Merging)**: 파편화된 IP/CIDR들을 최소한의 연속된 숫자 범위로 통합하여 인덱스 크기를 최적화합니다.
3.  **벌크 저장(Bulk Insert)**: 변환된 인덱스 데이터를 `policy_address_members` 및 `policy_service_members` 테이블에 대량 저장합니다.

---

## 2. 주요 모듈 구조 (Module Structure)

### 2.1. 서비스 계층 (Service Layer)
- **Sync Service**: 장비 데이터 수집 및 DB 상태 동기화 관리.
- **Firewall Service**: 멀티 벤더 추상화 인터페이스 제공 (Interface-Factory 패턴).
- **Analysis Service**: 중복/위험/미사용 정책 탐지 및 분석 결과 JSON 생성.
- **Policy Indexer**: 정책 검색 성능 최적화를 위한 멤버 전개 및 범위 인덱싱.

### 2.2. 데이터 접근 계층 (CRUD Layer)
- SQLAlchemy 비동기 세션을 사용하여 DB 연산을 수행합니다.
- 인덱스 테이블을 활용한 범위 기반 검색(Range Search) 알고리즘을 구현하여 고속 정책 조회를 지원합니다.

### 2.3. 프론트엔드 (Frontend)
- Vanilla JS와 Bulma(CSS) 기반의 SPA 구조입니다.
- Ag-Grid를 사용하여 대용량 정책 데이터를 효율적으로 브라우징하며, WebSocket을 통해 동기화 상태를 실시간으로 추적합니다.

---

## 3. 성능 최적화 전략 (Performance Strategy)

- **비동기 I/O**: FastAPI와 SQLAlchemy Async를 활용하여 네트워크 및 DB 대기 시간 동안 이벤트 루프가 차단되지 않도록 합니다.
- **병렬 처리**: HA 장비의 히트 정보 수집 등 독립적인 작업은 병렬로 수행합니다.
- **자원 제한(Semaphore)**: `sync_parallel_limit` 설정을 통해 동시 동기화 작업 수를 제한하여 서버 자원 고갈을 방지합니다.
- **벌크 연산**: 대량의 데이터 처리 시 `bulk_insert_mappings` 등을 사용하여 DB 트랜잭션 오버헤드를 최소화합니다.
