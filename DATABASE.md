# 데이터베이스 스키마 정의서 (Database Schema Documentation)

본 문서는 Firewall Analysis Tool에서 사용하는 모든 데이터베이스 테이블의 상세 명세와 관계를 정의합니다.

---

## 1. 장비 및 이력 관리

### `devices` Table (방화벽 장비)
관리 대상인 방화벽 장비 정보를 저장합니다.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY`, `NOT NULL` | 고유 식별자 |
| `name` | `VARCHAR` | `NOT NULL`, `UNIQUE` | 장비 명칭 |
| `ip_address` | `VARCHAR` | `NOT NULL`, `UNIQUE` | 장비 IP 주소 |
| `vendor` | `VARCHAR` | `NOT NULL` | 제조사 (paloalto, secui, ngf 등) |
| `username` | `VARCHAR` | `NOT NULL` | 접속 ID (NGF의 경우 클라이언트 ID) |
| `password` | `VARCHAR` | `NOT NULL` | Fernet 암호화된 비밀번호 |
| `description` | `VARCHAR` | `NULLABLE` | 장비 설명 |
| `ha_peer_ip` | `VARCHAR` | `NULLABLE` | HA 구성을 위한 상대 장비 IP (Palo Alto) |
| `use_ssh_for_last_hit_date` | `BOOLEAN` | `DEFAULT False` | 히트 수집 시 SSH 사용 여부 |
| `model` | `VARCHAR` | `NULLABLE` | 장비 모델명 |
| `last_sync_at` | `DATETIME` | `NULLABLE` | 마지막 동기화 완료 시간 |
| `last_sync_status` | `VARCHAR` | `NULLABLE` | 동기화 상태 (in_progress, success, failure) |
| `last_sync_step` | `VARCHAR` | `NULLABLE` | 현재 진행 중인 동기화 단계 메시지 |

### `change_logs` Table (변경 이력)
동기화 과정에서 탐지된 객체 및 정책의 변경 이력을 저장합니다.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY`, `NOT NULL` | 고유 식별자 |
| `timestamp` | `DATETIME` | `NOT NULL` | 로그 생성 시간 |
| `device_id` | `INTEGER` | `FOREIGN KEY (devices.id)` | 관련 장비 ID |
| `data_type` | `VARCHAR` | `NOT NULL` | 데이터 타입 (policies, network_objects 등) |
| `object_name` | `VARCHAR` | `NOT NULL` | 변경된 객체의 이름 |
| `action` | `VARCHAR` | `NOT NULL` | 동작 (created, updated, deleted) |
| `details` | `JSON` | `NULLABLE` | 변경 전/후 상세 데이터 |

---

## 2. 정책 및 객체 테이블

### `network_objects` Table (네트워크 객체)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `name` | `VARCHAR` | `NOT NULL` | 객체명 |
| `ip_address` | `VARCHAR` | `NOT NULL` | 원시 주소 문자열 |
| `type` | `VARCHAR` | `NULLABLE` | 타입 (ip-netmask, ip-range, fqdn) |
| `ip_version` | `INTEGER` | `NULLABLE` | 4 (IPv4) 또는 6 (IPv6) |
| `ip_start` | `BIGINT` | `NULLABLE` | 숫자형 시작 IP |
| `ip_end` | `BIGINT` | `NULLABLE` | 숫자형 종료 IP |
| `is_active` | `BOOLEAN` | `NOT NULL` | 현재 활성 상태 여부 |
| `last_seen_at` | `DATETIME` | `NOT NULL` | 마지막 확인 시간 |

### `network_groups` Table (네트워크 그룹)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `name` | `VARCHAR` | `NOT NULL` | 그룹명 |
| `members` | `VARCHAR` | `NULLABLE` | 멤버 리스트 (쉼표 구분) |
| `is_active` | `BOOLEAN` | `NOT NULL` | 활성 상태 |
| `last_seen_at` | `DATETIME` | `NOT NULL` | 마지막 확인 시간 |

### `services` Table (서비스 객체)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `name` | `VARCHAR` | `NOT NULL` | 서비스명 |
| `protocol` | `VARCHAR` | `NULLABLE` | 프로토콜 (tcp, udp, icmp) |
| `port` | `VARCHAR` | `NULLABLE` | 원시 포트 정의 |
| `port_start` | `INTEGER` | `NULLABLE` | 시작 포트 (any=0) |
| `port_end` | `INTEGER` | `NULLABLE` | 종료 포트 (any=65535) |
| `is_active` | `BOOLEAN` | `NOT NULL` | 활성 상태 |

### `policies` Table (보안 정책)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `vsys` | `VARCHAR` | `NULLABLE` | 가상 시스템명 |
| `seq` | `INTEGER` | `NULLABLE` | 정책 순번 |
| `rule_name` | `VARCHAR` | `NOT NULL` | 정책 이름 |
| `enable` | `BOOLEAN` | `NULLABLE` | 활성 여부 |
| `action` | `VARCHAR` | `NOT NULL` | 액션 (allow, deny) |
| `source` | `VARCHAR` | `NOT NULL` | 출발지 (정규화 문자열) |
| `destination` | `VARCHAR` | `NOT NULL` | 목적지 (정규화 문자열) |
| `service` | `VARCHAR` | `NOT NULL` | 서비스 (정규화 문자열) |
| `last_hit_date` | `DATETIME` | `NULLABLE` | 최근 히트 일시 |
| `is_indexed` | `BOOLEAN` | `DEFAULT False` | 인덱싱 완료 여부 |

---

## 3. 고속 검색 인덱스 테이블

### `policy_address_members` Table (주소 인덱스)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `policy_id` | `INTEGER` | `FOREIGN KEY` | 정책 참조 |
| `direction` | `VARCHAR` | `NOT NULL` | 'source' 또는 'destination' |
| `token` | `VARCHAR` | `NULLABLE` | 원본 토큰 (빈 그룹용) |
| `token_type` | `VARCHAR` | `NULLABLE` | 'ipv4_range' 또는 'unknown' |
| `ip_start` | `BIGINT` | `NULLABLE` | 숫자형 시작 IP |
| `ip_end` | `BIGINT` | `NULLABLE` | 숫자형 종료 IP |

### `policy_service_members` Table (서비스 인덱스)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `policy_id` | `INTEGER` | `FOREIGN KEY` | 정책 참조 |
| `token` | `VARCHAR` | `NOT NULL` | 원본 토큰 |
| `protocol` | `VARCHAR` | `NULLABLE` | 프로토콜 |
| `port_start` | `INTEGER` | `NULLABLE` | 시작 포트 |
| `port_end` | `INTEGER` | `NULLABLE` | 종료 포트 |

---

## 4. 분석 및 시스템 로그

### `analysistasks` Table (분석 작업)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `task_type` | `ENUM` | `NOT NULL` | 분석 유형 (redundancy, unused 등) |
| `task_status` | `ENUM` | `NOT NULL` | 상태 (pending, success 등) |
| `created_at` | `DATETIME` | `NOT NULL` | 생성 시간 |

### `analysis_results` Table (분석 결과)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `analysis_type` | `VARCHAR` | `NOT NULL` | 분석 유형 |
| `result_data` | `JSON` | `NOT NULL` | 상세 결과 데이터 (JSON) |

### `notification_logs` Table (시스템 알림)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `timestamp` | `DATETIME` | `NOT NULL` | 발생 시간 |
| `title` | `VARCHAR` | `NOT NULL` | 제목 |
| `message` | `TEXT` | `NOT NULL` | 내용 |
| `type` | `VARCHAR` | `NOT NULL` | 타입 (info, error 등) |
| `category` | `VARCHAR` | `NULLABLE` | 카테고리 (sync, analysis) |

---

## 5. 설정 및 스케줄

### `settings` Table (애플리케이션 설정)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `key` | `VARCHAR` | `PRIMARY KEY` | 설정 키 (예: sync_parallel_limit) |
| `value` | `VARCHAR` | `NOT NULL` | 설정 값 |

### `sync_schedules` Table (동기화 스케줄)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `name` | `VARCHAR` | `NOT NULL` | 스케줄 이름 |
| `enabled` | `BOOLEAN` | `DEFAULT True` | 활성 여부 |
| `days_of_week` | `JSON` | `NOT NULL` | 실행 요일 [0-6] |
| `time` | `VARCHAR` | `NOT NULL` | 실행 시간 (HH:MM) |
| `device_ids` | `JSON` | `NOT NULL` | 대상 장비 ID 리스트 |
