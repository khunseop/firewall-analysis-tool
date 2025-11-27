from typing import List, Any, Dict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app import crud, schemas
from app.db.session import get_db
from app.services.deletion_workflow.config_manager import ConfigManager, CONFIG_KEY

router = APIRouter()


@router.get("/", response_model=List[schemas.Settings])
async def read_settings(
    db: AsyncSession = Depends(get_db)
):
    """모든 설정 조회"""
    return await crud.settings.get_all_settings(db)


@router.get("/{key}", response_model=schemas.Settings)
async def read_setting(
    key: str,
    db: AsyncSession = Depends(get_db)
):
    """특정 설정 조회"""
    setting = await crud.settings.get_setting(db, key=key)
    if setting is None:
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting


@router.put("/{key}", response_model=schemas.Settings)
async def update_setting(
    key: str,
    setting_in: schemas.SettingsUpdate,
    db: AsyncSession = Depends(get_db)
):
    """설정 업데이트 (없으면 생성)"""
    setting = await crud.settings.get_setting(db, key=key)
    if setting is None:
        # 설정이 없으면 생성
        setting_create = schemas.SettingsCreate(
            key=key,
            value=setting_in.value,
            description=setting_in.description
        )
        created_setting = await crud.settings.create_setting(db, setting_create)
        
        # sync_parallel_limit이 변경되면 세마포어 리셋
        if key == "sync_parallel_limit":
            from app.services.sync.tasks import reset_sync_semaphore
            await reset_sync_semaphore()
        
        return created_setting
    
    updated_setting = await crud.settings.update_setting(db=db, db_obj=setting, obj_in=setting_in)
    
    # sync_parallel_limit이 변경되면 세마포어 리셋
    if key == "sync_parallel_limit":
        from app.services.sync.tasks import reset_sync_semaphore
        await reset_sync_semaphore()
    
    return updated_setting


class DeletionWorkflowConfigUpdate(BaseModel):
    """정책 삭제 워크플로우 설정 업데이트 모델"""
    config: Dict[str, Any]


@router.get("/deletion-workflow/config", response_model=Dict[str, Any])
async def get_deletion_workflow_config(
    db: AsyncSession = Depends(get_db)
):
    """정책 삭제 워크플로우 설정 조회"""
    config_manager = ConfigManager(db=db)
    await config_manager.ensure_loaded(db)
    return config_manager.all_sync()


@router.put("/deletion-workflow/config", response_model=Dict[str, Any])
async def update_deletion_workflow_config(
    config_update: DeletionWorkflowConfigUpdate,
    db: AsyncSession = Depends(get_db)
):
    """정책 삭제 워크플로우 설정 업데이트"""
    config_manager = ConfigManager(db=db)
    await config_manager.ensure_loaded(db)
    
    # 설정 업데이트
    config_manager.config_data = config_update.config
    await config_manager._save_config(db, config_update.config)
    
    return config_manager.all_sync()

