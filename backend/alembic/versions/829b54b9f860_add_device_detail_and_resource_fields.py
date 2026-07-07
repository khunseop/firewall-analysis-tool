"""add device detail and resource fields

Revision ID: 829b54b9f860
Revises: b2bcdf268319
Create Date: 2026-07-07 16:39:25.179569

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '829b54b9f860'
down_revision: Union[str, Sequence[str], None] = 'b2bcdf268319'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('serial_number', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('os_name', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('os_version', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('install_date', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('location_region', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('location_building', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('location_floor', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('location_room', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('location_x', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('location_y', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('location_z', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('cpu_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('cpu_usage', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('memory_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('memory_usage', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('session_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('session_usage', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('session_usage')
        batch_op.drop_column('session_threshold')
        batch_op.drop_column('memory_usage')
        batch_op.drop_column('memory_threshold')
        batch_op.drop_column('cpu_usage')
        batch_op.drop_column('cpu_threshold')
        batch_op.drop_column('location_z')
        batch_op.drop_column('location_y')
        batch_op.drop_column('location_x')
        batch_op.drop_column('location_room')
        batch_op.drop_column('location_floor')
        batch_op.drop_column('location_building')
        batch_op.drop_column('location_region')
        batch_op.drop_column('install_date')
        batch_op.drop_column('os_version')
        batch_op.drop_column('os_name')
        batch_op.drop_column('serial_number')
