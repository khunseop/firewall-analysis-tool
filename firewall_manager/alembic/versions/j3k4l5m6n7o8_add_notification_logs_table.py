"""Add notification_logs table

Revision ID: j3k4l5m6n7o8
Revises: i2j3k4l5m6n7
Create Date: 2025-01-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'j3k4l5m6n7o8'
down_revision: Union[str, Sequence[str], None] = 'i2j3k4l5m6n7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create notification_logs table."""
    op.create_table(
        'notification_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('device_id', sa.Integer(), nullable=True),
        sa.Column('device_name', sa.String(), nullable=True),
        sa.Column('read', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notification_logs_timestamp'), 'notification_logs', ['timestamp'], unique=False)
    op.create_index(op.f('ix_notification_logs_type'), 'notification_logs', ['type'], unique=False)
    op.create_index(op.f('ix_notification_logs_category'), 'notification_logs', ['category'], unique=False)
    op.create_index(op.f('ix_notification_logs_device_id'), 'notification_logs', ['device_id'], unique=False)


def downgrade() -> None:
    """Drop notification_logs table."""
    op.drop_index(op.f('ix_notification_logs_device_id'), table_name='notification_logs')
    op.drop_index(op.f('ix_notification_logs_category'), table_name='notification_logs')
    op.drop_index(op.f('ix_notification_logs_type'), table_name='notification_logs')
    op.drop_index(op.f('ix_notification_logs_timestamp'), table_name='notification_logs')
    op.drop_table('notification_logs')

