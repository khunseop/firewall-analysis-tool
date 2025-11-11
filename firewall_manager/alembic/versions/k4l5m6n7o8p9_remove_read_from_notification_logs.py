"""Remove read column from notification_logs

Revision ID: k4l5m6n7o8p9
Revises: j3k4l5m6n7o8
Create Date: 2025-01-15 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'k4l5m6n7o8p9'
down_revision: Union[str, Sequence[str], None] = 'j3k4l5m6n7o8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remove read column from notification_logs table."""
    with op.batch_alter_table('notification_logs', schema=None) as batch_op:
        batch_op.drop_column('read')


def downgrade() -> None:
    """Add read column back to notification_logs table."""
    with op.batch_alter_table('notification_logs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('read', sa.Integer(), nullable=False, server_default='0'))

