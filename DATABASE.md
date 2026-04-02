# 데이터베이스 스키마 정의서 (Database Schema)

본 문서는 Firewall Analysis Tool에서 사용하는 데이터베이스 스키마와 각 테이블의 역할에 대해 상세히 설명합니다. 모든 테이블은 비동기 처리에 최적화되어 설계되었습니다.

---

## 1. 핵심 엔티티 (Core Entities)

### `devices` (방화벽 장비)
관리 대상인 방화벽 장비 정보를 저장합니다.

| 컬럼명 | 타입 | 제약조건 | 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PK`, `NOT NULL` | 고유 식별자 |
| `name` | `VARCHAR` | `NOT NULL`, `UNIQUE` | 장비 명칭 |
| `ip_address` | `VARCHAR` | `NOT NULL`, `UNIQUE` | 장비 IP 주소 |
| `vendor` | `VARCHAR` | `NOT NULL` | 제조사 (paloalto, secui, ngf 등) |
| `username` | `VARCHAR` | `NOT NULL` | 접속 ID (NGF의 경우 클라이언트 ID) |
| `password` | `VARCHAR` | `NOT NULL` | Fernet 암호화된 비밀번호 |
| `ha_peer_ip` | `VARCHAR` | `NULLABLE` | HA 구성을 위한 상대 장비 IP (Palo Alto) |
| `use_ssh_for_last_hit_date` | `BOOLEAN` | `DEFAULT False` | 히트 수집 시 SSH 사용 여부 |
| `model` | `VARCHAR` | `NULLABLE` | 장비 모델명 |
| `last_sync_at` | `DATETIME` | `NULLABLE` | 마지막 동기화 완료 시간 |
| `last_sync_status` | `VARCHAR` | `NULLABLE` | 동기화 상태 (in_progress, success, failure) |
| `last_sync_step` | `VARCHAR` | `NULLABLE` | 현재 진행 중인 동기화 단계 메시지 |

---

## 2. 정책 및 객체 테이블 (Policies & Objects)

### `policies` (보안 정책)
장비로부터 수집된 보안 규칙(Security Rules) 정보를 저장합니다.
- **`is_indexed`**: 정책 내용 변경 시 `False`로 설정되며, 인덱서가 처리를 완료하면 `True`가 됩니다.
- **`last_hit_date`**: 정책의 최근 매칭 시간을 저장합니다.

### `network_objects` / `network_groups`
네트워크 주소 객체 및 그룹 정보를 저장합니다. 그룹 멤버는 쉼표로 구분된 문자열로 저장됩니다.

### `services` / `service_groups`
서비스(포트/프로토콜) 객체 및 그룹 정보를 저장합니다.

---

## 3. 정책 검색 인덱스 테이블 (Member Indexes)

복잡한 그룹 구조를 가진 정책을 빠르게 검색하기 위해 사용되는 역정규화 테이블입니다.

### `policy_address_members` (주소 인덱스)
정책에 포함된 모든 IP 대역을 숫자 범위(`ip_start`, `ip_end`)로 전개하여 저장합니다.

### `policy_service_members` (서비스 인덱스)
정책에 포함된 모든 프로토콜 및 포트 정보를 범위(`port_start`, `port_end`)로 저장합니다.

---

## 4. 분석 결과 및 이력 (Analysis & Logs)

### `analysistasks` (분석 작업)
분석 작업(중복 탐지 등)의 진행 상태(pending, in_progress, success, failure)를 관리합니다.

### `analysis_results` (분석 결과)
분석 완료 후 도출된 상세 데이터를 JSON 포맷(`result_data`)으로 저장합니다.
- 예: 중복 정책 세트 정보, 미사용 객체 리스트 등.

### `change_logs` (변경 이력)
동기화 시 탐지된 객체/정책의 변경 사항을 기록합니다. 수정 시 `before/after` 상태를 JSON으로 저장합니다.

---

## 5. 시스템 공통

### `notification_logs` (알림 로그)
시스템 이벤트(동기화 성공/실패 등)를 기록하며 프론트엔드 알림 티커와 연동됩니다.

### `settings` (시스템 설정)
애플리케이션 전역 설정(예: `sync_parallel_limit`)을 키-값 쌍으로 저장합니다.

### `sync_schedules` (동기화 스케줄)
정기적인 자동 동기화 수행을 위한 요일, 시간 정보를 저장합니다.
