# SQLite 백업 전략 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fat.db`(SQLite, WAL 모드)가 유일한 데이터 저장소인데 정기 백업 체계가 없다. 앱이 켜져 있는 동안(WAL 모드, 동시 쓰기 가능)에도 안전하게 일관된 백업을 뜰 수 있는 스크립트와, 이를 정기 실행하는 방법을 문서화한다.

**Architecture:** `sqlite3` 표준 라이브러리의 `Connection.backup()` API를 사용한다 — 이는 SQLite의 온라인 백업 API를 감싼 것으로, 파일을 단순 복사(`cp`)하는 것과 달리 WAL 모드에서 동시 쓰기가 일어나는 중에도 일관된 스냅샷을 보장한다. 스크립트는 `backend/scripts/`의 기존 관례(단독 실행 CLI, `sys.path` 조정 후 `app.core.config.settings` 재사용)를 따른다. 타임스탬프가 찍힌 백업 파일을 만들고, 오래된 백업은 개수 기준으로 자동 정리(rotation)한다.

**Tech Stack:** 표준 라이브러리 `sqlite3`만 사용 — 새 의존성 없음.

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 5)

## Global Constraints

- 새 외부 의존성 추가 금지.
- 앱을 멈추지 않고도(운영 중에도) 안전하게 실행 가능해야 한다 — 파일 단순 복사 금지, 반드시 SQLite 온라인 백업 API 사용.
- 백업 파일은 저장소에 커밋하지 않는다 (`.gitignore` 처리).

---

## File Structure

- Create: `backend/scripts/backup_db.py` — 백업 생성 + 로테이션 CLI.
- Test: `backend/tests/test_backup_db.py` — 로테이션 순수 로직 단위 테스트.
- Modify: `.gitignore` — `backups/` 디렉터리 무시 추가.
- Create: `docs/BACKUP.md` — 사용법, cron 예시, 복구 절차.

---

### Task 1: 백업 스크립트 + 로테이션 로직 + 테스트

**Files:**
- Create: `backend/scripts/backup_db.py`
- Test: `backend/tests/test_backup_db.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `backup_sqlite(source_path: Path, dest_path: Path) -> None`, `rotate_backups(backup_dir: Path, keep: int) -> list[Path]` (삭제된 파일 목록 반환) — `backend/scripts/backup_db.py`.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_backup_db.py`:

```python
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_backup_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'backup_db'`로 전부 실패.

- [ ] **Step 3: 스크립트 구현**

`backend/scripts/backup_db.py`:

```python
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
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_backup_db.py -v
```

Expected: 3개 모두 PASS.

- [ ] **Step 5: `.gitignore`에 `backups/` 추가**

`.gitignore`의 `logs/` 줄 바로 다음에 추가:

```
backups/
```

- [ ] **Step 6: 실제 프로젝트 DB로 수동 검증 (읽기 전용, 안전)**

```bash
cd /Users/hoon/Code/firewall-analysis-tool
.venv/bin/python backend/scripts/backup_db.py --backup-dir /tmp/fat-backup-verify --keep 2
ls -la /tmp/fat-backup-verify
.venv/bin/python backend/scripts/backup_db.py --backup-dir /tmp/fat-backup-verify --keep 2
.venv/bin/python backend/scripts/backup_db.py --backup-dir /tmp/fat-backup-verify --keep 2
ls -la /tmp/fat-backup-verify
rm -rf /tmp/fat-backup-verify
```

Expected: 첫 실행 후 백업 파일 1개 생성. 세 번 실행 후에는 `--keep 2` 때문에 항상 최신 2개만 남아있어야 한다.

- [ ] **Step 7: 전체 회귀 확인**

```bash
cd backend && ../.venv/bin/python -m pytest -v 2>&1 | tail -5
```

Expected: 전체 테스트 PASS.

- [ ] **Step 8: 커밋**

```bash
git add backend/scripts/backup_db.py backend/tests/test_backup_db.py .gitignore
git commit -m "$(cat <<'EOF'
feat: SQLite 온라인 백업 스크립트 추가 (backup_db.py)

fat.db가 유일한 데이터 저장소인데 정기 백업이 없었다. sqlite3의 온라인
백업 API를 사용해 WAL 모드에서 앱이 떠 있는 동안에도 안전하게 백업하고,
개수 기준으로 오래된 백업을 자동 정리한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 백업 문서화 (사용법, cron 예시, 복구 절차)

**Files:**
- Create: `docs/BACKUP.md`

- [ ] **Step 1: 문서 작성**

`docs/BACKUP.md`:

```markdown
# DB 백업

FAT는 SQLite 단일 파일(`backend/fat.db`)을 유일한 데이터 저장소로 사용합니다.
디스크 손상·실수로 인한 데이터 손실에 대비해 정기 백업이 필수입니다.

## 백업 스크립트

`backend/scripts/backup_db.py`는 SQLite의 온라인 백업 API(`sqlite3.Connection.backup()`)를
사용합니다. 이 방식은 단순 파일 복사(`cp fat.db backup.db`)와 달리, 앱이 실행 중이라
WAL 모드에서 동시에 쓰기가 일어나고 있어도 일관된 스냅샷을 보장합니다 — **앱을 멈출
필요가 없습니다.**

```bash
# 프로젝트 루트에서
.venv/bin/python backend/scripts/backup_db.py

# 백업 위치/보관 개수 지정
.venv/bin/python backend/scripts/backup_db.py --backup-dir /path/to/backups --keep 30
```

기본 저장 위치는 `<프로젝트 루트>/backups/fat-<YYYYmmdd-HHMMSS>.db`이고, 기본적으로
최근 14개만 보관하며 그보다 오래된 백업은 스크립트 실행 시 자동 삭제됩니다.

## 정기 실행 (cron)

매일 새벽 3시에 백업하고 최근 30일치를 보관하는 예시:

```cron
0 3 * * * cd /path/to/firewall-analysis-tool && /path/to/firewall-analysis-tool/.venv/bin/python backend/scripts/backup_db.py --backup-dir /path/to/firewall-analysis-tool/backups --keep 30 >> /path/to/firewall-analysis-tool/logs/backup.log 2>&1
```

**중요:** `--backup-dir`는 가능하면 `fat.db`가 있는 것과 같은 디스크가 아닌 곳(별도
파티션, NAS, 오브젝트 스토리지 등)을 가리키도록 운영 환경에서 조정하세요. 같은 디스크에만
백업을 두면 디스크 자체가 고장 났을 때 백업도 함께 잃습니다. 이 스크립트는 로컬 디스크
백업만 담당하며, 오프사이트 복제는 별도 인프라(rsync, 클라우드 스토리지 동기화 등)로
처리해야 합니다.

## 복구 절차

1. 애플리케이션을 중지합니다 (`uvicorn` 프로세스 종료).
2. 복구할 백업 파일을 선택합니다 (`backups/fat-<날짜>-<시각>.db`).
3. 현재 `backend/fat.db`를 안전한 곳으로 옮겨둡니다 (실수 방지용, 삭제하지 않음):
   ```bash
   mv backend/fat.db backend/fat.db.before-restore
   ```
4. 선택한 백업 파일을 `backend/fat.db` 자리로 복사합니다:
   ```bash
   cp backups/fat-20260115-030000.db backend/fat.db
   ```
5. WAL/SHM 파일이 남아있다면 함께 정리합니다 (복구 직후에는 보통 없음):
   ```bash
   rm -f backend/fat.db-wal backend/fat.db-shm
   ```
6. 애플리케이션을 다시 시작하고 `/api/v1/health`로 DB 연결을 확인합니다.
```

- [ ] **Step 2: 커밋**

```bash
git add docs/BACKUP.md
git commit -m "$(cat <<'EOF'
docs: SQLite 백업 사용법/cron 예시/복구 절차 문서 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 로드맵 항목 5 전체를 Task 1(스크립트)·2(문서)가 커버.
- **플레이스홀더 스캔**: 없음.
- **타입 일관성**: `backup_sqlite(source_path, dest_path)`, `rotate_backups(backup_dir, keep)` 시그니처가 테스트·구현·문서 예시에서 일치.
- **의도적으로 하지 않은 것**: 실제 cron 등록, 오프사이트 복제 인프라 구축 — 둘 다 운영 환경 고유의 결정이라 이번 범위 밖이며 문서에 안내만 남긴다.
