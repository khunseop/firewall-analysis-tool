# Database Schema Documentation

This document provides an overview of the database schema for the Firewall Analysis Tool.

## `devices` Table

Stores information about the firewall devices being managed.

| Column                    | Type      | Constraints                | Description                                    |
|---------------------------|-----------|----------------------------|------------------------------------------------|
| `id`                      | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the device.              |
| `name`                    | `VARCHAR` | `NOT NULL`, `UNIQUE`       | User-defined name for the device.            |
| `ip_address`              | `VARCHAR` | `NOT NULL`, `UNIQUE`       | IP address of the device.                     |
| `vendor`                  | `VARCHAR` | `NOT NULL`                 | Vendor of the device (e.g., paloalto, secui). |
| `username`                | `VARCHAR` | `NOT NULL`                 | Username for device authentication.           |
| `password`                | `VARCHAR` | `NOT NULL`                 | Fernet (symmetric) encrypted password.        |
| `description`             | `VARCHAR` | `NULLABLE`                 | A brief description of the device.           |
| `ha_peer_ip`              | `VARCHAR` | `NULLABLE`                 | HA peer IP address (Palo Alto only).         |
| `use_ssh_for_last_hit_date`| `BOOLEAN` | `NULLABLE`, `DEFAULT False`| Use SSH instead of API for last_hit_date.    |
| `model`                   | `VARCHAR` | `NULLABLE`                 | Device model information.                      |
| `last_sync_at`            | `DATETIME`| `NULLABLE`                 | Timestamp of the last completed sync.         |
| `last_sync_status`        | `VARCHAR` | `NULLABLE`                 | `in_progress`, `success`, or `failure`.      |
| `last_sync_step`          | `VARCHAR` | `NULLABLE`                 | Current sync step message (e.g., "Collecting policies..."). |

### Indexes

- `ix_devices_id`: Index on the `id` column.
- `ix_devices_name`: Index on the `name` column.

## `change_logs` Table

Stores the history of changes made to firewall objects.

| Column        | Type      | Constraints                | Description                                           |
|---------------|-----------|----------------------------|-------------------------------------------------------|
| `id`          | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the log entry.                  |
| `timestamp`   | `DATETIME`| `NOT NULL`                 | Timestamp of when the change occurred.                |
| `device_id`   | `INTEGER` | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.                   |
| `data_type`   | `VARCHAR` | `NOT NULL`                 | The type of data that was changed (e.g., 'policies'). |
| `object_name` | `VARCHAR` | `NOT NULL`                 | The name or identifier of the object that changed.    |
| `action`      | `VARCHAR` | `NOT NULL`                 | The action performed ('created', 'updated', 'deleted').|
| `details`     | `JSON`    | `NULLABLE`                 | A JSON object containing details about the change.    |

### Indexes

- `ix_change_logs_id`: Index on the `id` column.

### Semantics

- On create/update/delete during synchronization, a row is appended:
  - `action`: `created` | `updated` | `deleted`
  - `details`: for updates, `{ "before": {..}, "after": {..} }` serialized to JSON

## `network_objects` Table

Stores information about the network objects.

| Column         | Type       | Constraints                | Description                                                                 |
|----------------|------------|----------------------------|-----------------------------------------------------------------------------|
| `id`           | `INTEGER`  | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the object.                                           |
| `device_id`    | `INTEGER`  | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.                                         |
| `name`         | `VARCHAR`  | `NOT NULL`                 | Name of the network object.                                                 |
| `ip_address`   | `VARCHAR`  | `NOT NULL`                 | Raw address string (single, CIDR, range, FQDN, any).                        |
| `type`         | `VARCHAR`  | `NULLABLE`                 | Type of the network object (e.g., ip-netmask, ip-range, fqdn).              |
| `description`  | `VARCHAR`  | `NULLABLE`                 | A brief description of the object.                                          |
| `ip_version`   | `INTEGER`  | `NULLABLE`                 | 4 when IPv4 numeric is available; 6 for IPv6, otherwise NULL (e.g., FQDN).  |
| `ip_start`     | `BIGINT`   | `NULLABLE`                 | Numeric start of IPv4 range (inclusive).                                    |
| `ip_end`       | `BIGINT`   | `NULLABLE`                 | Numeric end of IPv4 range (inclusive).                                      |
| `is_active`    | `BOOLEAN`  | `NOT NULL`                 | Whether the object is active (present in last sync).                        |
| `last_seen_at` | `DATETIME` | `NOT NULL`                 | Last time the object was confirmed present from source.                     |

### Indexes

- `ix_network_objects_id`: Index on the `id` column.
- `ix_network_objects_name`: Index on the `name` column.

## `network_groups` Table

Stores information about the network groups.

| Column         | Type      | Constraints                | Description                                  |
|----------------|-----------|----------------------------|----------------------------------------------|
| `id`           | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the group.             |
| `device_id`    | `INTEGER` | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.          |
| `name`         | `VARCHAR` | `NOT NULL`                 | Name of the network group.                   |
| `members`      | `VARCHAR` | `NULLABLE`                 | Comma-separated list of member object names. |
| `description`  | `VARCHAR` | `NULLABLE`                 | A brief description of the group.            |
| `is_active`    | `BOOLEAN` | `NOT NULL`                 | Whether the group is active (present in last sync).      |
| `last_seen_at` | `DATETIME`| `NOT NULL`                 | Last time the group was confirmed present.               |

### Indexes

- `ix_network_groups_id`: Index on the `id` column.
- `ix_network_groups_name`: Index on the `name` column.

## `services` Table

Stores information about the service objects.

| Column         | Type       | Constraints                | Description                                                |
|----------------|------------|----------------------------|------------------------------------------------------------|
| `id`           | `INTEGER`  | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the service.                         |
| `device_id`    | `INTEGER`  | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.                        |
| `name`         | `VARCHAR`  | `NOT NULL`                 | Name of the service object.                                |
| `protocol`     | `VARCHAR`  | `NULLABLE`                 | Protocol of the service (e.g., tcp, udp, icmp).            |
| `port`         | `VARCHAR`  | `NULLABLE`                 | Raw port definition (single, range, comma, any/*).         |
| `port_start`   | `INTEGER`  | `NULLABLE`                 | Numeric start port (inclusive). `any/*` → 0.               |
| `port_end`     | `INTEGER`  | `NULLABLE`                 | Numeric end port (inclusive). `any/*` → 65535.             |
| `description`  | `VARCHAR`  | `NULLABLE`                 | A brief description of the service.                        |
| `is_active`    | `BOOLEAN`  | `NOT NULL`                 | Whether the service is active (present in last sync).      |
| `last_seen_at` | `DATETIME` | `NOT NULL`                 | Last time the service was confirmed present.               |

### Indexes

- `ix_services_id`: Index on the `id` column.
- `ix_services_name`: Index on the `name` column.

## `service_groups` Table

Stores information about the service groups.

| Column         | Type      | Constraints                | Description                                   |
|----------------|-----------|----------------------------|-----------------------------------------------|
| `id`           | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the group.              |
| `device_id`    | `INTEGER` | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.           |
| `name`         | `VARCHAR` | `NOT NULL`                 | Name of the service group.                    |
| `members`      | `VARCHAR` | `NULLABLE`                 | Comma-separated list of member service names. |
| `description`  | `VARCHAR` | `NULLABLE`                 | A brief description of the group.             |
| `is_active`    | `BOOLEAN` | `NOT NULL`                 | Whether the group is active (present in last sync).      |
| `last_seen_at` | `DATETIME`| `NOT NULL`                 | Last time the group was confirmed present.               |

### Indexes

- `ix_service_groups_id`: Index on the `id` column.
- `ix_service_groups_name`: Index on the `name` column.

## `policies` Table

Stores information about the firewall policies.

| Column             | Type       | Constraints                | Description                                        |
|--------------------|------------|----------------------------|----------------------------------------------------|
| `id`               | `INTEGER`  | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the policy.                  |
| `device_id`        | `INTEGER`  | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.                |
| `vsys`             | `VARCHAR`  | `NULLABLE`                 | Virtual system name.                               |
| `seq`              | `INTEGER`  | `NULLABLE`                 | Sequence number of the policy.                     |
| `rule_name`        | `VARCHAR`  | `NOT NULL`                 | Name of the policy rule.                           |
| `enable`           | `BOOLEAN`  | `NULLABLE`                 | Whether the policy is enabled.                     |
| `action`           | `VARCHAR`  | `NOT NULL`                 | Action of the policy (e.g., allow, deny).          |
| `source`           | `VARCHAR`  | `NOT NULL`                 | Source field raw tokens (comma separated).         |
| `user`             | `VARCHAR`  | `NULLABLE`                 | User of the traffic.                               |
| `destination`      | `VARCHAR`  | `NOT NULL`                 | Destination field raw tokens (comma separated).    |
| `service`          | `VARCHAR`  | `NOT NULL`                 | Service field raw tokens (comma separated).        |
| `application`      | `VARCHAR`  | `NULLABLE`                 | Application of the traffic.                        |
| `security_profile` | `VARCHAR`  | `NULLABLE`                 | Security profile of the policy.                    |
| `category`         | `VARCHAR`  | `NULLABLE`                 | Category of the policy.                            |
| `description`      | `VARCHAR`  | `NULLABLE`                 | A brief description of the policy.                 |
| `last_hit_date`    | `DATETIME` | `NULLABLE`                 | Last usage timestamp (vendor-dependent enrichment).|
| `is_active`        | `BOOLEAN`  | `NOT NULL`                 | Whether the policy is active (present in last sync). |
| `last_seen_at`     | `DATETIME` | `NOT NULL`                 | Last time the policy was confirmed present.        |
| `is_indexed`        | `BOOLEAN`  | `NOT NULL`, `DEFAULT False`| Whether the policy has been indexed.                |

### Indexes

- `ix_policies_id`: Index on the `id` column.
- `ix_policies_rule_name`: Index on the `rule_name` column.

## Policy Member Index Tables

These tables store policy members as numeric ranges for high-performance search and analysis, covering both object references and raw literals entered directly in policies.

### `policy_address_members`

| Column        | Type      | Constraints                | Description                                                 |
|---------------|-----------|----------------------------|-------------------------------------------------------------|
| `id`          | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Row id.                                                     |
| `device_id`   | `INTEGER` | `FOREIGN KEY (devices.id)` | Device id.                                                  |
| `policy_id`   | `INTEGER` | `FOREIGN KEY (policies.id)`| Policy id.                                                  |
| `direction`   | `VARCHAR` | `NOT NULL`                 | 'source' or 'destination'.                                  |
| `token`       | `VARCHAR` | `NULLABLE`                 | Original token (for empty groups).                          |
| `token_type`  | `VARCHAR` | `NULLABLE`                 | 'ipv4_range' | 'unknown'.                                                  |
| `ip_start`    | `BIGINT`  | `NULLABLE`                 | IPv4 numeric start (inclusive).                              |
| `ip_end`      | `BIGINT`  | `NULLABLE`                 | IPv4 numeric end (inclusive).                                |

Indexes:
- `ix_policy_addr_members_lookup(device_id, direction, ip_start, ip_end)`
- `ix_policy_addr_members_policy(policy_id)`

### `policy_service_members`

| Column        | Type      | Constraints                | Description                                      |
|---------------|-----------|----------------------------|--------------------------------------------------|
| `id`          | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Row id.                                          |
| `device_id`   | `INTEGER` | `FOREIGN KEY (devices.id)` | Device id.                                       |
| `policy_id`   | `INTEGER` | `FOREIGN KEY (policies.id)`| Policy id.                                       |
| `token`       | `VARCHAR` | `NOT NULL`                 | Original token (object name or literal).         |
| `token_type`  | `VARCHAR` | `NULLABLE`                 | proto_port | any | unknown.                      |
| `protocol`    | `VARCHAR` | `NULLABLE`                 | Protocol (lowercase).                             |
| `port_start`  | `INTEGER` | `NULLABLE`                 | Start port (inclusive).                           |
| `port_end`    | `INTEGER` | `NULLABLE`                 | End port (inclusive).                             |

Indexes:
- `ix_policy_svc_members_lookup(device_id, protocol, port_start, port_end)`
- `ix_policy_svc_members_policy(policy_id)`

### Query Patterns (Examples)

- Find policies covering an IPv4 address X as source:
  - Compute `X_num = IPv4Address(X)`; then
  - `SELECT DISTINCT policy_id FROM policy_address_members WHERE device_id = ? AND direction = 'source' AND ip_start <= X_num AND ip_end >= X_num;`

- Find policies covering TCP port 443:
  - `SELECT DISTINCT policy_id FROM policy_service_members WHERE device_id = ? AND (protocol = 'tcp' OR protocol IS NULL) AND port_start <= 443 AND port_end >= 443;`

- Join to policies:
  - `SELECT p.* FROM policies p WHERE p.id IN (<subquery above>);`

---

## `analysistasks` Table

Stores analysis task information.

| Column         | Type      | Constraints                | Description                                    |
|----------------|-----------|----------------------------|------------------------------------------------|
| `id`           | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the task.              |
| `device_id`    | `INTEGER` | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.          |
| `task_type`    | `ENUM`    | `NOT NULL`                 | Task type: redundancy, unused, impact, unreferenced_objects, risky_ports. |
| `task_status`  | `ENUM`    | `NOT NULL`                 | Task status: pending, in_progress, success, failure. |
| `created_at`   | `DATETIME`| `NOT NULL`                 | Task creation timestamp.                      |
| `started_at`   | `DATETIME`| `NULLABLE`                 | Task start timestamp.                         |
| `completed_at` | `DATETIME`| `NULLABLE`                 | Task completion timestamp.                    |

## `redundancypolicysets` Table

Stores redundancy analysis results linking policies.

| Column        | Type      | Constraints                | Description                                    |
|---------------|-----------|----------------------------|------------------------------------------------|
| `id`          | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier.                             |
| `task_id`     | `INTEGER` | `FOREIGN KEY (analysistasks.id)` | Foreign key to the analysis task.         |
| `set_number`  | `INTEGER` | `NOT NULL`                 | Set number for grouping redundant policies.    |
| `type`        | `ENUM`    | `NOT NULL`                 | 'UPPER' or 'LOWER' policy type.               |
| `policy_id`   | `INTEGER` | `FOREIGN KEY (policies.id)`| Foreign key to the policy.                     |

### Indexes

- `ix_redundancypolicysets_set_number`: Index on the `set_number` column.

## `analysis_results` Table

Stores analysis results in JSON format.

| Column         | Type      | Constraints                | Description                                    |
|----------------|-----------|----------------------------|------------------------------------------------|
| `id`           | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier.                             |
| `device_id`    | `INTEGER` | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.           |
| `analysis_type`| `VARCHAR`| `NOT NULL`                 | Type of analysis (e.g., risky_ports).         |
| `result_data`  | `JSON`    | `NOT NULL`                 | Analysis results in JSON format.               |
| `created_at`   | `DATETIME`| `NOT NULL`                 | Result creation timestamp.                      |

### Indexes

- `ix_analysis_results_device_id`: Index on the `device_id` column.
- `ix_analysis_results_analysis_type`: Index on the `analysis_type` column.

## `notification_logs` Table

Stores system notification logs for sync and analysis operations.

| Column         | Type      | Constraints                | Description                                    |
|----------------|-----------|----------------------------|------------------------------------------------|
| `id`           | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier.                             |
| `timestamp`    | `DATETIME`| `NOT NULL`                 | Notification timestamp.                         |
| `title`        | `VARCHAR` | `NOT NULL`                 | Notification title.                            |
| `message`      | `TEXT`    | `NOT NULL`                 | Notification message.                          |
| `type`         | `VARCHAR` | `NOT NULL`                 | Notification type: info, success, warning, error. |
| `category`     | `VARCHAR` | `NULLABLE`                 | Category: sync, analysis, system.            |
| `device_id`    | `INTEGER` | `NULLABLE`                 | Related device ID (optional).                  |
| `device_name`  | `VARCHAR` | `NULLABLE`                 | Device name (cached).                          |

### Indexes

- `ix_notification_logs_timestamp`: Index on the `timestamp` column.
- `ix_notification_logs_type`: Index on the `type` column.
- `ix_notification_logs_category`: Index on the `category` column.
- `ix_notification_logs_device_id`: Index on the `device_id` column.

## `settings` Table

Stores application settings.

| Column         | Type      | Constraints                | Description                                    |
|----------------|-----------|----------------------------|------------------------------------------------|
| `key`          | `VARCHAR` | `PRIMARY KEY`, `NOT NULL`  | Setting key (e.g., sync_parallel_limit).      |
| `value`        | `VARCHAR` | `NOT NULL`                 | Setting value.                                 |
| `description`  | `VARCHAR` | `NULLABLE`                 | Setting description.                            |

### Indexes

- `ix_settings_key`: Index on the `key` column.

## `sync_schedules` Table

Stores scheduled synchronization tasks.

| Column           | Type      | Constraints                | Description                                    |
|------------------|-----------|----------------------------|------------------------------------------------|
| `id`             | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier.                             |
| `name`           | `VARCHAR` | `NOT NULL`, `UNIQUE`       | Schedule name.                                 |
| `enabled`        | `BOOLEAN` | `NOT NULL`, `DEFAULT True` | Whether the schedule is enabled.               |
| `days_of_week`   | `JSON`    | `NOT NULL`                 | Days of week: [0,1,2,3,4,5,6] (Mon-Sun).     |
| `time`           | `VARCHAR` | `NOT NULL`                 | Time in "HH:MM" format.                        |
| `device_ids`     | `JSON`    | `NOT NULL`                 | List of device IDs to sync.                    |
| `description`    | `VARCHAR` | `NULLABLE`                 | Schedule description.                           |
| `created_at`     | `DATETIME`| `NOT NULL`                 | Creation timestamp.                             |
| `updated_at`     | `DATETIME`| `NOT NULL`                 | Last update timestamp.                          |
| `last_run_at`    | `DATETIME`| `NULLABLE`                 | Last execution timestamp.                      |
| `last_run_status`| `VARCHAR` | `NULLABLE`                 | Last execution status: success, failure.       |

---

## Synchronization Semantics

- Device-level status:
  - When a sync request is accepted, `devices.last_sync_status` is set to `in_progress`.
  - On completion: set `success` or `failure`; `last_sync_at` is only updated at completion.

- Object lifecycle on sync:
  - New: insert rows for objects present in source but missing in DB.
  - Update: compare by key (`policies.rule_name`, otherwise `name`); persist diffs and write `change_logs` with before/after.
  - Delete: remove DB rows missing from source; write `change_logs` with `deleted`.
  - Touch: for objects seen in source, set `last_seen_at=now()` and keep `is_active=True`.

### Policy Flattening and Indexing

- 정책 인덱싱은 동기화와 분리된 전용 단계로 수행됩니다. `sync-all` 완료 후 자동으로 실행되며, 필요 시 수동 호출할 수 있습니다.
- 그룹 전개 및 값 치환 후 토큰을 파싱하여 `policy_address_members`와 `policy_service_members`에 기록합니다.
- IP 범위 병합: 개별 IP/CIDR을 숫자 범위로 변환 후 연속 범위를 병합하여 저장 공간을 절약합니다.
- Raw literals present directly in policies (e.g., single IPs, CIDRs, tcp/80) are included, ensuring no loss versus object tables.
- IPv4 전용: IPv6 numeric ranges are not stored by default due to SQLite 64-bit integer limitations.

### Policy Usage Tracking

- `policies.last_hit_date: DATETIME NULL`
  - **NGF**: 정책 수집 시 원천 데이터에 포함된 Last Hit Date를 저장. 값이 `-` 또는 공란이면 저장하지 않음(NULL 처리).
  - **Palo Alto**: 정책 수집 직후, API 또는 SSH를 통해 rule-hit-count를 호출해 VSYS, Rule Name 기준으로 병합하여 `last_hit_date`를 보강 저장.
    - VSYS가 식별 가능한 경우 `(vsys, rule_name)`으로 매칭, 없으면 `rule_name`만으로 폴백.
    - HA Peer IP가 설정된 경우, 메인 장비와 HA Peer에서 모두 수집 후 최신 타임스탬프를 선택.
    - `use_ssh_for_last_hit_date` 옵션으로 API 대신 SSH를 통한 수집 가능.
  - **MF2**: 미지원. 항상 NULL 유지.

