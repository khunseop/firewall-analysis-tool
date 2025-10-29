"""Add is_indexed to policies

Revision ID: 05af03b5b5a7
Revises: d4e5f6a7b8c9
Create Date: 2025-10-29 06:20:41.932183

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '05af03b5b5a7'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('policies', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_indexed', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('policies', schema=None) as batch_op:
        batch_op.drop_column('is_indexed')
