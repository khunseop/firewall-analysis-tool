# Project Tasks

This document tracks the development progress of the Firewall Analysis Tool.

## Future Tasks (To Do)

### Implement Change Tracking for Data Synchronization

The current data synchronization process overwrites existing data, which prevents tracking of historical changes. The following tasks will modify this to an "upsert" and "soft-delete" model.

- [ ] **Modify Database Schema:**
    - [ ] Add `is_active` (Boolean, default `True`) and `last_seen_at` (DateTime) columns to the following models:
        - [ ] `policy.py`
        - [ ] `network_object.py`
        - [ ] `network_group.py`
        - [ ] `service.py`
        - [ ] `service_group.py`
    - [ ] Update the corresponding Pydantic schemas to include the new fields.
    - [ ] Create and apply a new Alembic database migration for these schema changes.

- [ ] **Update Data Synchronization Logic (`firewall_data.py`):**
    - [ ] Modify the `_sync_data_task` to implement the new upsert/soft-delete strategy.
    - [ ] Before processing firewall data, fetch all existing active objects for the device from the database into a dictionary for quick lookups.
    - [ ] For each item received from the firewall:
        - If the item exists in the database dictionary: Update its contents if they have changed and set `is_active=True` and `last_seen_at` to the current time. Remove it from the dictionary.
        - If the item does not exist: Create it as a new record.
    - [ ] After the loop, any items remaining in the database dictionary were not seen in the latest sync. Mark all of them as `is_active = False`.

- [ ] **Update CRUD Functions:**
    - [ ] Modify all `get` functions (e.g., `get_policies_by_device`) to filter for `is_active == True` by default, so that "deleted" items are not returned by standard API calls.

## Completed Tasks

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
