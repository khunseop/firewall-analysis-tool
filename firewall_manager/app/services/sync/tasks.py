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

            # 모든 정책에 대해 last_hit_date 필드를 파싱하고 정규화합니다.
            # 이 로직은 `dataframe_to_pydantic`에서 이미 처리되었어야 하지만,
            # 동기화 객체에 대해 한 번 더 확실하게 처리하여 데이터 일관성을 보장합니다.
            if data_type == "policies":
                for item in items_to_sync:
                    if hasattr(item, "last_hit_date"):
                        raw_value = getattr(item, "last_hit_date")
                        normalized_date = normalize_last_hit_value(raw_value)
                        setattr(item, "last_hit_date", normalized_date)

            items_to_create: List[Any] = []

            for item_key, item_in in items_to_sync_map.items():
                existing_item = existing_items_map.get(item_key)
                if existing_item:
                    existing_item.last_seen_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
                    if hasattr(existing_item, "is_active"):
                        existing_item.is_active = True
                    obj_data_in = item_in.model_dump(exclude_unset=True, exclude_none=True)

                    is_dirty = False
                    fields_to_compare = obj_data_in.keys()

                    # 로깅을 위한 원본 데이터 상태 저장
                    db_obj_before_update = {k: getattr(existing_item, k, None) for k in fields_to_compare}

                    for field in fields_to_compare:
                        val_in = obj_data_in[field]
                        val_db = getattr(existing_item, field, None)

                        if normalize_value(val_in) != normalize_value(val_db):
                            is_dirty = True
                            break

                    if is_dirty:
                        logging.info(f"Updating {data_type}: {_display_name(item_in)}")

                        # 실제 업데이트 수행
                        await update_func(db=db, db_obj=existing_item, obj_in=item_in)

                        # 변경 로그 기록
                        await crud.change_log.create_change_log(
                            db=db,
                            change_log=schemas.ChangeLogCreate(
                                device_id=device_id,
                                data_type=data_type,
                                object_name=_display_name(item_in),
                                action="updated",
                                details=json.dumps({
                                    "before": db_obj_before_update,
                                    "after": obj_data_in
                                }, default=str),
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
    """Run full device sync sequentially for one device."""
    async with _DEVICE_SYNC_SEMAPHORE:
        logging.info(f"[orchestrator] Starting sync-all for device_id={device_id}")

        # 1. Set status to "in_progress"
        async with SessionLocal() as db:
            device = await crud.device.get_device(db=db, device_id=device_id)
            if not device:
                logging.warning(f"[orchestrator] Device not found: id={device_id}")
                return
            await crud.device.update_sync_status(db=db, device=device, status="in_progress")
            await db.commit()

        collector = create_collector_from_device(device)
        connected = False
        loop = asyncio.get_running_loop()

        try:
            # 2. Connect to the device
            try:
                await loop.run_in_executor(None, collector.connect)
                connected = True
            except NotImplementedError:
                # Some vendors may not require an explicit connect/disconnect
                connected = False

            # 3. Define the sequence of data types to sync
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

            # 4. Sequentially fetch and sync each data type
            for data_type, schema_create in sequence:
                logging.info(f"[orchestrator] Syncing {data_type} for device_id={device_id}")
                try:
                    df = await loop.run_in_executor(None, export_map[data_type])
                except NotImplementedError:
                    logging.info(f"[orchestrator] Sync for '{data_type}' is not implemented for this device vendor.")
                    continue

                if df is None:
                    df = pd.DataFrame()

                df["device_id"] = device_id
                items_to_sync = dataframe_to_pydantic(df, schema_create)
                await sync_data_task(device_id, data_type, items_to_sync, update_device_status=False)

            # 5. Post-sync operations (e.g., rebuilding indices)
            async with SessionLocal() as db:
                logging.info(f"[orchestrator] Rebuilding policy indices for device_id={device_id}")
                result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id))
                policies = result.scalars().all()
                await rebuild_policy_indices(db=db, device_id=device_id, policies=policies)

                # 6. Set final status to "success"
                device_to_update = await crud.device.get_device(db=db, device_id=device_id)  # Re-fetch device
                if device_to_update:
                    await crud.device.update_sync_status(db=db, device=device_to_update, status="success")
                    await db.commit()

            logging.info(f"[orchestrator] sync-all finished successfully for device_id={device_id}")

        except Exception as e:
            logging.error(f"[orchestrator] sync-all failed for device_id={device_id}: {e}", exc_info=True)
            # 7. Set final status to "failure"
            async with SessionLocal() as db:
                device_to_update = await crud.device.get_device(db=db, device_id=device_id)
                if device_to_update:
                    await crud.device.update_sync_status(db=db, device=device_to_update, status="failure")
                    await db.commit()
        finally:
            # 8. Disconnect from the device
            if connected:
                try:
                    await loop.run_in_executor(None, collector.disconnect)
                except Exception as e:
                    logging.warning(f"Ignoring error during collector disconnect: {e}", exc_info=True)
