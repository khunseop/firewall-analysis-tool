# FASTAPI Agent Setup Guide (자동 설정 포함)

아래 가이드에 따라 로컬 또는 개발 환경에서 빠르게 실행할 수 있습니다. 본 문서는 자동 설정(.env 생성, Alembic 마이그레이션 자동 적용) 흐름을 중심으로 설명합니다.

## 요구사항
- Python 3.10+
- (권장) 가상환경: venv 또는 Conda

## 설치
```bash
pip install -r firewall_manager/requirements.txt
```

## 실행
아래 중 한 방법으로 서버를 실행합니다.
```bash
# 방법 A: 프로젝트 루트에서 app-dir 지정 (권장)
uvicorn app.main:app --reload --app-dir firewall_manager

# 방법 B: 디렉토리 진입 후 실행
(cd firewall_manager && uvicorn app.main:app --reload)
```

### 자동 수행 항목
- 프로젝트 루트(`./`)에 `.env`가 없으면 자동 생성됩니다.
  - `DATABASE_URL=sqlite+aiosqlite:///<프로젝트루트>/fat.db`
  - `ENCRYPTION_KEY=<자동 생성된 Fernet 키>`
- 앱 `startup` 이벤트 시 Alembic `upgrade head`가 자동 실행되어 DB 스키마가 최신 상태로 반영됩니다.

### 문서 경로
- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`
- OpenAPI JSON: `http://127.0.0.1:8000/api/v1/openapi.json`

## 운영 환경 권장사항
- 자동 생성이 아닌 고정 `.env` 파일을 사용해 일관성을 유지하세요.
- `ENCRYPTION_KEY`는 절대로 유출되지 않도록 관리하세요. (키 변경 시 기존 암호화 데이터 복호화 불가)
- SQLite 외 RDBMS로 전환 시 `DATABASE_URL`만 교체하면 됩니다. (예: `postgresql+asyncpg://user:pass@host:5432/dbname`)

## 문제 해결
- 문서 화면이 로딩되지 않으면 정적 파일이 로컬에서 제공되는지 확인하세요 (`firewall_manager/app/static/*`).
- DB가 생성되지 않으면 로그에서 Alembic 오류를 확인하세요. 필요시 수동 실행:
```bash
(cd firewall_manager && alembic upgrade head)
```
- `.env`가 생성되지 않으면 `firewall_manager/app/core/config.py`의 자동 생성 로직이 실행되는지 확인하세요.
