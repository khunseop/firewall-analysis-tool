# Database Schema Documentation

This document provides an overview of the database schema for the Firewall Analysis Tool.

## `devices` Table

Stores information about the firewall devices being managed.

| Column        | Type      | Constraints                | Description                               |
|---------------|-----------|----------------------------|-------------------------------------------|
| `id`          | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the device.         |
| `name`        | `VARCHAR` | `NOT NULL`, `UNIQUE`       | User-defined name for the device.         |
| `ip_address`  | `VARCHAR` | `NOT NULL`, `UNIQUE`       | IP address of the device.                 |
| `vendor`      | `VARCHAR` | `NOT NULL`                 | Vendor of the device (e.g., Palo Alto).   |
| `username`    | `VARCHAR` | `NOT NULL`                 | Username for device authentication.       |
| `password`    | `VARCHAR` | `NOT NULL`                 | Fernet (symmetric) encrypted password.    |
| `description` | `VARCHAR` | `NULLABLE`                 | A brief description of the device.        |

### Indexes

- `ix_devices_id`: Index on the `id` column.
- `ix_devices_name`: Index on the `name` column.

## `network_objects` Table

Stores information about the network objects.

| Column        | Type      | Constraints                | Description                               |
|---------------|-----------|----------------------------|-------------------------------------------|
| `id`          | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the object.         |
| `device_id`   | `INTEGER` | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.       |
| `name`        | `VARCHAR` | `NOT NULL`                 | Name of the network object.               |
| `ip_address`  | `VARCHAR` | `NOT NULL`                 | IP address of the network object.         |
| `description` | `VARCHAR` | `NULLABLE`                 | A brief description of the object.        |

### Indexes

- `ix_network_objects_id`: Index on the `id` column.
- `ix_network_objects_name`: Index on the `name` column.

## `policies` Table

Stores information about the firewall policies.

| Column            | Type      | Constraints                | Description                               |
|-------------------|-----------|----------------------------|-------------------------------------------|
| `id`              | `INTEGER` | `PRIMARY KEY`, `NOT NULL`  | Unique identifier for the policy.         |
| `device_id`       | `INTEGER` | `FOREIGN KEY (devices.id)` | Foreign key to the `devices` table.       |
| `vsys`            | `VARCHAR` | `NULLABLE`                 | Virtual system name.                      |
| `seq`             | `INTEGER` | `NULLABLE`                 | Sequence number of the policy.            |
| `rule_name`       | `VARCHAR` | `NOT NULL`                 | Name of the policy rule.                  |
| `enable`          | `BOOLEAN` | `NULLABLE`                 | Whether the policy is enabled.            |
| `action`          | `VARCHAR` | `NOT NULL`                 | Action of the policy (e.g., allow, deny). |
| `source`          | `VARCHAR` | `NOT NULL`                 | Source of the traffic.                    |
| `user`            | `VARCHAR` | `NULLABLE`                 | User of the traffic.                      |
| `destination`     | `VARCHAR` | `NOT NULL`                 | Destination of the traffic.               |
| `service`         | `VARCHAR` | `NOT NULL`                 | Service of the traffic.                   |
| `application`     | `VARCHAR` | `NULLABLE`                 | Application of the traffic.               |
| `security_profile`| `VARCHAR` | `NULLABLE`                 | Security profile of the policy.           |
| `category`        | `VARCHAR` | `NULLABLE`                 | Category of the policy.                   |
| `description`     | `VARCHAR` | `NULLABLE`                 | A brief description of the policy.        |

### Indexes

- `ix_policies_id`: Index on the `id` column.
- `ix_policies_rule_name`: Index on the `rule_name` column.
