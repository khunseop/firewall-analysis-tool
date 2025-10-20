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


if __name__ == "__main__":
    test_docs_and_openapi()
    test_db_migrated()
    print(json.dumps({"status": "ok"}))
