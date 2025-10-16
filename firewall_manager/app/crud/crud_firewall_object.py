from sqlalchemy.orm import Session
from app import models, schemas

def get_objects_by_device(db: Session, device_id: int, skip: int = 0, limit: int = 100):
    return db.query(models.FirewallObject).filter(models.FirewallObject.device_id == device_id).offset(skip).limit(limit).all()

def create_firewall_object(db: Session, obj: schemas.FirewallObjectCreate, device_id: int):
    db_obj = models.FirewallObject(**obj.dict(), device_id=device_id)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj