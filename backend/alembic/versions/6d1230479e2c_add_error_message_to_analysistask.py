"""Add error_message to AnalysisTask

Revision ID: 6d1230479e2c
Revises: 57cc3fce8f18
Create Date: 2026-06-08 21:46:24.373870

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6d1230479e2c'
down_revision: Union[str, Sequence[str], None] = '57cc3fce8f18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('analysistasks', sa.Column('error_message', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('analysistasks', 'error_message')
