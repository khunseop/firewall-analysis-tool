"""Add task_id to analysis_results

Revision ID: p1q2r3s4t5u6
Revises: ac6ed09caa16
Create Date: 2026-07-06 10:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'p1q2r3s4t5u6'
down_revision: Union[str, Sequence[str], None] = 'ac6ed09caa16'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add task_id column to analysis_results (links each result to the run that produced it)."""
    with op.batch_alter_table('analysis_results', schema=None) as batch_op:
        batch_op.add_column(sa.Column('task_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_analysis_results_task_id'), ['task_id'], unique=False)
        batch_op.create_foreign_key(
            'fk_analysis_results_task_id_analysistasks', 'analysistasks', ['task_id'], ['id'], ondelete='CASCADE'
        )


def downgrade() -> None:
    """Remove task_id column from analysis_results."""
    with op.batch_alter_table('analysis_results', schema=None) as batch_op:
        batch_op.drop_constraint('fk_analysis_results_task_id_analysistasks', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_analysis_results_task_id'))
        batch_op.drop_column('task_id')
