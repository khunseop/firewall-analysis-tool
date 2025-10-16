from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app import crud, schemas
from app.database import get_db

router = APIRouter()

@router.get("/policies/{device_id}", response_model=List[schemas.Policy])
def read_policies(device_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    policies = crud.policy.get_policies_by_device(db, device_id=device_id, skip=skip, limit=limit)
    return policies

@router.get("/objects/{device_id}", response_model=List[schemas.FirewallObject])
def read_objects(device_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    objects = crud.firewall_object.get_objects_by_device(db, device_id=device_id, skip=skip, limit=limit)
    return objects

@router.get("/hits/{device_id}", response_model=List[schemas.HitCount])
def read_hit_counts(device_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    hit_counts = crud.hit_count.get_hit_counts_by_device(db, device_id=device_id, skip=skip, limit=limit)
    return hit_counts