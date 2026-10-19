"""스케줄 실행 결과(성공/일부 실패/실패) 판정과 중복 실행 방지."""
import asyncio
from types import SimpleNamespace

from app.services import scheduler as sched


class _FakeSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *exc):
        return False


def _setup(monkeypatch, device_results):
    recorded = {}

    async def fake_get(db, schedule_id):
        return SimpleNamespace(id=schedule_id, name="야간", device_ids=[r["device_id"] for r in device_results])

    async def fake_update(db, schedule_id, status, detail=None):
        recorded["status"], recorded["detail"] = status, detail

    async def fake_log(db, **kwargs):
        recorded["log"] = kwargs

    monkeypatch.setattr(sched, "SessionLocal", lambda: _FakeSession())
    monkeypatch.setattr(sched.crud.sync_schedule, "get_sync_schedule", fake_get)
    monkeypatch.setattr(sched.crud.sync_schedule, "update_schedule_run_status", fake_update)
    monkeypatch.setattr(sched, "log_activity", fake_log)

    s = sched.SyncScheduler()
    results = iter(device_results)

    async def fake_one(device_id):
        return next(results)

    monkeypatch.setattr(s, "_sync_one_device", fake_one)
    return s, recorded


def _r(device_id, ok):
    return {"device_id": device_id, "device_name": f"FW-{device_id}", "status": "success" if ok else "failure", "error": None if ok else "연결 실패"}


def test_all_success(monkeypatch):
    s, rec = _setup(monkeypatch, [_r(1, True), _r(2, True)])
    asyncio.run(s.execute_schedule(1))
    assert rec["status"] == "success"
    assert rec["log"]["type"] == "success"
    assert not s.is_running(1)


def test_partial_failure_is_not_reported_as_success(monkeypatch):
    s, rec = _setup(monkeypatch, [_r(1, True), _r(2, False), _r(3, True)])
    asyncio.run(s.execute_schedule(1))
    assert rec["status"] == "partial"
    assert [d["status"] for d in rec["detail"]] == ["success", "failure", "success"]
    assert "FW-2" in rec["log"]["message"]
    assert rec["log"]["type"] == "warning"


def test_all_failure(monkeypatch):
    s, rec = _setup(monkeypatch, [_r(1, False), _r(2, False)])
    asyncio.run(s.execute_schedule(1))
    assert rec["status"] == "failure"
    assert rec["log"]["type"] == "error"


def test_already_running_schedule_is_skipped(monkeypatch):
    s, rec = _setup(monkeypatch, [_r(1, True)])
    assert s.mark_running(1)
    asyncio.run(s.execute_schedule(1))  # 이미 실행 중 → 아무것도 기록하지 않고 건너뜀
    assert "status" not in rec
    assert s.is_running(1)  # 다른 실행이 잡고 있는 표시를 지우지 않는다


def test_sync_one_device_reads_final_device_status(monkeypatch):
    """오케스트레이터는 실패해도 예외를 던지지 않는다 — 장비의 last_sync_status로 판정해야 한다."""
    device = SimpleNamespace(name="FW-9", last_sync_status="failure", last_sync_step="Collecting Policies")

    async def fake_orchestrator(device_id):
        return None

    async def fake_get_device(db, device_id):
        return device

    monkeypatch.setattr(sched, "SessionLocal", lambda: _FakeSession())
    monkeypatch.setattr(sched, "run_sync_all_orchestrator", fake_orchestrator)
    monkeypatch.setattr(sched.crud.device, "get_device", fake_get_device)
    s = sched.SyncScheduler()
    result = asyncio.run(s._sync_one_device(9))
    assert result["status"] == "failure"
    assert "Collecting Policies" in result["error"]

    device.last_sync_status = "success"
    assert asyncio.run(s._sync_one_device(9))["status"] == "success"
