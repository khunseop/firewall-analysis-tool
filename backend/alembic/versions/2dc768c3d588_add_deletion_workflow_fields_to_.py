"""add deletion_workflow fields to analysis task and file

Revision ID: 2dc768c3d588
Revises: 58ee57742835
Create Date: 2026-08-27 09:42:00.439505

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2dc768c3d588'
down_revision: Union[str, Sequence[str], None] = '58ee57742835'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add deletion_workflow<->analysis linkage columns.

    analysistasks.pipeline_task_id / deletion_workflow_project_id: DELETION_WORKFLOW
    타입 실행이 어느 파이프라인 단계(0~19), 어느 프로젝트에 속하는지 나타낸다.
    deletion_workflow_files.analysis_task_id: 파일을 생성한 분석 실행(AnalysisTask)에 대한 참조.
    """
    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('pipeline_task_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('deletion_workflow_project_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_analysistasks_deletion_workflow_project_id_deletion_workflow_projects',
            'deletion_workflow_projects', ['deletion_workflow_project_id'], ['id'], ondelete='CASCADE'
        )

    with op.batch_alter_table('deletion_workflow_files', schema=None) as batch_op:
        batch_op.add_column(sa.Column('analysis_task_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_deletion_workflow_files_analysis_task_id_analysistasks',
            'analysistasks', ['analysis_task_id'], ['id'], ondelete='SET NULL'
        )


def downgrade() -> None:
    """Remove deletion_workflow<->analysis linkage columns."""
    with op.batch_alter_table('deletion_workflow_files', schema=None) as batch_op:
        batch_op.drop_constraint('fk_deletion_workflow_files_analysis_task_id_analysistasks', type_='foreignkey')
        batch_op.drop_column('analysis_task_id')

    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.drop_constraint('fk_analysistasks_deletion_workflow_project_id_deletion_workflow_projects', type_='foreignkey')
        batch_op.drop_column('deletion_workflow_project_id')
        batch_op.drop_column('pipeline_task_id')
