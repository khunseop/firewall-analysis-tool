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
from pathlib import Path
import importlib.util as _importlib_util
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

    # 4) Numeric normalization for specific models
    def _parse_ip_numeric(row: dict) -> dict:
        value = (row.get('ip_address') or '').strip()
        typ = (row.get('type') or '').strip().lower()
        if value == '' or value.lower() == 'none':
            return row
        # FQDN 처리: 타입 표기가 없더라도 알파 문자가 포함되면 FQDN로 간주
        if typ == 'fqdn' or any(c.isalpha() for c in value):
            row['ip_version'] = None
            row['ip_start'] = None
            row['ip_end'] = None
            return row
        try:
            if '-' in value:  # range: a-b
                start_s, end_s = value.split('-', 1)
                start_ip = ip_address(start_s.strip())
                end_ip = ip_address(end_s.strip())
                if isinstance(start_ip, IPv4Address) and isinstance(end_ip, IPv4Address):
                    row['ip_version'] = 4
                    row['ip_start'] = int(start_ip)
                    row['ip_end'] = int(end_ip)
                else:
                    # SQLite는 64-bit 정수만 지원하므로 IPv6은 숫자화 생략
                    row['ip_version'] = 6
                    row['ip_start'] = None
                    row['ip_end'] = None
                return row
            if '/' in value:  # cidr
                net = ip_network(value, strict=False)
                if isinstance(net.network_address, IPv4Address):
                    row['ip_version'] = 4
                    row['ip_start'] = int(net.network_address)
                    row['ip_end'] = int(net.broadcast_address)
                else:
                    row['ip_version'] = 6
                    row['ip_start'] = None
                    row['ip_end'] = None
                return row
            if value.lower() == 'any':
                # IPv4 any로 취급
                row['ip_version'] = 4
                row['ip_start'] = 0
                row['ip_end'] = (2**32) - 1
                return row
            # single ip
            addr = ip_address(value)
            if isinstance(addr, IPv4Address):
                row['ip_version'] = 4
                row['ip_start'] = int(addr)
                row['ip_end'] = int(addr)
            else:
                row['ip_version'] = 6
                row['ip_start'] = None
                row['ip_end'] = None
        except Exception:
            # 해석 실패 시 숫자 필드 비우기
            row['ip_version'] = None
            row['ip_start'] = None
            row['ip_end'] = None
        return row

    def _parse_port_numeric(row: dict) -> dict:
        port_raw = (row.get('port') or '').strip()
        if port_raw == '' or port_raw.lower() in {'none', 'icmp'}:
            return row
        if port_raw in {'*', 'any', 'ANY'}:
            row['port_start'] = 0
            row['port_end'] = 65535
            return row
        # 콤마 다중 포트는 애매하므로 숫자화 생략
        if ',' in port_raw:
            row['port_start'] = None
            row['port_end'] = None
            return row
        try:
            if '-' in port_raw:
                a, b = port_raw.split('-', 1)
                row['port_start'] = int(a)
                row['port_end'] = int(b)
                return row
            p = int(port_raw)
            row['port_start'] = p
            row['port_end'] = p
        except Exception:
            row['port_start'] = None
            row['port_end'] = None
        return row

    if pydantic_model is schemas.NetworkObjectCreate and not df.empty:
        df = df.apply(lambda s: pd.Series(_parse_ip_numeric(s.to_dict())), axis=1)

    if pydantic_model is schemas.ServiceCreate and not df.empty:
        # protocol normalize to lower for consistency
        if 'protocol' in df.columns:
            df['protocol'] = df['protocol'].apply(lambda x: str(x).lower() if x is not None else x)
        df = df.apply(lambda s: pd.Series(_parse_port_numeric(s.to_dict())), axis=1)

    # 5) Replace NaN with None for Pydantic compatibility
    if not df.empty:
        df = df.where(pd.notna(df), None)
    # 6) Build Pydantic objects
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
                    hit_map = {((str(r.get('vsys')).lower()) if r.get('vsys') else None, str(r.get('rule_name'))): r.get('last_hit_date') for r in hit_df.to_dict(orient='records') if r.get('rule_name')}
                    for name, obj in items_to_sync_map.items():
                        obj_vsys = getattr(obj, 'vsys', None)
                        key = ((str(obj_vsys).lower()) if obj_vsys else None, name)
                        if key in hit_map and hasattr(obj, 'last_hit_date'):
                            setattr(obj, 'last_hit_date', hit_map[key])

            # 정책 인덱스 재생성은 CRUD 반영 후에 수행 (신규 정책 ID 확보)

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
                    # 인덱스 테이블에서 관련 항목 먼저 삭제 (정책만 해당)
                    if data_type == "policies":
                        await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id == item.id))
                        await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id == item.id))
                    await delete_func(db=db, **{f"{get_singular_name(data_type)}": item})
                    await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=item_name, action="deleted"))

            if items_to_delete_count > 0:
                logging.info(f"Deleted {items_to_delete_count} {data_type}.")

            # 정책 인덱스 재생성 (업데이트/생성 반영 후 정책 ID 확보 가능 시점)
            if data_type == "policies":
                try:
                    # 동적 로더로 policy_resolver 모듈 로딩
                    def _load_policy_resolver_class():
                        try:
                            here = Path(__file__).resolve()
                            candidates = [
                                here.parents[5] / 'policy_resolver.py',
                                here.parents[4] / 'policy_resolver.py',
                            ]
                            for resolver_path in candidates:
                                if resolver_path.exists():
                                    spec = _importlib_util.spec_from_file_location('policy_resolver', str(resolver_path))
                                    mod = _importlib_util.module_from_spec(spec)
                                    assert spec and spec.loader
                                    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
                                    return getattr(mod, 'PolicyResolver', None)
                        except Exception:
                            return None
                        return None

                    PolicyResolverCls = _load_policy_resolver_class()
                    if PolicyResolverCls is not None and items_to_sync:
                        # 대상 정책 rule_name 목록
                        affected_rules = list(items_to_sync_map.keys())
                        # 정책 id 매핑
                        result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id, models.Policy.rule_name.in_(affected_rules)))
                        policy_rows = result.scalars().all()
                        rule_to_policy_id = {p.rule_name: p.id for p in policy_rows}

                        # DB에서 최신 객체/그룹 조회
                        network_objs = await crud.network_object.get_all_active_network_objects_by_device(db=db, device_id=device_id)
                        network_grps = await crud.network_group.get_all_active_network_groups_by_device(db=db, device_id=device_id)
                        services = await crud.service.get_all_active_services_by_device(db=db, device_id=device_id)
                        service_grps = await crud.service_group.get_all_active_service_groups_by_device(db=db, device_id=device_id)

                        # DataFrame 구성
                        rules_df = pd.DataFrame([
                            {
                                'Rule Name': rn,
                                'Source': getattr(items_to_sync_map[rn], 'source'),
                                'Destination': getattr(items_to_sync_map[rn], 'destination'),
                                'Service': getattr(items_to_sync_map[rn], 'service'),
                            }
                            for rn in affected_rules if rn in items_to_sync_map
                        ])

                        network_object_df = pd.DataFrame([
                            {'Name': o.name, 'Value': o.ip_address}
                            for o in network_objs
                        ])
                        network_group_object_df = pd.DataFrame([
                            {'Group Name': g.name, 'Entry': g.members or ''}
                            for g in network_grps
                        ])
                        service_object_df = pd.DataFrame([
                            {'Name': s.name, 'Protocol': s.protocol or '', 'Port': s.port or ''}
                            for s in services
                        ])
                        service_group_object_df = pd.DataFrame([
                            {'Group Name': g.name, 'Entry': g.members or ''}
                            for g in service_grps
                        ])

                        resolver = PolicyResolverCls()
                        def _compute_flatten():
                            return resolver.resolve(
                                rules_df, network_object_df, network_group_object_df,
                                service_object_df, service_group_object_df
                            )
                        loop = asyncio.get_running_loop()
                        result_df = await loop.run_in_executor(None, _compute_flatten)
                        if isinstance(result_df, pd.DataFrame) and not result_df.empty:
                            result_df = result_df.rename(columns={
                                'Extracted Source': 'flattened_source',
                                'Extracted Destination': 'flattened_destination',
                                'Extracted Service': 'flattened_service',
                            })
                            flat_map = {row['Rule Name']: row for row in result_df.to_dict(orient='records') if row.get('Rule Name')}

                            # helper: 주소 토큰 파싱 -> 숫자화
                            def _parse_addr_token(token: str) -> tuple[str | None, int | None, int | None, int | None]:
                                t = token.strip()
                                if t == '' or t.lower() == 'none':
                                    return ('unknown', None, None, None)
                                if t.lower() == 'any':
                                    return ('any', 4, 0, (2**32)-1)
                                if any(c.isalpha() for c in t):
                                    return ('fqdn', None, None, None)
                                try:
                                    if '-' in t:
                                        a, b = t.split('-', 1)
                                        ia, ib = ip_address(a.strip()), ip_address(b.strip())
                                        if isinstance(ia, IPv4Address) and isinstance(ib, IPv4Address):
                                            return ('ipv4_range', 4, int(ia), int(ib))
                                        return ('unknown', 6, None, None)
                                    if '/' in t:
                                        net = ip_network(t, strict=False)
                                        if isinstance(net.network_address, IPv4Address):
                                            return ('ipv4_cidr', 4, int(net.network_address), int(net.broadcast_address))
                                        return ('unknown', 6, None, None)
                                    ip = ip_address(t)
                                    if isinstance(ip, IPv4Address):
                                        return ('ipv4_single', 4, int(ip), int(ip))
                                    return ('unknown', 6, None, None)
                                except Exception:
                                    return ('unknown', None, None, None)

                            # helper: 서비스 토큰 파싱 -> 숫자화
                            def _parse_svc_token(token: str) -> tuple[str | None, str | None, int | None, int | None]:
                                t = token.strip()
                                if t == '' or t.lower() == 'none':
                                    return ('unknown', None, None, None)
                                if t in {'*', 'any', 'ANY'}:
                                    return ('proto_port', None, 0, 65535)
                                try:
                                    if '/' in t:
                                        proto, ports = t.split('/', 1)
                                        proto = proto.strip().lower()
                                        if ports == '*' or ports.lower() == 'any':
                                            return ('proto_port', proto, 0, 65535)
                                        if ',' in ports:
                                            return ('unknown', proto, None, None)
                                        if '-' in ports:
                                            a, b = ports.split('-', 1)
                                            return ('proto_port', proto, int(a), int(b))
                                        p = int(ports)
                                        return ('proto_port', proto, p, p)
                                except Exception:
                                    return ('unknown', None, None, None)
                                return ('unknown', None, None, None)

                            # 재작성
                            for rn in affected_rules:
                                pid = rule_to_policy_id.get(rn)
                                row = flat_map.get(rn)
                                if not pid or not row:
                                    continue
                                await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id == pid))
                                await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id == pid))

                                for direction_key, col in (("source", 'flattened_source'), ("destination", 'flattened_destination')):
                                    tokens = [t.strip() for t in str(row.get(col, '')).split(',') if t.strip()]
                                    for token in tokens:
                                        token_type, ver, start, end = _parse_addr_token(token)
                                        db.add(models.PolicyAddressMember(
                                            device_id=device_id,
                                            policy_id=pid,
                                            direction=direction_key,
                                            token=token,
                                            token_type=token_type,
                                            ip_version=ver,
                                            ip_start=start,
                                            ip_end=end,
                                        ))

                                svc_tokens_raw = [t.strip() for t in str(row.get('flattened_service', '')).split(',') if t.strip()]
                                svc_tokens: list[str] = []
                                for tok in svc_tokens_raw:
                                    if '/' in tok and ',' in tok.split('/', 1)[1]:
                                        proto, ports = tok.split('/', 1)
                                        for p in ports.split(','):
                                            svc_tokens.append(f"{proto}/{p.strip()}")
                                    else:
                                        svc_tokens.append(tok)
                                for token in svc_tokens:
                                    token_type, proto, pstart, pend = _parse_svc_token(token)
                                    db.add(models.PolicyServiceMember(
                                        device_id=device_id,
                                        policy_id=pid,
                                        token=token,
                                        token_type=token_type,
                                        protocol=proto,
                                        port_start=pstart,
                                        port_end=pend,
                                    ))
                except Exception:
                    logging.warning("Rebuild policy indices failed", exc_info=True)

            await crud.device.update_sync_status(db=db, device=device, status="success")
            await db.commit()
            logging.info(f"Sync completed successfully for device_id: {device_id}, data_type: {data_type}")

        except Exception as e:
            await db.rollback()
            logging.error(f"Failed to sync {data_type} for device {device.name}: {e}", exc_info=True)
            async with SessionLocal() as new_db:
                device_for_status_update = await crud.device.get_device(db=new_db, device_id=device_id)
                await crud.device.update_sync_status(db=new_db, device=device_for_status_update, status="failure")
                await new_db.commit()

@router.post("/sync/{device_id}/{data_type}", response_model=schemas.Msg)
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
