"""align NOT NULL / unique constraints with ORM models

모델은 nullable=False로 선언되어 있으나 초기 DDL로 생성된 DB에는 제약이 빠져 있던
컬럼들을 정렬한다 (적용 전 데이터에 NULL/중복 없음 확인됨).
SQLite는 ALTER COLUMN을 지원하지 않으므로 batch 모드(테이블 재생성)를 사용한다.

Revision ID: 9f3d51c8e2a7
Revises: 7c21e9d0a4b1
Create Date: 2026-07-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f3d51c8e2a7'
down_revision: Union[str, Sequence[str], None] = '7c21e9d0a4b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (테이블, [NOT NULL 정렬 대상 컬럼])
_NOT_NULL_TARGETS = [
    ('change_logs', ['timestamp', 'device_id', 'data_type', 'object_name', 'action']),
    ('devices', ['name', 'ip_address', 'vendor', 'username', 'password']),
    ('network_groups', ['name']),
    ('network_objects', ['name', 'ip_address']),
    ('policies', ['rule_name', 'action', 'source', 'destination', 'service']),
    ('service_groups', ['name']),
    ('services', ['name']),
]


def _set_nullable(nullable: bool) -> None:
    for table, cols in _NOT_NULL_TARGETS:
        with op.batch_alter_table(table) as batch:
            for col in cols:
                batch.alter_column(col, nullable=nullable)


def upgrade() -> None:
    """Upgrade schema."""
    _set_nullable(False)
    with op.batch_alter_table('devices') as batch:
        batch.create_unique_constraint('uq_devices_ip_address', ['ip_address'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('devices') as batch:
        batch.drop_constraint('uq_devices_ip_address', type_='unique')
    _set_nullable(True)
