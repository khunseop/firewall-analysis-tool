#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Settings의 deletion_workflow_config.exceptions.duplicate_policies에 잘못 저장된
중복정책 예외 항목을 조회/삭제하는 스크립트.

배경: save_task15_exceptions_to_settings가 한동안 '미사용예외' 컬럼 필터링 없이
Task15 '예외' 시트(전체만료/차단영향위험) 내용을 그대로 저장해, 잘못된 정책명이
duplicate_policies에 누적된 채로 남아있을 수 있다.

사용법:
  python backend/cleanup_duplicate_policy_exceptions.py list [--device-id ID]
  python backend/cleanup_duplicate_policy_exceptions.py remove --name RULE_NAME [--device-id ID] [--apply]
  python backend/cleanup_duplicate_policy_exceptions.py remove --all [--device-id ID] [--apply]

--apply 없이 실행하면 무엇이 삭제될지만 보여주고 실제로는 반영하지 않는다(dry-run 기본값).
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import SessionLocal
from backend.app import crud, schemas

SETTINGS_KEY = "deletion_workflow_config"


def _print_entries(entries: list[dict]) -> None:
    if not entries:
        print("(항목 없음)")
        return
    for i, e in enumerate(entries):
        print(f"[{i}] device_id={e.get('device_id')} name={e.get('name')!r} "
              f"reason={e.get('reason')!r} registered_at={e.get('registered_at')} "
              f"expires_at={e.get('expires_at')}")


async def _load(db: AsyncSession) -> tuple[dict, list[dict]]:
    setting = await crud.settings.get_setting(db, key=SETTINGS_KEY)
    if not setting:
        print("Settings에 deletion_workflow_config가 없습니다.")
        return {}, []
    try:
        cfg = json.loads(setting.value)
    except Exception as e:
        print(f"Settings 값 파싱 실패: {e}")
        return {}, []
    entries = cfg.get("exceptions", {}).get("duplicate_policies", [])
    return cfg, entries


async def list_entries(device_id: int | None) -> None:
    db: AsyncSession = SessionLocal()
    try:
        _, entries = await _load(db)
        if device_id is not None:
            entries = [e for e in entries if e.get("device_id") == device_id]
        print(f"총 {len(entries)}건")
        _print_entries(entries)
    finally:
        await db.close()


async def remove_entries(device_id: int | None, names: list[str] | None, remove_all: bool, apply: bool) -> None:
    db: AsyncSession = SessionLocal()
    try:
        cfg, entries = await _load(db)
        if not entries:
            return

        def matches(e: dict) -> bool:
            if device_id is not None and e.get("device_id") != device_id:
                return False
            if remove_all:
                return True
            return e.get("name") in (names or [])

        to_remove = [e for e in entries if matches(e)]
        to_keep = [e for e in entries if not matches(e)]

        print(f"삭제 대상 {len(to_remove)}건 (전체 {len(entries)}건 중):")
        _print_entries(to_remove)

        if not apply:
            print("\n--apply 없이 실행됨: 실제로 삭제되지 않았습니다.")
            return

        if not to_remove:
            print("삭제할 항목이 없습니다.")
            return

        cfg.setdefault("exceptions", {})["duplicate_policies"] = to_keep
        value = json.dumps(cfg, ensure_ascii=False)
        setting = await crud.settings.get_setting(db, key=SETTINGS_KEY)
        await crud.settings.update_setting(
            db=db, db_obj=setting,
            obj_in=schemas.SettingsUpdate(value=value),
        )
        await db.commit()
        print(f"\n{len(to_remove)}건 삭제 완료. 남은 항목: {len(to_keep)}건")
    except Exception as e:
        print(f"오류 발생: {e}")
        await db.rollback()
    finally:
        await db.close()


def main():
    parser = argparse.ArgumentParser(description="잘못 저장된 중복정책 예외(duplicate_policies) 조회/삭제")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="현재 저장된 예외 목록 조회")
    p_list.add_argument("--device-id", type=int, default=None)

    p_remove = sub.add_parser("remove", help="예외 항목 삭제")
    p_remove.add_argument("--device-id", type=int, default=None, help="특정 장비로 제한")
    p_remove.add_argument("--name", action="append", default=None, help="삭제할 정책명 (여러 번 지정 가능)")
    p_remove.add_argument("--all", action="store_true", help="조건에 맞는 항목 전체 삭제")
    p_remove.add_argument("--apply", action="store_true", help="실제로 반영 (없으면 dry-run)")

    args = parser.parse_args()

    if args.command == "list":
        asyncio.run(list_entries(args.device_id))
    elif args.command == "remove":
        if not args.all and not args.name:
            parser.error("--name 또는 --all 중 하나는 지정해야 합니다.")
        asyncio.run(remove_entries(args.device_id, args.name, args.all, args.apply))


if __name__ == "__main__":
    main()
