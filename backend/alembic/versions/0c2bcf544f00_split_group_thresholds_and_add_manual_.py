"""split group thresholds and add manual flags

기존 policy_threshold / network_object_threshold / service_threshold는 지금까지
객체+그룹을 합산한 값과 비교되어 왔다. 그룹 임계치를 별도 컬럼(network_group_threshold,
service_group_threshold)으로 분리하고, 각 항목에 manual 플래그를 추가한다.
manual=False(기본값)면 Palo Alto 동기화 시 SSH로 수집한 벤더 한도 값이 자동으로 채워지고,
manual=True면 관리자가 수기 입력한 값을 유지한다.

업그레이드 시 기존에 이미 값이 들어있던 3개 컬럼은 관리자가 수기 입력한 것으로 간주해
해당 manual 플래그를 True로 설정한다 (자동 수집이 기존 값을 덮어쓰지 않도록).

Revision ID: 0c2bcf544f00
Revises: 9f3d51c8e2a7
Create Date: 2026-07-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0c2bcf544f00'
down_revision: Union[str, Sequence[str], None] = '9f3d51c8e2a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('policy_threshold_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('network_object_threshold_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('network_group_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('network_group_threshold_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('service_threshold_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('service_group_threshold', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('service_group_threshold_manual', sa.Boolean(), nullable=False, server_default=sa.false()))

    # 기존에 값이 있던 항목은 수기 입력으로 간주 — 자동 수집이 덮어쓰지 않도록 manual=True로 표시
    devices = sa.table(
        'devices',
        sa.column('policy_threshold', sa.Integer()),
        sa.column('policy_threshold_manual', sa.Boolean()),
        sa.column('network_object_threshold', sa.Integer()),
        sa.column('network_object_threshold_manual', sa.Boolean()),
        sa.column('service_threshold', sa.Integer()),
        sa.column('service_threshold_manual', sa.Boolean()),
    )
    op.execute(devices.update().where(devices.c.policy_threshold.isnot(None)).values(policy_threshold_manual=True))
    op.execute(devices.update().where(devices.c.network_object_threshold.isnot(None)).values(network_object_threshold_manual=True))
    op.execute(devices.update().where(devices.c.service_threshold.isnot(None)).values(service_threshold_manual=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('service_group_threshold_manual')
        batch_op.drop_column('service_group_threshold')
        batch_op.drop_column('service_threshold_manual')
        batch_op.drop_column('network_group_threshold_manual')
        batch_op.drop_column('network_group_threshold')
        batch_op.drop_column('network_object_threshold_manual')
        batch_op.drop_column('policy_threshold_manual')
