from sqlalchemy.orm import Session
from app import models, schemas

def get_firewall_device(db: Session, device_id: int):
    return db.query(models.FirewallDevice).filter(models.FirewallDevice.id == device_id).first()

def get_firewall_devices(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.FirewallDevice).offset(skip).limit(limit).all()

def create_firewall_device(db: Session, device: schemas.FirewallDeviceCreate):
    # 실제 환경에서는 비밀번호 해싱 필요
    db_device = models.FirewallDevice(
        name=device.name,
        hostname=device.hostname,
        vendor=device.vendor,
        username=device.username,
        password=device.password
    )
    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    return db_device

def update_firewall_device(db: Session, device_id: int, device_update: schemas.FirewallDeviceUpdate):
    db_device = get_firewall_device(db, device_id)
    if not db_device:
        return None

    update_data = device_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_device, key, value)

    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    return db_device

def delete_firewall_device(db: Session, device_id: int):
    db_device = get_firewall_device(db, device_id)
    if not db_device:
        return None

    db.delete(db_device)
    db.commit()
    return db_device