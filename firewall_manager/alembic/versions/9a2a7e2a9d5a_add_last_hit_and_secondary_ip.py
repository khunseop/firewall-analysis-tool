"""
add last_hit_at fields to policies and secondary_ip_address to devices

Revision ID: 9a2a7e2a9d5a
Revises: 775a087473c7
Create Date: 2025-10-24 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = '9a2a7e2a9d5a'
down_revision = '775a087473c7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # devices.secondary_ip_address
    device_columns = {col['name'] for col in inspector.get_columns('devices')}
    if 'secondary_ip_address' not in device_columns:
        with op.batch_alter_table('devices') as batch_op:
            batch_op.add_column(sa.Column('secondary_ip_address', sa.String(), nullable=True))

    # policies.last_hit_at, policies.last_hit_at_secondary
    policy_columns = {col['name'] for col in inspector.get_columns('policies')}
    add_any = False
    with op.batch_alter_table('policies') as batch_op:
        if 'last_hit_at' not in policy_columns:
            batch_op.add_column(sa.Column('last_hit_at', sa.DateTime(), nullable=True))
            add_any = True
        if 'last_hit_at_secondary' not in policy_columns:
            batch_op.add_column(sa.Column('last_hit_at_secondary', sa.DateTime(), nullable=True))
            add_any = True


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # policies
    policy_columns = {col['name'] for col in inspector.get_columns('policies')}
    with op.batch_alter_table('policies') as batch_op:
        if 'last_hit_at_secondary' in policy_columns:
            batch_op.drop_column('last_hit_at_secondary')
        if 'last_hit_at' in policy_columns:
            batch_op.drop_column('last_hit_at')

    # devices
    device_columns = {col['name'] for col in inspector.get_columns('devices')}
    if 'secondary_ip_address' in device_columns:
        with op.batch_alter_table('devices') as batch_op:
            batch_op.drop_column('secondary_ip_address')
