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

# 동적 세마포어를 위한 전역 변수
_device_sync_semaphore: asyncio.Semaphore | None = None


async def get_sync_semaphore() -> asyncio.Semaphore:
    """DB에서 설정값을 읽어서 세마포어를 생성하거나 반환합니다."""
    global _device_sync_semaphore
    
    # 이미 생성된 세마포어가 있으면 반환
    if _device_sync_semaphore is not None:
        return _device_sync_semaphore
    
    # DB에서 설정값 읽기
    async with SessionLocal() as db:
        setting = await crud.settings.get_setting(db, key="sync_parallel_limit")
        if setting:
            limit = int(setting.value)
        else:
            # 기본값 4
            limit = 4
    
    # 세마포어 생성
    _device_sync_semaphore = asyncio.Semaphore(limit)
    logging.info(f"[sync] 동기화 병렬 처리 개수 설정: {limit}")
    return _device_sync_semaphore


async def reset_sync_semaphore():
    """세마포어를 리셋하여 다음 호출 시 DB에서 다시 읽도록 합니다."""
    global _device_sync_semaphore
    _device_sync_semaphore = None


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

                        # 최신 값 선택: 기존 값과 새 값 중 더 최신인 것을 선택 
                        if old_hit_date_str and new_hit_date:
                            # 둘 다 있으면 datetime으로 변환하여 비교
                            try:
                                old_dt = datetime.strptime(old_hit_date_str, "%Y-%m-%d %H:%M:%S") if old_hit_date_str else None
                                new_dt = datetime.strptime(new_hit_date, "%Y-%m-%d %H:%M:%S") if new_hit_date else None

                                if old_dt and new_dt:
                                    # 더 최신 값 선택
                                    if new_dt > old_dt:
                                        # 새 값이 더 최신이면 업데이트
                                        is_hit_date_changed = True
                                    else:
                                        # 기존 값이 더 최신이면 새 값을 기존 값으로 덮어쓰기
                                        update_data['last_hit_date'] = old_hit_date_str
                                        is_hit_date_changed = False
                                elif new_dt and not old_dt:
                                    # 새 값만 있으면 업데이트
                                    is_hit_date_changed = True
                                elif old_dt and not new_dt:
                                    # 기존 값만 있으면 유지 (업데이트 안 함)
                                    update_data['last_hit_date'] = old_hit_date_str
                                    is_hit_date_changed = False
                            except (ValueError, TypeError):
                                # 파싱 실패 시 기존 로직 사용
                                if old_hit_date_str != new_hit_date:
                                    is_hit_date_changed = True
                        if old_hit_date_str != new_hit_date:
                            # None 처리: 기존 값이 없고 새 값이 있으면 업데이트
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


async def _collect_last_hit_date_parallel(
    collector,
    device: models.Device,
    vsys_list: List[str] | None,
    loop: asyncio.AbstractEventLoop
) -> pd.DataFrame | None:
    """병렬로 메인 장비와 HA Peer의 last_hit_date를 수집하고 최신 값으로 병합합니다.
    
    Args:
        collector: 메인 장비 collector
        device: Device 모델 (ha_peer_ip, use_ssh_for_last_hit_date 확인용)
        vsys_list: VSYS 리스트
        loop: asyncio event loop
        
    Returns:
        병합된 hit_date_df (각 rule별 최신 날짜) 또는 None (수집 실패 시)
    """
    async def _collect_main_device() -> pd.DataFrame | None:
        """메인 장비의 last_hit_date 수집"""
        try:
            if device.use_ssh_for_last_hit_date:
                logging.info("[orchestrator] Collecting main device last_hit_date via SSH.")
                return await loop.run_in_executor(
                    None, 
                    lambda: collector.export_last_hit_date_ssh(vsys=vsys_list)
                )
            else:
                logging.info("[orchestrator] Collecting main device last_hit_date via API.")
                return await loop.run_in_executor(
                    None,
                    lambda: collector.export_last_hit_date(vsys=vsys_list)
                )
        except Exception as e:
            logging.warning(f"[orchestrator] Failed to collect last_hit_date from main device: {e}")
            return None
    
    async def _collect_ha_peer() -> pd.DataFrame | None:
        """HA Peer의 last_hit_date 수집"""
        if not device.ha_peer_ip:
            return None
            
        ha_collector = None
        try:
            logging.info(f"[orchestrator] Collecting HA peer ({device.ha_peer_ip}) last_hit_date.")
            ha_collector = create_collector_from_device(device, use_ha_ip=True)
            
            # 연결
            await loop.run_in_executor(None, ha_collector.connect)
            
            # last_hit_date 수집
            if device.use_ssh_for_last_hit_date:
                hit_date_df = await loop.run_in_executor(
                    None,
                    lambda: ha_collector.export_last_hit_date_ssh(vsys=vsys_list)
                )
            else:
                hit_date_df = await loop.run_in_executor(
                    None,
                    lambda: ha_collector.export_last_hit_date(vsys=vsys_list)
                )
            
            return hit_date_df
        except Exception as e:
            logging.warning(f"[orchestrator] Failed to collect last_hit_date from HA peer {device.ha_peer_ip}: {e}")
            return None
        finally:
            if ha_collector:
                try:
                    await loop.run_in_executor(None, ha_collector.disconnect)
                except Exception:
                    pass
    
    # 메인 장비와 HA Peer를 병렬로 수집
    main_result, ha_result = await asyncio.gather(
        _collect_main_device(),
        _collect_ha_peer(),
        return_exceptions=False
    )
    
    # 결과 병합: 정책명(rule_name) 기준으로 최신 날짜 선택
    # 주의: HA 장비 간에는 VSYS가 다를 수 있으므로 rule_name만으로 병합
    if main_result is None or main_result.empty:
        if ha_result is None or ha_result.empty:
            logging.info("[orchestrator] No last_hit_date records collected from either device.")
            return None
        # 메인 장비 결과가 없으면 HA Peer 결과만 반환 (None 값 제거)
        hit_date_df = ha_result.copy()
        hit_date_df['last_hit_date'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')
        hit_date_df = hit_date_df[hit_date_df['last_hit_date'].notna()].copy()
        if hit_date_df.empty:
            return None
        # rule_name 기준으로 중복 제거 (같은 정책명이 여러 VSYS에 있을 수 있음)
        hit_date_df = hit_date_df.groupby('rule_name', as_index=False)['last_hit_date'].max()
        logging.info(f"[orchestrator] Collected {len(hit_date_df)} last_hit records from HA peer only.")
        return hit_date_df
    
    if ha_result is None or ha_result.empty:
        # HA Peer 결과가 없으면 메인 장비 결과만 반환 (None 값 제거)
        hit_date_df = main_result.copy()
        hit_date_df['last_hit_date'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')
        hit_date_df = hit_date_df[hit_date_df['last_hit_date'].notna()].copy()
        if hit_date_df.empty:
            return None
        # rule_name 기준으로 중복 제거
        hit_date_df = hit_date_df.groupby('rule_name', as_index=False)['last_hit_date'].max()
        logging.info(f"[orchestrator] Collected {len(hit_date_df)} last_hit records from main device only.")
        return hit_date_df
    
    # 둘 다 있는 경우: datetime 변환 후 병합
    main_df = main_result.copy()
    main_df['last_hit_date'] = pd.to_datetime(main_df['last_hit_date'], errors='coerce')
    main_df = main_df[main_df['last_hit_date'].notna()].copy()  # None 값 제거
    
    ha_df = ha_result.copy()
    ha_df['last_hit_date'] = pd.to_datetime(ha_df['last_hit_date'], errors='coerce')
    ha_df = ha_df[ha_df['last_hit_date'].notna()].copy()  # None 값 제거
    
    # 두 DataFrame을 합치고, 정책명(rule_name) 기준으로 최신 날짜 선택
    combined_df = pd.concat([main_df, ha_df], ignore_index=True)
    
    # groupby로 최신 날짜 선택 (rule_name만 사용, VSYS는 제외)
    hit_date_df = combined_df.groupby('rule_name', as_index=False)['last_hit_date'].max()
    
    logging.info(f"[orchestrator] Collected {len(hit_date_df)} last_hit records (merged from main device and HA peer by rule_name).")
    return hit_date_df


async def run_sync_all_orchestrator(device_id: int) -> None:
    """Run full device sync sequentially for one device."""
    semaphore = await get_sync_semaphore()
    async with semaphore:
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
            # 연결 시도
            await loop.run_in_executor(None, getattr(collector, 'connect', lambda: None))
            
            # 연결 완료 후 상태 업데이트
            async with SessionLocal() as db:
                device = await crud.device.get_device(db=db, device_id=device_id)
                if device:
                    await crud.device.update_sync_status(db, device=device, status="in_progress", step="Connected")
                    await db.commit()

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
                # 데이터 수집 시작 전 상태 업데이트
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step=step_msg)
                        await db.commit()

                # 실제 데이터 수집 수행 (여기서 시간이 걸림)
                logging.info(f"[orchestrator] Starting export for {data_type}")
                df = await loop.run_in_executor(None, export_func)
                collected_dfs[data_type] = pd.DataFrame() if df is None else df
                logging.info(f"[orchestrator] Export completed for {data_type}, rows: {len(collected_dfs[data_type])}")
                
                # 데이터 수집 완료 후 상태 업데이트
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        completed_msg_map = {
                            "network_objects": "Network objects collected",
                            "network_groups": "Network groups collected",
                            "services": "Services collected",
                            "service_groups": "Service groups collected",
                            "policies": "Policies collected",
                        }
                        completed_msg = completed_msg_map.get(data_type, f"{data_type} collected")
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step=completed_msg)
                        await db.commit()

            # --- Post-Collection Processing ---
            # Hit Date Collection
            from app.services.firewall.interface import FirewallInterface as _FWI
            if device.vendor == 'paloalto':
                logging.info(f"[orchestrator] Palo Alto device detected. Starting last_hit_date collection for device_id={device_id}")
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step="Collecting usage history...")
                        await db.commit()
                try:
                    policies_df = collected_dfs["policies"]
                    vsys_list = policies_df["vsys"].unique().tolist() if "vsys" in policies_df.columns and not policies_df["vsys"].isnull().all() else None

                    logging.info(f"[orchestrator] Collecting last_hit_date for VSYS: {vsys_list if vsys_list else 'all'}")
                    
                    # 병렬로 메인 장비와 HA Peer의 last_hit_date 수집
                    hit_date_df = await _collect_last_hit_date_parallel(
                        collector=collector,
                        device=device,
                        vsys_list=vsys_list,
                        loop=loop
                    )

                    if hit_date_df is not None and not hit_date_df.empty:
                        logging.info(f"[orchestrator] Retrieved {len(hit_date_df)} last_hit records; processing...")

                        # _collect_last_hit_date_parallel에서 이미 최신 값으로 병합되었으므로 추가 처리 불필요
                        # 데이터 타입 통일 (문자열로 변환하여 merge 준비)
                        # 주의: rule_name만으로 병합하므로 vsys는 제외
                        if 'rule_name' in policies_df.columns:
                            policies_df['rule_name'] = policies_df['rule_name'].astype(str)
                        if 'rule_name' in hit_date_df.columns:
                            hit_date_df['rule_name'] = hit_date_df['rule_name'].astype(str)
                        
                        # datetime을 문자열로 변환 (merge 준비)
                        hit_date_df['last_hit_date'] = hit_date_df['last_hit_date'].dt.strftime('%Y-%m-%d %H:%M:%S')

                        # 기존 last_hit_date와 새로 수집한 값을 병합 (최신 값 선택)
                        # 정책명(rule_name)만으로 병합 (VSYS는 제외)
                        if 'last_hit_date' in policies_df.columns:
                            # 기존 값과 새 값을 datetime으로 변환하여 비교
                            policies_df['last_hit_date_old'] = pd.to_datetime(policies_df['last_hit_date'], errors='coerce')
                            hit_date_df['last_hit_date_new'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')
                            
                            # 병합: rule_name만 사용
                            merged_df = pd.merge(
                                policies_df, 
                                hit_date_df[['rule_name', 'last_hit_date_new']], 
                                on="rule_name", 
                                how="left"
                            )
                            
                            # 최신 값 선택: 기존 값과 새 값 중 더 최신인 것을 선택
                            # None/NaT는 무시하고 유효한 값만 비교
                            def choose_latest(row):
                                old_val = row.get('last_hit_date_old')
                                new_val = row.get('last_hit_date_new')
                                
                                # 둘 다 None이면 None 반환
                                if pd.isna(old_val) and pd.isna(new_val):
                                    return None
                                # 하나만 있으면 그 값 반환
                                elif pd.isna(old_val):
                                    return new_val
                                elif pd.isna(new_val):
                                    return old_val
                                # 둘 다 있으면 더 최신 값 선택
                                else:
                                    return new_val if new_val > old_val else old_val
                            
                            merged_df['last_hit_date'] = merged_df.apply(choose_latest, axis=1)
                            
                            # 임시 컬럼 제거
                            merged_df = merged_df.drop(columns=['last_hit_date_old', 'last_hit_date_new'], errors='ignore')
                            
                            # 문자열로 변환 (원래 형식 유지)
                            merged_df['last_hit_date'] = pd.to_datetime(merged_df['last_hit_date'], errors='coerce').dt.strftime('%Y-%m-%d %H:%M:%S')
                            
                            policies_df = merged_df
                        else:
                            # 기존 last_hit_date가 없으면 그냥 병합 (rule_name만 사용)
                            policies_df = pd.merge(policies_df, hit_date_df[['rule_name', 'last_hit_date']], on="rule_name", how="left")
                        
                        collected_dfs["policies"] = policies_df
                        merged_hits = policies_df["last_hit_date"].notna().sum() if "last_hit_date" in policies_df.columns else 0
                        logging.info(f"[orchestrator] last_hit_date merge complete. Non-null hits: {merged_hits}")
                        
                        # Usage history 수집 완료 후 상태 업데이트
                        async with SessionLocal() as db:
                            device = await crud.device.get_device(db=db, device_id=device_id)
                            if device:
                                await crud.device.update_sync_status(db, device=device, status="in_progress", step="Usage history collected")
                                await db.commit()
                    else:
                        logging.info("[orchestrator] No last_hit_date records returned; skipping merge.")
                except Exception as e:
                    logging.warning(f"Failed to collect or merge last_hit_date for device {device_id}: {e}. Continuing sync without hit dates.", exc_info=True)
            else:
                logging.info(f"[orchestrator] Vendor is not 'paloalto' ({device.vendor}); skipping usage history collection.")


            # --- DB Synchronization ---
            for data_type, _, _, schema_create in collection_sequence:
                # 동기화 시작 전 상태 업데이트
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        syncing_msg_map = {
                            "network_objects": "Synchronizing network objects...",
                            "network_groups": "Synchronizing network groups...",
                            "services": "Synchronizing services...",
                            "service_groups": "Synchronizing service groups...",
                            "policies": "Synchronizing policies...",
                        }
                        syncing_msg = syncing_msg_map.get(data_type, f"Synchronizing {data_type}...")
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step=syncing_msg)
                        await db.commit()
                
                # 실제 동기화 수행
                logging.info(f"[orchestrator] Starting DB sync for {data_type}")
                df = collected_dfs[data_type]
                df["device_id"] = device_id
                items_to_sync = dataframe_to_pydantic(df, schema_create)
                await sync_data_task(device_id, data_type, items_to_sync)
                logging.info(f"[orchestrator] DB sync completed for {data_type}")
                
                # 동기화 완료 후 상태 업데이트
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        synced_msg_map = {
                            "network_objects": "Network objects synchronized",
                            "network_groups": "Network groups synchronized",
                            "services": "Services synchronized",
                            "service_groups": "Service groups synchronized",
                            "policies": "Policies synchronized",
                        }
                        synced_msg = synced_msg_map.get(data_type, f"{data_type} synchronized")
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step=synced_msg)
                        await db.commit()


            # --- Policy Indexing ---
            async with SessionLocal() as db:
                device = await crud.device.get_device(db=db, device_id=device_id)
                if device:
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
                    if device_to_update:
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
