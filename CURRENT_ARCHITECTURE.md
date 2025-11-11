# 현행 시스템 아키텍처 분석

현재 시스템은 크게 두 단계로 나뉘어 동작합니다. 첫 번째는 방화벽에서 데이터를 가져와 데이터베이스에 저장하는 **'동기화 단계'**이고, 두 번째는 저장된 데이터를 검색하기 쉽게 가공하는 **'인덱싱 단계'**입니다.

## 1. 데이터 동기화 단계 (`run_sync_all_orchestrator` / `sync_data_task` in `tasks.py`)

- **목표:** 방화벽 장비의 최신 설정(정책, 객체 등)을 로컬 데이터베이스에 복사하고 변경 이력을 기록합니다.
- **동작 순서:**
    1.  **동기화 시작:** API 호출로 특정 장비에 대한 동기화가 시작됩니다. `devices.last_sync_status`를 `in_progress`로 설정하고, `last_sync_step`에 현재 단계 메시지를 기록합니다.
    2.  **데이터 수집:** 방화벽 벤더(예: Palo Alto, SECUI)에 맞는 'Collector'가 방화벽에 접속하여 다음 순서로 데이터를 수집합니다:
        - 네트워크 객체 (`export_network_objects`)
        - 네트워크 그룹 (`export_network_group_objects`)
        - 서비스 객체 (`export_service_objects`)
        - 서비스 그룹 (`export_service_group_objects`)
        - 정책 (`export_security_rules`)
    3.  **Last Hit Date 수집 (Palo Alto 전용):**
        - 정책 수집 완료 후, `last_hit_date` 정보를 별도로 수집합니다.
        - `use_ssh_for_last_hit_date` 옵션이 활성화된 경우 SSH를 통해 수집, 그렇지 않으면 API를 통해 수집합니다.
        - `ha_peer_ip`가 설정된 경우, 메인 장비와 HA Peer에서 병렬로 수집 후 최신 타임스탬프를 선택합니다.
        - 수집된 `last_hit_date`는 정책 데이터와 병합되어 저장됩니다.
    4.  **데이터 비교 및 저장:**
        - 새로 가져온 데이터와 DB에 이미 저장된 데이터를 비교합니다.
        - DB에 없으면 **신규 생성(Create)**합니다.
        - DB에 있지만 내용이 다르면 **수정(Update)**합니다. 정책의 경우 실질적인 필드 변경 시 `is_indexed`를 `False`로 설정합니다.
        - `last_hit_date`만 변경된 경우에는 인덱싱을 다시 수행하지 않습니다.
        - 새 데이터에 없으면 DB에서 **삭제(Delete)** 처리합니다. 정책 삭제 시 관련 인덱스 테이블(`policy_address_members`, `policy_service_members`)도 함께 삭제됩니다.
    5.  **변경 이력 기록:** 모든 생성, 수정, 삭제 내용은 `change_logs` 테이블에 기록하여 추적할 수 있도록 합니다.

## 2. 정책 인덱싱 단계 (`rebuild_policy_indices` in `policy_indexer.py`)

- **목표:** 정책 검색 속도를 높이기 위해, 각 정책에 어떤 IP 주소와 서비스 포트가 포함되어 있는지 미리 모두 계산해서 별도의 '인덱스 테이블'에 저장합니다.
- **동작 순서:**
    1.  **분석 대상 선정:** `is_indexed`가 `False`인 정책만 대상으로 선정합니다. 동기화 완료 후 자동으로 실행됩니다.
    2.  **객체 정보 로딩:** 분석에 필요한 모든 네트워크/서비스 객체와 그룹 정보를 DB에서 전부 메모리로 불러옵니다.
    3.  **그룹 멤버 재귀 분석 (핵심 로직):**
        -   정책의 `source`, `destination`, `service` 필드에 그룹 객체가 있으면, 이 그룹에 속한 모든 멤버를 끝까지 추적하여 풀어냅니다.
        -   순환 참조 방지를 위해 방문한 그룹을 추적합니다.
        -   빈 그룹의 경우 `__GROUP__:그룹명` 형태로 마커를 저장합니다.
        -   예시: `Policy-A`의 `source`가 `Group-1`이고, `Group-1`이 `Host-A(1.1.1.1)`와 `Group-2`를 포함하고, `Group-2`가 `Subnet-B(2.2.0.0/16)`를 포함한다면, 최종적으로 `Policy-A`의 `source`에는 `1.1.1.1`과 `2.2.0.0/16`이 포함된다고 분석합니다.
    4.  **IP 범위 병합 (데이터 압축):**
        -   개별 IP/CIDR을 숫자 범위로 변환한 후, 연속되거나 겹치는 범위를 병합합니다.
        -   예: `1.1.1.1`, `1.1.1.2`, `1.1.1.3` → `1.1.1.1-1.1.1.3` (단일 범위로 병합)
        -   이를 통해 DB 저장 공간을 절약하고 검색 성능을 개선합니다.
    5.  **인덱스 테이블 저장:**
        -   위 분석 결과를 `policy_address_members`와 `policy_service_members`라는 별도의 테이블에 저장합니다.
        -   `policy_address_members`에는 `direction`(source/destination), `ip_start`, `ip_end`가 저장됩니다.
        -   `policy_service_members`에는 `protocol`, `port_start`, `port_end`가 저장됩니다.
        -   빈 그룹의 경우 `token`과 `token_type='unknown'`으로 저장됩니다.
    6.  **플래그 업데이트:** 분석이 끝난 정책은 `is_indexed` 플래그를 `True`로 변경하여 다음 분석 대상에서 제외합니다.

## 3. 정책 검색 단계 (`search_policies` in `crud_policy.py`)

- **목표:** 사용자가 입력한 조건(예: IP 주소 '1.2.3.4', 포트 '443')으로 정책을 검색합니다.
- **동작 방식:**
    -   사용자가 IP 주소나 포트로 검색을 요청하면, 시스템은 `policies` 테이블을 직접 검색하는 것이 아니라, 미리 만들어 둔 인덱스 테이블을 먼저 조회합니다.
    -   **IP 주소 검색:**
        -   검색할 IP를 숫자로 변환한 후, `policy_address_members` 테이블에서 `ip_start <= 검색IP <= ip_end` 조건으로 범위 검색을 수행합니다.
        -   Source/Destination 방향별로 필터링이 가능합니다.
        -   여러 IP를 입력하면 OR 조건으로 처리됩니다.
    -   **포트 검색:**
        -   검색할 포트를 숫자로 변환한 후, `policy_service_members` 테이블에서 `port_start <= 검색포트 <= port_end` 조건으로 범위 검색을 수행합니다.
        -   프로토콜(tcp/udp)별 필터링이 가능합니다.
    -   **필터 조합:**
        -   Source IP, Destination IP, Service는 AND 조건으로 처리됩니다 (교집합).
        -   각 필터 내의 여러 값은 OR 조건으로 처리됩니다 (합집합).
    -   **최종 결과:**
        -   인덱스 테이블에서 찾은 정책 ID들을 이용해 `policies` 테이블에서 최종 정책 정보를 가져옵니다.
        -   추가로 정책명, 사용자, 애플리케이션 등의 텍스트 필터도 적용됩니다.
    -   이를 통해 복잡한 그룹 멤버를 포함하는 정책도 빠르게 찾아낼 수 있습니다.
