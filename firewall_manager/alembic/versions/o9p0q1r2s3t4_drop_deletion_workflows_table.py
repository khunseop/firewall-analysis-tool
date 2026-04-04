"""Drop deletion_workflows table

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
Branch Labels: None
Depends On: None

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'o9p0q1r2s3t4'
down_revision: Union[str, Sequence[str], None] = 'n8o9p0q1r2s3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop deletion_workflows table (replaced by fpat policy_deletion_processor)."""
    op.drop_index('ix_deletion_workflows_device_id', table_name='deletion_workflows')
    op.drop_index('ix_deletion_workflows_id', table_name='deletion_workflows')
    op.drop_table('deletion_workflows')


def downgrade() -> None:
    """Recreate deletion_workflows table."""
    op.create_table(
        'deletion_workflows',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.Integer(), nullable=False),
        sa.Column('current_step', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('master_file_path', sa.String(), nullable=True),
        sa.Column('step_files', sa.JSON(), nullable=True),
        sa.Column('final_files', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_deletion_workflows_id', 'deletion_workflows', ['id'], unique=False)
    op.create_index('ix_deletion_workflows_device_id', 'deletion_workflows', ['device_id'], unique=False)
