"""Add ha_peer_ip and use_ssh_for_last_hit_date to devices

Revision ID: 021c2a4e1680
Revises: 5a0be6dd8ed0
Create Date: 2025-11-04 02:58:29.490868

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '021c2a4e1680'
down_revision: Union[str, Sequence[str], None] = '5a0be6dd8ed0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ha_peer_ip', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('use_ssh_for_last_hit_date', sa.Boolean(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('use_ssh_for_last_hit_date')
        batch_op.drop_column('ha_peer_ip')
