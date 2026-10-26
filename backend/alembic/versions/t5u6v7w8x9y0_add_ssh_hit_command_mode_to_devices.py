"""Add ssh_hit_command_mode to devices

Revision ID: t5u6v7w8x9y0
Revises: s4t5u6v7w8x9
Create Date: 2026-10-26 12:00:00.000000

동기화·미사용 NG 분석의 SSH 히트 수집 시 Palo Alto 명령 버전을 장비별로 지정하는 컬럼.
- ssh_hit_command_mode: 'vsys_all' | 'vsys_name'. 기존 장비는 NULL(→ OS 버전 자동 판단, 기존 동작 유지).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 't5u6v7w8x9y0'
down_revision: Union[str, Sequence[str], None] = 's4t5u6v7w8x9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ssh_hit_command_mode', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('ssh_hit_command_mode')
