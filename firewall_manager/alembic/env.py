from logging.config import fileConfig
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context
import os
import sys

# 프로젝트 루트를 sys.path에 추가
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from app.core.config import settings
from app.database import Base
from app.models import FirewallDevice, Policy, FirewallObject, HitCount # 모든 모델 임포트

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

def get_url():
    # .env 파일에서 DATABASE_URL을 읽어옵니다.
    # SQLite의 경우, 상대 경로를 절대 경로로 변환합니다.
    db_url = settings.DATABASE_URL
    if db_url.startswith("sqlite:///"):
        project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        db_name = db_url.split("sqlite:///./")[1]
        db_path = os.path.join(project_dir, db_name)
        db_url = f"sqlite:///{db_path}"
    return db_url

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()