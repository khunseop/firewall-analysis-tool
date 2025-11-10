"""Add model to devices

Revision ID: i2j3k4l5m6n7
Revises: h1i2j3k4l5m6
Create Date: 2025-01-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'i2j3k4l5m6n7'
down_revision: Union[str, Sequence[str], None] = 'h1i2j3k4l5m6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add model column to devices table."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('model', sa.String(), nullable=True))


def downgrade() -> None:
    """Remove model column from devices table."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('model')

