"""Add ssh_command_mode to export_tasks

Revision ID: s4t5u6v7w8x9
Revises: r3s4t5u6v7w8
Create Date: 2026-10-26 10:00:00.000000

직접 추출(사용이력) SSH 수집 시 Palo Alto 명령 버전을 사용자가 지정하도록 하는 컬럼.
- ssh_command_mode: 'vsys_all' | 'vsys_name'. 기존 행은 NULL(→ OS 버전 자동 판단).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 's4t5u6v7w8x9'
down_revision: Union[str, Sequence[str], None] = 'r3s4t5u6v7w8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('export_tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ssh_command_mode', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('export_tasks', schema=None) as batch_op:
        batch_op.drop_column('ssh_command_mode')
