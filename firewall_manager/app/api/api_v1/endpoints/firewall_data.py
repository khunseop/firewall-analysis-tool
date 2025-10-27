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
from ipaddress import ip_address, IPv4Address  # used for PaloAlto hit-date enrichment
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

    # 2) Normalize enable to boolean when present (robust to numeric/strings)
    if 'enable' in df.columns:
        def _to_bool(v):
            if v is None:
                return None
            # Native booleans
            if isinstance(v, bool):
                return v
            # Numeric types (including floats from Excel): 0/0.0 -> False, 1/1.0 -> True
            if isinstance(v, (int,)):
                return bool(v)
            if isinstance(v, float):
                if v == 0.0:
                    return False
                if v == 1.0:
                    return True
            # String normalization
            try:
                s = str(v).strip().lower()
            except Exception:
                return None
            if s in {"y", "yes", "true", "1", "on", "enabled"}:
                return True
            if s in {"n", "no", "false", "0", "off", "disabled"}:
                return False
            return None
        df['enable'] = df['enable'].apply(_to_bool)

    # 3) Policy-specific fixes
    # Detect if this looks like a policies DataFrame by presence of rule_name-ish column
    if 'rule_name' in df.columns or 'rule name' in df.columns:
        # Ensure the canonical column name
        if 'rule name' in df.columns and 'rule_name' not in df.columns:
            df = df.rename(columns={'rule name': 'rule_name'})

        # Normalize last_hit_date to naive UTC datetime; None when empty-like
        if 'last_hit_date' in df.columns:
            def _normalize_last_hit(v):
                if v in ("", "None", None, "-"):
                    return None
                try:
                    dt = pd.to_datetime(v, errors='coerce', utc=True)
                    if pd.isna(dt):
                        return None
                    # store as naive UTC datetime to fit DB DateTime
                    return dt.to_pydatetime().replace(tzinfo=None)
                except Exception:
                    return None
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

    # 4) 동기화 단계에서는 숫자화 파싱을 수행하지 않습니다 (원문 보존)
    #    - 네트워크 객체: ip_version/ip_start/ip_end는 NULL 유지
    #    - 서비스: port_start/port_end는 NULL 유지, protocol은 소문자 정규화만 수행
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

async def _sync_data_task(device_id: int, data_type: str, items_to_sync: List[Any], update_device_status: bool = False):
    """Generic background task to synchronize data for a device.

    If update_device_status is True, update device status on success/failure.
    Used by single-type sync endpoint. For orchestrated sync-all, pass False.
    """
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

            # Palo Alto: last_hit_date 단순 보강 (VSYS 고려)
            if data_type == "policies" and (device.vendor or "").lower() == "paloalto":
                loop = asyncio.get_running_loop()
                collector = await _get_collector(device)
                try:
                    # policies에 포함된 vsys만 추출해 최소 호출
                    vsys_set = {str(getattr(obj, 'vsys')).strip() for obj in items_to_sync if getattr(obj, 'vsys', None)}
                    await loop.run_in_executor(None, collector.connect)
                    hit_df = await loop.run_in_executor(None, lambda: collector.export_last_hit_date(vsys=vsys_set))
                finally:
                    try:
                        await loop.run_in_executor(None, collector.disconnect)
                    except Exception:
                        pass

                if hit_df is not None and not hit_df.empty:
                    hit_df.columns = [c.lower().replace(' ', '_') for c in hit_df.columns]
                    if 'last_hit_date' in hit_df.columns:
                        def _normalize_hit(v):
                            if v in ("", "None", None, "-"):
                                return None
                            try:
                                dt = pd.to_datetime(v, errors='coerce', utc=True)
                                if pd.isna(dt):
                                    return None
                                return dt.to_pydatetime().replace(tzinfo=None)
                            except Exception:
                                return None
                        hit_df['last_hit_date'] = hit_df['last_hit_date'].apply(_normalize_hit)
                    hit_map = {((str(r.get('vsys')).lower()) if r.get('vsys') else None, str(r.get('rule_name'))): r.get('last_hit_date') for r in hit_df.to_dict(orient='records') if r.get('rule_name')}
                    for name, obj in items_to_sync_map.items():
                        obj_vsys = getattr(obj, 'vsys', None)
                        key = ((str(obj_vsys).lower()) if obj_vsys else None, name)
                        if key in hit_map and hasattr(obj, 'last_hit_date'):
                            setattr(obj, 'last_hit_date', hit_map[key])

            items_to_create = []

            for item_name, item_in in items_to_sync_map.items():
                existing_item = existing_items_map.get(item_name)
                if existing_item:
                    # Touch last_seen_at and ensure is_active for seen items
                    existing_item.last_seen_at = datetime.utcnow()
                    if hasattr(existing_item, "is_active"):
                        existing_item.is_active = True
                    # Compare only explicitly provided and non-null fields to avoid false updates
                    obj_data = item_in.model_dump(exclude_unset=True, exclude_none=True)
                    # Normalize booleans consistently for diff (especially 'enable')
                    db_obj_data = {}
                    for k in obj_data.keys():
                        v = getattr(existing_item, k, None)
                        db_obj_data[k] = _normalize_bool(v) if k == 'enable' else _normalize_value(v)
                    cmp_left = {k: (_normalize_bool(v) if k == 'enable' else _normalize_value(v)) for k, v in obj_data.items()}
                    if any(cmp_left.get(k) != db_obj_data.get(k) for k in obj_data):
                        logging.info(f"Updating {data_type}: {item_name}")
                        await update_func(db=db, db_obj=existing_item, obj_in=item_in)
                        await crud.change_log.create_change_log(
                            db=db,
                            change_log=schemas.ChangeLogCreate(
                                device_id=device_id,
                                data_type=data_type,
                                object_name=item_name,
                                action="updated",
                                details=json.dumps({"before": db_obj_data, "after": cmp_left}, default=str),
                            ),
                        )
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
                    # 인덱스 테이블에서 관련 항목 먼저 삭제 (정책만 해당)
                    if data_type == "policies":
                        await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id == item.id))
                        await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id == item.id))
                    await delete_func(db=db, **{f"{get_singular_name(data_type)}": item})
                    await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=item_name, action="deleted"))

            if items_to_delete_count > 0:
                logging.info(f"Deleted {items_to_delete_count} {data_type}.")

            # commit all CRUD changes for this data type
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
                # update success only when explicitly requested (single-type sync)
                await crud.device.update_sync_status(db=db, device=device, status="success")
                await db.commit()
                logging.info(f"Device status updated to success for device_id: {device_id}")

def _normalize_value(value: Any) -> Any:
    try:
        if value is None:
            return None
        # Trim strings and normalize empty-like
        if isinstance(value, str):
            s = value.strip()
            return None if s == "" else s
        # Normalize pandas NaN-like
        if isinstance(value, float) and (value != value):
            return None
        return value
    except Exception:
        return value

def _normalize_bool(value: Any) -> Any:
    """Normalize diverse boolean-ish values to True/False/None for diff compare."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int,)):
        if value == 0:
            return False
        if value == 1:
            return True
    if isinstance(value, float):
        if value == 0.0:
            return False
        if value == 1.0:
            return True
    try:
        s = str(value).strip().lower()
    except Exception:
        return None
    if s in {"y", "yes", "true", "1", "on", "enabled"}:
        return True
    if s in {"n", "no", "false", "0", "off", "disabled"}:
        return False
    return None

@router.post("/sync/{device_id}/{data_type}", include_in_schema=False, response_model=schemas.Msg)
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
        # 단일 타입 동기화는 상태 업데이트를 포함하도록 플래그 설정
        background_tasks.add_task(_sync_data_task, device_id, data_type, items_to_sync, True)
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

    # 상태 in_progress로 설정
    await crud.device.update_sync_status(db=db, device=device, status="in_progress")
    await db.commit()

    # 순서: network_objects -> network_groups -> services -> service_groups -> policies
    sequence = [
        ("network_objects", schemas.NetworkObjectCreate),
        ("network_groups", schemas.NetworkGroupCreate),
        ("services", schemas.ServiceCreate),
        ("service_groups", schemas.ServiceGroupCreate),
        ("policies", schemas.PolicyCreate),
    ]

    loop = asyncio.get_running_loop()

    try:
        # 안전 복호화
        try:
            decrypted_password = decrypt(device.password)
        except Exception:
            if (device.vendor or "").lower() == "mock":
                decrypted_password = device.password
            else:
                raise

        collector = FirewallCollectorFactory.get_collector(
            source_type=(device.vendor or "").lower(),
            hostname=device.ip_address,
            username=device.username,
            password=decrypted_password,
        )

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

            # 각 타입을 순차 수집 및 백그라운드 태스크로 push
            all_items: dict[str, list[Any]] = {}
            for data_type, schema_create in sequence:
                try:
                    df = await loop.run_in_executor(None, export_map[data_type])
                except NotImplementedError:
                    continue
                if df is None:
                    df = pd.DataFrame()
                df['device_id'] = device_id
                items_to_sync = dataframe_to_pydantic(df, schema_create)
                all_items[data_type] = items_to_sync
                # 개별 태스크 enqueue
                background_tasks.add_task(_sync_data_task, device_id, data_type, items_to_sync, False)

            # 모든 동기화 완료 이벤트 이후 정책 인덱싱을 수행하기 위한 별도 태스크 추가
            # BackgroundTasks는 순차 보장 없으므로, parse-index는 별도 엔드포인트/트리거를 권장
            # 여기서는 성공/실패와 무관하게 parse-index를 후속 태스크로 추가
            background_tasks.add_task(_parse_index_after_sync_all, device_id)

            return {"msg": "Full synchronization started in the background. Indices will be rebuilt afterwards."}
        finally:
            if connected:
                try:
                    await loop.run_in_executor(None, collector.disconnect)
                except Exception:
                    pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"sync-all failed: {e}")


@router.post("/parse-index/{device_id}", response_model=schemas.Msg)
async def parse_index(device_id: int, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    try:
        result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id))
        policies = result.scalars().all()
        await rebuild_policy_indices(db=db, device_id=device_id, policies=policies)
        await db.commit()
        return {"msg": "Policy indices rebuilt."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"parse-index failed: {e}")


async def _parse_index_after_sync_all(device_id: int) -> None:
    """Rebuild policy indices after sync-all. Best-effort; errors are logged only."""
    logging.info(f"Rebuilding policy indices after sync-all for device_id={device_id}")
    async with SessionLocal() as db:
        try:
            result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id))
            policies = result.scalars().all()
            await rebuild_policy_indices(db=db, device_id=device_id, policies=policies)
            # 성공 시 장비 상태 success로 업데이트
            device = await crud.device.get_device(db=db, device_id=device_id)
            if device:
                await crud.device.update_sync_status(db=db, device=device, status="success")
            await db.commit()
            logging.info("Policy indices rebuilt successfully after sync-all")
        except Exception:
            await db.rollback()
            # 실패 시 failure로 업데이트
            async with SessionLocal() as new_db:
                try:
                    device = await crud.device.get_device(db=new_db, device_id=device_id)
                    if device:
                        await crud.device.update_sync_status(db=new_db, device=device, status="failure")
                        await new_db.commit()
                except Exception:
                    pass
            logging.warning("Failed to rebuild indices after sync-all", exc_info=True)

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
