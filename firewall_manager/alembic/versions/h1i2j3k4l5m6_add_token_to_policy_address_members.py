"""Add token to policy_address_members

Revision ID: h1i2j3k4l5m6
Revises: g2d3e4f5a6b7
Create Date: 2025-11-10 16:43:32.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h1i2j3k4l5m6'
down_revision: Union[str, Sequence[str], None] = 'g2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add token column to policy_address_members for empty group support."""
    with op.batch_alter_table('policy_address_members', schema=None) as batch_op:
        batch_op.add_column(sa.Column('token', sa.String(), nullable=True))


def downgrade() -> None:
    """Remove token column from policy_address_members."""
    with op.batch_alter_table('policy_address_members', schema=None) as batch_op:
        batch_op.drop_column('token')

