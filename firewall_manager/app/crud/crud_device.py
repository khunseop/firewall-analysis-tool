from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List

from app.core.security import encrypt
from app.models.device import Device
from app.models.policy import Policy
from app.models.network_object import NetworkObject
from app.models.network_group import NetworkGroup
from app.models.service import Service
from app.models.service_group import ServiceGroup
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceStats, DashboardStatsResponse
from datetime import datetime

async def get_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(Device).filter(Device.id == device_id))
    return result.scalars().first()

async def get_device_by_name(db: AsyncSession, name: str):
    result = await db.execute(select(Device).filter(Device.name == name))
    return result.scalars().first()

async def get_devices(db: AsyncSession, skip: int = 0, limit: int | None = None):
    """장비 목록 조회 (limit이 None이면 모든 장비 조회)"""
    stmt = select(Device).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def create_device(db: AsyncSession, device: DeviceCreate):
    create_data = device.model_dump()
    create_data.pop("password_confirm", None)
    create_data["password"] = encrypt(create_data["password"])
    db_device = Device(**create_data)
    db.add(db_device)
    await db.commit()
    await db.refresh(db_device)
    return db_device

async def update_device(db: AsyncSession, db_obj: Device, obj_in: DeviceUpdate):
    obj_data = obj_in.model_dump(exclude_unset=True)
    obj_data.pop("password_confirm", None)
    if "password" in obj_data and obj_data["password"]:
        obj_data["password"] = encrypt(obj_data["password"])
    else:
        obj_data.pop("password", None)

    for field in obj_data:
        setattr(db_obj, field, obj_data[field])

    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def remove_device(db: AsyncSession, id: int):
    result = await db.execute(select(Device).filter(Device.id == id))
    db_device = result.scalars().first()
    if db_device:
        await db.delete(db_device)
        await db.commit()
    return db_device


async def update_sync_status(
    db: AsyncSession, device: Device, status: str, step: str | None = None
) -> Device:
    """Update device sync status, step, and optionally timestamp."""
    import logging
    logger = logging.getLogger(__name__)
    
    device.last_sync_status = status
    device.last_sync_step = step

    if status in {"success", "failure"}:
        # Set timestamp only when the sync finishes to mark the end time.
        device.last_sync_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)

    if status == "success":
        device.last_sync_step = "Completed" # Mark final step on success

    db.add(device)
    
    # WebSocket으로 상태 변경 브로드캐스트
    try:
        from app.services.websocket_manager import websocket_manager
        await websocket_manager.broadcast_device_status(device.id, status, step)
    except Exception as e:
        # WebSocket 브로드캐스트 실패해도 DB 업데이트는 계속 진행
        logger.warning(f"WebSocket 브로드캐스트 실패: {e}")
    
    return device


async def get_dashboard_stats(db: AsyncSession) -> DashboardStatsResponse:
    """대시보드 통계를 한 번에 조회 (모든 장비의 통계 포함)"""
    # 모든 장비 조회
    devices_result = await db.execute(select(Device))
    devices = devices_result.scalars().all()
    
    if not devices:
        return DashboardStatsResponse(
            total_devices=0,
            active_devices=0,
            total_policies=0,
            total_active_policies=0,
            total_disabled_policies=0,
            total_network_objects=0,
            total_services=0,
            device_stats=[]
        )
    
    device_ids = [d.id for d in devices]
    
    # 각 장비별 정책 통계 (집계 쿼리)
    policy_stats = {}
    for device_id in device_ids:
        total_result = await db.execute(
            select(func.count(Policy.id)).where(
                Policy.device_id == device_id,
                Policy.is_active == True
            )
        )
        total = total_result.scalar() or 0
        
        active_result = await db.execute(
            select(func.count(Policy.id)).where(
                Policy.device_id == device_id,
                Policy.is_active == True,
                Policy.enable == True
            )
        )
        active = active_result.scalar() or 0
        
        disabled_result = await db.execute(
            select(func.count(Policy.id)).where(
                Policy.device_id == device_id,
                Policy.is_active == True,
                Policy.enable == False
            )
        )
        disabled = disabled_result.scalar() or 0
        
        policy_stats[device_id] = {
            'total': total,
            'active': active,
            'disabled': disabled
        }
    
    # 각 장비별 네트워크 객체 통계
    network_object_stats = {}
    for device_id in device_ids:
        net_obj_result = await db.execute(
            select(func.count(NetworkObject.id)).where(
                NetworkObject.device_id == device_id,
                NetworkObject.is_active == True
            )
        )
        net_obj_count = net_obj_result.scalar() or 0
        
        net_group_result = await db.execute(
            select(func.count(NetworkGroup.id)).where(
                NetworkGroup.device_id == device_id,
                NetworkGroup.is_active == True
            )
        )
        net_group_count = net_group_result.scalar() or 0
        
        network_object_stats[device_id] = net_obj_count + net_group_count
    
    # 각 장비별 서비스 객체 통계
    service_stats = {}
    for device_id in device_ids:
        svc_result = await db.execute(
            select(func.count(Service.id)).where(
                Service.device_id == device_id,
                Service.is_active == True
            )
        )
        svc_count = svc_result.scalar() or 0
        
        svc_group_result = await db.execute(
            select(func.count(ServiceGroup.id)).where(
                ServiceGroup.device_id == device_id,
                ServiceGroup.is_active == True
            )
        )
        svc_group_count = svc_group_result.scalar() or 0
        
        service_stats[device_id] = svc_count + svc_group_count
    
    # 장비별 통계 데이터 구성
    device_stats_list: List[DeviceStats] = []
    total_policies = 0
    total_active_policies = 0
    total_disabled_policies = 0
    total_network_objects = 0
    total_services = 0
    active_devices = 0
    
    for device in devices:
        policy_data = policy_stats.get(device.id, {'total': 0, 'active': 0, 'disabled': 0})
        network_count = network_object_stats.get(device.id, 0)
        service_count = service_stats.get(device.id, 0)
        
        total_policies += policy_data['total']
        total_active_policies += policy_data['active']
        total_disabled_policies += policy_data['disabled']
        total_network_objects += network_count
        total_services += service_count
        
        if device.last_sync_status == 'success':
            active_devices += 1
        
        device_stats_list.append(DeviceStats(
            id=device.id,
            name=device.name,
            vendor=device.vendor,
            ip_address=device.ip_address,
            policies=policy_data['total'],
            active_policies=policy_data['active'],
            disabled_policies=policy_data['disabled'],
            network_objects=network_count,
            services=service_count,
            sync_status=device.last_sync_status,
            sync_step=device.last_sync_step,
            sync_time=device.last_sync_at
        ))
    
    return DashboardStatsResponse(
        total_devices=len(devices),
        active_devices=active_devices,
        total_policies=total_policies,
        total_active_policies=total_active_policies,
        total_disabled_policies=total_disabled_policies,
        total_network_objects=total_network_objects,
        total_services=total_services,
        device_stats=device_stats_list
    )
