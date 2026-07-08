"""add policy device_id/is_active composite index

Revision ID: 4018cfde1957
Revises: 6ff06bc5a575
Create Date: 2026-07-08 10:38:38.555503

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4018cfde1957'
down_revision: Union[str, Sequence[str], None] = '6ff06bc5a575'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 자동 생성 결과에 포함된 기존 스키마 드리프트(타입/NOT NULL/notifications 테이블 등)는
    # 이 마이그레이션의 목적이 아니므로 제외하고, 복합 인덱스 추가만 수행한다.
    op.create_index('ix_policies_device_active', 'policies', ['device_id', 'is_active'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_policies_device_active', table_name='policies')
