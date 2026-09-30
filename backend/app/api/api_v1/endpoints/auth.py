from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_password, create_access_token, get_current_user
from app.core.rate_limit import login_rate_limiter
from app.crud.crud_user import get_user_by_username
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import Token, UserOut
from app.services.audit_log import log_activity

router = APIRouter()


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    rate_limit_key = form_data.username.strip().lower()
    if login_rate_limiter.is_locked(rate_limit_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.",
        )

    user = await get_user_by_username(db, form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        login_rate_limiter.record_failure(rate_limit_key)
        await log_activity(
            db,
            title="로그인 실패",
            message=f"사용자 '{form_data.username}' 로그인 실패 (아이디 또는 비밀번호 불일치)",
            type="warning",
            category="auth",
            username=form_data.username,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        await log_activity(
            db,
            title="로그인 거부",
            message=f"비활성화된 계정 '{user.username}' 로그인 시도",
            type="warning",
            category="auth",
            user_id=user.id,
            username=user.username,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 계정입니다")

    login_rate_limiter.record_success(rate_limit_key)
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    await log_activity(
        db,
        title="로그인",
        message=f"사용자 '{user.username}' 로그인",
        type="info",
        category="auth",
        user_id=user.id,
        username=user.username,
    )

    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
