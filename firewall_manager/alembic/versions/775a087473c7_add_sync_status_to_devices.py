"""Add sync status to devices (guarded if present)

Revision ID: 775a087473c7
Revises: 506be5600d50
Create Date: 2025-10-21 03:05:38.890602

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '775a087473c7'
down_revision: Union[str, Sequence[str], None] = '506be5600d50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema with column existence guard."""
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = {c['name'] for c in inspector.get_columns('devices')}
    with op.batch_alter_table('devices') as batch_op:
        if 'last_sync_at' not in cols:
            batch_op.add_column(sa.Column('last_sync_at', sa.DateTime(), nullable=True))
        if 'last_sync_status' not in cols:
            batch_op.add_column(sa.Column('last_sync_status', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema with guards."""
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = {c['name'] for c in inspector.get_columns('devices')}
    with op.batch_alter_table('devices') as batch_op:
        if 'last_sync_status' in cols:
            batch_op.drop_column('last_sync_status')
        if 'last_sync_at' in cols:
            batch_op.drop_column('last_sync_at')
