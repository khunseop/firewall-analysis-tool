import asyncio

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401  (모든 모델을 Base.metadata에 등록)
from app.api.api_v1.endpoints.system_import import resolve_base_url
from app.db.session import Base
from app.models.device import Device
from app.models.settings import Settings
from app.services.system_import.client import DashboardFetchError
from app.services.system_import.service import build_preview

ROWS = [
    {"hostname": "fwap", "ip": "10.0.0.1", "vendor": "Paloalto", "model": "PA-3220", "status": "운영", "task_name": "본사 FW"},
    {"hostname": "fwas", "ip": "10.0.0.2", "vendor": "Palo Alto", "model": "PA-3220", "status": "운영"},
    {"hostname": "newfw", "ip": "10.0.0.50", "vendor": "SECUI", "model": "NGF-1000", "status": "운영"},
    {"hostname": "oldfw", "ip": "10.0.0.60", "vendor": "SECUI", "model": "MF2", "status": "폐기"},
    {"hostname": "dell1", "ip": "10.0.0.70", "vendor": "Dell", "model": "R740", "status": "운영"},
]


def _transport(rows=ROWS):
    return httpx.MockTransport(lambda r: httpx.Response(200, json={"total": len(rows), "items": rows}))


async def _session():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def _snapshot(devices):
    return [{c.name: getattr(d, c.name) for c in Device.__table__.columns} for d in devices]


def test_preview_builds_diffs_unmatched_and_counts_without_writing():
    async def scenario():
        engine, maker = await _session()
        async with maker() as db:
            db.add_all([
                Device(name="FW-A", ip_address="10.0.0.1", vendor="paloalto", username="u", password="p"),
                Device(name="FW-B", ip_address="10.0.0.9", vendor="paloalto", username="u", password="p"),
            ])
            await db.commit()
            before = _snapshot((await db.execute(select(Device).order_by(Device.id))).scalars().all())
            preview = await build_preview(db, "http://dash:5012", transport=_transport())
            await db.rollback()
            db.expire_all()
            after = _snapshot((await db.execute(select(Device).order_by(Device.id))).scalars().all())
        await engine.dispose()
        return preview, before, after

    preview, before, after = asyncio.run(scenario())
    assert before == after  # 미리보기는 DB를 바꾸지 않는다
    assert [d.device_name for d in preview.diffs] == ["FW-A"]
    diff = preview.diffs[0]
    assert diff.via == "ip" and diff.partner_hostname == "fwas"
    changes = {c.field: c for c in diff.changes}
    assert changes["hostname"].new == "fwap" and changes["hostname"].set_manual is True
    assert changes["model"].new == "PA-3220" and changes["description"].new == "본사 FW"
    assert changes["ha_peer_ip"].new == "10.0.0.2"
    assert [d.name for d in preview.unmatched_devices] == ["FW-B"]
    # 대시보드에만 있는 장비: 신규 SECUI만. 폐기 행·HA 상대 행·지원하지 않는 벤더 행은 제외
    assert [r.hostname for r in preview.unmatched_rows] == ["newfw"]
    assert preview.skipped_vendor_count == 1


def test_preview_warns_about_unpaired_candidate_hostname_of_matched_device():
    async def scenario():
        engine, maker = await _session()
        async with maker() as db:
            db.add(Device(name="FW-A", ip_address="10.0.0.1", vendor="paloalto", username="u", password="p"))
            await db.commit()
            preview = await build_preview(db, "http://dash:5012", transport=_transport([ROWS[0]]))
        await engine.dispose()
        return preview

    preview = asyncio.run(scenario())
    assert any("fwap" in w for w in preview.warnings)


def test_preview_propagates_fetch_errors():
    async def scenario():
        engine, maker = await _session()
        async with maker() as db:
            await build_preview(db, "http://dash:5012", transport=_transport([]))
        await engine.dispose()

    with pytest.raises(DashboardFetchError):
        asyncio.run(scenario())


def test_resolve_base_url_prefers_request_then_setting_else_400():
    async def scenario():
        engine, maker = await _session()
        async with maker() as db:
            with pytest.raises(HTTPException) as exc:
                await resolve_base_url(db, None)
            assert exc.value.status_code == 400
            with pytest.raises(HTTPException):
                await resolve_base_url(db, "   ")
            assert await resolve_base_url(db, " http://a:1 ") == "http://a:1"
            db.add(Settings(key="system_dashboard_url", value="http://saved:5012", description=None))
            await db.commit()
            assert await resolve_base_url(db, None) == "http://saved:5012"
            assert await resolve_base_url(db, "http://other:1") == "http://other:1"
        await engine.dispose()

    asyncio.run(scenario())
