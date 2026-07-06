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
| `collect_last_hit_date` | `BOOLEAN` | `DEFAULT False` | Last Hit Date 수집 활성화 여부 |
| `group` | `VARCHAR` | `NULLABLE` | 장비 그룹 (예: 서울DC, 부산DR) |
| `model` | `VARCHAR` | `NULLABLE` | 장비 모델명 |
| `last_sync_at` | `DATETIME` | `NULLABLE` | 마지막 동기화 완료 시간 |
| `last_sync_status` | `VARCHAR` | `NULLABLE` | 동기화 상태 (in_progress, success, failure) |
| `last_sync_step` | `VARCHAR` | `NULLABLE` | 현재 진행 중인 동기화 단계 메시지 |
| `cached_policies` | `INTEGER` | `DEFAULT 0` | 전체 정책 수 캐시 |
| `cached_active_policies` | `INTEGER` | `DEFAULT 0` | 활성 정책 수 캐시 |
| `cached_disabled_policies` | `INTEGER` | `DEFAULT 0` | 비활성 정책 수 캐시 |
| `cached_network_objects` | `INTEGER` | `DEFAULT 0` | 네트워크 객체 수 캐시 |
| `cached_network_groups` | `INTEGER` | `DEFAULT 0` | 네트워크 그룹 수 캐시 |
| `cached_services` | `INTEGER` | `DEFAULT 0` | 서비스 객체 수 캐시 |
| `cached_service_groups` | `INTEGER` | `DEFAULT 0` | 서비스 그룹 수 캐시 |

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

## 1.1. 사용자 관리

### `users` Table (시스템 사용자)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY`, `NOT NULL` | 고유 식별자 |
| `username` | `VARCHAR` | `NOT NULL`, `UNIQUE` | 사용자명 |
| `email` | `VARCHAR` | `NOT NULL`, `UNIQUE` | 이메일 |
| `password_hash` | `VARCHAR` | `NOT NULL` | bcrypt 해시된 비밀번호 |
| `is_active` | `BOOLEAN` | `DEFAULT True` | 활성 사용자 여부 |
| `created_at` | `DATETIME` | `NOT NULL` | 계정 생성 시간 |
| `last_login_at` | `DATETIME` | `NULLABLE` | 마지막 로그인 시간 |

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
| `description` | `VARCHAR` | `NULLABLE` | 객체 설명 |
| `is_active` | `BOOLEAN` | `NOT NULL` | 현재 활성 상태 여부 |
| `last_seen_at` | `DATETIME` | `NOT NULL` | 마지막 확인 시간 |

### `network_groups` Table (네트워크 그룹)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `name` | `VARCHAR` | `NOT NULL` | 그룹명 |
| `members` | `VARCHAR` | `NULLABLE` | 멤버 리스트 (쉼표 구분) |
| `description` | `VARCHAR` | `NULLABLE` | 그룹 설명 |
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
| `description` | `VARCHAR` | `NULLABLE` | 서비스 설명 |
| `is_active` | `BOOLEAN` | `NOT NULL` | 활성 상태 |

### `service_groups` Table (서비스 그룹)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `name` | `VARCHAR` | `NOT NULL` | 그룹명 |
| `members` | `VARCHAR` | `NULLABLE` | 멤버 리스트 (쉼표 구분) |
| `description` | `VARCHAR` | `NULLABLE` | 그룹 설명 |
| `is_active` | `BOOLEAN` | `NOT NULL` | 활성 상태 |
| `last_seen_at` | `DATETIME` | `NOT NULL` | 마지막 확인 시간 |

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
| `task_type` | `ENUM` | `NOT NULL` | 분석 유형 (redundancy, unused, impact, unreferenced_objects, risky_ports, over_permissive) |
| `task_status` | `ENUM` | `NOT NULL` | 상태 (pending, in_progress, success, failure) |
| `created_at` | `DATETIME` | `NOT NULL` | 생성 시간 |
| `started_at` | `DATETIME` | `NULLABLE` | 분석 시작 시간 |
| `completed_at` | `DATETIME` | `NULLABLE` | 분석 완료 시간 |
| `error_message` | `VARCHAR` | `NULLABLE` | 실패 시 오류 메시지 |

### `analysis_results` Table (분석 결과)
- 실행(`analysistasks`)마다 새 행이 쌓여 이력으로 보존된다 (device_id+analysis_type 기준으로 덮어쓰지 않음).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY` | 장비 참조 |
| `analysis_type` | `VARCHAR` | `NOT NULL` | 분석 유형 |
| `task_id` | `INTEGER` | `FOREIGN KEY (analysistasks.id), NULLABLE` | 이 결과를 생성한 분석 실행 참조 (CASCADE, 컬럼 추가 이전 데이터 호환을 위해 nullable) |
| `result_data` | `JSON` | `NOT NULL` | 상세 결과 데이터 (JSON) |

### `redundancypolicysets` Table (중복 정책 분석 결과)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `task_id` | `INTEGER` | `FOREIGN KEY (analysistasks.id)` | 분석 작업 참조 (CASCADE) |
| `set_number` | `INTEGER` | `NOT NULL` | 중복 세트 번호 (같은 번호끼리 한 세트) |
| `type` | `ENUM` | `NOT NULL` | 정책 역할 (UPPER: 가리는 정책, LOWER: 가려지는 정책) |
| `policy_id` | `INTEGER` | `FOREIGN KEY (policies.id)` | 정책 참조 (CASCADE) |

### `notification_logs` Table (시스템 알림)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `timestamp` | `DATETIME` | `NOT NULL` | 발생 시간 |
| `title` | `VARCHAR` | `NOT NULL` | 제목 |
| `message` | `TEXT` | `NOT NULL` | 내용 |
| `type` | `VARCHAR` | `NOT NULL` | 타입 (info, error 등) |
| `category` | `VARCHAR` | `NULLABLE` | 카테고리 (sync, analysis) |

### `sync_histories` Table (동기화 이력)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY (devices.id)` | 장비 참조 |
| `sync_at` | `DATETIME` | `NOT NULL` | 동기화 실행 시간 |
| `total_policies` | `INTEGER` | `NULLABLE` | 동기화 후 전체 정책 수 |
| `created_count` | `INTEGER` | `DEFAULT 0` | 신규 생성된 항목 수 |
| `updated_count` | `INTEGER` | `DEFAULT 0` | 수정된 항목 수 |
| `deleted_count` | `INTEGER` | `DEFAULT 0` | 삭제된 항목 수 |

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

---

## 6. 삭제 워크플로우

### `deletion_workflow_projects` Table (삭제 워크플로우 프로젝트)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `device_id` | `INTEGER` | `FOREIGN KEY (devices.id)` | 장비 참조 |
| `name` | `VARCHAR` | `NOT NULL` | 프로젝트 이름 |
| `status` | `VARCHAR` | `DEFAULT 'draft'` | 상태 (draft, running, completed) |
| `memo` | `VARCHAR` | `NULLABLE` | 메모 |
| `created_at` | `DATETIME` | `NOT NULL` | 생성 시간 |
| `updated_at` | `DATETIME` | `NOT NULL` | 마지막 수정 시간 |

### `deletion_workflow_files` Table (삭제 워크플로우 파일)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `project_id` | `INTEGER` | `FOREIGN KEY (deletion_workflow_projects.id)` | 프로젝트 참조 (CASCADE) |
| `task_id` | `INTEGER` | `NOT NULL` | 파이프라인 태스크 번호 (0~14) |
| `slot` | `VARCHAR` | `NOT NULL` | 파일 슬롯 (output_0, output_1, external_1, external_2) |
| `filename` | `VARCHAR` | `NOT NULL` | 파일명 |
| `file_data` | `BLOB` | `NOT NULL` | 파일 바이너리 데이터 |
| `created_at` | `DATETIME` | `NOT NULL` | 생성 시간 |

> `(project_id, task_id, slot)` 조합이 UNIQUE 제약.
