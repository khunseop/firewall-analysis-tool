"""add concurrent task lock and requester fields for sync/analysis/deletion workflow

Revision ID: a3f7c9d1e246
Revises: 0c2bcf544f00
Create Date: 2026-07-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f7c9d1e246'
down_revision: Union[str, Sequence[str], None] = '0c2bcf544f00'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sync_requested_by_user_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('sync_requested_by_username', sa.String(), nullable=True))

    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('requested_by_user_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('requested_by_username', sa.String(), nullable=True))

    with op.batch_alter_table('deletion_workflow_projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('running_task_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('running_by_user_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('running_by_username', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('deletion_workflow_projects', schema=None) as batch_op:
        batch_op.drop_column('running_by_username')
        batch_op.drop_column('running_by_user_id')
        batch_op.drop_column('running_task_id')

    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.drop_column('requested_by_username')
        batch_op.drop_column('requested_by_user_id')

    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('sync_requested_by_username')
        batch_op.drop_column('sync_requested_by_user_id')
