"""device system info 자동수집 컬럼 추가 (hostname uptime multi_vsys manual flags)

Palo Alto SSH `show system info` 자동 수집을 위해 hostname/uptime/multi_vsys
컬럼을 추가하고, 기존에 수기 입력 전용이던 model/serial_number/os_version에도
manual 플래그를 추가한다. 0c2bcf544f00(임계치 manual 플래그 추가)와 동일하게,
업그레이드 시 이미 값이 들어있던 model/serial_number/os_version은 관리자가
수기 입력한 것으로 간주해 manual 플래그를 True로 설정한다 (자동 수집이 기존
값을 덮어쓰지 않도록).

Revision ID: 58ee57742835
Revises: 09dd00061f54
Create Date: 2026-08-07 11:59:48.303721

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '58ee57742835'
down_revision: Union[str, Sequence[str], None] = '09dd00061f54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('hostname', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('hostname_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('uptime', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('multi_vsys', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('multi_vsys_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('model_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('serial_number_manual', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('os_version_manual', sa.Boolean(), nullable=False, server_default=sa.false()))

    # 기존에 값이 있던 항목은 수기 입력으로 간주 — 자동 수집이 덮어쓰지 않도록 manual=True로 표시
    devices = sa.table(
        'devices',
        sa.column('model', sa.String()),
        sa.column('model_manual', sa.Boolean()),
        sa.column('serial_number', sa.String()),
        sa.column('serial_number_manual', sa.Boolean()),
        sa.column('os_version', sa.String()),
        sa.column('os_version_manual', sa.Boolean()),
    )
    op.execute(devices.update().where(devices.c.model.isnot(None)).values(model_manual=True))
    op.execute(devices.update().where(devices.c.serial_number.isnot(None)).values(serial_number_manual=True))
    op.execute(devices.update().where(devices.c.os_version.isnot(None)).values(os_version_manual=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_column('os_version_manual')
        batch_op.drop_column('serial_number_manual')
        batch_op.drop_column('model_manual')
        batch_op.drop_column('multi_vsys_manual')
        batch_op.drop_column('multi_vsys')
        batch_op.drop_column('uptime')
        batch_op.drop_column('hostname_manual')
        batch_op.drop_column('hostname')
