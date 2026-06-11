"""add deletion workflow projects and files

Revision ID: be31ff864885
Revises: 3b8b30b839e4
Create Date: 2026-06-11 09:42:40.855628

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'be31ff864885'
down_revision: Union[str, Sequence[str], None] = '3b8b30b839e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'deletion_workflow_projects',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('memo', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_deletion_workflow_projects_id', 'deletion_workflow_projects', ['id'], unique=False)

    op.create_table(
        'deletion_workflow_files',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('slot', sa.String(), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('file_data', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['deletion_workflow_projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'task_id', 'slot', name='uq_project_task_slot'),
    )
    op.create_index('ix_deletion_workflow_files_id', 'deletion_workflow_files', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_deletion_workflow_files_id', table_name='deletion_workflow_files')
    op.drop_table('deletion_workflow_files')
    op.drop_index('ix_deletion_workflow_projects_id', table_name='deletion_workflow_projects')
    op.drop_table('deletion_workflow_projects')
