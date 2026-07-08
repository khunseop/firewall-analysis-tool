"""replace device resource usage fields with object count thresholds

Revision ID: 6ff06bc5a575
Revises: 829b54b9f860
Create Date: 2026-07-08 09:18:52.691028

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6ff06bc5a575'
down_revision: Union[str, Sequence[str], None] = '829b54b9f860'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('policy_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('network_object_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('service_threshold', sa.Integer(), nullable=True))
        batch_op.drop_column('cpu_threshold')
        batch_op.drop_column('cpu_usage')
        batch_op.drop_column('memory_threshold')
        batch_op.drop_column('memory_usage')
        batch_op.drop_column('session_threshold')
        batch_op.drop_column('session_usage')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('session_usage', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('session_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('memory_usage', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('memory_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('cpu_usage', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('cpu_threshold', sa.Integer(), nullable=True))
        batch_op.drop_column('service_threshold')
        batch_op.drop_column('network_object_threshold')
        batch_op.drop_column('policy_threshold')
