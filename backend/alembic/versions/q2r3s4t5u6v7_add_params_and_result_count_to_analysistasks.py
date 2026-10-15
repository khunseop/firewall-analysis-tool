"""Add params and result_count to analysistasks

Revision ID: q2r3s4t5u6v7
Revises: 279168ff6fab
Create Date: 2026-10-15 23:40:00.000000

분석 이력 목록에 "실행 기준(파라미터)"과 "결과 건수"를 보여주기 위한 컬럼.
- params: 실행 시점 파라미터 스냅샷(JSON). 기존 실행분은 기록이 없으므로 NULL.
- result_count: 결과 건수. 기존 실행분 중 저장된 결과(analysis_results.task_id)가 연결된 것만 채우고,
  연결된 결과가 없는 성공 작업은 "0건"인지 "결과 연결 이전의 실행"인지 구분할 수 없으므로 NULL로 둔다.
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'q2r3s4t5u6v7'
down_revision: Union[str, Sequence[str], None] = '279168ff6fab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _count(task_type: str, data) -> int:
    rows = [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []
    if task_type == 'REDUNDANCY':
        return len({r.get('set_number') for r in rows})
    if task_type == 'IMPACT':
        return sum(1 for r in rows if r.get('impact_type') == '최대 안전 이동 위치')
    return len(rows)


def upgrade() -> None:
    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('params', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('result_count', sa.Integer(), nullable=True))

    # 기존 성공 작업 중 결과가 연결된 것의 건수를 채운다.
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT t.id, t.task_type, r.result_data "
        "FROM analysistasks t JOIN analysis_results r ON r.task_id = t.id "
        "WHERE t.task_status = 'SUCCESS' AND t.task_type != 'DELETION_WORKFLOW'"
    )).fetchall()
    for task_id, task_type, raw in rows:
        data = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
        bind.execute(
            sa.text("UPDATE analysistasks SET result_count = :c WHERE id = :i"),
            {"c": _count(task_type, data), "i": task_id},
        )


def downgrade() -> None:
    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.drop_column('result_count')
        batch_op.drop_column('params')
