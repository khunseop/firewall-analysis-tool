# Synchronization Module (동기화 모듈)

이 모듈은 다양한 제조사의 방화벽 장비로부터 설정 데이터를 수집하고, 이를 시스템 데이터베이스와 동기화하는 핵심 로직을 담당합니다.

## 1. 개요 (Overview)

동기화 모듈은 네트워크 객체, 서비스, 보안 정책 등의 데이터를 정기적으로 또는 수동으로 가져와 최신 상태를 유지합니다. 대량의 데이터를 효율적으로 처리하기 위해 비동기(Async) 처리와 벌크(Bulk) DB 작업을 수행하며, HA(High Availability) 구성 장비의 히트 정보를 통합 관리합니다.

## 2. 아키텍처 및 구성 (Architecture)

### `tasks.py` (오케스트레이터 및 동기화 로직)
- **`run_sync_all_orchestrator`**: 전체 동기화 프로세스를 제어하는 메인 함수입니다. 세마포어를 통한 병렬 제어, 단계별 상태 업데이트, 예외 처리를 담당합니다.
- **`sync_data_task`**: 수집된 데이터를 실제 DB와 대량 동기화합니다. 기존 데이터와 비교하여 생성(Insert), 수정(Update), 삭제(Delete)를 결정하며, 변경 이력(ChangeLog)을 생성합니다.
- **`_collect_last_hit_date_parallel`**: HA 환경의 메인/Peer 장비로부터 히트 정보를 동시에 수집하고 병합합니다.

### `collector.py` (데이터 수집기)
- 장비 정보를 바탕으로 적절한 제조사별 Collector 객체를 생성(Factory Pattern)합니다.
- 장비 연결을 위한 패스워드 복호화 및 SSH/API 세션 관리를 수행합니다.

### `transform.py` (데이터 변환기)
- 장비로부터 수집된 원시(Raw) 데이터를 시스템 모델 형식에 맞게 정규화합니다.
- Pandas DataFrame을 활용하여 대량의 데이터를 Pydantic 모델로 일괄 변환합니다.

## 3. 주요 로직 및 흐름 (Main Flow)

`run_sync_all_orchestrator` 함수를 통한 전체 동기화 흐름은 다음과 같습니다.

1.  **세마포어 획득**: `sync_parallel_limit` 설정에 따라 동시 실행 가능한 동기화 작업 수를 제한합니다.
2.  **장비 연결 (Connecting)**: 제조사별 프로토콜(XML API, REST, SSH)을 통해 장비에 접속합니다.
3.  **순차적 데이터 수집 (Collection Sequence)**:
    - 데이터 간 종속성을 고려하여 **네트워크 객체 -> 그룹 -> 서비스 객체 -> 그룹 -> 보안 정책** 순으로 수집합니다.
4.  **히트 정보 수집 (Usage History)**: (Palo Alto 전용) 정책의 마지막 사용 일시(`last_hit_date`)를 수집합니다. HA 구성 시 양쪽 장비를 모두 조회합니다.
5.  **DB 동기화 (Synchronization)**: `sync_data_task`를 통해 수집된 DataFrame과 기존 DB 데이터를 비교하여 변경분만 반영합니다.
    - 주요 필드 변경 시 `is_indexed`를 `False`로 설정하여 재분석 대상으로 분류합니다.
6.  **인덱스 재구성 (Indexing)**: 변경된 정책에 대해 전문 검색(Full-text Search)용 인덱스를 재생성합니다.
7.  **상태 업데이트 (Finalization)**: 성공(Success) 또는 실패(Failure) 상태를 기록하고 WebSocket으로 실시간 알림을 전송합니다.

## 4. 데이터 규격 및 상세 설명

### HA 히트 정보 병합 로직
HA(Active-Passive 또는 Active-Active) 환경에서는 트래픽이 양쪽 장비로 분산될 수 있습니다. 시스템은 이를 다음과 같이 처리합니다.

- **병렬 수집**: `asyncio.gather`를 사용하여 메인 장비와 HA Peer 장비의 히트 정보를 동시에 요청함으로써 수집 시간을 단축합니다.
- **데이터 병합**: 두 장비의 결과 리스트를 하나로 합친 후, 동일 정책(`vsys`, `rule_name`)에 대해 `last_hit_date` 기준으로 내림차순 정렬합니다.
- **최신값 선택**: 중복 제거(`drop_duplicates`)를 통해 각 정책별로 가장 최근에 발생한 히트 시간만을 최종 데이터로 채택합니다.

### 동기화 비교 로직 (is_dirty)
`sync_data_task`에서는 성능을 위해 모든 필드를 비교하지 않고, `last_hit_date`와 `seq`를 제외한 주요 설정값의 변경 여부만을 확인합니다.
- 설정값이 변경된 경우: `updated` 액션 로그 생성 및 인덱싱 필요(`is_indexed=False`) 표시.
- 히트 정보만 변경된 경우: `hit_date_updated` 전용 로그 생성.
