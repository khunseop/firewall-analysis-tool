from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app import crud, schemas, models
from app.db.session import get_db
from sqlalchemy.future import select
from sqlalchemy import desc
from app.services.policy_indexer import rebuild_policy_indices
from app.models.change_log import ChangeLog

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


@router.get("/change-stats")
async def get_change_stats(
    device_ids: List[int] = Query(..., description="장비 ID 목록"),
    weeks: int = Query(12, ge=1, le=52),
    db: AsyncSession = Depends(get_db),
):
    """주차별 정책 변경 건수 통계 (최근 N주)"""
    from sqlalchemy import func, text

    since = datetime.now() - timedelta(weeks=weeks)
    result = await db.execute(
        select(
            func.strftime('%Y-%W', ChangeLog.timestamp).label('week'),
            ChangeLog.action,
            func.count().label('count'),
        )
        .where(
            ChangeLog.device_id.in_(device_ids),
            ChangeLog.data_type == "policies",
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

