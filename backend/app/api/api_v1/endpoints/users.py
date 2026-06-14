from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserOut, UserCreate
from app.core.auth import get_current_user, hash_password
from app import crud
from app.services.audit_log import log_activity

router = APIRouter()


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다")
    return current_user


@router.get("/", response_model=List[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    """사용자 목록 조회"""
    return await crud.user.get_all_users(db)


@router.post("/", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """사용자 생성"""
    existing = await crud.user.get_user_by_username(db, body.username)
    if existing:
        raise HTTPException(status_code=409, detail="이미 존재하는 사용자명입니다")
    new_user = await crud.user.create_user(db, body.username, body.password, body.is_admin)
    role = "관리자" if body.is_admin else "일반 사용자"
    await log_activity(
        db,
        title="사용자 생성",
        message=f"'{body.username}' 계정 생성 ({role}) — 수행자: {current_user.username}",
        type="success",
        category="user",
        user_id=current_user.id,
        username=current_user.username,
    )
    return new_user


@router.patch("/{user_id}/password", status_code=204)
async def change_password(
    user_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """비밀번호 변경"""
    new_password = body.get("password", "").strip()
    if not new_password:
        raise HTTPException(status_code=422, detail="비밀번호를 입력하세요")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    user.hashed_password = hash_password(new_password)
    await db.commit()
    await log_activity(
        db,
        title="비밀번호 변경",
        message=f"'{user.username}' 계정 비밀번호 변경 — 수행자: {current_user.username}",
        type="info",
        category="user",
        user_id=current_user.id,
        username=current_user.username,
    )


@router.patch("/{user_id}/active", response_model=UserOut)
async def toggle_active(
    user_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """활성/비활성 토글"""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="자기 자신의 상태를 변경할 수 없습니다")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    is_active = body.get("is_active")
    if is_active is None:
        raise HTTPException(status_code=422, detail="is_active 값이 필요합니다")

    user.is_active = bool(is_active)
    await db.commit()
    await db.refresh(user)
    action = "활성화" if is_active else "비활성화"
    await log_activity(
        db,
        title=f"계정 {action}",
        message=f"'{user.username}' 계정 {action} — 수행자: {current_user.username}",
        type="info",
        category="user",
        user_id=current_user.id,
        username=current_user.username,
    )
    return user


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """사용자 삭제"""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="자기 자신을 삭제할 수 없습니다")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    deleted_username = user.username
    await db.delete(user)
    await db.commit()
    await log_activity(
        db,
        title="사용자 삭제",
        message=f"'{deleted_username}' 계정 삭제 — 수행자: {current_user.username}",
        type="warning",
        category="user",
        user_id=current_user.id,
        username=current_user.username,
    )
