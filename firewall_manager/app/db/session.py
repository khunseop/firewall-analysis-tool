from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool

from app.core.config import settings

# SQLite 동시 접근을 안정화하기 위해 다음을 적용합니다:
# - check_same_thread=False: aiosqlite에서 필수
# - poolclass=NullPool: 커넥션 풀 제거로 파일 락 경쟁 완화
# - pool_pre_ping=True: 끊어진 커넥션 자동 감지
# - connect_args에 timeout 연장: DB 락 대기 시간 증가
engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={
        "check_same_thread": False,
        "timeout": 30,  # seconds
    },
    poolclass=NullPool,
    pool_pre_ping=True,
)

# Avoid attribute expiration after commit to prevent MissingGreenlet issues
SessionLocal = async_sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,
)
Base = declarative_base()

async def get_db():
    async with SessionLocal() as session:
        # SQLite 권장: WAL 모드 및 busy_timeout 설정
        try:
            await session.execute("PRAGMA journal_mode=WAL;")
            await session.execute("PRAGMA busy_timeout=30000;")  # 30s
            await session.execute("PRAGMA synchronous=NORMAL;")
        except Exception:
            pass
        yield session
