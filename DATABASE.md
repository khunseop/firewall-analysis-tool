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
