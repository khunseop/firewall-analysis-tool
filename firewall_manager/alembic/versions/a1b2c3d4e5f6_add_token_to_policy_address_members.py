"""Add token to policy_address_members

Revision ID: a1b2c3d4e5f6
Revises: 96102c4e15f4
Create Date: 2025-11-10 16:43:32.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '96102c4e15f4'
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

