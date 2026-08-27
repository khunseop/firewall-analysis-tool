"""rename deletion_workflow tables to analysis_project

Revision ID: 81e64193b9c6
Revises: 7beff9969c59
Create Date: 2026-08-27 13:17:11.994809

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '81e64193b9c6'
down_revision: Union[str, Sequence[str], None] = '7beff9969c59'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rename deletion_workflow_* tables to generic analysis_project_* tables
    and add module_type so other project-type analysis modules can share them."""
    op.rename_table('deletion_workflow_projects', 'analysis_projects')
    op.rename_table('deletion_workflow_files', 'analysis_project_files')

    with op.batch_alter_table('analysis_projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('module_type', sa.String(), nullable=False, server_default='deletion_workflow'))
        batch_op.create_index(batch_op.f('ix_analysis_projects_module_type'), ['module_type'], unique=False)

    # NOTE: drop_constraint + alter_column(rename) + create_foreign_key must NOT be combined
    # in a single batch_alter_table block on SQLite: Alembic's batch "recreate" silently drops
    # the newly created FK when it's mixed with a column rename in the same batch. Split the
    # FK creation into its own batch so it is applied against the already-renamed column.
    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.drop_constraint(
            'fk_analysistasks_deletion_workflow_project_id_deletion_workflow_projects',
            type_='foreignkey',
        )
        batch_op.alter_column('deletion_workflow_project_id', new_column_name='analysis_project_id')

    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.create_foreign_key(
            'fk_analysistasks_analysis_project_id_analysis_projects',
            'analysis_projects', ['analysis_project_id'], ['id'], ondelete='CASCADE',
        )


def downgrade() -> None:
    """Revert analysis_project_* tables back to deletion_workflow_*."""
    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.drop_constraint(
            'fk_analysistasks_analysis_project_id_analysis_projects',
            type_='foreignkey',
        )
        batch_op.alter_column('analysis_project_id', new_column_name='deletion_workflow_project_id')

    with op.batch_alter_table('analysis_projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_analysis_projects_module_type'))
        batch_op.drop_column('module_type')

    op.rename_table('analysis_project_files', 'deletion_workflow_files')
    op.rename_table('analysis_projects', 'deletion_workflow_projects')

    # Create the FK only after 'deletion_workflow_projects' exists again (post-rename above),
    # and as its own batch block for the same reason as in upgrade().
    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.create_foreign_key(
            'fk_analysistasks_deletion_workflow_project_id_deletion_workflow_projects',
            'deletion_workflow_projects', ['deletion_workflow_project_id'], ['id'], ondelete='CASCADE',
        )
