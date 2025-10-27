"""Drop flattened_* columns from policies

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2025-10-27 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {col['name'] for col in inspector.get_columns('policies')}
    with op.batch_alter_table('policies', schema=None) as batch_op:
        if 'flattened_service' in existing_cols:
            batch_op.drop_column('flattened_service')
        if 'flattened_destination' in existing_cols:
            batch_op.drop_column('flattened_destination')
        if 'flattened_source' in existing_cols:
            batch_op.drop_column('flattened_source')


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {col['name'] for col in inspector.get_columns('policies')}
    with op.batch_alter_table('policies', schema=None) as batch_op:
        if 'flattened_source' not in existing_cols:
            batch_op.add_column(sa.Column('flattened_source', sa.String(), nullable=True))
        if 'flattened_destination' not in existing_cols:
            batch_op.add_column(sa.Column('flattened_destination', sa.String(), nullable=True))
        if 'flattened_service' not in existing_cols:
            batch_op.add_column(sa.Column('flattened_service', sa.String(), nullable=True))
