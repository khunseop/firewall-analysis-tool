# CLAUDE.md

Guidance for Claude Code working on **FAT (Firewall Analysis Tool)**.
For architectural detail, see `CURRENT_ARCHITECTURE.md`.
For current tasks, see `TODO.md`.

---

## Environment

| Item | Value |
|------|-------|
| OS | Windows |
| Python | 3.11+ |
| DB | SQLite (`fat.db`) |
| Default port | 8000 |

`.env` is auto-generated on first run by `app/core/config.py`. Do not create it manually.

---

## Commands

```bash
# Install dependencies
pip install -r firewall_manager/requirements.txt

# Run server (must run from project root)
uvicorn app.main:app --reload --app-dir firewall_manager

# DB migrations
python firewall_manager/migrate.py                      # Apply latest
python firewall_manager/migrate.py current              # Check current revision
python firewall_manager/migrate.py history base:head    # View history

# Reindex a specific device
python firewall_manager/reindex_device.py
```

---

## Architecture

```
API Endpoints  (app/api/api_v1/endpoints/)
      ↓
Services       (app/services/)
      ↓
CRUD / DAO     (app/crud/)
      ↓
ORM Models     (app/models/)  ──►  SQLite fat.db  (via Alembic)
```

### Subsystems

| Subsystem | Path | Responsibility |
|-----------|------|----------------|
| Multi-vendor abstraction | `app/services/firewall/` | Interface → Factory → Vendor. Resolves correct vendor at runtime. |
| Sync pipeline | `app/services/sync/` | Orchestrates: connect → collect → transform → DB upsert → index → broadcast |
| Policy indexer | `app/services/policy_indexer.py` | Expands groups (DFS), converts to numeric IP/port ranges, bulk-inserts index |
| Range-based search | `app/crud/crud_policy.py` | SQL overlap check on `policy_address_members` / `policy_service_members` |
| Analysis engines | `app/services/analysis/` | 6 async engines tracked via `analysistasks` table; progress via WebSocket |
| Deletion workflow | `app/services/deletion_workflow/` | Config-driven processor pipeline → Excel export |
| Scheduler | `app/services/scheduler.py` | APScheduler; schedules persisted in `sync_schedules` and reloaded at startup |
| WebSocket manager | `app/services/websocket_manager.py` | Broadcasts sync stage and analysis progress to all frontend clients |

### Firewall Vendors

| Vendor | Transport | File |
|--------|-----------|------|
| Palo Alto | XML API + SSH (HA support) | `vendors/paloalto.py` |
| SECUI MF2 | SSH + CLI regex parsing | `vendors/mf2.py` |
| SECUI NGF | REST API | `vendors/ngf.py` |
| Mock | Deterministic random (testing) | `vendors/mock.py` |

### Analysis Engines

| Engine | File | Description |
|--------|------|-------------|
| Redundancy | `redundancy.py` | Policies shadowed by a higher-priority policy |
| Unused | `unused.py` | Policies with no hits in N days |
| Impact | `impact.py` | Simulates traffic changes when moving a policy |
| Unreferenced objects | `unreferenced_objects.py` | Objects not referenced by any policy |
| Risky ports | `risky_ports.py` | Policies allowing dangerous ports or any-service |
| Over-permissive | `over_permissive.py` | Overly broad policy detection |

### Frontend

Vanilla JS SPA served at `/app`. No framework.

| Library | Purpose |
|---------|---------|
| AG-Grid | Large policy dataset browsing |
| ApexCharts | Charts / dashboard |
| Bulma | CSS framework |
| ExcelJS | Client-side Excel generation |
| Tom-Select | Select dropdowns |
| Font Awesome | Icons |

API docs: `/docs` (Swagger) · `/redoc`

---

## Critical Constraints

- **DB**: Never edit `fat.db` directly. All schema changes must go through Alembic.
- **Passwords**: Always use `encrypt_password` / `decrypt_password` in `app/core/security.py`.
- **Frontend**: Vanilla JS only. Do not introduce React, Vue, or any JS framework.
- **Imports**: Use absolute paths from `app/` root.
  - ✅ `from app.services.sync.tasks import run_sync_all_orchestrator`
  - ❌ `from services.sync.tasks import ...`
- **Server startup**: Always run `uvicorn` from the project root, not from inside `firewall_manager/`.

---

## DB Schema Change Checklist

When modifying the database schema, complete **all** steps:

- [ ] Edit ORM model in `app/models/`
- [ ] Sync Pydantic schema in `app/schemas/`
- [ ] Generate migration: `alembic revision --autogenerate -m "describe change"`
- [ ] Review the generated migration file before applying
- [ ] Apply: `python firewall_manager/migrate.py`
- [ ] Update `DATABASE.md`

---

## Documentation Rules

Claude Code **must** update the relevant docs after completing any task.

| Document | Update when |
|----------|-------------|
| `TODO.md` | Task started (`[~]`) or completed (`[x]`) |
| `CLAUDE.md` | Environment, constraints, or architecture structure changes |
| `DATABASE.md` | Any schema change |
| `CURRENT_ARCHITECTURE.md` | Any structural change to services or layers |

> If a task touches multiple areas, update all relevant documents before closing the task.
