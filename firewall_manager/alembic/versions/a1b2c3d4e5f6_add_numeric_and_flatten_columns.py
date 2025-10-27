"""Add numeric IP/port and flattened columns

Revision ID: a1b2c3d4e5f6
Revises: 999999999999
Create Date: 2025-10-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '999999999999'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema by adding numeric and flattened columns if missing."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # policies: flattened_* columns
    existing_policy_cols = {col['name'] for col in inspector.get_columns('policies')}
    with op.batch_alter_table('policies', schema=None) as batch_op:
        if 'flattened_source' not in existing_policy_cols:
            batch_op.add_column(sa.Column('flattened_source', sa.String(), nullable=True))
        if 'flattened_destination' not in existing_policy_cols:
            batch_op.add_column(sa.Column('flattened_destination', sa.String(), nullable=True))
        if 'flattened_service' not in existing_policy_cols:
            batch_op.add_column(sa.Column('flattened_service', sa.String(), nullable=True))

    # network_objects: ip_version, ip_start, ip_end
    existing_netobj_cols = {col['name'] for col in inspector.get_columns('network_objects')}
    with op.batch_alter_table('network_objects', schema=None) as batch_op:
        if 'ip_version' not in existing_netobj_cols:
            batch_op.add_column(sa.Column('ip_version', sa.Integer(), nullable=True))
        if 'ip_start' not in existing_netobj_cols:
            batch_op.add_column(sa.Column('ip_start', sa.BigInteger(), nullable=True))
        if 'ip_end' not in existing_netobj_cols:
            batch_op.add_column(sa.Column('ip_end', sa.BigInteger(), nullable=True))

    # services: port_start, port_end
    existing_service_cols = {col['name'] for col in inspector.get_columns('services')}
    with op.batch_alter_table('services', schema=None) as batch_op:
        if 'port_start' not in existing_service_cols:
            batch_op.add_column(sa.Column('port_start', sa.Integer(), nullable=True))
        if 'port_end' not in existing_service_cols:
            batch_op.add_column(sa.Column('port_end', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema by dropping added columns."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_policy_cols = {col['name'] for col in inspector.get_columns('policies')}
    with op.batch_alter_table('policies', schema=None) as batch_op:
        if 'flattened_service' in existing_policy_cols:
            batch_op.drop_column('flattened_service')
        if 'flattened_destination' in existing_policy_cols:
            batch_op.drop_column('flattened_destination')
        if 'flattened_source' in existing_policy_cols:
            batch_op.drop_column('flattened_source')

    existing_netobj_cols = {col['name'] for col in inspector.get_columns('network_objects')}
    with op.batch_alter_table('network_objects', schema=None) as batch_op:
        if 'ip_end' in existing_netobj_cols:
            batch_op.drop_column('ip_end')
        if 'ip_start' in existing_netobj_cols:
            batch_op.drop_column('ip_start')
        if 'ip_version' in existing_netobj_cols:
            batch_op.drop_column('ip_version')

    existing_service_cols = {col['name'] for col in inspector.get_columns('services')}
    with op.batch_alter_table('services', schema=None) as batch_op:
        if 'port_end' in existing_service_cols:
            batch_op.drop_column('port_end')
        if 'port_start' in existing_service_cols:
            batch_op.drop_column('port_start')
