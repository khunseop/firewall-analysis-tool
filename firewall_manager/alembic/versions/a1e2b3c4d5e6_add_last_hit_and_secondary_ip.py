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
    """Upgrade schema: add last hit columns and secondary IP with guards."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # policies: last_hit_at and last_hit_at_secondary
    policy_cols = {col['name'] for col in inspector.get_columns('policies')}
    with op.batch_alter_table('policies') as batch_op:
        if 'last_hit_at' not in policy_cols:
            batch_op.add_column(sa.Column('last_hit_at', sa.DateTime(), nullable=True))
        if 'last_hit_at_secondary' not in policy_cols:
            batch_op.add_column(sa.Column('last_hit_at_secondary', sa.DateTime(), nullable=True))

    # devices: secondary_ip_address
    device_cols = {col['name'] for col in inspector.get_columns('devices')}
    with op.batch_alter_table('devices') as batch_op:
        if 'secondary_ip_address' not in device_cols:
            batch_op.add_column(sa.Column('secondary_ip_address', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema: remove added columns if present."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    device_cols = {col['name'] for col in inspector.get_columns('devices')}
    with op.batch_alter_table('devices') as batch_op:
        if 'secondary_ip_address' in device_cols:
            batch_op.drop_column('secondary_ip_address')

    policy_cols = {col['name'] for col in inspector.get_columns('policies')}
    with op.batch_alter_table('policies') as batch_op:
        if 'last_hit_at_secondary' in policy_cols:
            batch_op.drop_column('last_hit_at_secondary')
        if 'last_hit_at' in policy_cols:
            batch_op.drop_column('last_hit_at')
