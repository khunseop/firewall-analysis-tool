"""Add full-text search index to policies

Revision ID: 03b8541df858
Revises: d4e5f6a7b8c9
Create Date: 2025-10-29 07:10:15.601266

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '03b8541df858'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('policies', schema=None) as batch_op:
        batch_op.create_index('ix_policies_search', ['source', 'destination', 'service'], unique=False, postgresql_using='gin', postgresql_ops={'source': 'gin_trgm_ops', 'destination': 'gin_trgm_ops', 'service': 'gin_trgm_ops'})


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('policies', schema=None) as batch_op:
        batch_op.drop_index('ix_policies_search', postgresql_using='gin')
