"""
정책 삭제 워크플로우 API 엔드포인트
"""
import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app import crud
from app.services.deletion_workflow.workflow_manager import WorkflowManager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/{device_id}/status")
async def get_workflow_status(
    device_id: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """워크플로우 상태 조회"""
    workflow = await crud.deletion_workflow.get_workflow_by_device(db, device_id)
    if not workflow:
        return {
            "device_id": device_id,
            "status": "not_started",
            "current_step": 0
        }
    
    return {
        "id": workflow.id,
        "device_id": workflow.device_id,
        "status": workflow.status,
        "current_step": workflow.current_step,
        "master_file_path": workflow.master_file_path,
        "step_files": workflow.step_files,
        "final_files": workflow.final_files,
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at
    }


@router.post("/{device_id}/start")
async def start_workflow(
    device_id: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """워크플로우 시작 (Step 1 실행)"""
    try:
        manager = WorkflowManager(db, device_id)
        result = await manager.execute_step(1)
        return {"msg": "워크플로우가 시작되었습니다.", "step": 1, "result": result}
    except Exception as e:
        logger.error(f"워크플로우 시작 실패: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{device_id}/step/{step_number}/execute")
async def execute_step(
    device_id: int,
    step_number: int,
    csv_file: UploadFile = None,
    excel_file: UploadFile = None,
    redundancy_file: UploadFile = None,
    vendor: str = "paloalto",
    db: AsyncSession = Depends(get_db)
) -> Any:
    """특정 단계 실행"""
    if step_number < 1 or step_number > 7:
        raise HTTPException(status_code=400, detail="단계 번호는 1-7 사이여야 합니다.")
    
    try:
        manager = WorkflowManager(db, device_id)
        
        kwargs = {}
        if step_number == 3 and csv_file:
            # CSV 파일 저장
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(delete=False, suffix='.csv') as tmp_file:
                content = await csv_file.read()
                tmp_file.write(content)
                kwargs['csv_file_path'] = tmp_file.name
        
        if step_number == 4 and excel_file:
            # Excel 파일 저장
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp_file:
                content = await excel_file.read()
                tmp_file.write(content)
                kwargs['input_file_path'] = tmp_file.name
        
        if step_number == 5 and excel_file:
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp_file:
                content = await excel_file.read()
                tmp_file.write(content)
                kwargs['info_file_path'] = tmp_file.name
        
        if step_number == 6:
            kwargs['vendor'] = vendor
        
        if step_number == 7 and redundancy_file:
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp_file:
                content = await redundancy_file.read()
                tmp_file.write(content)
                kwargs['redundancy_result_file_path'] = tmp_file.name
        
        result = await manager.execute_step(step_number, **kwargs)
        return {"msg": f"Step {step_number} 실행 완료", "step": step_number, "result": result}
    except Exception as e:
        logger.error(f"Step {step_number} 실행 실패: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{device_id}/step/{step_number}/download")
async def download_step_result(
    device_id: int,
    step_number: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """단계별 결과 파일 다운로드"""
    workflow = await crud.deletion_workflow.get_workflow_by_device(db, device_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="워크플로우를 찾을 수 없습니다.")
    
    file_path = None
    if step_number == 1:
        file_path = workflow.step_files.get('1') or workflow.master_file_path
    else:
        file_path = workflow.step_files.get(str(step_number))
    
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Step {step_number} 결과 파일을 찾을 수 없습니다.")
    
    from fastapi.responses import FileResponse
    import os
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=os.path.basename(file_path))
    else:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")


@router.get("/{device_id}/master/download")
async def download_master_file(
    device_id: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """마스터 파일 다운로드"""
    workflow = await crud.deletion_workflow.get_workflow_by_device(db, device_id)
    if not workflow or not workflow.master_file_path:
        raise HTTPException(status_code=404, detail="마스터 파일을 찾을 수 없습니다.")
    
    from fastapi.responses import FileResponse
    import os
    if os.path.exists(workflow.master_file_path):
        return FileResponse(workflow.master_file_path, filename=os.path.basename(workflow.master_file_path))
    else:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")


@router.post("/{device_id}/final/export")
async def export_final_results(
    device_id: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """최종 결과 파일들 생성"""
    try:
        manager = WorkflowManager(db, device_id)
        result_files = await manager.export_final_results()
        return {"msg": "최종 결과 파일 생성 완료", "files": result_files}
    except Exception as e:
        logger.error(f"최종 결과 생성 실패: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{device_id}/final/download")
async def download_final_results(
    device_id: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """최종 결과 파일들 다운로드 (ZIP)"""
    workflow = await crud.deletion_workflow.get_workflow_by_device(db, device_id)
    if not workflow or not workflow.final_files:
        raise HTTPException(status_code=404, detail="최종 결과 파일을 찾을 수 없습니다.")
    
    import zipfile
    import tempfile
    import os
    from fastapi.responses import FileResponse
    
    # 임시 ZIP 파일 생성
    with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_zip:
        with zipfile.ZipFile(tmp_zip.name, 'w') as zipf:
            for file_type, file_path in workflow.final_files.items():
                if os.path.exists(file_path):
                    zipf.write(file_path, os.path.basename(file_path))
        
        return FileResponse(
            tmp_zip.name,
            filename=f"deletion_workflow_{device_id}_final_results.zip",
            media_type="application/zip"
        )

