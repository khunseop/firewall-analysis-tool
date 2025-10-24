import os
import json
from pathlib import Path
import sqlite3

from starlette.testclient import TestClient
import time

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

def create_test_device():
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/devices/",
            json={
                "name": "test",
                "ip_address": "1.1.1.1",
                "vendor": "mock",
                "username": "user",
                "password": "password"
            }
        )
        assert r.status_code in (200, 400), f"create device failed: {r.status_code} {r.text}"
        # 400 may indicate already exists in repeated runs

        # fetch device id
        devices = client.get("/api/v1/devices/").json()
        device = next((d for d in devices if d["name"] == "test"), None)
        assert device, "test device not found after creation"
        device_id = device["id"]

        # trigger policy sync
        resp = client.post(f"/api/v1/firewall/sync/{device_id}/policies")
        assert resp.status_code == 200, f"sync start failed: {resp.status_code} {resp.text}"

        # poll sync status until success or timeout
        deadline = time.time() + 10
        status = None
        while time.time() < deadline:
            s = client.get(f"/api/v1/firewall/sync/{device_id}/status")
            assert s.status_code == 200
            data = s.json()
            status = data.get("last_sync_status")
            if status == "success":
                break
            time.sleep(0.1)
        assert status == "success", f"sync did not succeed, status={status}"

        # verify policies exist and last_hit_at optional field appears
        pol = client.get(f"/api/v1/firewall/{device_id}/policies")
        assert pol.status_code == 200
        policies = pol.json()
        assert isinstance(policies, list) and len(policies) > 0
        # fields presence
        sample = policies[0]
        assert "last_hit_at" in sample and "last_hit_at_secondary" in sample

if __name__ == "__main__":
    test_docs_and_openapi()
    test_db_migrated()
    create_test_device()
    print(json.dumps({"status": "ok"}))
