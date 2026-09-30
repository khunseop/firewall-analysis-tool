import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from backup_db import backup_sqlite, rotate_backups  # noqa: E402


def test_backup_sqlite_creates_a_valid_copy(tmp_path):
    import sqlite3

    source = tmp_path / "source.db"
    conn = sqlite3.connect(source)
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO t (name) VALUES ('hello')")
    conn.commit()
    conn.close()

    dest = tmp_path / "backup.db"
    backup_sqlite(source, dest)

    assert dest.exists()
    check_conn = sqlite3.connect(dest)
    rows = check_conn.execute("SELECT name FROM t").fetchall()
    check_conn.close()
    assert rows == [("hello",)]


def test_rotate_backups_keeps_only_most_recent_n(tmp_path):
    names = [f"fat-2026010{i}-000000.db" for i in range(1, 6)]
    for name in names:
        (tmp_path / name).write_text("x")

    deleted = rotate_backups(tmp_path, keep=3)

    remaining = sorted(p.name for p in tmp_path.glob("fat-*.db"))
    assert remaining == names[-3:]
    assert sorted(p.name for p in deleted) == names[:-3]


def test_rotate_backups_noop_when_under_limit(tmp_path):
    (tmp_path / "fat-20260101-000000.db").write_text("x")

    deleted = rotate_backups(tmp_path, keep=10)

    assert deleted == []
    assert len(list(tmp_path.glob("fat-*.db"))) == 1
