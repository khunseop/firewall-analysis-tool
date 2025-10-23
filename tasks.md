# Project Tasks

This document tracks the development progress of the Firewall Analysis Tool.

## Future Tasks (To Do)


## Completed Tasks
- [x] **Implement Sync Status Tracking:**
    - [x] **Add Status Endpoint:** Created a new `GET /firewall/sync/{device_id}/status` endpoint to allow polling for the current synchronization status.
    - [x] **Update Sync Logic:** Modified the synchronization task to update the `last_sync_status` to "in_progress" at the start and "success" or "failure" upon completion.
    - [x] **Add Pydantic Schema:** Created a `DeviceSyncStatus` schema for the new endpoint.
    - [x] **Update Documentation:** Added the new endpoint to `AGENTS.md`.

- [x] **Implement Change Tracking for Data Synchronization (Overwrite-and-Log):**
    - [x] **Architectural Shift:** Replaced the previous "soft-delete" model with a more robust "overwrite-and-log" strategy to provide a clear audit trail of all changes.
    - [x] **Remove Soft-Delete Columns:** Deleted the `is_active` and `last_seen_at` columns from the `Policy`, `NetworkObject`, `NetworkGroup`, `Service`, and `ServiceGroup` models and created a database migration to apply these changes.
    - [x] **Add Change Log Feature:**
        - [x] Created a new `ChangeLog` model to store the history of created, updated, and deleted objects.
        - [x] Implemented a corresponding Pydantic schema and CRUD functions for the change log.
        - [x] Created a database migration to add the new `change_logs` table.
    - [x] **Rewrite Synchronization Logic:**
        - [x] Overhauled the `_sync_data_task` to compare firewall data with the database.
        - [x] Implemented logic to create new items, delete old items, and update existing items.
        - [x] For every change (create, update, delete), a detailed entry is now recorded in the `change_logs` table.
    - [x] **Simplify CRUD:** Refactored the CRUD functions for policies and objects to use simple `delete` operations, removing the now-obsolete soft-delete logic.
    - [x] **Update Documentation:** Updated `DATABASE.md` to reflect the removal of old columns and the addition of the `change_logs` table.

- [x] **Initial Project Setup:**
    - [x] Established the core FastAPI application structure.
    - [x] Implemented the initial database schema for Devices.
    - [x] Set up basic CRUD operations and API endpoints for device management.

- [x] **Schema and Feature Expansion:**
    - [x] Expanded the `Policy` model with detailed columns to match vendor specifications.
    - [x] Created new database models, Pydantic schemas, and CRUD functions for `NetworkObject`, `NetworkGroup`, `Service`, and `ServiceGroup`.
    - [x] Updated the `DATABASE.md` documentation to reflect the complete schema.
    - [x] Created a single, clean initial database migration file.
    - [x] Implemented a generic, background-task-based API endpoint for synchronizing all data types from firewalls.
    - [x] Added a data transformation layer to handle differences between vendor data formats and the application's Pydantic models.
