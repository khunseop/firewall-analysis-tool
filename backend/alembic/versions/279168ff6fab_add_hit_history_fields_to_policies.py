"""add hit history fields to policies

Revision ID: 279168ff6fab
Revises: 81e64193b9c6
Create Date: 2026-09-22 15:09:58.751290

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '279168ff6fab'
down_revision: Union[str, Sequence[str], None] = '81e64193b9c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('policies', sa.Column('first_hit_date', sa.DateTime(), nullable=True))
    op.add_column('policies', sa.Column('unused_days', sa.Integer(), nullable=True))
    op.add_column('policies', sa.Column('rule_create_date', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('policies', 'rule_create_date')
    op.drop_column('policies', 'unused_days')
    op.drop_column('policies', 'first_hit_date')
