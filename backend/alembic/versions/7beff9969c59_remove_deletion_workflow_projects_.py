"""remove deletion_workflow_projects running lock columns

Revision ID: 7beff9969c59
Revises: 2dc768c3d588
Create Date: 2026-08-27 09:50:53.171179

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7beff9969c59'
down_revision: Union[str, Sequence[str], None] = '2dc768c3d588'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the DB-field-based running-task lock — replaced by an in-memory
    asyncio.Lock per project (see services/deletion_workflow/tasks.py) plus
    AnalysisTask(IN_PROGRESS) 조회 기반 409 사전 체크."""
    with op.batch_alter_table('deletion_workflow_projects', schema=None) as batch_op:
        batch_op.drop_column('running_by_username')
        batch_op.drop_column('running_task_id')
        batch_op.drop_column('running_by_user_id')


def downgrade() -> None:
    """Restore the DB-field-based running-task lock columns."""
    with op.batch_alter_table('deletion_workflow_projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('running_by_user_id', sa.INTEGER(), nullable=True))
        batch_op.add_column(sa.Column('running_task_id', sa.INTEGER(), nullable=True))
        batch_op.add_column(sa.Column('running_by_username', sa.VARCHAR(), nullable=True))
