# firewall_manager/smoke_test.py
import os
import json
from pathlib import Path
import time
import logging

from starlette.testclient import TestClient

from app.main import app

logging.basicConfig(level=logging.INFO)

def get_db_path_from_env() -> Path:
    url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///firewall_manager/fat.db")
    return Path(url.split("sqlite+aiosqlite:///", 1)[1])

def setup_database():
    db_path = get_db_path_from_env()
    if db_path.exists():
        os.remove(db_path)

    import subprocess
    alembic_ini_path = Path(__file__).resolve().parent / "alembic.ini"
    subprocess.run(["python3", "-m", "alembic", "-c", str(alembic_ini_path), "upgrade", "head"], check=True)

def create_test_device(client: TestClient):
    response = client.get("/api/v1/devices/?limit=100")
    assert response.status_code == 200
    test_device = next((d for d in response.json() if d["name"] == "test-mock"), None)
    if test_device:
        client.delete(f"/api/v1/devices/{test_device['id']}")

    create_res = client.post("/api/v1/devices/", json={"name": "test-mock", "ip_address": "1.1.1.1", "vendor": "mock", "username": "user", "password": "password", "password_confirm": "password"})
    assert create_res.status_code == 200
    return create_res.json()

def run_sync(client: TestClient, device_id: int):
    sync_res = client.post(f"/api/v1/firewall/sync-all/{device_id}")
    assert sync_res.status_code == 200
    for _ in range(30):
        status_res = client.get(f"/api/v1/firewall/sync/{device_id}/status")
        if status_res.json().get("last_sync_status") == "success":
            return
        time.sleep(1)
    raise TimeoutError("Sync did not complete")

def test_policy_search_scenarios(client: TestClient, device_id: int):
    logging.info("\n--- Testing Policy Search Scenarios ---")

    def _search_and_assert(description: str, payload: dict, min_results: int = 1):
        logging.info(f"  - Testing: {description}")
        full_payload = {"device_ids": [device_id], **payload}
        response = client.post("/api/v1/firewall/policies/search", json=full_payload)
        assert response.status_code == 200, f"Search failed for '{description}'"
        results = response.json()['policies']
        logging.info(f"    -> Found {len(results)} policies.")
        assert len(results) >= min_results, f"Expected at least {min_results} for '{description}', but got {len(results)}"

    # Note: Mock data uses random IPs, so we test for general patterns.
    # The mock data generator creates IPs in 192.168.x.x, 172.16.x.x, and 10.0.x.x

    _search_and_assert("Search by single CIDR", {"src_ips": ["192.168.0.0/16"]})
    _search_and_assert("Search by multiple CIDR and IP", {"dst_ips": ["10.0.0.0/8", "172.16.1.1"]})
    _search_and_assert("Search by service port", {"services": ["80"]})
    _search_and_assert("Search by service protocol/port", {"services": ["tcp/443"]})
    _search_and_assert("Search by combined src and service", {"src_ips": ["192.168.1.0/24"], "services": ["tcp/80", "443"]})
    _search_and_assert("Search with no results expected", {"src_ips": ["99.99.99.99/32"]}, min_results=0)


if __name__ == "__main__":
    setup_database()
    with TestClient(app) as client:
        device = create_test_device(client)
        run_sync(client, device["id"])
        test_policy_search_scenarios(client, device["id"])

    print(json.dumps({"status": "ok"}))
