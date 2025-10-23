"""Add last hit fields to policies and secondary IP to devices

Revision ID: a1e2b3c4d5e6
Revises: 775a087473c7
Create Date: 2025-10-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1e2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = '775a087473c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: add last hit columns and secondary IP."""
    # policies: last_hit_at and last_hit_at_secondary
    with op.batch_alter_table('policies') as batch_op:
        batch_op.add_column(sa.Column('last_hit_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('last_hit_at_secondary', sa.DateTime(), nullable=True))

    # devices: secondary_ip_address
    with op.batch_alter_table('devices') as batch_op:
        batch_op.add_column(sa.Column('secondary_ip_address', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema: remove added columns."""
    with op.batch_alter_table('devices') as batch_op:
        batch_op.drop_column('secondary_ip_address')

    with op.batch_alter_table('policies') as batch_op:
        batch_op.drop_column('last_hit_at_secondary')
        batch_op.drop_column('last_hit_at')
