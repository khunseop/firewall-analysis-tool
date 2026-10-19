"""Add last_run_detail to sync_schedules

Revision ID: r3s4t5u6v7w8
Revises: q2r3s4t5u6v7
Create Date: 2026-10-19 10:50:00.000000

스케줄 마지막 실행의 장비별 결과(성공/실패, 실패 사유)를 보여주기 위한 컬럼.
- last_run_detail: [{"device_id": 1, "device_name": "FW-01", "status": "success|failure", "error": "..."}] JSON.
  기존 실행분은 장비별 기록이 없으므로 NULL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'r3s4t5u6v7w8'
down_revision: Union[str, Sequence[str], None] = 'q2r3s4t5u6v7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('sync_schedules', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_run_detail', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('sync_schedules', schema=None) as batch_op:
        batch_op.drop_column('last_run_detail')
