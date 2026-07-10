#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
redundancy_policy_sets 중 policy_id가 가리키는 정책이 이미 삭제되어 고아가 된
행을 조회/삭제하는 스크립트.

배경: sync/tasks.py가 정책을 삭제할 때 관련 redundancy_policy_sets 행을 함께
지우지 않았고(SQLite는 PRAGMA foreign_keys=ON이 아니라 ondelete="CASCADE"도
동작하지 않음), 이 때문에 중복정책 분석 결과가 이미 없는 정책을 가리키는 고아
행으로 남을 수 있었다. 고아 행이 있으면 export 시 중복 세트의 Upper/Lower
짝이 깨져 한쪽만 추출되는 것처럼 보인다.

사용법:
  python backend/cleanup_orphaned_redundancy_sets.py list [--device-id ID]
  python backend/cleanup_orphaned_redundancy_sets.py remove [--device-id ID] [--apply]

--apply 없이 실행하면 무엇이 삭제될지만 보여주고 실제로는 반영하지 않는다(dry-run 기본값).
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import SessionLocal
from backend.app.models.analysis import AnalysisTask, RedundancyPolicySet
from backend.app.models.policy import Policy


async def _find_orphans(db: AsyncSession, device_id: int | None) -> list[dict]:
    query = (
        select(
            RedundancyPolicySet.id,
            RedundancyPolicySet.task_id,
            RedundancyPolicySet.set_number,
            RedundancyPolicySet.type,
            RedundancyPolicySet.policy_id,
            AnalysisTask.device_id,
        )
        .join(AnalysisTask, AnalysisTask.id == RedundancyPolicySet.task_id)
        .outerjoin(Policy, Policy.id == RedundancyPolicySet.policy_id)
        .where(Policy.id.is_(None))
    )
    if device_id is not None:
        query = query.where(AnalysisTask.device_id == device_id)

    result = await db.execute(query)
    rows = result.all()
    return [
        {
            "id": r.id, "task_id": r.task_id, "device_id": r.device_id,
            "set_number": r.set_number, "type": r.type.value if r.type else None,
            "policy_id": r.policy_id,
        }
        for r in rows
    ]


def _print_entries(entries: list[dict]) -> None:
    if not entries:
        print("(항목 없음)")
        return
    for e in entries:
        print(f"id={e['id']} device_id={e['device_id']} task_id={e['task_id']} "
              f"set_number={e['set_number']} type={e['type']} policy_id={e['policy_id']} (삭제된 정책)")


async def list_orphans(device_id: int | None) -> None:
    db: AsyncSession = SessionLocal()
    try:
        entries = await _find_orphans(db, device_id)
        print(f"총 {len(entries)}건")
        _print_entries(entries)
    finally:
        await db.close()


async def remove_orphans(device_id: int | None, apply: bool) -> None:
    db: AsyncSession = SessionLocal()
    try:
        entries = await _find_orphans(db, device_id)
        print(f"삭제 대상 {len(entries)}건:")
        _print_entries(entries)

        if not apply:
            print("\n--apply 없이 실행됨: 실제로 삭제되지 않았습니다.")
            return

        if not entries:
            print("삭제할 항목이 없습니다.")
            return

        ids = [e["id"] for e in entries]
        await db.execute(delete(RedundancyPolicySet).where(RedundancyPolicySet.id.in_(ids)))
        await db.commit()
        print(f"\n{len(ids)}건 삭제 완료.")
    except Exception as e:
        print(f"오류 발생: {e}")
        await db.rollback()
    finally:
        await db.close()


def main():
    parser = argparse.ArgumentParser(description="고아가 된 redundancy_policy_sets 행 조회/삭제")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="현재 고아 행 목록 조회")
    p_list.add_argument("--device-id", type=int, default=None)

    p_remove = sub.add_parser("remove", help="고아 행 삭제")
    p_remove.add_argument("--device-id", type=int, default=None, help="특정 장비로 제한")
    p_remove.add_argument("--apply", action="store_true", help="실제로 반영 (없으면 dry-run)")

    args = parser.parse_args()

    if args.command == "list":
        asyncio.run(list_orphans(args.device_id))
    elif args.command == "remove":
        asyncio.run(remove_orphans(args.device_id, args.apply))


if __name__ == "__main__":
    main()
