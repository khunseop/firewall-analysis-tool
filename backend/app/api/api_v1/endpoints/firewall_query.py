from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app import crud, schemas, models
from app.db.session import get_db
from sqlalchemy.future import select
from sqlalchemy import desc
from app.services.policy_indexer import rebuild_policy_indices
from app.models.change_log import ChangeLog
from app.models.sync_history import SyncHistory

router = APIRouter()


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


@router.get("/{device_id}/policies", response_model=List[schemas.Policy])
async def read_db_device_policies(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.policy.get_policies_by_device(db=db, device_id=device_id)


@router.get("/{device_id}/policies/count", response_model=schemas.PolicyCountResponse)
async def count_device_policies(device_id: int, db: AsyncSession = Depends(get_db)):
    """장비별 정책 수량을 카운트합니다. (총 정책 수, 비활성화 정책 수)"""
    counts = await crud.policy.count_policies_by_device(db=db, device_id=device_id)
    return schemas.PolicyCountResponse(**counts)


@router.get("/{device_id}/objects/count", response_model=schemas.ObjectCountResponse)
async def count_device_objects(device_id: int, db: AsyncSession = Depends(get_db)):
    """장비별 객체 수량을 카운트합니다. (네트워크 객체+그룹, 서비스+그룹)"""
    network_objects_count = await crud.network_object.count_network_objects_by_device(db=db, device_id=device_id)
    network_groups_count = await crud.network_group.count_network_groups_by_device(db=db, device_id=device_id)
    
    services_count = await crud.service.count_services_by_device(db=db, device_id=device_id)
    service_groups_count = await crud.service_group.count_service_groups_by_device(db=db, device_id=device_id)
    
    return schemas.ObjectCountResponse(
        network_objects=network_objects_count + network_groups_count,
        services=services_count + service_groups_count
    )


@router.post("/policies/search", response_model=schemas.PolicySearchResponse)
async def search_policies(req: schemas.PolicySearchRequest, db: AsyncSession = Depends(get_db)):
    if not req.device_ids:
        return schemas.PolicySearchResponse(policies=[], valid_object_names=[])

    policies = await crud.policy.search_policies(db=db, req=req)

    # Fetch all valid object names for the given devices
    valid_object_names = set()
    for device_id in req.device_ids:
        net_objs = await crud.network_object.get_network_objects_by_device(db=db, device_id=device_id)
        valid_object_names.update(obj.name for obj in net_objs)

        net_groups = await crud.network_group.get_network_groups_by_device(db=db, device_id=device_id)
        valid_object_names.update(group.name for group in net_groups)

        services = await crud.service.get_services_by_device(db=db, device_id=device_id)
        valid_object_names.update(svc.name for svc in services)

        service_groups = await crud.service_group.get_service_groups_by_device(db=db, device_id=device_id)
        valid_object_names.update(group.name for group in service_groups)

    return schemas.PolicySearchResponse(policies=policies, valid_object_names=list(valid_object_names))


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


from typing import Union
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

@router.get("/object/details", response_model=Union[schemas.NetworkObject, schemas.NetworkGroup, schemas.Service, schemas.ServiceGroup, schemas.Msg])
async def get_object_details(device_id: int, name: str, db: AsyncSession = Depends(get_db)):
    """객체 상세 정보 조회 - 네트워크 객체, 네트워크 그룹, 서비스, 서비스 그룹 순서로 검색"""
    # 입력 검증
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Object name cannot be empty")
    
    name = name.strip()
    
    try:
        # Try to find the object in the order of likelihood

        # 1. Network Object
        try:
            net_obj = await crud.network_object.get_network_object_by_name_and_device(db, device_id=device_id, name=name)
            if net_obj:
                return net_obj
        except Exception as e:
            logger.error(f"Error fetching network object '{name}' from device {device_id}: {e}", exc_info=True)

        # 2. Network Group
        try:
            net_group = await crud.network_group.get_network_group_by_name_and_device(db, device_id=device_id, name=name)
            if net_group:
                return net_group
        except Exception as e:
            logger.error(f"Error fetching network group '{name}' from device {device_id}: {e}", exc_info=True)

        # 3. Service Object
        try:
            svc_obj = await crud.service.get_service_by_name_and_device(db, device_id=device_id, name=name)
            if svc_obj:
                return svc_obj
        except Exception as e:
            logger.error(f"Error fetching service '{name}' from device {device_id}: {e}", exc_info=True)

        # 4. Service Group
        try:
            svc_group = await crud.service_group.get_service_group_by_name_and_device(db, device_id=device_id, name=name)
            if svc_group:
                return svc_group
        except Exception as e:
            logger.error(f"Error fetching service group '{name}' from device {device_id}: {e}", exc_info=True)

        raise HTTPException(status_code=404, detail=f"Object '{name}' not found in device '{device_id}'")
    except HTTPException:
        # HTTPException은 그대로 전파
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_object_details for device {device_id}, name '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve object details: {str(e)}")


@router.get("/sync/{device_id}/status", response_model=schemas.DeviceSyncStatus)
async def get_device_sync_status(device_id: int, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.post("/objects/search", response_model=schemas.ObjectSearchResponse)
async def search_objects(req: schemas.ObjectSearchRequest, db: AsyncSession = Depends(get_db)):
    """객체 검색 API - 여러 장비와 필터 조건으로 객체 검색"""
    try:
        if not req.device_ids:
            return schemas.ObjectSearchResponse()
        
        # 쉼표로 구분된 문자열을 리스트로 변환하는 헬퍼 함수
        def split_csv(val: str | None) -> list[str]:
            if not val:
                return []
            return [s.strip() for s in val.split(',') if s.strip()]
        
        # 이름 필터 처리 (단일 값 또는 리스트)
        names = req.names or split_csv(req.name)
        
        # IP 주소 필터 처리 (네트워크 객체용)
        ip_addresses = req.ip_addresses or split_csv(req.ip_address)
        
        # 프로토콜 필터 처리 (서비스 객체용)
        protocols = req.protocols or split_csv(req.protocol)
        
        # 포트 필터 처리 (서비스 객체용)
        ports = req.ports or split_csv(req.port)
        
        network_objects = []
        network_groups = []
        services = []
        service_groups = []
        
        # 객체 타입별 검색
        try:
            if req.object_type == 'network-objects':
                network_objects = await crud.network_object.search_network_objects(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    ip_addresses=ip_addresses if ip_addresses else None,
                    type=req.type,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
            elif req.object_type == 'network-groups':
                network_groups = await crud.network_group.search_network_groups(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    members=req.members,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
            elif req.object_type == 'services':
                services = await crud.service.search_services(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    protocols=protocols if protocols else None,
                    ports=ports if ports else None,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
            elif req.object_type == 'service-groups':
                service_groups = await crud.service_group.search_service_groups(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    members=req.members,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
            else:
                # 모든 타입 검색 (object_type이 지정되지 않은 경우)
                network_objects = await crud.network_object.search_network_objects(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    ip_addresses=ip_addresses if ip_addresses else None,
                    type=req.type,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
                network_groups = await crud.network_group.search_network_groups(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    members=req.members,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
                services = await crud.service.search_services(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    protocols=protocols if protocols else None,
                    ports=ports if ports else None,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
                service_groups = await crud.service_group.search_service_groups(
                    db=db,
                    device_ids=req.device_ids,
                    names=names if names else None,
                    members=req.members,
                    description=req.description,
                    skip=req.skip or 0,
                    limit=req.limit
                )
        except Exception as e:
            logger.error(f"Error searching objects for device_ids {req.device_ids}, object_type '{req.object_type}': {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to search objects: {str(e)}")
        
        return schemas.ObjectSearchResponse(
            network_objects=network_objects,
            network_groups=network_groups,
            services=services,
            service_groups=service_groups
        )
    except HTTPException:
        # HTTPException은 그대로 전파
        raise
    except Exception as e:
        logger.error(f"Unexpected error in search_objects: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to search objects: {str(e)}")


@router.get("/objects/usage-counts")
async def get_object_usage_counts(
    device_ids: List[int] = Query(..., description="장비 ID 목록"),
    db: AsyncSession = Depends(get_db),
):
    """
    각 오브젝트가 몇 개의 정책에서 직접 참조되는지 반환합니다.
    Policy.source, destination, service 필드의 쉼표 구분 이름을 집계합니다.
    결과: [{"device_id": 1, "name": "obj1", "member_type": "address"|"service", "policy_count": 5}]
    """
    result = await db.execute(
        select(
            models.Policy.device_id,
            models.Policy.source,
            models.Policy.destination,
            models.Policy.service,
        ).where(models.Policy.device_id.in_(device_ids))
    )
    policies = result.all()

    addr_counts: dict[tuple, int] = {}
    svc_counts: dict[tuple, int] = {}

    for row in policies:
        for field in (row.source, row.destination):
            if field:
                for name in (n.strip() for n in field.split(',') if n.strip()):
                    key = (row.device_id, name)
                    addr_counts[key] = addr_counts.get(key, 0) + 1
        if row.service:
            for name in (n.strip() for n in row.service.split(',') if n.strip()):
                key = (row.device_id, name)
                svc_counts[key] = svc_counts.get(key, 0) + 1

    return [
        {"device_id": k[0], "name": k[1], "member_type": "address", "policy_count": v}
        for k, v in addr_counts.items()
    ] + [
        {"device_id": k[0], "name": k[1], "member_type": "service", "policy_count": v}
        for k, v in svc_counts.items()
    ]


@router.get("/policy-history")
async def get_policy_history(
    device_id: int = Query(..., description="장비 ID"),
    rule_name: str = Query(..., description="정책명"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """특정 정책의 변경 이력 조회 (before/after diff 포함)"""
    result = await db.execute(
        select(ChangeLog)
        .where(
            ChangeLog.device_id == device_id,
            ChangeLog.data_type == "policies",
            ChangeLog.object_name == rule_name,
        )
        .order_by(desc(ChangeLog.timestamp))
        .limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id": log.id,
            "device_id": log.device_id,
            "object_name": log.object_name,
            "action": log.action,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "details": log.details,
        }
        for log in logs
    ]


CATEGORY_DATA_TYPES = {
    "policies": ["policies"],
    "network_objects": ["network_objects", "network_groups"],
    "services": ["services", "service_groups"],
}


@router.get("/change-stats")
async def get_change_stats(
    device_ids: List[int] = Query(..., description="장비 ID 목록"),
    weeks: int = Query(12, ge=1, le=52),
    category: str = Query("policies", pattern="^(policies|network_objects|services)$"),
    db: AsyncSession = Depends(get_db),
):
    """주차별 객체 변경 건수 통계 (최근 N주). category로 정책/네트워크객체/서비스객체 구분 조회."""
    from sqlalchemy import func, text

    since = datetime.now() - timedelta(weeks=weeks)
    data_types = CATEGORY_DATA_TYPES[category]
    result = await db.execute(
        select(
            func.strftime('%Y-%W', ChangeLog.timestamp).label('week'),
            ChangeLog.action,
            func.count().label('count'),
        )
        .where(
            ChangeLog.device_id.in_(device_ids),
            ChangeLog.data_type.in_(data_types),
            ChangeLog.timestamp >= since,
        )
        .group_by(
            func.strftime('%Y-%W', ChangeLog.timestamp),
            ChangeLog.action,
        )
        .order_by(func.strftime('%Y-%W', ChangeLog.timestamp))
    )
    rows = result.all()
    return [{"week": r.week, "action": r.action, "count": r.count} for r in rows]


@router.get("/change-logs")
async def get_policy_change_logs(
    device_ids: List[int] = Query(..., description="장비 ID 목록"),
    limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
):
    """
    지정한 장비들의 정책(Policy) 변경 이력을 반환합니다.
    각 항목: device_id, object_name(rule_name), action, timestamp
    """
    result = await db.execute(
        select(ChangeLog)
        .where(
            ChangeLog.device_id.in_(device_ids),
            ChangeLog.data_type == "policies",
        )
        .order_by(desc(ChangeLog.timestamp))
        .limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id": log.id,
            "device_id": log.device_id,
            "object_name": log.object_name,
            "action": log.action,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
        }
        for log in logs
    ]


@router.get("/sync-history")
async def get_sync_history(
    device_id: int = Query(..., description="장비 ID"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """동기화 시점 이력 조회 (정책 diff 비교용 sync point 목록)"""
    result = await db.execute(
        select(SyncHistory)
        .where(SyncHistory.device_id == device_id)
        .order_by(desc(SyncHistory.sync_at))
        .limit(limit)
    )
    records = result.scalars().all()
    return [
        {
            "id": r.id,
            "device_id": r.device_id,
            "sync_at": r.sync_at.isoformat() if r.sync_at else None,
            "total_policies": r.total_policies,
            "created_count": r.created_count,
            "updated_count": r.updated_count,
            "deleted_count": r.deleted_count,
        }
        for r in records
    ]


@router.get("/policy-diff")
async def get_policy_diff(
    device_id: int = Query(..., description="장비 ID"),
    from_sync_id: int = Query(..., description="비교 시작 sync point ID"),
    to_sync_id: int = Query(..., description="비교 종료 sync point ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    두 동기화 시점 사이의 정책 변경 Diff를 반환합니다.
    from_sync_id → to_sync_id 기간 동안 추가/수정/삭제된 정책을 필드 레벨까지 상세히 제공합니다.
    """
    from_result = await db.execute(select(SyncHistory).where(SyncHistory.id == from_sync_id))
    from_sync = from_result.scalar_one_or_none()
    to_result = await db.execute(select(SyncHistory).where(SyncHistory.id == to_sync_id))
    to_sync = to_result.scalar_one_or_none()

    if not from_sync or not to_sync:
        raise HTTPException(status_code=404, detail="Sync history record not found")
    if from_sync.device_id != device_id or to_sync.device_id != device_id:
        raise HTTPException(status_code=400, detail="Sync records do not belong to the specified device")

    # from_sync와 to_sync 중 시간순 정렬
    earlier, later = (from_sync, to_sync) if from_sync.sync_at <= to_sync.sync_at else (to_sync, from_sync)

    # earlier.sync_at 이후 ~ later.sync_at 이하 구간의 정책 변경 로그 조회
    logs_result = await db.execute(
        select(ChangeLog)
        .where(
            ChangeLog.device_id == device_id,
            ChangeLog.data_type == "policies",
            ChangeLog.timestamp > earlier.sync_at,
            ChangeLog.timestamp <= later.sync_at,
            ChangeLog.action.in_(["created", "updated", "deleted"]),
        )
        .order_by(ChangeLog.timestamp)
    )
    logs = logs_result.scalars().all()

    # 정책별 변경 이력 집계 (rule_name → [logs])
    policy_logs: dict[str, list] = {}
    for log in logs:
        key = log.object_name
        if key not in policy_logs:
            policy_logs[key] = []
        policy_logs[key].append(log)

    DIFF_FIELDS = ["enable", "action", "source", "destination", "service", "description", "user", "application", "security_profile", "category"]

    changes = []
    for rule_name, rule_logs in policy_logs.items():
        actions = [l.action for l in rule_logs]
        first_log = rule_logs[0]
        last_log = rule_logs[-1]

        # 순 변경 유형 결정
        if "created" in actions and "deleted" in actions:
            net_action = "deleted"  # 생성 후 삭제 → 사실상 삭제
        elif "created" in actions:
            net_action = "created"
        elif "deleted" in actions:
            net_action = "deleted"
        else:
            net_action = "updated"

        # before/after 데이터 추출
        before_data = None
        after_data = None

        if net_action == "created":
            # 생성된 정책: after 데이터 = 마지막 상태
            details = last_log.details or {}
            if isinstance(details, str):
                import json as _json
                details = _json.loads(details)
            after_data = details.get("after") or details
            field_changes = []

        elif net_action == "deleted":
            # 삭제된 정책: before 데이터 = 삭제 로그의 before
            del_log = next((l for l in reversed(rule_logs) if l.action == "deleted"), last_log)
            details = del_log.details or {}
            if isinstance(details, str):
                import json as _json
                details = _json.loads(details)
            before_data = details.get("before") or details
            field_changes = []

        else:
            # 수정된 정책: 최초 before와 최종 after를 비교
            first_details = first_log.details or {}
            last_details = last_log.details or {}
            if isinstance(first_details, str):
                import json as _json
                first_details = _json.loads(first_details)
            if isinstance(last_details, str):
                import json as _json
                last_details = _json.loads(last_details)

            before_data = first_details.get("before", {}) or {}
            after_data = last_details.get("after", {}) or {}

            field_changes = []
            all_fields = set(list(before_data.keys()) + list(after_data.keys()))
            for field in DIFF_FIELDS:
                if field not in all_fields:
                    continue
                b_val = str(before_data.get(field, "")) if before_data.get(field) is not None else ""
                a_val = str(after_data.get(field, "")) if after_data.get(field) is not None else ""
                if b_val != a_val:
                    field_changes.append({"field": field, "before": b_val, "after": a_val})

        vsys = None
        if before_data and isinstance(before_data, dict):
            vsys = before_data.get("vsys")
        if not vsys and after_data and isinstance(after_data, dict):
            vsys = after_data.get("vsys")

        changes.append({
            "rule_name": rule_name,
            "vsys": vsys,
            "action": net_action,
            "field_changes": field_changes,
            "before": before_data if net_action in ("deleted", "updated") else None,
            "after": after_data if net_action in ("created", "updated") else None,
            "change_count": len(rule_logs),
        })

    # 정렬: 삭제 → 수정 → 추가 순
    order = {"deleted": 0, "updated": 1, "created": 2}
    changes.sort(key=lambda c: (order.get(c["action"], 9), c["rule_name"]))

    summary = {
        "created": sum(1 for c in changes if c["action"] == "created"),
        "updated": sum(1 for c in changes if c["action"] == "updated"),
        "deleted": sum(1 for c in changes if c["action"] == "deleted"),
        "total": len(changes),
    }

    return {
        "from_sync": {
            "id": earlier.id,
            "sync_at": earlier.sync_at.isoformat(),
            "total_policies": earlier.total_policies,
        },
        "to_sync": {
            "id": later.id,
            "sync_at": later.sync_at.isoformat(),
            "total_policies": later.total_policies,
        },
        "summary": summary,
        "changes": changes,
    }

