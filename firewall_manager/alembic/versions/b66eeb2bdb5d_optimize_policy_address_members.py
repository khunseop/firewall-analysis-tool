"""Optimize policy address members

Revision ID: b66eeb2bdb5d
Revises: 05af03b5b5a7
Create Date: 2025-10-30 11:13:35.426629

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b66eeb2bdb5d'
down_revision: Union[str, Sequence[str], None] = '05af03b5b5a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema to remove the token column from policy_address_members."""
    # Using batch mode for SQLite compatibility to drop a column.
    with op.batch_alter_table('policy_address_members', schema=None) as batch_op:
        batch_op.drop_column('token')


def downgrade() -> None:
    """Downgrade schema to re-add the token column to policy_address_members."""
    # Using batch mode for SQLite compatibility to add a column.
    with op.batch_alter_table('policy_address_members', schema=None) as batch_op:
        # Add the column back. It's marked as non-nullable, so a server_default is needed
        # for existing rows. SQLite doesn't support arbitrary server defaults, but an empty
        # string is safe for VARCHAR.
        batch_op.add_column(sa.Column('token', sa.VARCHAR(), nullable=False, server_default=''))
