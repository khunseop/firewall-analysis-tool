"""
정책 삭제 워크플로우 API 엔드포인트
"""
import logging
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.session import get_db
from app import crud
from app.services.deletion_workflow.workflow_manager import WorkflowManager
from app.services.deletion_workflow.file_manager import FileManager


class ResetRequest(BaseModel):
    """워크플로우 초기화 요청 모델"""
    delete_files: bool = True

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
    csv_file: Optional[UploadFile] = File(None),
    excel_file: Optional[UploadFile] = File(None),
    redundancy_file: Optional[UploadFile] = File(None),
    vendor: str = Form("paloalto"),
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
    """단계별 결과 파일 다운로드 (최신 파일 우선)"""
    workflow = await crud.deletion_workflow.get_workflow_by_device(db, device_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="워크플로우를 찾을 수 없습니다.")
    
    # 장비명 가져오기
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="장비를 찾을 수 없습니다.")
    device_name = device.name.replace(' ', '_').replace('/', '_').replace('\\', '_').replace(':', '_').replace('*', '_').replace('?', '_').replace('"', '_').replace('<', '_').replace('>', '_').replace('|', '_')
    
    file_manager = FileManager()
    import os
    import zipfile
    import tempfile
    from datetime import datetime
    from fastapi.responses import FileResponse
    
    # Step 7은 두 개의 파일(notice, delete)이 있으므로 ZIP으로 묶어서 다운로드
    if step_number == 7:
        notice_path = None
        delete_path = None
        
        # DB에서 경로 확인
        notice_path = workflow.step_files.get('7_notice')
        delete_path = workflow.step_files.get('7_delete')
        
        # 디렉토리에서 최신 파일 찾기
        latest_notice = file_manager.get_latest_file_by_pattern(device_id, 'step_7_notice_')
        latest_delete = file_manager.get_latest_file_by_pattern(device_id, 'step_7_delete_')
        
        # 최신 파일 선택
        if notice_path and os.path.exists(notice_path) and latest_notice and os.path.exists(latest_notice):
            notice_mtime = os.path.getmtime(notice_path)
            latest_notice_mtime = os.path.getmtime(latest_notice)
            notice_path = latest_notice if latest_notice_mtime > notice_mtime else notice_path
        elif latest_notice and os.path.exists(latest_notice):
            notice_path = latest_notice
        
        if delete_path and os.path.exists(delete_path) and latest_delete and os.path.exists(latest_delete):
            delete_mtime = os.path.getmtime(delete_path)
            latest_delete_mtime = os.path.getmtime(latest_delete)
            delete_path = latest_delete if latest_delete_mtime > delete_mtime else delete_path
        elif latest_delete and os.path.exists(latest_delete):
            delete_path = latest_delete
        
        if not notice_path and not delete_path:
            raise HTTPException(status_code=404, detail="Step 7 결과 파일을 찾을 수 없습니다.")
        
        # ZIP 파일 생성
        with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_zip:
            with zipfile.ZipFile(tmp_zip.name, 'w') as zipf:
                if notice_path and os.path.exists(notice_path):
                    zipf.write(notice_path, '중복정책_공지용.xlsx')
                if delete_path and os.path.exists(delete_path):
                    zipf.write(delete_path, '중복정책_삭제용.xlsx')
            
            # 파일명 생성: 날짜_구분_장비명 형식
            date_str = datetime.now().strftime("%Y-%m-%d")
            step_name = "중복정책분류"
            filename = f"{date_str}_{step_name}_{device_name}.zip"
            
            return FileResponse(
                tmp_zip.name,
                filename=filename,
                media_type="application/zip"
            )
    
    # 다른 단계는 단일 파일 다운로드
    # DB에 저장된 경로 확인
    db_file_path = None
    if step_number == 1:
        db_file_path = workflow.step_files.get('1') or workflow.master_file_path
    else:
        db_file_path = workflow.step_files.get(str(step_number))
    
    # 디렉토리에서 최신 파일 찾기
    latest_file_path = None
    if step_number == 1:
        # Step 1은 step_1_ 또는 master_ 패턴
        latest_file_path = file_manager.get_latest_file_by_pattern(device_id, 'step_1_')
        if not latest_file_path:
            latest_file_path = file_manager.get_latest_file_by_pattern(device_id, 'master_')
    else:
        # 다른 단계는 step_{step_number}_ 패턴
        latest_file_path = file_manager.get_latest_file_by_pattern(device_id, f'step_{step_number}_')
    
    # DB 경로와 디렉토리 최신 파일 중 더 최신 파일 선택
    file_path = None
    if db_file_path and os.path.exists(db_file_path) and latest_file_path and os.path.exists(latest_file_path):
        # 둘 다 있으면 수정 시간 비교
        db_mtime = os.path.getmtime(db_file_path)
        latest_mtime = os.path.getmtime(latest_file_path)
        file_path = latest_file_path if latest_mtime > db_mtime else db_file_path
    elif latest_file_path and os.path.exists(latest_file_path):
        # 디렉토리 파일만 있으면 그것 사용
        file_path = latest_file_path
    elif db_file_path and os.path.exists(db_file_path):
        # DB 파일만 있으면 그것 사용
        file_path = db_file_path
    
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Step {step_number} 결과 파일을 찾을 수 없습니다.")
    
    # 파일명 생성: 날짜_구분_장비명 형식
    date_str = datetime.now().strftime("%Y-%m-%d")
    step_name_map = {
        1: '신청정보파싱',
        2: 'RequestID추출',
        3: 'MISID업데이트',
        4: '신청정보가공',
        5: '신청정보매핑',
        6: '예외처리',
        7: '중복정책분류'
    }
    step_name = step_name_map.get(step_number, f'Step{step_number}')
    extension = '.xlsx'
    filename = f"{date_str}_{step_name}_{device_name}{extension}"
    
    return FileResponse(file_path, filename=filename)


@router.get("/{device_id}/master/download")
async def download_master_file(
    device_id: int,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """마스터 파일 다운로드 (최신 파일 우선)"""
    workflow = await crud.deletion_workflow.get_workflow_by_device(db, device_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="워크플로우를 찾을 수 없습니다.")
    
    # 장비명 가져오기
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="장비를 찾을 수 없습니다.")
    device_name = device.name.replace(' ', '_').replace('/', '_').replace('\\', '_').replace(':', '_').replace('*', '_').replace('?', '_').replace('"', '_').replace('<', '_').replace('>', '_').replace('|', '_')
    
    file_manager = FileManager()
    import os
    from datetime import datetime
    
    # DB에 저장된 경로 확인
    db_file_path = workflow.master_file_path
    
    # 디렉토리에서 최신 파일 찾기
    latest_file_path = file_manager.get_latest_file_by_pattern(device_id, 'master_')
    if not latest_file_path:
        # master_가 없으면 step_1_도 확인 (Step 1 결과가 마스터일 수 있음)
        latest_file_path = file_manager.get_latest_file_by_pattern(device_id, 'step_1_')
    
    # DB 경로와 디렉토리 최신 파일 중 더 최신 파일 선택
    file_path = None
    if db_file_path and os.path.exists(db_file_path) and latest_file_path and os.path.exists(latest_file_path):
        # 둘 다 있으면 수정 시간 비교
        db_mtime = os.path.getmtime(db_file_path)
        latest_mtime = os.path.getmtime(latest_file_path)
        file_path = latest_file_path if latest_mtime > db_mtime else db_file_path
    elif latest_file_path and os.path.exists(latest_file_path):
        # 디렉토리 파일만 있으면 그것 사용
        file_path = latest_file_path
    elif db_file_path and os.path.exists(db_file_path):
        # DB 파일만 있으면 그것 사용
        file_path = db_file_path
    
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="마스터 파일을 찾을 수 없습니다.")
    
    # 파일명 생성: 날짜_구분_장비명 형식
    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"{date_str}_마스터파일_{device_name}.xlsx"
    
    from fastapi.responses import FileResponse
    return FileResponse(file_path, filename=filename)


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
    
    # 장비명 가져오기
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="장비를 찾을 수 없습니다.")
    device_name = device.name.replace(' ', '_').replace('/', '_').replace('\\', '_').replace(':', '_').replace('*', '_').replace('?', '_').replace('"', '_').replace('<', '_').replace('>', '_').replace('|', '_')
    
    import zipfile
    import tempfile
    import os
    from datetime import datetime
    from fastapi.responses import FileResponse
    
    # 임시 ZIP 파일 생성
    with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_zip:
        with zipfile.ZipFile(tmp_zip.name, 'w') as zipf:
            for file_type, file_path in workflow.final_files.items():
                if os.path.exists(file_path):
                    zipf.write(file_path, os.path.basename(file_path))
        
        # 파일명 생성: 날짜_구분_장비명 형식
        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = f"{date_str}_최종결과_{device_name}.zip"
        
        return FileResponse(
            tmp_zip.name,
            filename=filename,
            media_type="application/zip"
        )


@router.post("/{device_id}/reset")
async def reset_workflow(
    device_id: int,
    request_body: Optional[ResetRequest] = None,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """워크플로우 초기화"""
    try:
        delete_files = True
        if request_body:
            delete_files = request_body.delete_files
        
        manager = WorkflowManager(db, device_id)
        await manager.reset_workflow(delete_files=delete_files)
        return {
            "msg": "워크플로우가 초기화되었습니다.",
            "delete_files": delete_files
        }
    except Exception as e:
        logger.error(f"워크플로우 초기화 실패: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

