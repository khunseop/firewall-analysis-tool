from sqlalchemy.orm import Session
from app import models, schemas

def get_hit_counts_by_device(db: Session, device_id: int, skip: int = 0, limit: int = 100):
    return db.query(models.HitCount).join(models.Policy).filter(models.Policy.device_id == device_id).offset(skip).limit(limit).all()

def create_hit_count(db: Session, hit_count: schemas.HitCountCreate):
    db_hit_count = models.HitCount(**hit_count.model_dump())
    db.add(db_hit_count)
    db.commit()
    db.refresh(db_hit_count)
    return db_hit_count