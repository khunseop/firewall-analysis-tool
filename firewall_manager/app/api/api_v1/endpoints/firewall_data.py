# firewall_manager/app/api/api_v1/endpoints/firewall_data.py
import logging
from typing import Any, List
import asyncio
from datetime import datetime
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from sqlalchemy.future import select
import json

from app import crud, models, schemas
from app.db.session import get_db, SessionLocal
from app.core.security import fernet, decrypt
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.firewall.interface import FirewallInterface
from ipaddress import ip_network, ip_address, IPv4Address, IPv6Address
from app.services.policy_indexer import rebuild_policy_indices
from app.models.policy_members import PolicyAddressMember, PolicyServiceMember

router = APIRouter()

def dataframe_to_pydantic(df: pd.DataFrame, pydantic_model):
    """Converts a Pandas DataFrame to a list of Pydantic models.

    - Normalizes column names to snake_case
    - Converts vendor-specific flags to expected types
    - Ensures critical keys (like policies.rule_name) are present and valid
    """
    # 1) Standardize columns
    df.columns = [col.lower().replace(' ', '_') for col in df.columns]
    df = df.rename(columns={
        # Common normalizations for non-policy objects
        "group_name": "name",
        "entry": "members",
        "value": "ip_address",
    })

    # 2) Normalize enable to boolean when present
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

    # 3) Policy-specific fixes
    # Detect if this looks like a policies DataFrame by presence of rule_name-ish column
    if 'rule_name' in df.columns or 'rule name' in df.columns:
        # Ensure the canonical column name
        if 'rule name' in df.columns and 'rule_name' not in df.columns:
            df = df.rename(columns={'rule name': 'rule_name'})

        # Normalize last_hit_date values to None when empty-like
        if 'last_hit_date' in df.columns:
            def _normalize_last_hit(v):
                if v in ("", "None", None, "-"):
                    return None
                return v
            df['last_hit_date'] = df['last_hit_date'].apply(_normalize_last_hit)

        # NGF 등 일부 벤더가 숫자 ID를 반환할 수 있으므로 문자열로 강제하고, 결측은 제거
        if 'rule_name' in df.columns:
            def _normalize_rule_name(v):
                try:
                    if v is None:
                        return None
                    s = str(v).strip()
                    if s == '' or s.lower() in {"nan", "none", "-"}:
                        return None
                    return s
                except Exception:
                    return None
            df['rule_name'] = df['rule_name'].apply(_normalize_rule_name)
            # Drop invalid rows lacking a usable rule_name
            df = df[df['rule_name'].notna()]

    # 4) (REMOVED) Numeric parsing is now handled by the policy indexer.
    # The sync process now preserves the original string values from the firewall.

    # 5) protocol normalize to lower for consistency
    if pydantic_model is schemas.ServiceCreate and not df.empty and 'protocol' in df.columns:
        df['protocol'] = df['protocol'].apply(lambda x: str(x).lower() if x is not None else x)

    # 6) Replace NaN with None for Pydantic compatibility
    if not df.empty:
        df = df.where(pd.notna(df), None)
    # 7) Build Pydantic objects
    records = df.to_dict(orient='records') if not df.empty else []
    return [pydantic_model(**row) for row in records]

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

async def _sync_data_core(db: AsyncSession, device: models.Device, data_type: str, items_to_sync: List[Any]):
    """
    Core data synchronization logic for a single data type within a transaction.
    This function does NOT commit the transaction.
    """
    logging.info(f"Core sync for {data_type} on device: {device.name}")
    sync_map = {
        "policies": (crud.policy.get_policies_by_device, crud.policy.create_policies, crud.policy.update_policy, crud.policy.delete_policy),
        "network_objects": (crud.network_object.get_network_objects_by_device, crud.network_object.create_network_objects, crud.network_object.update_network_object, crud.network_object.delete_network_object),
        "network_groups": (crud.network_group.get_network_groups_by_device, crud.network_group.create_network_groups, crud.network_group.update_network_group, crud.network_group.delete_network_group),
        "services": (crud.service.get_services_by_device, crud.service.create_services, crud.service.update_service, crud.service.delete_service),
        "service_groups": (crud.service_group.get_service_groups_by_device, crud.service_group.create_service_groups, crud.service_group.update_service_group, crud.service_group.delete_service_group),
    }

    get_all_func, create_func, update_func, delete_func = sync_map[data_type]

    existing_items = await get_all_func(db=db, device_id=device.id)
    key_attribute = get_key_attribute(data_type)
    existing_items_map = {getattr(item, key_attribute): item for item in existing_items}
    items_to_sync_map = {getattr(item, key_attribute): item for item in items_to_sync}

    logging.info(f"Found {len(existing_items)} existing items and {len(items_to_sync)} items to sync for {data_type}.")

    # Create/Update/Touch logic
    items_to_create = []
    for item_name, item_in in items_to_sync_map.items():
        existing_item = existing_items_map.get(item_name)
        if existing_item:
            obj_data = item_in.model_dump(exclude_unset=True)
            db_obj_data = {c.name: getattr(existing_item, c.name) for c in existing_item.__table__.columns if c.name in obj_data}

            is_dirty = False
            for k in obj_data:
                # 데이터 타입 불일치 및 정규화 후 비교 (예: " a " == "a")
                val_in = obj_data.get(k)
                val_db = db_obj_data.get(k)

                if isinstance(val_in, str) and isinstance(val_db, str):
                    if val_in.strip() != val_db.strip():
                        is_dirty = True
                        break
                elif val_in != val_db:
                    is_dirty = True
                    break

            if is_dirty:
                logging.info(f"Updating {data_type}: {item_name}")
                await update_func(db=db, db_obj=existing_item, obj_in=item_in)
                await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device.id, data_type=data_type, object_name=item_name, action="updated", details=json.dumps({"before": db_obj_data, "after": obj_data}, default=str)))
        else:
            items_to_create.append(item_in)

    if items_to_create:
        logging.info(f"Creating {len(items_to_create)} new {data_type}.")
        await create_func(db=db, **{f"{data_type}": items_to_create})
        for item_in in items_to_create:
            await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device.id, data_type=data_type, object_name=getattr(item_in, key_attribute), action="created", details=json.dumps(item_in.model_dump(), default=str)))

    # Delete logic
    items_to_delete_count = 0
    for item_name, item in existing_items_map.items():
        if item_name not in items_to_sync_map:
            items_to_delete_count += 1
            logging.info(f"Deleting {data_type}: {item_name}")
            if data_type == "policies":
                await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id == item.id))
                await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id == item.id))
            await delete_func(db=db, **{f"{get_singular_name(data_type)}": item})
            await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device.id, data_type=data_type, object_name=item_name, action="deleted"))

    if items_to_delete_count > 0:
        logging.info(f"Deleted {items_to_delete_count} {data_type}.")


async def _sync_data_task(device_id: int, data_type: str, items_to_sync: List[Any]):
    """(DEPRECATED) Generic background task to synchronize data for a device."""
    logging.info(f"Starting sync for device_id: {device_id}, data_type: {data_type}")
    async with SessionLocal() as db:
        device = await crud.device.get_device(db=db, device_id=device_id)
        if not device:
            logging.error(f"Device with id {device_id} not found.")
            return

        try:
            await _sync_data_core(db, device, data_type, items_to_sync)

            # NOTE: Policy indexing is now a separate step, not called here.

            await crud.device.update_sync_status(db=db, device=device, status="success")
            await db.commit()
            logging.info(f"Sync completed successfully for device_id: {device_id}, data_type: {data_type}")

        except Exception as e:
            await db.rollback()
            logging.error(f"Failed to sync {data_type} for device {device.name}: {e}", exc_info=True)
            async with SessionLocal() as new_db:
                device_for_status_update = await crud.device.get_device(db=new_db, device_id=device_id)
                if device_for_status_update:
                    await crud.device.update_sync_status(db=new_db, device=device_for_status_update, status="failure")
                    await new_db.commit()


async def _sync_all_task(device_id: int):
    """
    Orchestrated background task to synchronize all data types for a device
    in a single transaction.
    """
    logging.info(f"Starting sync-all orchestrator for device_id: {device_id}")
    async with SessionLocal() as db:
        device = await crud.device.get_device(db=db, device_id=device_id)
        if not device:
            logging.error(f"Device with id {device_id} not found during sync-all.")
            return

        collector = None
        connected = False
        loop = asyncio.get_running_loop()
        try:
            collector = await _get_collector(device)
            try:
                connected = await loop.run_in_executor(None, collector.connect)
            except NotImplementedError:
                connected = True # Some vendors don't need explicit connect
            except Exception as e:
                raise RuntimeError(f"Failed to connect to device: {e}")

            sequence = [
                ("network_objects", schemas.NetworkObjectCreate, collector.export_network_objects),
                ("network_groups", schemas.NetworkGroupCreate, collector.export_network_group_objects),
                ("services", schemas.ServiceCreate, collector.export_service_objects),
                ("service_groups", schemas.ServiceGroupCreate, collector.export_service_group_objects),
                ("policies", schemas.PolicyCreate, collector.export_security_rules),
            ]

            all_policies_from_sync = []
            for data_type, schema_create, export_func in sequence:
                logging.info(f"Sync-all: fetching {data_type} for device {device.name}")
                try:
                    df = await loop.run_in_executor(None, export_func)
                except NotImplementedError:
                    logging.warning(f"Vendor '{device.vendor}' does not support '{data_type}'. Skipping.")
                    continue

                if df is None:
                    df = pd.DataFrame()
                df['device_id'] = device_id
                items_to_sync = dataframe_to_pydantic(df, schema_create)

                if data_type == "policies":
                    all_policies_from_sync = items_to_sync

                await _sync_data_core(db, device, data_type, items_to_sync)

            # Palo Alto: last_hit_date 보강 (모든 정책 수집 후 1회 호출)
            if all_policies_from_sync and (device.vendor or "").lower() == "paloalto":
                logging.info("Enriching Palo Alto policies with last hit date...")
                try:
                    vsys_set = {str(p.vsys).strip() for p in all_policies_from_sync if getattr(p, 'vsys', None)}
                    hit_df = await loop.run_in_executor(None, lambda: collector.export_last_hit_date(vsys=vsys_set))
                    if hit_df is not None and not hit_df.empty:
                        hit_df.columns = [c.lower().replace(' ', '_') for c in hit_df.columns]
                        hit_map = {((str(r.get('vsys')).lower()) if r.get('vsys') else None, str(r.get('rule_name'))): r.get('last_hit_date') for r in hit_df.to_dict(orient='records') if r.get('rule_name')}

                        # DB에서 해당 정책들을 다시 조회하여 업데이트
                        policy_names = [p.rule_name for p in all_policies_from_sync]
                        result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id, models.Policy.rule_name.in_(policy_names)))
                        policies_to_update = result.scalars().all()

                        for p in policies_to_update:
                            key = ((str(p.vsys).lower()) if p.vsys else None, p.rule_name)
                            if key in hit_map:
                                p.last_hit_date = hit_map[key]
                except Exception:
                    logging.warning("Failed to enrich policies with last hit date", exc_info=True)


            logging.info("Sync-all transaction phase complete. Committing...")
            await crud.device.update_sync_status(db=db, device=device, status="success")
            await db.commit()
            logging.info(f"Sync-all completed successfully for device_id: {device_id}")

        except Exception as e:
            await db.rollback()
            logging.error(f"Failed to sync-all for device {device.name}: {e}", exc_info=True)
            # Use a new session for the final status update on failure
            async with SessionLocal() as new_db:
                device_for_status_update = await crud.device.get_device(db=new_db, device_id=device_id)
                if device_for_status_update:
                    await crud.device.update_sync_status(db=new_db, device=device_for_status_update, status="failure")
                    await new_db.commit()
        finally:
            if connected and collector:
                try:
                    await loop.run_in_executor(None, collector.disconnect)
                except Exception:
                    pass # Ignore disconnect errors

@router.post("/sync/{device_id}/{data_type}", response_model=schemas.Msg, deprecated=True)
async def sync_device_data(device_id: int, data_type: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    await crud.device.update_sync_status(db=db, device=device, status="in_progress")
    await db.commit()

    # 미싱 그린렛(MissingGreenlet) 회피: 커밋 이후 ORM 속성 재로딩을 피하기 위해
    # 필요한 장비 속성을 커밋 전에 미리 추출해 둡니다.
    loop = asyncio.get_running_loop()
    vendor_lower = (device.vendor or "").lower()
    device_ip = device.ip_address
    device_username = device.username
    encrypted_pw = device.password
    # 상태 갱신 및 커밋 이후에는 ORM 객체 접근을 최소화합니다.

    # 데이터 타입별 생성 스키마만 먼저 매핑하고, export 함수는 collector 생성 후 바인딩합니다.
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
        # Collector는 커밋 이전에 확보한 원시 값으로 생성하여 그린렛 오류를 예방합니다.
        # (ORM 객체 필드 재평가를 피함)
        # 안전 복호화 처리 (mock는 실패 시 원문 허용)
        try:
            try:
                decrypted_password = decrypt(encrypted_pw)
            except Exception:
                if vendor_lower == "mock":
                    decrypted_password = encrypted_pw
                else:
                    raise
            collector = FirewallCollectorFactory.get_collector(
                source_type=vendor_lower,
                hostname=device_ip,
                username=device_username,
                password=decrypted_password,
            )
        except Exception as e:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=500, detail=f"Collector initialization failed: {e}")

        # Ensure connection for vendors that require it (e.g., PaloAlto)
        try:
            connected = await loop.run_in_executor(None, collector.connect)
        except NotImplementedError:
            connected = False
        except Exception as e:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=502, detail=f"Failed to connect to device: {e}")

        # 바인딩된 export 함수 선택
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
            # Vendor does not support this data type
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=400, detail=f"'{data_type}' sync is not supported by vendor '{device.vendor}'.")
        except Exception as e:
            await crud.device.update_sync_status(db=db, device=device, status="failure")
            await db.commit()
            raise HTTPException(status_code=502, detail=f"Failed to export data from device: {e}")

        if df is None:
            df = pd.DataFrame()
        df['device_id'] = device_id
        items_to_sync = dataframe_to_pydantic(df, schema_create)

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


@router.post("/sync-all/{device_id}", response_model=schemas.Msg)
async def sync_all(device_id: int, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    await crud.device.update_sync_status(db=db, device=device, status="in_progress")
    await db.commit()

    background_tasks.add_task(_sync_all_task, device_id)

    return {"msg": "Full synchronization started in the background."}

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


@router.post("/parse-index/{device_id}", response_model=schemas.Msg)
async def parse_and_index_policies(device_id: int, db: AsyncSession = Depends(get_db)):
    """Manually trigger policy parsing and indexing for a device."""
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    try:
        # Fetch all policies for the device to be indexed
        policies = await crud.policy.get_policies_by_device(db=db, device_id=device_id)
        if not policies:
            return {"msg": "No policies found for the device to index."}

        await rebuild_policy_indices(db=db, device_id=device_id, policies=policies)
        await db.commit()
        return {"msg": f"Successfully parsed and indexed {len(policies)} policies."}
    except Exception as e:
        await db.rollback()
        logging.error(f"Failed to parse and index policies for device {device.name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error during policy indexing.")
