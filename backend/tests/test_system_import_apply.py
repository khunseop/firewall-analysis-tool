import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.api.api_v1.endpoints.system_import import apply_system_import
from app.db.session import Base
from app.models.device import Device
from app.models.notification_log import NotificationLog
from app.schemas.system_import import ApplyRequest, FieldChange
from app.services.system_import.service import ConfirmationRequired, apply_changes

USER = dict(user_id=7, username="tester")


def _chg(field, old, new, kind="fill", device_id=1, set_manual=None):
    return FieldChange(device_id=device_id, field=field, old=old, new=new, kind=kind, set_manual=set_manual)


def _snapshot(devices):
    return [{c.name: getattr(d, c.name) for c in Device.__table__.columns} for d in devices]


async def _setup():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add_all([
            Device(name="FW-A", ip_address="10.0.0.1", vendor="paloalto", username="u", password="p"),
            Device(name="FW-B", ip_address="10.0.0.2", vendor="mf2", username="u", password="p", model="PA-5220"),
        ])
        await db.commit()
    return engine, maker


async def _devices(db):
    db.expire_all()
    return (await db.execute(select(Device).order_by(Device.id))).scalars().all()


def _run(coro_fn):
    async def main():
        engine, maker = await _setup()
        try:
            async with maker() as db:
                return await coro_fn(db)
        finally:
            await engine.dispose()
    return asyncio.run(main())


def test_apply_updates_values_and_manual_flag_and_logs_activity():
    async def scenario(db):
        req = ApplyRequest(changes=[_chg("hostname", None, "fwa", "override", set_manual=True), _chg("model", None, "PA-3220")])
        result = await apply_changes(db, req, **USER)
        d1 = (await _devices(db))[0]
        logs = (await db.execute(select(NotificationLog))).scalars().all()
        return result, d1, logs

    result, d1, logs = _run(scenario)
    assert len(result.applied) == 2 and not result.skipped_conflicts and not result.skipped_invalid
    assert (d1.hostname, d1.hostname_manual, d1.model, d1.model_manual) == ("fwa", True, "PA-3220", False)
    assert len(logs) == 1 and logs[0].category == "device" and logs[0].username == "tester"


def test_connection_change_without_confirmation_is_refused_and_db_unchanged():
    async def scenario(db):
        before = _snapshot(await _devices(db))
        req = ApplyRequest(changes=[_chg("hostname", None, "x", "override"), _chg("ip_address", "10.0.0.1", "10.0.0.9", "connection")])
        with pytest.raises(ConfirmationRequired):
            await apply_changes(db, req, **USER)
        with pytest.raises(HTTPException) as exc:
            await apply_system_import(req, db=db, current_user=SimpleNamespace(id=7, username="tester"))
        return before, _snapshot(await _devices(db)), exc.value.status_code

    before, after, status = _run(scenario)
    assert before == after and status == 400


def test_changed_value_since_preview_is_conflict_and_others_still_apply():
    async def scenario(db):
        req = ApplyRequest(changes=[_chg("model", "OLD-VALUE", "PA-3220"), _chg("os_name", None, "PAN-OS")])
        result = await apply_changes(db, req, **USER)
        return result, (await _devices(db))[0]

    result, d1 = _run(scenario)
    assert [c.field for c in result.skipped_conflicts] == ["model"]
    assert [c.field for c in result.applied] == ["os_name"]
    assert (d1.model, d1.os_name) == (None, "PAN-OS")


def test_ip_that_collides_with_another_device_is_invalid():
    async def scenario(db):
        before = _snapshot(await _devices(db))
        req = ApplyRequest(changes=[_chg("ip_address", "10.0.0.1", "10.0.0.2", "connection")], confirm_connection=True)
        result = await apply_changes(db, req, **USER)
        return result, before, _snapshot(await _devices(db))

    result, before, after = _run(scenario)
    assert [c.field for c in result.skipped_invalid] == ["ip_address"] and result.applied == []
    assert before == after


def test_unknown_device_forbidden_field_bad_vendor_and_bad_date_are_invalid():
    async def scenario(db):
        before = _snapshot(await _devices(db))
        req = ApplyRequest(changes=[
            _chg("model", None, "X", device_id=999),
            _chg("password", "p", "hacked"),
            _chg("vendor", "paloalto", "evil", "connection"),
            _chg("install_date", None, "not-a-date"),
            _chg("model", None, "X", set_manual=True),  # 유효한 항목: 장비 1의 model을 채우고 model_manual을 켠다
        ], confirm_connection=True)
        result = await apply_changes(db, req, **USER)
        return result, before, _snapshot(await _devices(db))

    result, before, after = _run(scenario)
    assert sorted(c.field for c in result.skipped_invalid) == ["install_date", "model", "password", "vendor"]
    assert [c.field for c in result.applied] == ["model"] and after[0]["model"] == "X" and after[0]["model_manual"] is True
    assert after[1] == before[1]  # 다른 장비는 불변
    assert all(a["password"] == b["password"] for a, b in zip(before, after))


def test_set_manual_on_field_without_flag_is_invalid():
    async def scenario(db):
        return await apply_changes(db, ApplyRequest(changes=[_chg("os_name", None, "PAN-OS", set_manual=True)]), **USER)

    result = _run(scenario)
    assert [c.field for c in result.skipped_invalid] == ["os_name"] and result.applied == []


def test_applying_reverse_restores_the_whole_row():
    async def scenario(db):
        before = _snapshot(await _devices(db))
        req = ApplyRequest(confirm_connection=True, changes=[
            _chg("hostname", None, "fwa", "override", set_manual=True),
            _chg("ip_address", "10.0.0.1", "10.0.0.11", "connection"),
            _chg("vendor", "paloalto", "ngf", "connection"),
            _chg("model", None, "PA-3220"),
            _chg("install_date", None, "2023-05-01"),
            _chg("location_x", None, "12"),
        ])
        applied = await apply_changes(db, req, **USER)
        changed = _snapshot(await _devices(db))
        undone = await apply_changes(db, ApplyRequest(changes=applied.reverse, confirm_connection=True), **USER)
        return before, changed, applied, undone, _snapshot(await _devices(db))

    before, changed, applied, undone, restored = _run(scenario)
    assert len(applied.applied) == 6
    assert changed[0]["ip_address"] == "10.0.0.11" and str(changed[0]["install_date"]) == "2023-05-01"
    assert len(undone.applied) == 6 and not undone.skipped_conflicts and not undone.skipped_invalid
    assert restored == before  # hostname_manual 포함 행 전체가 원래대로
    assert any(c.kind == "connection" for c in applied.reverse)  # 되돌리기도 연결 정보 확인이 필요


def test_malformed_ip_values_are_invalid_but_valid_ones_and_clearing_are_applied():
    async def scenario(db):
        before = _snapshot(await _devices(db))
        bad = ApplyRequest(confirm_connection=True, changes=[
            _chg("ip_address", "10.0.0.1", "10.0.0.5, 10.0.0.6 (VIP)", "connection"),
            _chg("ha_peer_ip", None, "not an ip", "connection"),
            _chg("ip_address", "10.0.0.1", "10.0.0.5\n10.0.0.6", "connection"),
        ])
        bad_result = await apply_changes(db, bad, **USER)
        unchanged = _snapshot(await _devices(db))
        good = await apply_changes(db, ApplyRequest(confirm_connection=True, changes=[
            _chg("ha_peer_ip", None, "10.0.0.2", "connection"),
            _chg("ip_address", "10.0.0.1", "2001:db8::1", "connection"),
        ]), **USER)
        cleared = await apply_changes(db, ApplyRequest(confirm_connection=True, changes=[_chg("ha_peer_ip", "10.0.0.2", None, "connection")]), **USER)
        return before, bad_result, unchanged, good, cleared, (await _devices(db))[0]

    before, bad_result, unchanged, good, cleared, d1 = _run(scenario)
    assert len(bad_result.skipped_invalid) == 3 and bad_result.applied == [] and before == unchanged
    assert len(good.applied) == 2 and len(cleared.applied) == 1
    assert d1.ha_peer_ip is None and d1.ip_address == "2001:db8::1"


def test_audit_log_records_fields_and_old_new_values():
    async def scenario(db):
        req = ApplyRequest(confirm_connection=True, changes=[
            _chg("ip_address", "10.0.0.1", "10.0.0.11", "connection"),
            _chg("hostname", None, "fwa", "override", set_manual=True),
        ])
        await apply_changes(db, req, **USER)
        return (await db.execute(select(NotificationLog))).scalars().one().message

    message = _run(scenario)
    for expected in ("FW-A", "ip_address", "10.0.0.1", "10.0.0.11", "hostname", "fwa"):
        assert expected in message
