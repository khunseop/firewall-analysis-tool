from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List

from app import crud
from app import schemas
from app.database import get_db

router = APIRouter()

@router.post("/", response_model=schemas.FirewallDevice)
def create_firewall_device(
    device: schemas.FirewallDeviceCreate, db: Session = Depends(get_db)
):
    # 여기서는 간단히 생성하지만, 실제로는 hostname 중복 체크 등이 필요
    return crud.firewall_device.create_firewall_device(db=db, device=device)


@router.get("/", response_model=List[schemas.FirewallDevice])
def read_firewall_devices(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
):
    devices = crud.firewall_device.get_firewall_devices(db, skip=skip, limit=limit)
    return devices


@router.get("/{device_id}", response_model=schemas.FirewallDevice)
def read_firewall_device(device_id: int, db: Session = Depends(get_db)):
    db_device = crud.firewall_device.get_firewall_device(db, device_id=device_id)
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return db_device

def collect_data_background(device_id: int, db: Session):
    """
    실제 데이터 수집 로직이 들어갈 자리.
    지금은 단순히 로그만 남깁니다.
    """
    print(f"Starting data collection for device {device_id} in the background...")
    # 1. DB에서 장비 정보 조회
    # 2. firewall_module(가칭)을 사용하여 장비에 연결
    # 3. 정책, 객체 등 데이터 수집
    # 4. 수집된 데이터를 DB에 저장
    print(f"Data collection for device {device_id} finished.")


@router.post("/{device_id}/collect", status_code=202)
def collect_data(device_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_device = crud.firewall_device.get_firewall_device(db, device_id=device_id)
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    background_tasks.add_task(collect_data_background, device_id, db)

    return {"message": "Data collection started in the background."}


@router.put("/{device_id}", response_model=schemas.FirewallDevice)
def update_firewall_device(
    device_id: int, device_update: schemas.FirewallDeviceUpdate, db: Session = Depends(get_db)
):
    db_device = crud.firewall_device.update_firewall_device(
        db, device_id=device_id, device_update=device_update
    )
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return db_device


@router.delete("/{device_id}", response_model=schemas.FirewallDevice)
def delete_firewall_device(device_id: int, db: Session = Depends(get_db)):
    db_device = crud.firewall_device.delete_firewall_device(db, device_id=device_id)
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return db_device