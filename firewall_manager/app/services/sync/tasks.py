import asyncio
import logging
import json
from datetime import datetime
from typing import Any, List, Iterable, Dict, Tuple
from zoneinfo import ZoneInfo

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, update
from sqlalchemy.future import select

from app import crud, models, schemas
from app.db.session import SessionLocal
from app.models.policy_members import PolicyAddressMember, PolicyServiceMember
from app.services.sync.transform import (
    dataframe_to_pydantic,
    get_key_attribute,
    get_singular_name,
    normalize_value,
    normalize_last_hit_value,
)
from app.services.sync.collector import create_collector_from_device
from app.services.policy_indexer import rebuild_policy_indices

_DEVICE_SYNC_SEMAPHORE = asyncio.Semaphore(1)


async def sync_data_task(
    device_id: int,
    data_type: str,
    items_to_sync: List[Any],
) -> None:
    """Generic background task to synchronize one data type for a device using bulk operations."""
    logging.info(f"Starting bulk sync for device_id: {device_id}, data_type: {data_type}")

    # Determine the correct model based on data_type
    model_map = {
        "policies": models.Policy,
        "network_objects": models.NetworkObject,
        "network_groups": models.NetworkGroup,
        "services": models.Service,
        "service_groups": models.ServiceGroup,
    }
    model = model_map[data_type]
    key_attribute = get_key_attribute(data_type)

    def _make_key(obj: Any) -> Tuple:
        if data_type == "policies":
            vsys = str(getattr(obj, "vsys", "") or "").strip().lower()
            return (vsys if vsys else None, getattr(obj, "rule_name"))
        return (getattr(obj, key_attribute),)

    items_to_sync_map = {_make_key(item): item for item in items_to_sync}

    async with SessionLocal() as db:
        try:
            # Fetch existing items just once
            existing_items_query = await db.execute(select(model).where(model.device_id == device_id))
            existing_items = existing_items_query.scalars().all()
            existing_items_map = {_make_key(item): item for item in existing_items}

            # In-memory computation of changes
            items_to_create, items_to_update, ids_to_delete = [], [], []
            change_logs_to_create = []

            for key, new_item in items_to_sync_map.items():
                existing_item = existing_items_map.get(key)
                if not existing_item:
                    items_to_create.append(new_item.model_dump())
                    change_logs_to_create.append(schemas.ChangeLogCreate(
                        device_id=device_id, data_type=data_type, object_name=key[-1], action="created",
                        details=json.dumps(new_item.model_dump(), default=str)
                    ))
                else:
                    update_data = new_item.model_dump(exclude_unset=True)
                    is_dirty = any(normalize_value(update_data.get(k)) != normalize_value(getattr(existing_item, k)) for k in update_data)

                    if is_dirty:
                        update_data["id"] = existing_item.id
                        if data_type == "policies":
                            update_data["is_indexed"] = False
                        items_to_update.append(update_data)
                        change_logs_to_create.append(schemas.ChangeLogCreate(
                            device_id=device_id, data_type=data_type, object_name=key[-1], action="updated",
                            details=json.dumps({"before": {k: getattr(existing_item, k) for k in update_data if k != 'id'}, "after": update_data}, default=str)
                        ))

            for key, existing_item in existing_items_map.items():
                if key not in items_to_sync_map:
                    ids_to_delete.append(existing_item.id)
                    change_logs_to_create.append(schemas.ChangeLogCreate(
                        device_id=device_id, data_type=data_type, object_name=key[-1], action="deleted"
                    ))

            # Perform all DB operations in a single transaction block
            async with db.begin():
                if ids_to_delete:
                    if data_type == "policies":
                        await db.execute(delete(PolicyAddressMember).where(PolicyAddressMember.policy_id.in_(ids_to_delete)))
                        await db.execute(delete(PolicyServiceMember).where(PolicyServiceMember.policy_id.in_(ids_to_delete)))
                    await db.execute(delete(model).where(model.id.in_(ids_to_delete)))

                if items_to_create:
                    await db.run_sync(lambda sync_session: sync_session.bulk_insert_mappings(model, items_to_create))

                if items_to_update:
                    await db.run_sync(lambda sync_session: sync_session.bulk_update_mappings(model, items_to_update))

                if change_logs_to_create:
                    await crud.change_log.create_change_logs(db, change_logs=change_logs_to_create)

            logging.info(f"Bulk sync for {data_type} completed. "
                         f"Created: {len(items_to_create)}, Updated: {len(items_to_update)}, Deleted: {len(ids_to_delete)}")

        except Exception as e:
            await db.rollback()
            logging.error(f"Failed to bulk sync {data_type} for device_id {device_id}: {e}", exc_info=True)
            raise

async def run_sync_all_orchestrator(device_id: int) -> None:
    """Run full device sync sequentially for one device."""
    async with _DEVICE_SYNC_SEMAPHORE:
        logging.info(f"[orchestrator] Starting sync-all for device_id={device_id}")
        device = None
        async with SessionLocal() as db:
            device = await crud.device.get_device(db=db, device_id=device_id)
            if not device:
                logging.warning(f"[orchestrator] Device not found: id={device_id}")
                return
            await crud.device.update_sync_status(db=db, device=device, status="in_progress")
            await db.commit()

        collector = create_collector_from_device(device)
        loop = asyncio.get_running_loop()

        try:
            await loop.run_in_executor(None, getattr(collector, 'connect', lambda: None))

            sequence = [
                ("network_objects", schemas.NetworkObjectCreate, collector.export_network_objects),
                ("network_groups", schemas.NetworkGroupCreate, collector.export_network_group_objects),
                ("services", schemas.ServiceCreate, collector.export_service_objects),
                ("service_groups", schemas.ServiceGroupCreate, collector.export_service_group_objects),
                ("policies", schemas.PolicyCreate, collector.export_security_rules),
            ]

            for data_type, schema_create, export_func in sequence:
                df = await loop.run_in_executor(None, export_func)
                df = pd.DataFrame() if df is None else df
                df["device_id"] = device_id
                items_to_sync = dataframe_to_pydantic(df, schema_create)
                await sync_data_task(device_id, data_type, items_to_sync)

            async with SessionLocal() as db:
                result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id, models.Policy.is_indexed == False))
                policies_to_index = result.scalars().all()
                if policies_to_index:
                    await rebuild_policy_indices(db=db, device_id=device_id, policies=policies_to_index)
                    for p in policies_to_index:
                        p.is_indexed = True
                    db.add_all(policies_to_index)
                    await db.commit()

                device_to_update = await crud.device.get_device(db=db, device_id=device_id)
                await crud.device.update_sync_status(db=db, device=device_to_update, status="success")
                await db.commit()
            logging.info(f"[orchestrator] sync-all finished successfully for device_id={device_id}")

        except Exception as e:
            logging.error(f"[orchestrator] sync-all failed for device_id={device_id}: {e}", exc_info=True)
            async with SessionLocal() as db:
                device_to_update = await crud.device.get_device(db=db, device_id=device_id)
                await crud.device.update_sync_status(db=db, device=device_to_update, status="failure")
                await db.commit()
        finally:
            await loop.run_in_executor(None, getattr(collector, 'disconnect', lambda: None))
