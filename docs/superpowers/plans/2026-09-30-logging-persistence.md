# 백엔드 로그 영속화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백엔드 로그를 콘솔뿐 아니라 로테이팅 파일에도 남겨 재현 안 되는 오류를 추적할 수 있게 하고, 그 과정에서 발견한 "숨은 전역 로깅 설정" 버그를 제거한다.

**Architecture:** `app/core/logging_config.py`에 `setup_logging()`을 신설해 루트 로거에 `RotatingFileHandler`+콘솔 핸들러를 붙이고, `propagate=False`로 격리되어 있는 uvicorn 자체 로거(`uvicorn`, `uvicorn.error`, `uvicorn.access`)에도 같은 파일 핸들러를 추가로 붙여 액세스 로그까지 파일에 남긴다. `main.py`에서 앱 생성 전에 한 번 호출한다.

**Tech Stack:** 표준 라이브러리 `logging.handlers.RotatingFileHandler`만 사용 — 새 의존성 없음.

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 3)

## Global Constraints

- 새 외부 의존성 추가 금지 — 표준 라이브러리만 사용.
- 기존에 `logger = logging.getLogger(__name__)`로 작성된 코드는 그대로 두고, 루트 로거 설정만 중앙화한다 (개별 파일의 로그 호출부는 건드리지 않음).
- 로그 파일은 프로젝트 루트 `logs/` 디렉터리에 남긴다. `*.log`는 이미 `.gitignore`에 있지만 로테이션 백업 파일(`backend.log.1` 등)은 매칭되지 않으므로 `logs/` 디렉터리 자체를 추가로 무시 처리한다.

---

## File Structure

- Create: `backend/app/core/logging_config.py` — `setup_logging(log_dir, level)` 함수.
- Test: `backend/tests/test_logging_config.py`
- Modify: `backend/app/main.py` — 앱 생성 전 `setup_logging()` 호출.
- Modify: `backend/app/services/firewall/vendors/ngf.py` — 모듈 임포트 시점에 전역 루트 로거를 조작하던 `logging.basicConfig(...)` 제거 (버그 수정).
- Modify: `.gitignore` — `logs/` 디렉터리 무시 추가.

---

### Task 1: `setup_logging()` 구현 + 단위 테스트

**Files:**
- Create: `backend/app/core/logging_config.py`
- Test: `backend/tests/test_logging_config.py`

**Interfaces:**
- Produces: `setup_logging(log_dir: Path = LOG_DIR, level: int = logging.INFO) -> None` — 루트 로거와 `uvicorn`/`uvicorn.error`/`uvicorn.access` 로거에 이름표(`name` 속성) 붙은 핸들러를 부착. 상수 `LOG_DIR`, `_FILE_HANDLER_NAME`, `_CONSOLE_HANDLER_NAME`을 모듈에 노출 (테스트에서 사용).

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_logging_config.py`:

```python
import logging

import pytest

from app.core.logging_config import (
    setup_logging,
    _FILE_HANDLER_NAME,
    _CONSOLE_HANDLER_NAME,
)

_UVICORN_LOGGER_NAMES = ("uvicorn", "uvicorn.error", "uvicorn.access")


def _count_named(handlers, name):
    return sum(1 for h in handlers if h.name == name)


@pytest.fixture(autouse=True)
def _cleanup_logging_handlers():
    yield
    loggers = [logging.getLogger()] + [logging.getLogger(n) for n in _UVICORN_LOGGER_NAMES]
    for lg in loggers:
        for h in lg.handlers[:]:
            if h.name in (_FILE_HANDLER_NAME, _CONSOLE_HANDLER_NAME):
                lg.removeHandler(h)
                h.close()


def test_creates_log_directory_and_writes_to_file(tmp_path):
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)

    logging.getLogger("test.logger").info("hello")
    for handler in logging.getLogger().handlers:
        handler.flush()

    log_file = log_dir / "backend.log"
    assert log_file.exists()
    assert "hello" in log_file.read_text(encoding="utf-8")


def test_calling_twice_does_not_duplicate_root_handlers(tmp_path):
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)
    setup_logging(log_dir=log_dir)

    root = logging.getLogger()
    assert _count_named(root.handlers, _FILE_HANDLER_NAME) == 1
    assert _count_named(root.handlers, _CONSOLE_HANDLER_NAME) == 1


def test_attaches_file_handler_to_uvicorn_loggers(tmp_path):
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)

    for name in _UVICORN_LOGGER_NAMES:
        handlers = logging.getLogger(name).handlers
        assert _count_named(handlers, _FILE_HANDLER_NAME) == 1
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_logging_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.core.logging_config'`로 전부 실패.

- [ ] **Step 3: 최소 구현 작성**

`backend/app/core/logging_config.py`:

```python
"""백엔드 로그를 콘솔 + 로테이팅 파일에 동시에 남기기 위한 중앙 설정.

uvicorn은 자체 로거(``uvicorn``/``uvicorn.error``/``uvicorn.access``)에
``propagate=False``로 자기 핸들러만 붙여두므로, 루트 로거에만 파일 핸들러를
달아서는 요청 로그가 파일에 남지 않는다. 그래서 이 세 로거에도 같은 파일
핸들러를 직접 추가로 붙인다 (콘솔 핸들러는 uvicorn이 이미 갖고 있으므로
중복 출력을 피하기 위해 파일 핸들러만 추가한다).
"""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
LOG_DIR = PROJECT_ROOT / "logs"
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(name)s - %(message)s"

_FILE_HANDLER_NAME = "fat-file"
_CONSOLE_HANDLER_NAME = "fat-console"
_UVICORN_LOGGER_NAMES = ("uvicorn", "uvicorn.error", "uvicorn.access")


def _replace_named_handler(logger: logging.Logger, handler: logging.Handler) -> None:
    for existing in [h for h in logger.handlers if h.name == handler.name]:
        logger.removeHandler(existing)
    logger.addHandler(handler)


def setup_logging(log_dir: Path = LOG_DIR, level: int = logging.INFO) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(LOG_FORMAT)

    file_handler = RotatingFileHandler(
        log_dir / "backend.log", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    file_handler.name = _FILE_HANDLER_NAME

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.name = _CONSOLE_HANDLER_NAME

    root = logging.getLogger()
    root.setLevel(level)
    _replace_named_handler(root, file_handler)
    _replace_named_handler(root, console_handler)

    for name in _UVICORN_LOGGER_NAMES:
        _replace_named_handler(logging.getLogger(name), file_handler)
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_logging_config.py tests/test_rate_limit.py -v
```

Expected: 9개 테스트(로깅 3 + 기존 rate limit 6) 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/core/logging_config.py backend/tests/test_logging_config.py
git commit -m "$(cat <<'EOF'
feat: 로그 영속화용 setup_logging() 추가 (콘솔+로테이팅 파일, uvicorn 로거 포함)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `main.py`에서 `setup_logging()` 호출 + `.gitignore` 갱신

**Files:**
- Modify: `backend/app/main.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `setup_logging` (Task 1에서 정의).

- [ ] **Step 1: `main.py` 상단에서 호출**

`backend/app/main.py`의 기존:

```python
from app.api.api_v1.api import api_router as api_v1_router
from app.core.auth import decode_token
from app.core.config import settings
from app.services.scheduler import sync_scheduler

logger = logging.getLogger(__name__)
```

다음으로 교체 (import 한 줄 추가 + 앱 코드가 실행되기 전에 `setup_logging()` 호출):

```python
from app.api.api_v1.api import api_router as api_v1_router
from app.core.auth import decode_token
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.services.scheduler import sync_scheduler

setup_logging()
logger = logging.getLogger(__name__)
```

- [ ] **Step 2: `.gitignore`에 `logs/` 추가**

`.gitignore`의 `*.log` 줄 바로 아래에 추가:

```
logs/
```

- [ ] **Step 3: 수동 검증 — 파일에 실제로 로그가 쌓이는지 확인**

```bash
cd /Users/hoon/Code/firewall-analysis-tool
rm -rf logs  # 검증용 클린 상태
(.venv/bin/uvicorn app.main:app --app-dir backend --port 8012 > /tmp/uvicorn_logging_verify.log 2>&1 &)
sleep 2
curl -s -o /dev/null http://localhost:8012/api/v1/openapi.json
pkill -f "uvicorn app.main:app --app-dir backend --port 8012"
sleep 1
ls logs/
tail -5 logs/backend.log
```

Expected: `logs/backend.log`가 생성되어 있고, `Application started and scheduler initialized` 같은 앱 로그와 `GET /api/v1/openapi.json` 같은 uvicorn 액세스 로그가 함께 찍혀 있다.

- [ ] **Step 4: 커밋**

```bash
git add backend/app/main.py .gitignore
git commit -m "$(cat <<'EOF'
feat: 앱 시작 시 setup_logging() 호출해 로그 파일 영속화 적용

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 숨은 전역 로깅 설정 버그 제거 (`ngf.py`)

**Files:**
- Modify: `backend/app/services/firewall/vendors/ngf.py`

`backend/app/services/firewall/vendors/ngf.py`의 다음 블록:

```python
# 로깅 설정
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')
```

이 모듈이 임포트되는 순간 **애플리케이션 전체의 루트 로거 설정을 암묵적으로 확정**시켜 버린다 (`logging.basicConfig`는 루트 로거에 핸들러가 하나도 없을 때만 동작하므로, 어떤 모듈이 먼저 임포트되느냐에 따라 로그 포맷이 달라지는 재현 어려운 버그의 원인이었다). Task 2에서 `setup_logging()`이 앱 시작 시점에 명시적으로 루트 로거를 구성하므로 이 블록은 더 이상 필요 없다.

- [ ] **Step 1: 블록 제거**

```python
# 로깅 설정
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')
```

이 두 줄과 주석을 삭제한다. `import logging`은 파일 내에서 `logging.error(...)` 호출에 계속 쓰이므로 그대로 둔다.

- [ ] **Step 2: 회귀 확인**

```bash
cd backend && ../.venv/bin/python -c "from app.services.firewall.vendors import ngf; print('import ok')"
```

Expected: `import ok` 출력, 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/firewall/vendors/ngf.py
git commit -m "$(cat <<'EOF'
fix: ngf.py의 암묵적 logging.basicConfig 제거 (전역 로그 설정 충돌 버그)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 로드맵 항목 3(로그 영속화)을 Task 1~2가 구현하고, 그 과정에서 발견한 `ngf.py`의 숨은 버그를 Task 3에서 제거함.
- **플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 코드/명령 포함.
- **타입 일관성**: `setup_logging(log_dir, level)` 시그니처가 Task 1 정의, Task 2 호출부(`setup_logging()` — 기본값 사용)에서 일치.
- **후속 이슈**: 로그 레벨을 환경변수로 조정하는 기능은 이번 범위에 없음 — 필요해지면 로드맵에 별도 항목으로 추가한다.
