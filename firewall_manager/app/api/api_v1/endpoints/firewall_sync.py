import logging
import pandas as pd
import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.db.session import get_db
from app.services.sync.transform import dataframe_to_pydantic
from app.services.sync.collector import build_collector
from app.services.sync.tasks import sync_data_task, run_sync_all_orchestrator

router = APIRouter()


@router.post("/sync/{device_id}/{data_type}", include_in_schema=False, response_model=schemas.Msg)
async def sync_device_data(device_id: int, data_type: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    await crud.device.update_sync_status(db=db, device=device, status="in_progress")
    await db.commit()

    # Extract primitive fields to avoid MissingGreenlet after commit
    loop = asyncio.get_running_loop()
    vendor_lower = (device.vendor or "").lower()
    device_ip = device.ip_address
    device_username = device.username
    encrypted_pw = device.password

    schema_map = {
        "policies": schemas.PolicyCreate,
        "network_objects": schemas.NetworkObjectCreate,
        "network_groups": schemas.NetworkGroupCreate,
        "services": schemas.ServiceCreate,
        "service_groups": schemas.ServiceGroupCreate,
    }
    if data_type not in schema_map:
        raise HTTPException(status_code=400, detail="Invalid data type for synchronization")
    schema_create = schema_map[data_type]

    connected = False
    try:
        try:
            collector = build_collector(vendor_lower, device_ip, device_username, encrypted_pw)
        except Exception as e:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=500, detail=f"Collector initialization failed: {e}")

        try:
            connected = await loop.run_in_executor(None, collector.connect)
        except NotImplementedError:
            connected = False
        except Exception as e:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=502, detail=f"Failed to connect to device: {e}")

        try:
            export_func = {
                "policies": collector.export_security_rules,
                "network_objects": collector.export_network_objects,
                "network_groups": collector.export_network_group_objects,
                "services": collector.export_service_objects,
                "service_groups": collector.export_service_group_objects,
            }[data_type]
        except KeyError:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=400, detail="Invalid data type for synchronization")

        try:
            df = await loop.run_in_executor(None, export_func)
        except NotImplementedError:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=400, detail=f"'{data_type}' sync is not supported by vendor '{device.vendor}'.")
        except Exception as e:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=502, detail=f"Failed to export data from device: {e}")

        if df is None:
            df = pd.DataFrame()
        df["device_id"] = device_id
        items_to_sync = dataframe_to_pydantic(df, schema_create)

        logging.info(f"Adding background task for {data_type} sync on device {device_id}")
        background_tasks.add_task(sync_data_task, device_id, data_type, items_to_sync)
        return {"msg": f"{data_type.replace('_', ' ').title()} synchronization started in the background."}
    finally:
        if connected:
            try:
                await loop.run_in_executor(None, collector.disconnect)
            except Exception:
                pass


@router.post("/sync-all/{device_id}", response_model=schemas.Msg)
async def sync_all(device_id: int, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # 동기화 시작 전 대기중 상태로 설정
    await crud.device.update_sync_status(db=db, device=device, status="pending", step="대기중...")
    await db.commit()

    background_tasks.add_task(run_sync_all_orchestrator, device_id)
    return {"msg": "Full synchronization started in the background."}
