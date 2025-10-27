# Database Schema Documentation

This document provides an overview of the database schema for the Firewall Analysis Tool.

## `devices` Table

Stores information about the firewall devices being managed.

| Column             | Type      | Constraints                | Description                               |
|--------------------|-----------|----------------------------|-------------------------------------------|
| `id`               | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the device.         |
| `name`             | `VARCHAR` | `NOT NULL`, `UNIQUE`       | User-defined name for the device.         |
| `ip_address`       | `VARCHAR` | `NOT NULL`, `UNIQUE`       | IP address of the device.                 |
| `vendor`           | `VARCHAR` | `NOT NULL`                 | Vendor of the device (e.g., Palo Alto).   |
| `username`         | `VARCHAR` | `NOT NULL`                 | Username for device authentication.       |
| `password`         | `VARCHAR` | `NOT NULL`                 | Fernet (symmetric) encrypted password.    |
| `description`      | `VARCHAR` | `NULLABLE`                 | A brief description of the device.        |
| `last_sync_at`     | `DATETIME`| `NULLABLE`                 | Timestamp of the last completed sync (success/failure). |
| `last_sync_status` | `VARCHAR` | `NULLABLE`                 | `in_progress`, `success`, or `failure`.   |

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
- Recommended (vendor dependent): composite index on (`ip_version`, `ip_start`, `ip_end`).

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
- Recommended: composite index on (`protocol`, `port_start`, `port_end`).

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

Note: legacy `flattened_*` columns may exist for backward compatibility, but querying and analysis should use the member index tables below.

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
| `token`       | `VARCHAR` | `NOT NULL`                 | Original token (object name or literal).                    |
| `token_type`  | `VARCHAR` | `NULLABLE`                 | any | ipv4_single | ipv4_cidr | ipv4_range | fqdn | unknown. |
| `ip_version`  | `INTEGER` | `NULLABLE`                 | 4 or 6; IPv6 numeric omitted by default (SQLite limits).    |
| `ip_start`    | `BIGINT`  | `NULLABLE`                 | IPv4 numeric start (inclusive).                              |
| `ip_end`      | `BIGINT`  | `NULLABLE`                 | IPv4 numeric end (inclusive).                                |

Indexes:
- `ix_policy_addr_members_lookup(device_id, direction, ip_version, ip_start, ip_end)`
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
  - `SELECT DISTINCT policy_id FROM policy_address_members WHERE device_id = ? AND direction = 'source' AND ip_version = 4 AND ip_start <= X_num AND ip_end >= X_num;`

- Find policies covering TCP port 443:
  - `SELECT DISTINCT policy_id FROM policy_service_members WHERE device_id = ? AND (protocol = 'tcp' OR protocol IS NULL) AND port_start <= 443 AND port_end >= 443;`

- Join to policies:
  - `SELECT p.* FROM policies p WHERE p.id IN (<subquery above>);`

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

- During policy sync, group members are resolved (including nested groups) via the resolver, then tokens are parsed and written into `policy_address_members` and `policy_service_members`.
- Re-indexing is performed per affected policy (existing rows for that policy are deleted and re-inserted).
- Raw literals present directly in policies (e.g., single IPs, CIDRs, tcp/80) are included, ensuring no loss versus object tables.

Notes:
- IPv6 numeric ranges are not stored by default due to SQLite 64-bit integer limitations. The fields remain NULL; future schema can extend to support IPv6 (e.g., hi/lo or BLOB).

### Policy Usage Tracking

- `policies.last_hit_date: DATETIME NULL`
  - NGF: 정책 수집 시 원천 데이터에 포함된 Last Hit Date를 저장. 값이 `-` 또는 공란이면 저장하지 않음(NULL 처리).
  - Palo Alto: 정책 수집 직후, 공급자 API의 rule-hit-count를 호출해 VSYS, Rule Name 기준으로 병합하여 `last_hit_date`를 보강 저장.
    - VSYS가 식별 가능한 경우 `(vsys, rule_name)`으로 매칭, 없으면 `rule_name`만으로 폴백.
  - MF2: 미지원. 항상 NULL 유지.

