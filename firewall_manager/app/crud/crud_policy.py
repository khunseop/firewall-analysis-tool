from sqlalchemy.orm import Session
from app import models, schemas

def get_policies_by_device(db: Session, device_id: int, skip: int = 0, limit: int = 100):
    return db.query(models.Policy).filter(models.Policy.device_id == device_id).offset(skip).limit(limit).all()

def create_policy(db: Session, policy: schemas.PolicyCreate, device_id: int):
    db_policy = models.Policy(**policy.dict(), device_id=device_id)
    db.add(db_policy)
    db.commit()
    db.refresh(db_policy)
    return db_policy