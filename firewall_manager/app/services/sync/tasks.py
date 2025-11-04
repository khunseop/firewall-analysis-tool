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
    logging.info(f"Starting sync for device_id: {device_id}, data_type: {data_type}")

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
                    # --- Handle item creation ---
                    items_to_create.append(new_item.model_dump())
                    change_logs_to_create.append(schemas.ChangeLogCreate(
                        device_id=device_id, data_type=data_type, object_name=key[-1], action="created",
                        details=json.dumps(new_item.model_dump(), default=str)
                    ))
                else:
                    # --- Handle item updates ---
                    update_data = new_item.model_dump(exclude_unset=True)

                    # 1. Check for last_hit_date change separately (for policies)
                    is_hit_date_changed = False
                    if data_type == "policies":
                        old_hit_date = getattr(existing_item, 'last_hit_date', None)
                        new_hit_date = update_data.get('last_hit_date')

                        old_hit_date_str = None
                        if isinstance(old_hit_date, datetime):
                            # Format datetime to string to match the new string-based format
                            old_hit_date_str = old_hit_date.strftime("%Y-%m-%d %H:%M:%S")
                        else:
                            # It's already a string or None
                            old_hit_date_str = old_hit_date

                        if old_hit_date_str != new_hit_date:
                            is_hit_date_changed = True

                    # 2. Check for other field changes (is_dirty)
                    fields_to_compare = set(update_data.keys())
                    if data_type == "policies":
                        fields_to_compare -= {'seq', 'last_hit_date'} # Exclude seq and last_hit_date

                    is_dirty = any(
                        normalize_value(update_data.get(k)) != normalize_value(getattr(existing_item, k))
                        for k in fields_to_compare
                    )

                    # 3. Determine if an update and/or logging is needed
                    needs_update = is_dirty or is_hit_date_changed

                    if needs_update:
                        update_data["id"] = existing_item.id
                        if data_type == "policies":
                            # Mark for re-indexing only if substantive fields changed
                            if is_dirty:
                                update_data["is_indexed"] = False
                        items_to_update.append(update_data)

                        # Logging logic
                        if is_dirty:
                            change_logs_to_create.append(schemas.ChangeLogCreate(
                                device_id=device_id, data_type=data_type, object_name=key[-1], action="updated",
                                details=json.dumps({"before": {k: getattr(existing_item, k) for k in update_data if k != 'id'}, "after": update_data}, default=str)
                            ))
                        elif is_hit_date_changed: # Only hit date changed
                            change_logs_to_create.append(schemas.ChangeLogCreate(
                                device_id=device_id, data_type=data_type, object_name=key[-1], action="hit_date_updated",
                                details=json.dumps({"before": {"last_hit_date": old_hit_date}, "after": {"last_hit_date": new_hit_date}}, default=str)
                            ))

            for key, existing_item in existing_items_map.items():
                if key not in items_to_sync_map:
                    ids_to_delete.append(existing_item.id)
                    change_logs_to_create.append(schemas.ChangeLogCreate(
                        device_id=device_id, data_type=data_type, object_name=key[-1], action="deleted"
                    ))

            # Perform all DB operations in a single transaction block
            # Note: Transaction is already started by the first query, so we just perform operations and commit
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

            # Commit all changes
            await db.commit()

            logging.info(f"Sync for {data_type} completed. "
                         f"Created: {len(items_to_create)}, Updated: {len(items_to_update)}, Deleted: {len(ids_to_delete)}")

        except Exception as e:
            await db.rollback()
            logging.error(f"Failed to sync {data_type} for device_id {device_id}: {e}", exc_info=True)
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
            await crud.device.update_sync_status(db=db, device=device, status="in_progress", step="Connecting...")
            await db.commit()

        collector = create_collector_from_device(device)
        loop = asyncio.get_running_loop()

        try:
            await loop.run_in_executor(None, getattr(collector, 'connect', lambda: None))

            # --- Data Collection Sequence ---
            collection_sequence = [
                ("network_objects", "Collecting network objects...", collector.export_network_objects, schemas.NetworkObjectCreate),
                ("network_groups", "Collecting network groups...", collector.export_network_group_objects, schemas.NetworkGroupCreate),
                ("services", "Collecting services...", collector.export_service_objects, schemas.ServiceCreate),
                ("service_groups", "Collecting service groups...", collector.export_service_group_objects, schemas.ServiceGroupCreate),
                ("policies", "Collecting policies...", collector.export_security_rules, schemas.PolicyCreate),
            ]

            collected_dfs = {}
            for data_type, step_msg, export_func, schema_create in collection_sequence:
                async with SessionLocal() as db:
                    await crud.device.update_sync_status(db, device=device, status="in_progress", step=step_msg)
                    await db.commit()

                df = await loop.run_in_executor(None, export_func)
                collected_dfs[data_type] = pd.DataFrame() if df is None else df

            # --- Post-Collection Processing ---
            # Hit Date Collection
            from app.services.firewall.interface import FirewallInterface as _FWI
            if device.vendor == 'paloalto':
                logging.info(f"[orchestrator] Palo Alto device detected. Starting last_hit_date collection for device_id={device_id}")
                async with SessionLocal() as db:
                    await crud.device.update_sync_status(db, device=device, status="in_progress", step="Collecting usage history...")
                    await db.commit()
                try:
                    policies_df = collected_dfs["policies"]
                    vsys_list = policies_df["vsys"].unique().tolist() if "vsys" in policies_df.columns and not policies_df["vsys"].isnull().all() else None

                    logging.info(f"[orchestrator] Collecting last_hit_date for VSYS: {vsys_list if vsys_list else 'all'}")

                    if device.use_ssh_for_last_hit_date:
                        logging.info("[orchestrator] Using SSH for last_hit_date collection.")
                        await loop.run_in_executor(None, lambda: collector.export_last_hit_date_ssh(vsys=vsys_list))
                        hit_date_df = pd.DataFrame() # SSH is for logging only for now
                    else:
                        logging.info("[orchestrator] Using API for last_hit_date collection.")
                        # Primary device collection
                        hit_date_df = await loop.run_in_executor(None, lambda: collector.export_last_hit_date(vsys=vsys_list))

                        # HA Peer device collection
                        if device.ha_peer_ip:
                            logging.info(f"[orchestrator] HA Peer IP detected ({device.ha_peer_ip}). Collecting its last_hit_date as well.")
                            ha_collector = create_collector_from_device(device, use_ha_ip=True)
                            try:
                                await loop.run_in_executor(None, ha_collector.connect)
                                ha_hit_date_df = await loop.run_in_executor(None, lambda: ha_collector.export_last_hit_date(vsys=vsys_list))
                                if ha_hit_date_df is not None and not ha_hit_date_df.empty:
                                    hit_date_df = pd.concat([hit_date_df, ha_hit_date_df]).reset_index(drop=True)
                                    logging.info(f"[orchestrator] Concatenated hit dates. Total records: {len(hit_date_df)}")
                            except Exception as ha_e:
                                logging.warning(f"[orchestrator] Failed to collect last_hit_date from HA peer {device.ha_peer_ip}: {ha_e}")
                            finally:
                                await loop.run_in_executor(None, ha_collector.disconnect)

                    if hit_date_df is not None and not hit_date_df.empty:
                        logging.info(f"[orchestrator] Retrieved {len(hit_date_df)} last_hit records; processing...")

                        # Keep only the latest hit date for each rule
                        hit_date_df['last_hit_date'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')
                        hit_date_df = hit_date_df.sort_values('last_hit_date').groupby(['vsys', 'rule_name']).tail(1)

                        # Vender 모듈에서 컬럼명을 snake_case로 통일했으므로 rename 불필요
                        # 데이터 타입 통일
                        for col in ['vsys', 'rule_name']:
                            if col in policies_df.columns: policies_df[col] = policies_df[col].astype(str)
                            if col in hit_date_df.columns: hit_date_df[col] = hit_date_df[col].astype(str)

                        # Convert datetime back to string for merging
                        hit_date_df['last_hit_date'] = hit_date_df['last_hit_date'].dt.strftime('%Y-%m-%d %H:%M:%S')

                        policies_df = pd.merge(policies_df, hit_date_df, on=["vsys", "rule_name"], how="left")

                        collected_dfs["policies"] = policies_df
                        merged_hits = policies_df["last_hit_date"].notna().sum() if "last_hit_date" in policies_df.columns else 0
                        logging.info(f"[orchestrator] last_hit_date merge complete. Non-null hits: {merged_hits}")
                    else:
                        logging.info("[orchestrator] No last_hit_date records returned; skipping merge.")
                except Exception as e:
                    logging.warning(f"Failed to collect or merge last_hit_date for device {device_id}: {e}. Continuing sync without hit dates.", exc_info=True)
            else:
                logging.info(f"[orchestrator] Vendor is not 'paloalto' ({device.vendor}); skipping usage history collection.")


            # --- DB Synchronization ---
            for data_type, _, _, schema_create in collection_sequence:
                df = collected_dfs[data_type]
                df["device_id"] = device_id
                items_to_sync = dataframe_to_pydantic(df, schema_create)
                await sync_data_task(device_id, data_type, items_to_sync)


            # --- Policy Indexing ---
            async with SessionLocal() as db:
                await crud.device.update_sync_status(db, device=device, status="in_progress", step="Indexing policies...")
                await db.commit()

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
                if device_to_update:
                    await crud.device.update_sync_status(db=db, device=device_to_update, status="failure", step="Failed")
                    await db.commit()
        finally:
            await loop.run_in_executor(None, getattr(collector, 'disconnect', lambda: None))
