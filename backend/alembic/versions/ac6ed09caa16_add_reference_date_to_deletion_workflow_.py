"""add_reference_date_to_deletion_workflow_projects

Revision ID: ac6ed09caa16
Revises: be31ff864885
Create Date: 2026-06-15 10:24:03.777342

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ac6ed09caa16'
down_revision: Union[str, Sequence[str], None] = 'be31ff864885'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('deletion_workflow_projects', sa.Column('reference_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('deletion_workflow_projects', 'reference_date')
