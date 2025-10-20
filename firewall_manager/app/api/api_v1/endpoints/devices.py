from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, models, schemas
from app.db.session import get_db
from app.services import device_service

router = APIRouter()

@router.post("/", response_model=schemas.Device)
async def create_device(
    device_in: schemas.DeviceCreate,
    db: AsyncSession = Depends(get_db)
):
    db_device = await crud.get_device_by_name(db, name=device_in.name)
    if db_device:
        raise HTTPException(status_code=400, detail="Device with this name already registered")
    return await crud.create_device(db=db, device=device_in)

@router.get("/", response_model=List[schemas.Device])
async def read_devices(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    devices = await crud.get_devices(db, skip=skip, limit=limit)
    return devices

@router.get("/{device_id}", response_model=schemas.Device)
async def read_device(
    device_id: int,
    db: AsyncSession = Depends(get_db)
):
    db_device = await crud.get_device(db, device_id=device_id)
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return db_device

@router.put("/{device_id}", response_model=schemas.Device)
async def update_device(
    device_id: int,
    device_in: schemas.DeviceUpdate,
    db: AsyncSession = Depends(get_db)
):
    db_device = await crud.get_device(db, device_id=device_id)
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    updated_device = await crud.update_device(db=db, db_obj=db_device, obj_in=device_in)
    return updated_device

@router.delete("/{device_id}", response_model=schemas.Device)
async def delete_device(
    device_id: int,
    db: AsyncSession = Depends(get_db)
):
    db_device = await crud.remove_device(db, id=device_id)
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return db_device

@router.post("/{device_id}/test-connection", response_model=dict)
async def test_connection(
    device_id: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Test the connection to a device.
    """
    db_device = await crud.get_device(db, device_id=device_id)
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    connection_result = await device_service.test_device_connection(db_device)

    if connection_result["status"] == "failure":
        raise HTTPException(status_code=400, detail=connection_result["message"])

    return connection_result
