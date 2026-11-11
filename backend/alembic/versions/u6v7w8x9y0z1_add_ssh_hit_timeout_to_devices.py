"""Add ssh_hit_timeout to devices

Revision ID: u6v7w8x9y0z1
Revises: t5u6v7w8x9y0
Create Date: 2026-11-11 12:00:00.000000

동기화의 SSH 히트 수집 시 명령 응답 대기 시간을 장비별로 지정하는 컬럼(초).
- ssh_hit_timeout: 기존 장비는 NULL(→ 기본 3600초, 기존 동작 유지).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'u6v7w8x9y0z1'
down_revision: Union[str, Sequence[str], None] = 't5u6v7w8x9y0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ssh_hit_timeout', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('ssh_hit_timeout')
