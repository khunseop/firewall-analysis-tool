"""시스템 현황 대시보드 → FAT 장비 정보 가져오기 API."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.db.session import get_db
from app.core.auth import get_current_user
from app.schemas.system_import import ApplyRequest, ApplyResult, PreviewRequest, SystemImportPreview
from app.services.system_import.client import DashboardFetchError
from app.services.system_import.service import ConfirmationRequired, apply_changes, build_preview

logger = logging.getLogger(__name__)
router = APIRouter()

SETTING_KEY = "system_dashboard_url"


async def resolve_base_url(db: AsyncSession, requested: Optional[str]) -> str:
    """요청에 주소가 있으면 그것을, 없으면 저장된 설정을 쓴다. 둘 다 없으면 400."""
    url = (requested or "").strip()
    if not url:
        setting = await crud.settings.get_setting(db, key=SETTING_KEY)
        url = (setting.value if setting else "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="시스템 현황 대시보드 주소가 설정되지 않았습니다.")
    return url


@router.post("/preview", response_model=SystemImportPreview)
async def preview_system_import(req: PreviewRequest, db: AsyncSession = Depends(get_db)):
    """대시보드를 읽어 변경 내용을 미리 계산한다 (DB는 바뀌지 않음)."""
    base_url = await resolve_base_url(db, req.base_url)
    try:
        return await build_preview(db, base_url)
    except DashboardFetchError as e:
        logger.warning("시스템 현황 대시보드 읽기 실패: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/apply", response_model=ApplyResult)
async def apply_system_import(
    req: ApplyRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """미리보기에서 고른 변경만 적용한다. 응답의 `reverse`를 다시 보내면 되돌려진다."""
    try:
        return await apply_changes(db, req, user_id=current_user.id, username=current_user.username)
    except ConfirmationRequired as e:
        raise HTTPException(status_code=400, detail=str(e))
