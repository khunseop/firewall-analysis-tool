from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
from sqlalchemy.engine import Engine

from app.core.config import settings

@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and set a busy timeout for all SQLite connections."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA busy_timeout = 30000;") # 30 seconds
        cursor.execute("PRAGMA synchronous = NORMAL;")
    finally:
        cursor.close()

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)

SessionLocal = async_sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,
)
Base = declarative_base()

async def get_db():
    async with SessionLocal() as session:
        yield session
