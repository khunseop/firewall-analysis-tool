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
