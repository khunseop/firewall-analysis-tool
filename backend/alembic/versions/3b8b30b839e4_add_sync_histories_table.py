"""add_sync_histories_table

Revision ID: 3b8b30b839e4
Revises: 6d1230479e2c
Create Date: 2026-06-08 22:24:15.106805

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3b8b30b839e4'
down_revision: Union[str, Sequence[str], None] = '6d1230479e2c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'sync_histories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.Integer(), nullable=False),
        sa.Column('sync_at', sa.DateTime(), nullable=False),
        sa.Column('total_policies', sa.Integer(), nullable=True),
        sa.Column('created_count', sa.Integer(), nullable=True),
        sa.Column('updated_count', sa.Integer(), nullable=True),
        sa.Column('deleted_count', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_sync_histories_device_id', 'sync_histories', ['device_id'], unique=False)
    op.create_index('ix_sync_histories_id', 'sync_histories', ['id'], unique=False)
    op.create_index('ix_sync_histories_sync_at', 'sync_histories', ['sync_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_sync_histories_sync_at', table_name='sync_histories')
    op.drop_index('ix_sync_histories_id', table_name='sync_histories')
    op.drop_index('ix_sync_histories_device_id', table_name='sync_histories')
    op.drop_table('sync_histories')
