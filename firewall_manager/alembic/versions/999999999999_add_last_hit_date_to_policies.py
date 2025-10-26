"""Add last_hit_date to policies

Revision ID: 999999999999
Revises: 775a087473c7
Create Date: 2025-10-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '999999999999'
down_revision: Union[str, Sequence[str], None] = '775a087473c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema by adding last_hit_date column to policies if missing."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {col['name'] for col in inspector.get_columns('policies')}
    if 'last_hit_date' not in existing_cols:
        op.add_column('policies', sa.Column('last_hit_date', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema by dropping last_hit_date column from policies."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {col['name'] for col in inspector.get_columns('policies')}
    if 'last_hit_date' in existing_cols:
        op.drop_column('policies', 'last_hit_date')


