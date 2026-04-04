# app/api/api_v1/endpoints/deletion_workflow.py
"""
정책 삭제 워크플로우 API 엔드포인트.

fpat policy_deletion_processor의 14개 태스크를 REST API로 노출합니다.
각 태스크는 Excel/CSV 파일을 업로드 받아 처리 결과를 ZIP으로 반환합니다.
"""

import os
import io
import logging
import zipfile
from typing import List, Tuple

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse

from app.services.deletion_workflow.core.workspace_runner import WorkspaceRunner

logger = logging.getLogger(__name__)
router = APIRouter()

# fpat.yaml 경로 (프로젝트 루트 기준)
_FPAT_YAML = os.path.join(
    os.path.dirname(__file__),          # endpoints/
    '..', '..', '..', '..', '..',       # → firewall_manager root
    'fpat', 'fpat.yaml'
)
_FPAT_YAML = os.path.abspath(_FPAT_YAML)

# 태스크별 메타데이터
TASK_META = {
    1:  {"name": "신청정보파싱",       "input_count": 1, "description": "정책 Excel에서 신청 정보 파싱"},
    2:  {"name": "RequestID추출",      "input_count": 1, "description": "고유 신청 ID 추출"},
    3:  {"name": "MISID업데이트",      "input_count": 2, "description": "정책 Excel + MIS CSV → MIS ID 추가"},
    4:  {"name": "신청정보취합",       "input_count": 1, "description": "외부 시스템 신청 정보 취합"},
    5:  {"name": "신청정보매핑",       "input_count": 2, "description": "정책 Excel + 정보 Excel → 매핑"},
    6:  {"name": "예외처리_PaloAlto",  "input_count": 1, "description": "PaloAlto 정책 예외 분류"},
    7:  {"name": "예외처리_SECUI",     "input_count": 1, "description": "SECUI 정책 예외 분류"},
    8:  {"name": "중복정책분류",       "input_count": 2, "description": "중복정책 Excel + 신청정보 Excel → 분류"},
    9:  {"name": "중복정책상태업데이트","input_count": 2, "description": "정책 Excel + 분류결과 Excel → 중복여부 반영"},
    10: {"name": "히트카운트병합",     "input_count": 2, "description": "HA Primary + Secondary 히트카운트 병합"},
    11: {"name": "미사용여부추가",     "input_count": 2, "description": "정책 Excel + 미사용 Excel → 미사용여부 추가"},
    12: {"name": "미사용예외업데이트", "input_count": 2, "description": "정책 Excel + 중복분류 Excel → 미사용예외 반영"},
    13: {"name": "공지파일분류",       "input_count": 1, "description": "정책 Excel → 유형별 공지파일 생성"},
    14: {"name": "자동연장탐지",       "input_count": 1, "description": "신청정보 Excel → 자동연장 정책 탐지"},
}


def _fpat_yaml_path() -> str:
    """fpat.yaml 경로를 반환합니다. 없으면 빈 문자열 반환."""
    return _FPAT_YAML if os.path.exists(_FPAT_YAML) else ""


def _make_zip_response(output_files: List[Tuple[str, bytes]], zip_name: str) -> StreamingResponse:
    """여러 (filename, bytes) 튜플을 ZIP으로 묶어 StreamingResponse를 반환합니다."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, content in output_files:
            zf.writestr(name, content)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type='application/zip',
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.get("/tasks")
async def list_tasks():
    """사용 가능한 태스크 목록과 각 태스크의 설명을 반환합니다."""
    return {
        "tasks": [
            {"id": tid, **meta}
            for tid, meta in TASK_META.items()
        ],
        "fpat_yaml": _fpat_yaml_path() or "설정 파일 없음 — fpat/fpat.yaml 확인 필요",
    }


@router.post("/tasks/{task_id}/execute")
async def execute_task(
    task_id: int,
    files: List[UploadFile] = File(...),
    vendor: str = Form(default=""),
):
    """
    지정된 태스크를 실행합니다.

    - **task_id**: 1-14 사이의 태스크 번호
    - **files**: 입력 파일 목록 (태스크별 필요 파일 수 확인)
    - **vendor**: Tasks 6/7용 — 'paloalto' 또는 'secui' (기본값: 레지스트리 기본값 사용)

    반환: 단일 파일이면 xlsx 다운로드, 복수 파일이면 ZIP 다운로드
    """
    if task_id not in TASK_META:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 태스크 번호: {task_id} (1-14)")

    meta = TASK_META[task_id]
    required = meta["input_count"]

    if len(files) < required:
        raise HTTPException(
            status_code=400,
            detail=f"Task {task_id}({meta['name']})는 파일 {required}개가 필요합니다. (받은 파일: {len(files)}개)"
        )

    # 파일 내용 읽기
    contents = []
    filenames = []
    for f in files[:required]:
        contents.append(await f.read())
        filenames.append(f.filename)

    # 추가 kwargs 구성
    extra_kwargs = {}
    if vendor:
        extra_kwargs["vendor"] = vendor

    # 동기 프로세서를 스레드에서 실행
    import asyncio
    loop = asyncio.get_event_loop()

    runner = WorkspaceRunner(config_path=_fpat_yaml_path() or None)
    try:
        output_files = await loop.run_in_executor(
            None,
            lambda: runner.run_task(task_id, contents, filenames, **extra_kwargs)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception(f"Task {task_id} 실행 중 예외: {e}")
        raise HTTPException(status_code=500, detail=f"Task {task_id} 실행 실패: {str(e)}")

    if not output_files:
        raise HTTPException(
            status_code=500,
            detail=f"Task {task_id} 실행 완료됐으나 출력 파일이 없습니다."
        )

    task_name = meta["name"]

    if len(output_files) == 1:
        # 단일 파일: xlsx 직접 반환
        name, content = output_files[0]
        ext = os.path.splitext(name)[1]
        media = (
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            if ext == '.xlsx' else 'application/octet-stream'
        )
        return Response(
            content=content,
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    # 복수 파일: ZIP 반환
    return _make_zip_response(output_files, f"task{task_id}_{task_name}.zip")
