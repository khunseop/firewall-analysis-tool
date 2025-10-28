import asyncio
import logging
import json
from datetime import datetime
from typing import Any, List, Iterable
from zoneinfo import ZoneInfo

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from sqlalchemy.future import select

from app import crud, models, schemas
from app.db.session import SessionLocal
from app.models.policy_members import PolicyAddressMember, PolicyServiceMember
from app.services.sync.transform import (
    dataframe_to_pydantic,
    get_key_attribute,
    get_singular_name,
    normalize_bool,
    normalize_value,
    normalize_last_hit_value,
    coerce_timestamp_to_py_datetime,
)
from app.services.sync.collector import create_collector_from_device
from app.services.policy_indexer import rebuild_policy_indices


# SQLite의 동시 쓰기 한계를 고려하여 1개 장비만 동기화하도록 제한합니다.
_DEVICE_SYNC_SEMAPHORE = asyncio.Semaphore(1)


async def sync_data_task(
    device_id: int,
    data_type: str,
    items_to_sync: List[Any],
    update_device_status: bool = False,
) -> None:
    """Generic background task to synchronize one data type for a device."""
    logging.info(f"Starting sync for device_id: {device_id}, data_type: {data_type}")
    async with SessionLocal() as db:
        device = await crud.device.get_device(db=db, device_id=device_id)
        if not device:
            logging.error(f"Device with id {device_id} not found.")
            return

        try:
            logging.info(f"Syncing {data_type} for device: {device.name}")
            sync_map = {
                "policies": (
                    crud.policy.get_policies_by_device,
                    crud.policy.create_policies,
                    crud.policy.update_policy,
                    crud.policy.delete_policy,
                ),
                "network_objects": (
                    crud.network_object.get_network_objects_by_device,
                    crud.network_object.create_network_objects,
                    crud.network_object.update_network_object,
                    crud.network_object.delete_network_object,
                ),
                "network_groups": (
                    crud.network_group.get_network_groups_by_device,
                    crud.network_group.create_network_groups,
                    crud.network_group.update_network_group,
                    crud.network_group.delete_network_group,
                ),
                "services": (
                    crud.service.get_services_by_device,
                    crud.service.create_services,
                    crud.service.update_service,
                    crud.service.delete_service,
                ),
                "service_groups": (
                    crud.service_group.get_service_groups_by_device,
                    crud.service_group.create_service_groups,
                    crud.service_group.update_service_group,
                    crud.service_group.delete_service_group,
                ),
            }

            get_all_func, create_func, update_func, delete_func = sync_map[data_type]
            existing_items = await get_all_func(db=db, device_id=device_id)
            key_attribute = get_key_attribute(data_type)

            # Use composite key for policies to avoid cross-VSYS collisions on rule_name
            def _make_key(obj: Any):
                if data_type == "policies":
                    vsys_val = getattr(obj, "vsys", None)
                    vsys_key = (str(vsys_val).strip().lower()) if (vsys_val is not None and str(vsys_val).strip() != "") else None
                    return (vsys_key, getattr(obj, "rule_name"))
                return getattr(obj, key_attribute)

            def _display_name(obj: Any) -> str:
                if data_type == "policies":
                    vsys_val = getattr(obj, "vsys", None)
                    rule_name_val = getattr(obj, "rule_name", None)
                    return f"{(vsys_val if (vsys_val is not None and str(vsys_val).strip() != '') else '-')}::{rule_name_val}"
                return str(getattr(obj, key_attribute))

            existing_items_map = {_make_key(item): item for item in existing_items}
            items_to_sync_map = {_make_key(item): item for item in items_to_sync}

            logging.info(f"Found {len(existing_items)} existing items and {len(items_to_sync)} items to sync.")

            # Palo Alto: last_hit_date 보강 (VSYS 고려)
            if data_type == "policies" and (device.vendor or "").lower() == "paloalto":
                loop = asyncio.get_running_loop()
                collector = create_collector_from_device(device)
                try:
                    await loop.run_in_executor(None, collector.connect)
                    vsys_set = {str(getattr(obj, 'vsys')).strip() for obj in items_to_sync if getattr(obj, 'vsys', None)}
                    hit_df = await loop.run_in_executor(None, lambda: collector.export_last_hit_date(vsys=vsys_set))
                finally:
                    try:
                        await loop.run_in_executor(None, collector.disconnect)
                    except Exception:
                        pass

                if hit_df is not None and not hit_df.empty:
                    hit_df.columns = [c.lower().replace(' ', '_') for c in hit_df.columns]
                    if 'last_hit_date' in hit_df.columns:
                        hit_df['last_hit_date'] = hit_df['last_hit_date'].apply(normalize_last_hit_value)
                        hit_df['last_hit_date'] = hit_df['last_hit_date'].apply(coerce_timestamp_to_py_datetime)
                    hit_map = {((str(r.get('vsys')).lower()) if r.get('vsys') else None, str(r.get('rule_name'))): r.get('last_hit_date') for r in hit_df.to_dict(orient='records') if r.get('rule_name')}
                    for name, obj in items_to_sync_map.items():
                        obj_vsys = getattr(obj, 'vsys', None)
                        key = ((str(obj_vsys).lower()) if obj_vsys else None, name)
                        if key in hit_map and hasattr(obj, 'last_hit_date'):
                            setattr(obj, 'last_hit_date', hit_map[key])

            items_to_create: List[Any] = []

            for item_key, item_in in items_to_sync_map.items():
                existing_item = existing_items_map.get(item_key)
                if existing_item:
                    existing_item.last_seen_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
                    if hasattr(existing_item, "is_active"):
                        existing_item.is_active = True
                    obj_data = item_in.model_dump(exclude_unset=True, exclude_none=True)
                    db_obj_data = {}
                    for k in obj_data.keys():
                        v = getattr(existing_item, k, None)
                        db_obj_data[k] = normalize_bool(v) if k == 'enable' else normalize_value(v)
                    cmp_left = {k: (normalize_bool(v) if k == 'enable' else normalize_value(v)) for k, v in obj_data.items()}
                    if any(cmp_left.get(k) != db_obj_data.get(k) for k in obj_data):
                        logging.info(f"Updating {data_type}: {_display_name(item_in)}")
                        await update_func(db=db, db_obj=existing_item, obj_in=item_in)
                        await crud.change_log.create_change_log(
                            db=db,
                            change_log=schemas.ChangeLogCreate(
                                device_id=device_id,
                                data_type=data_type,
                                object_name=_display_name(item_in),
                                action="updated",
                                details=json.dumps({"before": db_obj_data, "after": cmp_left}, default=str),
                            ),
                        )
                    else:
                        db.add(existing_item)
                else:
                    items_to_create.append(item_in)

            if items_to_create:
                logging.info(f"Creating {len(items_to_create)} new {data_type}.")
                await create_func(db=db, **{f"{data_type}": items_to_create})
                for item_in in items_to_create:
                    await crud.change_log.create_change_log(
                        db=db,
                        change_log=schemas.ChangeLogCreate(
                            device_id=device_id,
                            data_type=data_type,
                            object_name=_display_name(item_in),
                            action="created",
                            details=json.dumps(item_in.model_dump(), default=str),
                        ),
                    )

            items_to_delete_count = 0
            for item_key, item in existing_items_map.items():
                if item_key not in items_to_sync_map:
                    items_to_delete_count += 1
                    logging.info(f"Deleting {data_type}: {_display_name(item)}")
                    if data_type == "policies":
                        await db.execute(delete(PolicyAddressMember).where(PolicyAddressMember.policy_id == item.id))
                        await db.execute(delete(PolicyServiceMember).where(PolicyServiceMember.policy_id == item.id))
                    await delete_func(db=db, **{f"{get_singular_name(data_type)}": item})
                    await crud.change_log.create_change_log(
                        db=db,
                        change_log=schemas.ChangeLogCreate(
                            device_id=device_id,
                            data_type=data_type,
                            object_name=_display_name(item),
                            action="deleted",
                        ),
                    )

            if items_to_delete_count > 0:
                logging.info(f"Deleted {items_to_delete_count} {data_type}.")

            await db.commit()
            logging.info(f"Sync completed successfully for device_id: {device_id}, data_type: {data_type}")
        except Exception as e:
            await db.rollback()
            logging.error(f"Failed to sync {data_type} for device {device.name}: {e}", exc_info=True)
            if update_device_status:
                async with SessionLocal() as new_db:
                    device_for_status_update = await crud.device.get_device(db=new_db, device_id=device_id)
                    await crud.device.update_sync_status(db=new_db, device=device_for_status_update, status="failure")
                    await new_db.commit()
        else:
            if update_device_status:
                await crud.device.update_sync_status(db=db, device=device, status="success")
                await db.commit()
                logging.info(f"Device status updated to success for device_id: {device_id}")


async def run_sync_all_orchestrator(device_id: int) -> None:
    """Run full device sync inside a global concurrency limiter and set final status."""
    async with _DEVICE_SYNC_SEMAPHORE:
        logging.info(f"[orchestrator] Starting sync-all for device_id={device_id}")
        async with SessionLocal() as db:
            device = await crud.device.get_device(db=db, device_id=device_id)
            if not device:
                logging.warning(f"[orchestrator] Device not found: id={device_id}")
                return

            try:
                await crud.device.update_sync_status(db=db, device=device, status="in_progress")
                await db.commit()
            except Exception:
                await db.rollback()

            loop = asyncio.get_running_loop()
            try:
                collector = create_collector_from_device(device)
                connected = False
                try:
                    try:
                        connected = await loop.run_in_executor(None, collector.connect)
                    except NotImplementedError:
                        connected = False

                    export_map = {
                        "policies": collector.export_security_rules,
                        "network_objects": collector.export_network_objects,
                        "network_groups": collector.export_network_group_objects,
                        "services": collector.export_service_objects,
                        "service_groups": collector.export_service_group_objects,
                    }

                    sequence = [
                        ("network_objects", schemas.NetworkObjectCreate),
                        ("network_groups", schemas.NetworkGroupCreate),
                        ("services", schemas.ServiceCreate),
                        ("service_groups", schemas.ServiceGroupCreate),
                        ("policies", schemas.PolicyCreate),
                    ]

                    for data_type, schema_create in sequence:
                        try:
                            df = await loop.run_in_executor(None, export_map[data_type])
                        except NotImplementedError:
                            continue
                        if df is None:
                            df = pd.DataFrame()
                        df["device_id"] = device_id
                        items_to_sync = dataframe_to_pydantic(df, schema_create)
                        await sync_data_task(device_id, data_type, items_to_sync, False)

                    # Rebuild indices after full sync
                    result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id))
                    policies = result.scalars().all()
                    await rebuild_policy_indices(db=db, device_id=device_id, policies=policies)
                    await crud.device.update_sync_status(db=db, device=device, status="success")
                    await db.commit()
                    logging.info(f"[orchestrator] sync-all finished successfully for device_id={device_id}")
                finally:
                    if connected:
                        try:
                            await loop.run_in_executor(None, collector.disconnect)
                        except Exception:
                            pass
            except Exception:
                await db.rollback()
                try:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        await crud.device.update_sync_status(db=db, device=device, status="failure")
                        await db.commit()
                except Exception:
                    pass
                logging.warning(f"[orchestrator] sync-all failed for device_id={device_id}", exc_info=True)
