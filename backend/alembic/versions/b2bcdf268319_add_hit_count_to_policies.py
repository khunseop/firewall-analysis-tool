"""add hit_count to policies

Revision ID: b2bcdf268319
Revises: p1q2r3s4t5u6
Create Date: 2026-07-07 14:55:09.426851

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2bcdf268319'
down_revision: Union[str, Sequence[str], None] = 'p1q2r3s4t5u6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('policies', sa.Column('hit_count', sa.Integer(), nullable=True))

    # Palo Alto API 방식에서 이력 없음을 나타내던 1900-01-01 sentinel 값을 NULL로 백필
    op.execute("UPDATE policies SET last_hit_date = NULL WHERE last_hit_date < '1901-01-01'")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('policies', 'hit_count')
