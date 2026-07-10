"""drop legacy notifications table and stale ix_policies_search index

- notifications: notification_logs로 대체된 뒤 모델·코드 참조가 전혀 없는 legacy 테이블
- ix_policies_search(source, destination, service): ILIKE '%..%' 검색은 btree 인덱스를
  사용하지 못하므로 쓰기 오버헤드만 있는 불용 인덱스

Revision ID: 7c21e9d0a4b1
Revises: 4018cfde1957
Create Date: 2026-07-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c21e9d0a4b1'
down_revision: Union[str, Sequence[str], None] = '4018cfde1957'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_indexes = {ix['name'] for ix in inspector.get_indexes('policies')}
    if 'ix_policies_search' in existing_indexes:
        op.drop_index('ix_policies_search', table_name='policies')

    if inspector.has_table('notifications'):
        op.drop_table('notifications')


def downgrade() -> None:
    """Downgrade schema (데이터는 복원되지 않음 — 스키마만 재생성)."""
    op.create_table(
        'notifications',
        sa.Column('id', sa.INTEGER(), nullable=False),
        sa.Column('type', sa.VARCHAR(length=8), nullable=False),
        sa.Column('title', sa.VARCHAR(), nullable=False),
        sa.Column('message', sa.VARCHAR(), nullable=False),
        sa.Column('device_id', sa.INTEGER(), nullable=True),
        sa.Column('task_id', sa.INTEGER(), nullable=True),
        sa.Column('status', sa.VARCHAR(length=11), nullable=False),
        sa.Column('is_read', sa.BOOLEAN(), server_default=sa.text("'0'"), nullable=False),
        sa.Column('created_at', sa.DATETIME(), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_notifications_type', 'notifications', ['type'], unique=False)
    op.create_index('ix_notifications_task_id', 'notifications', ['task_id'], unique=False)
    op.create_index('ix_notifications_is_read', 'notifications', ['is_read'], unique=False)
    op.create_index('ix_notifications_id', 'notifications', ['id'], unique=False)
    op.create_index('ix_notifications_device_id', 'notifications', ['device_id'], unique=False)
    op.create_index('ix_notifications_created_at', 'notifications', ['created_at'], unique=False)
    op.create_index('ix_policies_search', 'policies', ['source', 'destination', 'service'], unique=False)
