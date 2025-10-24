"""Add sync status to devices

Revision ID: 775a087473c7
Revises: 506be5600d50
Create Date: 2025-10-21 03:05:38.890602

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '775a087473c7'
down_revision: Union[str, Sequence[str], None] = '506be5600d50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    This migration originally added last_sync_at/last_sync_status to devices.
    Some environments already include these columns from an earlier revision.
    Guard additions to avoid duplicate-column errors (especially on SQLite).
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col['name'] for col in inspector.get_columns('devices')}

    if 'last_sync_at' not in existing_columns:
        op.add_column('devices', sa.Column('last_sync_at', sa.DateTime(), nullable=True))
    if 'last_sync_status' not in existing_columns:
        op.add_column('devices', sa.Column('last_sync_status', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema.

    Drop columns only if they exist to avoid errors on partially-applied DBs.
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col['name'] for col in inspector.get_columns('devices')}

    if 'last_sync_status' in existing_columns:
        op.drop_column('devices', 'last_sync_status')
    if 'last_sync_at' in existing_columns:
        op.drop_column('devices', 'last_sync_at')
