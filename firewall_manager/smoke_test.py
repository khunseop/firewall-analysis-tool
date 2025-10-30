import os
import json
from pathlib import Path
import sqlite3

from starlette.testclient import TestClient

from app.main import app


def get_db_path_from_env() -> Path:
    url = os.getenv("DATABASE_URL", "")
    # Expect format: sqlite+aiosqlite:///absolute/path/to/fat.db
    if url.startswith("sqlite+aiosqlite:///"):
        return Path(url.split("sqlite+aiosqlite:///", 1)[1])
    # Fallback to project root fat.db
    return Path(__file__).resolve().parent / "fat.db"


def test_docs_and_openapi():
    with TestClient(app) as client:
        r1 = client.get("/docs")
        assert r1.status_code == 200, f"/docs failed: {r1.status_code}"
        r2 = client.get("/redoc")
        assert r2.status_code == 200, f"/redoc failed: {r2.status_code}"
        r3 = client.get("/api/v1/openapi.json")
        assert r3.status_code == 200, f"openapi failed: {r3.status_code}"
        data = r3.json()
        assert "openapi" in data, "Invalid OpenAPI schema"


def test_db_migrated():
    db_path = get_db_path_from_env()
    assert db_path.exists(), f"DB file not found: {db_path}"
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='devices';")
        row = cur.fetchone()
        assert row and row[0] == "devices", "devices table missing"
    finally:
        con.close()

import time

def create_test_device():
    with TestClient(app) as client:
        # Check if device exists and delete it for idempotency
        response = client.get("/api/v1/devices/?limit=100")
        assert response.status_code == 200
        devices = response.json()
        test_device = next((d for d in devices if d["name"] == "test"), None)
        if test_device:
            delete_res = client.delete(f"/api/v1/devices/{test_device['id']}")
            assert delete_res.status_code == 200

        # Create the test device
        create_res = client.post(
            "/api/v1/devices/",
            json={"name": "test", "ip_address": "1.1.1.1", "vendor": "mock", "username": "user", "password": "password"}
        )
        assert create_res.status_code == 200, f"Failed to create device: {create_res.text}"
        return create_res.json()

def run_test_sync(device_id: int):
    with TestClient(app) as client:
        # Start sync
        sync_res = client.post(f"/api/v1/firewall/sync-all/{device_id}")
        assert sync_res.status_code == 200, f"Failed to start sync: {sync_res.text}"

        # Poll status until success
        for _ in range(30): # 30초 타임아웃
            status_res = client.get(f"/api/v1/firewall/sync/{device_id}/status")
            assert status_res.status_code == 200
            status = status_res.json().get("last_sync_status")
            if status == "success":
                return
            if status == "failure":
                raise AssertionError("Sync failed")
            time.sleep(1)
        raise TimeoutError("Sync did not complete in 30 seconds")


if __name__ == "__main__":
    test_docs_and_openapi()
    test_db_migrated()
    new_device = create_test_device()
    run_test_sync(new_device["id"])
    print(json.dumps({"status": "ok"}))
