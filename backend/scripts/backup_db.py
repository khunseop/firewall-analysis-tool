"""
SQLite DB(fat.db) 온라인 백업 스크립트.

파일을 단순 복사(cp)하면 WAL 모드에서 동시 쓰기 중인 페이지를 읽어
손상된 백업이 만들어질 수 있다. sqlite3.Connection.backup()은 SQLite의
온라인 백업 API를 사용해 앱이 떠 있는 상태에서도 일관된 스냅샷을 만든다.

실행 (프로젝트 루트에서, 또는 아무 위치에서든 절대경로로):
    python backend/scripts/backup_db.py [--backup-dir PATH] [--keep N]

기본 백업 위치: <프로젝트 루트>/backups/fat-<YYYYmmdd-HHMMSS>.db
기본 보관 개수: 14 (그 이상 오래된 백업은 자동 삭제)
"""
import argparse
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.core.config import settings  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BACKUP_DIR = PROJECT_ROOT / "backups"
DEFAULT_KEEP = 14


def _sqlite_path_from_url(url: str) -> Path:
    """settings.DATABASE_URL('sqlite+aiosqlite:///<절대경로>')에서 파일 경로를 뽑아낸다."""
    return Path(url.split("sqlite+aiosqlite:///", 1)[1])


def backup_sqlite(source_path: Path, dest_path: Path) -> None:
    """SQLite 온라인 백업 API로 source_path를 dest_path에 안전하게 복제한다."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    source_conn = sqlite3.connect(source_path)
    dest_conn = sqlite3.connect(dest_path)
    try:
        source_conn.backup(dest_conn)
    finally:
        dest_conn.close()
        source_conn.close()


def rotate_backups(backup_dir: Path, keep: int) -> list[Path]:
    """backup_dir의 fat-*.db 백업 중 오래된 것부터 keep개를 초과하는 만큼 삭제한다."""
    backups = sorted(backup_dir.glob("fat-*.db"))
    to_delete = backups[:-keep] if keep > 0 and len(backups) > keep else []
    for p in to_delete:
        p.unlink()
    return to_delete


def main() -> None:
    parser = argparse.ArgumentParser(description="fat.db SQLite 온라인 백업")
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
    parser.add_argument("--keep", type=int, default=DEFAULT_KEEP)
    args = parser.parse_args()

    source_path = _sqlite_path_from_url(settings.DATABASE_URL)
    if not source_path.exists():
        print(f"오류: DB 파일을 찾을 수 없습니다: {source_path}", file=sys.stderr)
        sys.exit(1)

    backup_dir = Path(args.backup_dir)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest_path = backup_dir / f"fat-{timestamp}.db"

    backup_sqlite(source_path, dest_path)
    print(f"백업 완료: {dest_path}")

    deleted = rotate_backups(backup_dir, args.keep)
    if deleted:
        print(f"오래된 백업 {len(deleted)}개 정리: {', '.join(p.name for p in deleted)}")


if __name__ == "__main__":
    main()
