"""Add policy member index tables

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2025-10-27 00:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'policy_address_members',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('device_id', sa.Integer(), sa.ForeignKey('devices.id'), nullable=False),
        sa.Column('policy_id', sa.Integer(), sa.ForeignKey('policies.id'), nullable=False),
        sa.Column('direction', sa.String(), nullable=False),
        sa.Column('token', sa.String(), nullable=False),
        sa.Column('token_type', sa.String(), nullable=True),
        sa.Column('ip_version', sa.Integer(), nullable=True),
        sa.Column('ip_start', sa.BigInteger(), nullable=True),
        sa.Column('ip_end', sa.BigInteger(), nullable=True),
    )
    op.create_index('ix_policy_addr_members_lookup', 'policy_address_members', ['device_id', 'direction', 'ip_version', 'ip_start', 'ip_end'])
    op.create_index('ix_policy_addr_members_policy', 'policy_address_members', ['policy_id'])

    op.create_table(
        'policy_service_members',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('device_id', sa.Integer(), sa.ForeignKey('devices.id'), nullable=False),
        sa.Column('policy_id', sa.Integer(), sa.ForeignKey('policies.id'), nullable=False),
        sa.Column('token', sa.String(), nullable=False),
        sa.Column('token_type', sa.String(), nullable=True),
        sa.Column('protocol', sa.String(), nullable=True),
        sa.Column('port_start', sa.Integer(), nullable=True),
        sa.Column('port_end', sa.Integer(), nullable=True),
    )
    op.create_index('ix_policy_svc_members_lookup', 'policy_service_members', ['device_id', 'protocol', 'port_start', 'port_end'])
    op.create_index('ix_policy_svc_members_policy', 'policy_service_members', ['policy_id'])


def downgrade() -> None:
    op.drop_index('ix_policy_svc_members_policy', table_name='policy_service_members')
    op.drop_index('ix_policy_svc_members_lookup', table_name='policy_service_members')
    op.drop_table('policy_service_members')

    op.drop_index('ix_policy_addr_members_policy', table_name='policy_address_members')
    op.drop_index('ix_policy_addr_members_lookup', table_name='policy_address_members')
    op.drop_table('policy_address_members')
