from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, delete
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
from app.models.policy_members import PolicyAddressMember, PolicyServiceMember
from app.models.analysis import AnalysisTask, AnalysisResult
from app.models.change_log import ChangeLog
from app.models.notification_log import NotificationLog
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceStats, DashboardStatsResponse

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
    """장비 삭제 - 외래키 제약조건을 피하기 위해 관련 데이터를 먼저 삭제"""
    result = await db.execute(select(Device).filter(Device.id == id))
    db_device = result.scalars().first()
    if not db_device:
        return None
    
    try:
        # 외래키 제약조건 때문에 관련 데이터를 먼저 삭제
        await db.execute(delete(PolicyAddressMember).where(PolicyAddressMember.device_id == id))
        await db.execute(delete(PolicyServiceMember).where(PolicyServiceMember.device_id == id))
        await db.execute(delete(Policy).where(Policy.device_id == id))
        await db.execute(delete(AnalysisTask).where(AnalysisTask.device_id == id))
        await db.execute(delete(AnalysisResult).where(AnalysisResult.device_id == id))
        await db.execute(delete(ChangeLog).where(ChangeLog.device_id == id))
        await db.execute(delete(NetworkObject).where(NetworkObject.device_id == id))
        await db.execute(delete(NetworkGroup).where(NetworkGroup.device_id == id))
        await db.execute(delete(Service).where(Service.device_id == id))
        await db.execute(delete(ServiceGroup).where(ServiceGroup.device_id == id))
        await db.execute(delete(NotificationLog).where(NotificationLog.device_id == id))
        
        # 마지막으로 장비 삭제
        await db.execute(delete(Device).where(Device.id == id))
        await db.commit()
        return db_device
    except Exception as e:
        await db.rollback()
        raise e


async def update_sync_status(
    db: AsyncSession, device: Device, status: str, step: str | None = None
) -> Device:
    """
    장비의 동기화 상태(status)와 현재 진행 단계(step)를 업데이트합니다.
    실시간 상태 변경은 WebSocket을 통해 프론트엔드로 브로드캐스트됩니다.
    
    :param status: 동기화 상태 ('running', 'success', 'failure')
    :param step: 세부 진행 단계 (예: 'Collecting Policies', 'Indexing', 'Completed')
    """
    import logging
    logger = logging.getLogger(__name__)
    
    device.last_sync_status = status
    device.last_sync_step = step

    # 동기화가 종료(성공 또는 실패)된 경우에만 마지막 동기화 시간(last_sync_at)을 기록
    if status in {"success", "failure"}:
        device.last_sync_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)

    # 성공 시 세부 단계를 'Completed'로 강제 설정하여 명확성 확보
    if status == "success":
        device.last_sync_step = "Completed"

    db.add(device)
    
    # WebSocket을 통한 상태 변경 알림 전송 (프론트엔드 실시간 UI 반영용)
    try:
        from app.services.websocket_manager import websocket_manager
        await websocket_manager.broadcast_device_status(device.id, status, step)
    except Exception as e:
        # WebSocket 오류가 DB 트랜잭션에 영향을 주지 않도록 예외 처리
        logger.warning(f"WebSocket 브로드캐스트 실패: {e}")
    
    return device


_THRESHOLD_MANUAL_MAP = {
    "policy_threshold": "policy_threshold_manual",
    "network_object_threshold": "network_object_threshold_manual",
    "network_group_threshold": "network_group_threshold_manual",
    "service_threshold": "service_threshold_manual",
    "service_group_threshold": "service_group_threshold_manual",
}


async def update_collected_thresholds(db: AsyncSession, device: Device, limits: dict) -> None:
    """SSH 등으로 자동 수집한 리소스 한도 값을 device에 반영합니다.
    manual 플래그가 True인 항목은 관리자가 수기 입력한 값을 유지하기 위해 건드리지 않습니다.
    """
    for field, manual_flag in _THRESHOLD_MANUAL_MAP.items():
        if field in limits and not getattr(device, manual_flag, False):
            setattr(device, field, limits[field])
    db.add(device)


async def get_dashboard_stats(db: AsyncSession) -> DashboardStatsResponse:
    """캐시 컬럼에서 읽어 대시보드 통계를 즉시 반환합니다."""
    devices_result = await db.execute(select(Device))
    devices = devices_result.scalars().all()

    if not devices:
        return DashboardStatsResponse(
            total_devices=0, active_devices=0,
            total_policies=0, total_active_policies=0, total_disabled_policies=0,
            total_network_objects=0, total_network_groups=0,
            total_services=0, total_service_groups=0,
            device_stats=[]
        )

    device_stats_list: List[DeviceStats] = []
    total_policies = total_active_policies = total_disabled_policies = 0
    total_network_objects = total_network_groups = 0
    total_services = total_service_groups = active_devices = 0

    for d in devices:
        p  = d.cached_policies or 0
        pa = d.cached_active_policies or 0
        pd = d.cached_disabled_policies or 0
        no = d.cached_network_objects or 0
        ng = d.cached_network_groups or 0
        sv = d.cached_services or 0
        sg = d.cached_service_groups or 0

        total_policies          += p
        total_active_policies   += pa
        total_disabled_policies += pd
        total_network_objects   += no
        total_network_groups    += ng
        total_services          += sv
        total_service_groups    += sg
        if d.last_sync_status == 'success':
            active_devices += 1

        device_stats_list.append(DeviceStats(
            id=d.id, name=d.name, vendor=d.vendor, ip_address=d.ip_address,
            policies=p, active_policies=pa, disabled_policies=pd,
            network_objects=no, network_groups=ng,
            services=sv, service_groups=sg,
            sync_status=d.last_sync_status,
            sync_step=d.last_sync_step,
            sync_time=d.last_sync_at,
            policy_threshold=d.policy_threshold,
            network_object_threshold=d.network_object_threshold,
            network_group_threshold=d.network_group_threshold,
            service_threshold=d.service_threshold,
            service_group_threshold=d.service_group_threshold,
        ))

    return DashboardStatsResponse(
        total_devices=len(devices),
        active_devices=active_devices,
        total_policies=total_policies,
        total_active_policies=total_active_policies,
        total_disabled_policies=total_disabled_policies,
        total_network_objects=total_network_objects,
        total_network_groups=total_network_groups,
        total_services=total_services,
        total_service_groups=total_service_groups,
        device_stats=device_stats_list,
    )


async def update_device_stats_cache(db: AsyncSession, device_id: int) -> None:
    """동기화 완료 후 단일 장비의 통계를 GROUP BY 쿼리로 계산해 캐시 컬럼에 저장합니다."""
    # 정책 통계 — 3개 값을 단일 쿼리로
    from sqlalchemy import case
    policy_row = (await db.execute(
        select(
            func.count(Policy.id).label("total"),
            func.sum(case((Policy.enable == True,  1), else_=0)).label("active"),
            func.sum(case((Policy.enable == False, 1), else_=0)).label("disabled"),
        ).where(Policy.device_id == device_id, Policy.is_active == True)
    )).one()

    net_obj_count  = (await db.execute(
        select(func.count(NetworkObject.id))
        .where(NetworkObject.device_id == device_id, NetworkObject.is_active == True)
    )).scalar() or 0

    net_grp_count  = (await db.execute(
        select(func.count(NetworkGroup.id))
        .where(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True)
    )).scalar() or 0

    svc_count = (await db.execute(
        select(func.count(Service.id))
        .where(Service.device_id == device_id, Service.is_active == True)
    )).scalar() or 0

    svc_grp_count  = (await db.execute(
        select(func.count(ServiceGroup.id))
        .where(ServiceGroup.device_id == device_id, ServiceGroup.is_active == True)
    )).scalar() or 0

    device = await get_device(db, device_id)
    if device:
        device.cached_policies          = policy_row.total    or 0
        device.cached_active_policies   = policy_row.active   or 0
        device.cached_disabled_policies = policy_row.disabled or 0
        device.cached_network_objects   = net_obj_count
        device.cached_network_groups    = net_grp_count
        device.cached_services          = svc_count
        device.cached_service_groups    = svc_grp_count
        db.add(device)
