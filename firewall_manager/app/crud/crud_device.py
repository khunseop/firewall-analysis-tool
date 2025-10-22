from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from datetime import datetime

from app.core.security import encrypt
from app.models.device import Device
from app.schemas.device import DeviceCreate, DeviceUpdate

async def get_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(Device).filter(Device.id == device_id))
    return result.scalars().first()

async def get_device_by_name(db: AsyncSession, name: str):
    result = await db.execute(select(Device).filter(Device.name == name))
    return result.scalars().first()

async def get_devices(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(select(Device).offset(skip).limit(limit))
    return result.scalars().all()

async def create_device(db: AsyncSession, device: DeviceCreate):
    create_data = device.model_dump()
    create_data["password"] = encrypt(create_data["password"])
    db_device = Device(**create_data)
    db.add(db_device)
    await db.commit()
    await db.refresh(db_device)
    return db_device

async def update_device(db: AsyncSession, db_obj: Device, obj_in: DeviceUpdate):
    obj_data = obj_in.model_dump(exclude_unset=True)

    if "password" in obj_data and obj_data["password"]:
        obj_data["password"] = encrypt(obj_data["password"])

    for field in obj_data:
        setattr(db_obj, field, obj_data[field])

    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def update_sync_status(db: AsyncSession, device: Device, status: str):
    device.last_sync_at = datetime.utcnow()
    device.last_sync_status = status
    db.add(device)
    return device

async def remove_device(db: AsyncSession, id: int):
    result = await db.execute(select(Device).filter(Device.id == id))
    db_device = result.scalars().first()
    if db_device:
        await db.delete(db_device)
        await db.commit()
    return db_device
