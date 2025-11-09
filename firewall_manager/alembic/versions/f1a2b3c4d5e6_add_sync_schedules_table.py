"""Add sync_schedules table

Revision ID: f1a2b3c4d5e6
Revises: cea930c349cb
Create Date: 2025-01-27 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'cea930c349cb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite를 사용하므로 batch_alter_table 사용
    op.create_table('sync_schedules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('days_of_week', sa.JSON(), nullable=False),
        sa.Column('time', sa.String(), nullable=False),
        sa.Column('device_ids', sa.JSON(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('last_run_at', sa.DateTime(), nullable=True),
        sa.Column('last_run_status', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.create_index(op.f('ix_sync_schedules_id'), 'sync_schedules', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_sync_schedules_id'), table_name='sync_schedules')
    op.drop_table('sync_schedules')

