"""Add settings table

Revision ID: g2d3e4f5a6b7
Revises: f1a2b3c4d5e6
Create Date: 2025-01-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('settings',
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('value', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('key')
    )
    op.create_index(op.f('ix_settings_key'), 'settings', ['key'], unique=False)
    
    # 초기 데이터 삽입: sync_parallel_limit = "4"
    op.execute("""
        INSERT INTO settings (key, value, description)
        VALUES ('sync_parallel_limit', '4', '동기화 병렬 처리 개수 (동시에 동기화할 수 있는 장비 수)')
    """)


def downgrade() -> None:
    op.drop_index(op.f('ix_settings_key'), table_name='settings')
    op.drop_table('settings')

