from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Union

from app import crud, schemas, models
from app.db.session import get_db
from sqlalchemy.future import select
from app.services.policy_indexer import rebuild_policy_indices

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


@router.post("/objects/search", response_model=List[Union[schemas.NetworkObject, schemas.NetworkGroup, schemas.Service, schemas.ServiceGroup]])
async def search_objects(req: schemas.ObjectSearchRequest, db: AsyncSession = Depends(get_db)):
    if not req.device_ids:
        return []

    if req.object_type == 'network_object':
        return await crud.network_object.search_network_objects(db=db, req=req)
    elif req.object_type == 'network_group':
        return await crud.network_group.search_network_groups(db=db, req=req)
    elif req.object_type == 'service':
        return await crud.service.search_services(db=db, req=req)
    elif req.object_type == 'service_group':
        return await crud.service_group.search_service_groups(db=db, req=req)
    else:
        raise HTTPException(status_code=400, detail="Invalid object type specified")


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

@router.get("/object/details", response_model=Union[schemas.NetworkObject, schemas.NetworkGroup, schemas.Service, schemas.ServiceGroup, schemas.Msg])
async def get_object_details(device_id: int, name: str, db: AsyncSession = Depends(get_db)):
    # Try to find the object in the order of likelihood

    # 1. Network Object
    net_obj = await crud.network_object.get_network_object_by_name_and_device(db, device_id=device_id, name=name)
    if net_obj:
        return net_obj

    # 2. Network Group
    net_group = await crud.network_group.get_network_group_by_name_and_device(db, device_id=device_id, name=name)
    if net_group:
        return net_group

    # 3. Service Object
    svc_obj = await crud.service.get_service_by_name_and_device(db, device_id=device_id, name=name)
    if svc_obj:
        return svc_obj

    # 4. Service Group
    svc_group = await crud.service_group.get_service_group_by_name_and_device(db, device_id=device_id, name=name)
    if svc_group:
        return svc_group

    raise HTTPException(status_code=404, detail=f"Object '{name}' not found in device '{device_id}'")


@router.get("/sync/{device_id}/status", response_model=schemas.DeviceSyncStatus)
async def get_device_sync_status(device_id: int, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device
