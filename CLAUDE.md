# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Install dependencies:**
```bash
pip install -r firewall_manager/requirements.txt
```

**Run the server (from project root):**
```bash
uvicorn app.main:app --reload --app-dir firewall_manager
```

**Database migrations:**
```bash
python3 firewall_manager/migrate.py           # Apply latest migrations
python3 firewall_manager/migrate.py current   # Check current revision
python3 firewall_manager/migrate.py history base:head  # View history
```

**Reindex a specific device:**
```bash
python3 firewall_manager/reindex_device.py
```

**Integration test:**
```bash
cd firewall_manager && python3 smoke_test.py
```

There is no unit test suite, linter configuration, or Makefile. The smoke test requires a running server and exercises device creation, sync, and policy search.

## Architecture

FAT (Firewall Analysis Tool) is an async FastAPI application that aggregates and analyzes security policies from multi-vendor firewalls (Palo Alto, SECUI MF2, SECUI NGF). All application code lives under `firewall_manager/`.

### Layers

```
API Endpoints  (app/api/api_v1/endpoints/)
      ↓
Services       (app/services/)
      ↓
CRUD / DAO     (app/crud/)
      ↓
ORM Models     (app/models/)  →  SQLite fat.db (via Alembic)
```

### Key subsystems

**Multi-vendor abstraction** (`app/services/firewall/`): Interface-Factory-Vendor pattern. `interface.py` defines the abstract base; `factory.py` resolves the correct vendor at runtime. Vendors:
- `vendors/paloalto.py` — Palo Alto XML API + optional SSH for last-hit dates, HA support
- `vendors/mf2.py` — SECUI MF2 via SSH + CLI regex parsing
- `vendors/ngf.py` — SECUI NGF via REST API
- `vendors/mock.py` — Deterministic random policies for testing

**Sync pipeline** (`app/services/sync/`):
- `tasks.py` — Orchestrator (`run_sync_all_orchestrator`): semaphore → connect → collect objects/policies → HA hit-date merge → DB upsert → trigger indexer → broadcast progress
- `collector.py` — Device connector with Fernet password decryption
- `transform.py` — Vendor DataFrames → Pydantic models

**Policy indexer** (`app/services/policy_indexer.py`): Expands nested address/service groups via recursive DFS with memoization, converts all members to numeric IP/port boundaries, merges overlapping ranges (greedy interval merging), then bulk-inserts into `policy_address_members` and `policy_service_members`. This is what enables O(n) range-based policy search.

**Range-based search** (`app/crud/crud_policy.py`): Searches use the index tables with a SQL overlap check (`ip_start <= :end AND ip_end >= :start`), not full-table policy scans.

**Analysis engines** (`app/services/analysis/`): Six async engines, each tracked in `analysistasks`/`analysis_results`. Progress is broadcast over WebSocket.
- `redundancy.py` — Policies made redundant by a higher-priority policy
- `unused.py` — Policies with no hits in N days
- `impact.py` — Simulates traffic flow changes (shadowing, blocking) when moving a policy
- `unreferenced_objects.py` — Network/service objects not referenced by any policy
- `risky_ports.py` — Policies allowing dangerous ports (Telnet, etc.) or any-service
- `over_permissive.py` — Overly permissive policy detection

**Deletion workflow** (`app/services/deletion_workflow/`): Config-driven multi-step processor pipeline: parse request → extract → enrich with device info → classify duplicates → aggregate applications → add MIS IDs → export to Excel.

**Scheduler** (`app/services/scheduler.py`): APScheduler-based recurring sync. Schedules persisted in `sync_schedules` table and reloaded at startup.

**Real-time updates** (`app/services/websocket_manager.py`): Single manager broadcasts sync stage and analysis progress to all connected frontend clients.

### Configuration & environment

`app/core/config.py` auto-generates `.env` at the project root on first startup:
- `DATABASE_URL` — defaults to `sqlite+aiosqlite:///<project_root>/fat.db`
- `ENCRYPTION_KEY` — auto-generated Fernet key for credential encryption

`app/core/security.py` provides `encrypt_password` / `decrypt_password` using the Fernet key.

### Frontend

Vanilla JS SPA served at `/app`. No framework (no React/Vue). Libraries bundled under `app/static/vendor/`:
- **AG-Grid** — large policy dataset browsing
- **ApexCharts** — charts/dashboard
- **Bulma** — CSS framework
- **ExcelJS** — client-side Excel generation
- **Tom-Select** — select dropdowns
- **Font Awesome** — icons

Pages: Dashboard, Devices, Policies, Objects, Analysis, Deletion Workflow, Schedules, Settings.

API docs at `/docs` (Swagger) and `/redoc`.

### Database

Default: SQLite (`fat.db`). 26 Alembic migrations in `alembic/versions/`.

Key tables:
- `devices` — registered firewall devices
- `policies` — security policies
- `policy_address_members`, `policy_service_members` — numeric range index (core of fast search)
- `network_objects`, `network_groups`, `services`, `service_groups` — object definitions
- `analysistasks`, `redundancypolicysets`, `analysis_results` — analysis tracking
- `change_logs` — per-sync change history (created/updated/deleted/hit_date_updated)
- `sync_schedules` — recurring sync config
- `deletion_workflows` — deletion workflow state
- `notification_logs`, `settings`

## Project structure

```
firewall-analysis-tool/
├── CLAUDE.md
├── CURRENT_ARCHITECTURE.md            # System architecture (Korean)
├── DATABASE.md                        # Full DB schema reference
├── SETUP.md                           # Installation & setup guide
├── AGENTS.md                          # Multi-vendor feature overview
├── DELETION_WORKFLOW.md               # Deletion workflow process docs
├── TODO.md                            # Roadmap & completed work
│
└── firewall_manager/                  # All application code
    ├── requirements.txt
    ├── smoke_test.py                  # Integration test (requires running server)
    ├── migrate.py                     # Alembic migration wrapper
    ├── reindex_device.py              # Standalone reindex utility
    ├── alembic.ini
    ├── alembic/versions/              # 26 migration files
    ├── config/
    │   └── deletion_workflow_config.example.json
    └── app/
        ├── main.py                    # FastAPI app, router registration, scheduler lifecycle
        ├── core/
        │   ├── config.py              # Env/config, auto-generates .env
        │   └── security.py            # Fernet encrypt/decrypt
        ├── db/
        │   └── session.py             # Async SQLAlchemy session factory
        ├── api/api_v1/
        │   ├── api.py                 # Aggregates all routers
        │   └── endpoints/
        │       ├── devices.py
        │       ├── firewall_sync.py
        │       ├── firewall_query.py
        │       ├── export.py
        │       ├── analysis.py
        │       ├── deletion_workflow.py
        │       ├── sync_schedule.py
        │       ├── settings.py
        │       ├── notifications.py
        │       └── websocket.py
        ├── models/
        │   ├── device.py
        │   ├── policy.py
        │   ├── policy_members.py      # PolicyAddressMember, PolicyServiceMember
        │   ├── network_object.py
        │   ├── network_group.py
        │   ├── service.py
        │   ├── service_group.py
        │   ├── analysis.py            # AnalysisTask, RedundancyPolicySet, AnalysisResult
        │   ├── change_log.py
        │   ├── notification_log.py
        │   ├── sync_schedule.py
        │   ├── deletion_workflow.py
        │   └── settings.py
        ├── schemas/                   # Pydantic schemas mirroring models/
        │   ├── device.py, policy.py, network_object.py, network_group.py
        │   ├── service.py, service_group.py, analysis.py, change_log.py
        │   ├── notification_log.py, sync_schedule.py, settings.py
        │   ├── msg.py                 # Generic message schemas
        │   └── object_search.py       # Search request schemas
        ├── crud/
        │   ├── crud_device.py
        │   ├── crud_policy.py         # Range-based search via index tables
        │   ├── crud_network_object.py
        │   ├── crud_network_group.py
        │   ├── crud_service.py
        │   ├── crud_service_group.py
        │   ├── crud_analysis.py
        │   ├── crud_change_log.py
        │   ├── crud_notification_log.py
        │   ├── crud_settings.py
        │   └── crud_sync_schedule.py
        ├── services/
        │   ├── device_service.py      # Connection test utility
        │   ├── policy_indexer.py      # Core indexing engine
        │   ├── normalize.py           # Data normalization utilities
        │   ├── scheduler.py           # APScheduler integration
        │   ├── websocket_manager.py   # WebSocket broadcast manager
        │   ├── firewall/
        │   │   ├── interface.py       # Abstract FirewallInterface
        │   │   ├── factory.py         # FirewallCollectorFactory
        │   │   ├── exceptions.py      # Auth, Connection, API, Unsupported errors
        │   │   └── vendors/
        │   │       ├── paloalto.py
        │   │       ├── mf2.py
        │   │       ├── ngf.py
        │   │       └── mock.py
        │   ├── sync/
        │   │   ├── tasks.py           # Sync orchestrator & task runner
        │   │   ├── collector.py       # Device connector
        │   │   └── transform.py       # Raw data → Pydantic models
        │   ├── analysis/
        │   │   ├── tasks.py           # Async task management & locking
        │   │   ├── redundancy.py
        │   │   ├── unused.py
        │   │   ├── impact.py
        │   │   ├── unreferenced_objects.py
        │   │   ├── risky_ports.py
        │   │   └── over_permissive.py
        │   └── deletion_workflow/
        │       ├── workflow_manager.py
        │       ├── config_manager.py
        │       ├── file_manager.py
        │       ├── excel_manager.py
        │       ├── final_exporter.py
        │       └── processors/
        │           ├── request_parser.py
        │           ├── request_extractor.py
        │           ├── request_info_adder.py
        │           ├── duplicate_policy_classifier.py
        │           ├── application_aggregator.py
        │           ├── mis_id_adder.py
        │           └── exception_handler.py
        ├── frontend/
        │   ├── index.html
        │   ├── templates/             # Per-page HTML (dashboard, devices, policies,
        │   │                          #   objects, analysis, deletion_workflow,
        │   │                          #   schedules, settings)
        │   ├── js/
        │   │   ├── main.js, api.js, router.js
        │   │   ├── components/        # navbar, objectDetailModal, impactAnalysis
        │   │   ├── pages/             # Per-page JS + analysis/ sub-pages
        │   │   └── utils/             # date, dom, excel, export, grid, loading,
        │   │                          #   message, modal, notification, scriptGenerator,
        │   │                          #   storage + analysis/{columns,helpers}/
        │   └── styles/
        │       ├── app.css
        │       └── modules/           # variables, base, layout, components,
        │                              #   dashboard, grid, modal, notification, etc.
        └── static/
            ├── swagger-ui-bundle.js, swagger-ui.css
            ├── redoc.standalone.js
            ├── images/favicon.ico
            └── vendor/
                ├── ag-grid/
                ├── apexcharts/
                ├── bulma/
                ├── exceljs/
                ├── font-awesome/
                └── tom-select/
```
