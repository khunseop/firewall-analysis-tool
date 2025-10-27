#!/usr/bin/env python3
"""
Alembic migration helper script for manual execution.

Usage examples:
  - Upgrade to latest:       python firewall_manager/migrate.py
  - Explicit upgrade head:   python firewall_manager/migrate.py upgrade head
  - Downgrade one step:      python firewall_manager/migrate.py downgrade -1
  - Show current revision:   python firewall_manager/migrate.py current
  - Show history:            python firewall_manager/migrate.py history
  - Stamp to base:           python firewall_manager/migrate.py stamp base

This script ensures Alembic runs with the correct project paths and settings.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig


def build_alembic_config(project_root: Path) -> AlembicConfig:
    """Create an Alembic Config bound to this project's alembic.ini and scripts."""
    alembic_ini_path = project_root / "alembic.ini"
    if not alembic_ini_path.exists():
        raise FileNotFoundError(f"alembic.ini not found at {alembic_ini_path}")

    cfg = AlembicConfig(str(alembic_ini_path))
    # Force absolute script location for reliability regardless of CWD
    cfg.set_main_option("script_location", str(project_root / "alembic"))
    return cfg


def ensure_import_path(project_root: Path) -> None:
    """Ensure 'app' package is importable for alembic/env.py imports."""
    root_str = str(project_root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manual Alembic migration runner")

    subparsers = parser.add_subparsers(dest="cmd", required=False)

    # upgrade
    p_upgrade = subparsers.add_parser("upgrade", help="Upgrade to a later version")
    p_upgrade.add_argument("revision", nargs="?", default="head", help="Target revision (default: head)")

    # downgrade
    p_downgrade = subparsers.add_parser("downgrade", help="Revert to a previous version")
    p_downgrade.add_argument("revision", help="Target revision (e.g., -1, base, <rev>")

    # current
    subparsers.add_parser("current", help="Show the current revision")

    # history
    p_history = subparsers.add_parser("history", help="List changeset scripts in chronological order")
    p_history.add_argument("range", nargs="?", default=None, help="Revision range, e.g. base:head")

    # stamp
    p_stamp = subparsers.add_parser("stamp", help="'stamp' the revision table with the given revision")
    p_stamp.add_argument("revision", help="Target revision (e.g., base, head, <rev>)")

    # heads
    subparsers.add_parser("heads", help="Show current available heads")

    # default: upgrade head
    parser.set_defaults(cmd="upgrade", revision="head")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]

    project_root = Path(__file__).resolve().parent
    ensure_import_path(project_root)
    cfg = build_alembic_config(project_root)

    args = parse_args(argv)

    try:
        if args.cmd == "upgrade":
            command.upgrade(cfg, args.revision)
        elif args.cmd == "downgrade":
            command.downgrade(cfg, args.revision)
        elif args.cmd == "current":
            command.current(cfg)
        elif args.cmd == "history":
            command.history(cfg, rev_range=getattr(args, "range", None))
        elif args.cmd == "stamp":
            command.stamp(cfg, args.revision)
        elif args.cmd == "heads":
            command.heads(cfg)
        else:
            raise ValueError(f"Unknown command: {args.cmd}")
    except Exception as exc:  # noqa: BLE001 - surface all exceptions
        sys.stderr.write(f"Migration command failed: {exc}\n")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
