# firewall_manager/app/api/api_v1/endpoints/firewall_data.py
import logging
from typing import Any, List, Optional
import asyncio
from datetime import datetime
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
import json

from app import crud, models, schemas
from app.db.session import get_db, SessionLocal
from app.core.security import fernet, decrypt
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.firewall.interface import FirewallInterface

router = APIRouter()

def _parse_datetime_safe(value: Any) -> Optional[datetime]:
    """Best-effort parse of vendor-provided datetime strings or timestamps.
    Returns None if parsing fails.
    """
    if value is None:
        return None
    try:
        if isinstance(value, datetime):
            return value
        # Common placeholders for 'no data'
        if isinstance(value, str) and str(value).strip().lower() in {
            '-', '--', '—', 'n/a', 'na', 'none', ''
        }:
            return None
        # numeric timestamp (seconds)
        if isinstance(value, (int, float)):
            # 0 means no hit
            if value == 0:
                return None
            return datetime.fromtimestamp(int(value))
        s = str(value).strip()
        if not s:
            return None
        # common formats
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
            "%Y/%m/%d %H:%M:%S",
            "%Y/%m/%d",
        ):
            try:
                return datetime.strptime(s, fmt)
            except Exception:
                pass
    except Exception:
        return None
    return None


def dataframe_to_pydantic(df: pd.DataFrame, pydantic_model):
    """Converts a Pandas DataFrame to a list of Pydantic models."""
    df.columns = [col.lower().replace(' ', '_') for col in df.columns]
    rename_map = {
        "group_name": "name",
        "entry": "members",
        "value": "ip_address",
        "port": "port",
    }
    df = df.rename(columns=rename_map)
    # Map common hit date columns to standardized fields if present
    # Supported input columns: last_hit_date, last_hit_at, last_hit_date_secondary
    if 'last_hit_date' in df.columns and 'last_hit_at' not in df.columns:
        df['last_hit_at'] = df['last_hit_date'].apply(_parse_datetime_safe)
    elif 'last_hit_at' in df.columns:
        df['last_hit_at'] = df['last_hit_at'].apply(_parse_datetime_safe)

    if 'last_hit_date_secondary' in df.columns and 'last_hit_at_secondary' not in df.columns:
        df['last_hit_at_secondary'] = df['last_hit_date_secondary'].apply(_parse_datetime_safe)
    elif 'last_hit_at_secondary' in df.columns:
        df['last_hit_at_secondary'] = df['last_hit_at_secondary'].apply(_parse_datetime_safe)
    # Normalize enable column to boolean if present (handles 'Y'/'N', 'yes'/'no', etc.)
    if 'enable' in df.columns:
        def _to_bool(v):
            if v is None:
                return None
            if isinstance(v, bool):
                return v
            try:
                s = str(v).strip().lower()
            except Exception:
                return None
            if s in {"y", "yes", "true", "1"}:
                return True
            if s in {"n", "no", "false", "0"}:
                return False
            return None
        df['enable'] = df['enable'].apply(_to_bool)

    # Normalize NaN -> None for pydantic compatibility
    df = df.where(pd.notna(df), None)

    # Ensure rule_name is string when present (vendors may return numeric IDs)
    if 'rule_name' in df.columns:
        df['rule_name'] = df['rule_name'].apply(lambda v: str(v) if v is not None else v)
    records = df.to_dict(orient='records')
    models: list[Any] = []
    errors: list[dict[str, Any]] = []
    for idx, row in enumerate(records):
        try:
            models.append(pydantic_model(**row))
        except Exception as e:
            # Collect minimal error info without leaking secrets
            preview = {k: row.get(k) for k in list(row.keys())[:10]}
            errors.append({"index": idx, "error": str(e), "row_preview": preview})
    if errors:
        logging.warning("dataframe_to_pydantic: %d/%d rows failed validation. First error: %s", len(errors), len(records), errors[0])
    return models

def get_singular_name(plural_name: str) -> str:
    """Converts plural data type string to singular form for CRUD operations."""
    if plural_name == "policies":
        return "policy"
    return plural_name[:-1]

def get_key_attribute(data_type: str) -> str:
    """Returns the key attribute for a given data type."""
    return "rule_name" if data_type == "policies" else "name"

async def _get_collector(device: models.Device) -> FirewallInterface:
    """Helper function to create a firewall collector with safe decryption."""
    decrypted_password: str
    try:
        decrypted_password = decrypt(device.password)
    except Exception:
        # Fallback for vendors that don't actually use the password (e.g., mock)
        # Prevent hard failure while still allowing sync to proceed.
        logging.exception("Password decryption failed for device_id=%s vendor=%s", device.id, device.vendor)
        if device.vendor.lower() == "mock":
            decrypted_password = device.password
        else:
            raise HTTPException(status_code=500, detail="Password decryption failed")

    collector = FirewallCollectorFactory.get_collector(
        source_type=device.vendor.lower(),
        hostname=device.ip_address,
        username=device.username,
        password=decrypted_password,
    )
    return collector

async def _sync_data_task(device_id: int, data_type: str, items_to_sync: List[Any]):
    """Generic background task to synchronize data for a device."""
    logging.info(f"Starting sync for device_id: {device_id}, data_type: {data_type}")
    async with SessionLocal() as db:
        device = await crud.device.get_device(db=db, device_id=device_id)
        if not device:
            logging.error(f"Device with id {device_id} not found.")
            return

        try:
            logging.info(f"Syncing {data_type} for device: {device.name}")
            sync_map = {
                "policies": (crud.policy.get_policies_by_device, crud.policy.create_policies, crud.policy.update_policy, crud.policy.delete_policy),
                "network_objects": (crud.network_object.get_network_objects_by_device, crud.network_object.create_network_objects, crud.network_object.update_network_object, crud.network_object.delete_network_object),
                "network_groups": (crud.network_group.get_network_groups_by_device, crud.network_group.create_network_groups, crud.network_group.update_network_group, crud.network_group.delete_network_group),
                "services": (crud.service.get_services_by_device, crud.service.create_services, crud.service.update_service, crud.service.delete_service),
                "service_groups": (crud.service_group.get_service_groups_by_device, crud.service_group.create_service_groups, crud.service_group.update_service_group, crud.service_group.delete_service_group),
            }

            get_all_func, create_func, update_func, delete_func = sync_map[data_type]

            existing_items = await get_all_func(db=db, device_id=device_id)
            key_attribute = get_key_attribute(data_type)
            existing_items_map = {getattr(item, key_attribute): item for item in existing_items}
            items_to_sync_map = {getattr(item, key_attribute): item for item in items_to_sync}

            logging.info(f"Found {len(existing_items)} existing items and {len(items_to_sync)} items to sync.")

            items_to_create = []

            for item_name, item_in in items_to_sync_map.items():
                existing_item = existing_items_map.get(item_name)
                if existing_item:
                    # Touch last_seen_at and ensure is_active for seen items
                    existing_item.last_seen_at = datetime.utcnow()
                    if hasattr(existing_item, "is_active"):
                        existing_item.is_active = True
                    obj_data = item_in.model_dump()
                    db_obj_data = {c.name: getattr(existing_item, c.name) for c in existing_item.__table__.columns}
                    if any(obj_data.get(k) != db_obj_data.get(k) for k in obj_data):
                        logging.info(f"Updating {data_type}: {item_name}")
                        await update_func(db=db, db_obj=existing_item, obj_in=item_in)
                        await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=item_name, action="updated", details=json.dumps({"before": db_obj_data, "after": obj_data}, default=str)))
                    else:
                        # Persist the last_seen_at touch even if no field changed
                        db.add(existing_item)
                else:
                    items_to_create.append(item_in)

            if items_to_create:
                logging.info(f"Creating {len(items_to_create)} new {data_type}.")
                await create_func(db=db, **{f"{data_type}": items_to_create})
                for item_in in items_to_create:
                    await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=getattr(item_in, key_attribute), action="created", details=json.dumps(item_in.model_dump(), default=str)))

            items_to_delete_count = 0
            for item_name, item in existing_items_map.items():
                if item_name not in items_to_sync_map:
                    items_to_delete_count += 1
                    logging.info(f"Deleting {data_type}: {item_name}")
                    await delete_func(db=db, **{f"{get_singular_name(data_type)}": item})
                    await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=item_name, action="deleted"))

            if items_to_delete_count > 0:
                logging.info(f"Deleted {items_to_delete_count} {data_type}.")

            await crud.device.update_sync_status(db=db, device=device, status="success")
            await db.commit()
            logging.info(f"Sync completed successfully for device_id: {device_id}, data_type: {data_type}")

        except Exception as e:
            await db.rollback()
            logging.exception(f"Failed to sync {data_type} for device {device.name}")
            async with SessionLocal() as new_db:
                device_for_status_update = await crud.device.get_device(db=new_db, device_id=device_id)
                await crud.device.update_sync_status(db=new_db, device=device_for_status_update, status="failure")
                await new_db.commit()

@router.post("/sync/{device_id}/{data_type}", response_model=schemas.Msg)
async def sync_device_data(
    device_id: int,
    data_type: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    include_hit: bool = False,
    hit_timeout_seconds: int = 30,
):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    await crud.device.update_sync_status(db=db, device=device, status="in_progress")
    await db.commit()

    collector = await _get_collector(device)
    loop = asyncio.get_running_loop()

    sync_map = {
        "policies": (collector.export_security_rules, schemas.PolicyCreate),
        "network_objects": (collector.export_network_objects, schemas.NetworkObjectCreate),
        "network_groups": (collector.export_network_group_objects, schemas.NetworkGroupCreate),
        "services": (collector.export_service_objects, schemas.ServiceCreate),
        "service_groups": (collector.export_service_group_objects, schemas.ServiceGroupCreate),
    }

    if data_type not in sync_map:
        raise HTTPException(status_code=400, detail="Invalid data type for synchronization")

    export_func, schema_create = sync_map[data_type]

    # Build vendor-specific export kwargs
    export_kwargs = {}
    if data_type == "policies":
        vendor = (device.vendor or "").lower()
        if vendor == "paloalto":
            # Enable hit merge and optional secondary host for HA
            export_kwargs = {
                "include_hit": bool(include_hit),
                "secondary_hostname": (device.secondary_ip_address or None),
                "hit_timeout_seconds": int(hit_timeout_seconds),
            }

    connected = False
    try:
        # Ensure connection for vendors that require it (e.g., PaloAlto)
        try:
            connected = await loop.run_in_executor(None, collector.connect)
        except NotImplementedError:
            connected = False
        except Exception as e:
            # Mark failure and surface a user-friendly error
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=502, detail=f"Failed to connect to device: {e}")

        try:
            if export_kwargs:
                df = await loop.run_in_executor(None, lambda: export_func(**export_kwargs))
            else:
                df = await loop.run_in_executor(None, export_func)
        except NotImplementedError:
            # Vendor does not support this data type
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=400, detail=f"'{data_type}' sync is not supported by vendor '{device.vendor}'.")
        except Exception as e:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            # Log traceback and a compact hint
            logging.exception("Export failed for device_id=%s vendor=%s data_type=%s", device_id, device.vendor, data_type)
            raise HTTPException(status_code=502, detail=f"Failed to export data from device (vendor={device.vendor}, type={data_type}).")

        if df is None:
            df = pd.DataFrame()
        df['device_id'] = device_id
        try:
            items_to_sync = dataframe_to_pydantic(df, schema_create)
        except Exception as e:
            logging.exception("DataFrame to Pydantic conversion failed for device_id=%s data_type=%s", device_id, data_type)
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=500, detail="Failed to transform data for synchronization.")

        logging.info(f"Adding background task for {data_type} sync on device {device_id}")
        background_tasks.add_task(_sync_data_task, device_id, data_type, items_to_sync)
        return {"msg": f"{data_type.replace('_', ' ').title()} synchronization started in the background."}
    finally:
        if connected:
            try:
                await loop.run_in_executor(None, collector.disconnect)
            except Exception:
                # Ignore disconnect errors
                pass

@router.get("/{device_id}/policies", response_model=List[schemas.Policy])
async def read_db_device_policies(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.policy.get_policies_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/network-objects", response_model=List[schemas.NetworkObject])
async def read_db_device_network_objects(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.network_object.get_network_objects_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/network-groups", response_model=List[schemas.NetworkGroup])
async def read_db_device_network_groups(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.network_group.get_network_groups_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/services", response_model=List[schemas.Service])
async def read_db_device_services(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.service.get_services_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/service-groups", response_model=List[schemas.ServiceGroup])
async def read_db_device_service_groups(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.service_group.get_service_groups_by_device(db=db, device_id=device_id)

@router.get("/sync/{device_id}/status", response_model=schemas.DeviceSyncStatus)
async def get_device_sync_status(device_id: int, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device
