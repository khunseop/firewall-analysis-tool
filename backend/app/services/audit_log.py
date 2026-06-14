from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification_log import NotificationLog


async def log_activity(
    db: AsyncSession,
    *,
    title: str,
    message: str,
    type: str = "info",       # info | success | warning | error
    category: str = "system", # auth | user | device | sync | analysis | schedule | system
    device_id: Optional[int] = None,
    device_name: Optional[str] = None,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
) -> None:
    """활동 감사 로그를 notification_logs 테이블에 기록합니다."""
    log = NotificationLog(
        timestamp=datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None),
        title=title,
        message=message,
        type=type,
        category=category,
        device_id=device_id,
        device_name=device_name,
        user_id=user_id,
        username=username,
    )
    db.add(log)
    await db.commit()
