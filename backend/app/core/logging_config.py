"""백엔드 로그를 콘솔 + 로테이팅 파일에 동시에 남기기 위한 중앙 설정.

uvicorn은 ``uvicorn``/``uvicorn.access`` 로거에 ``propagate=False``로 자기
핸들러만 붙여두므로, 루트 로거에만 파일 핸들러를 달아서는 요청 로그가 파일에
남지 않는다. 그래서 이 두 로거에도 같은 파일 핸들러를 직접 추가로 붙인다
(콘솔 핸들러는 uvicorn이 이미 갖고 있으므로 중복 출력을 피하기 위해 파일
핸들러만 추가한다).

``uvicorn.error``는 여기 포함하지 않는다 — 이 로거는 uvicorn 기본 설정상
``propagate=True``라 부모인 ``uvicorn`` 로거로 레코드가 그대로 전파된다.
``uvicorn.error``에도 같은 파일 핸들러를 붙이면 전파된 레코드가 ``uvicorn``의
핸들러와 ``uvicorn.error``의 핸들러 양쪽에서 각각 한 번씩, 총 두 번 파일에
쓰여 로그가 중복된다.

``uvicorn``/``uvicorn.access``의 ``propagate``는 uvicorn이 실제 서버를
띄울 때 자체 설정(dictConfig)으로 ``False``로 맞춰주지만, 그 설정이 이
함수보다 먼저 실행된다는 보장에 기대지 않기 위해 여기서도 명시적으로
``False``로 고정한다 — 그렇지 않으면 (uvicorn 설정이 아직 안 된 상태에서
호출되는 테스트 등에서) 루트 로거로 다시 전파되어 같은 핸들러가 두 번
불리는 중복이 생긴다.
"""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
LOG_DIR = PROJECT_ROOT / "logs"
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(name)s - %(message)s"

_FILE_HANDLER_NAME = "fat-file"
_CONSOLE_HANDLER_NAME = "fat-console"
_UVICORN_LOGGER_NAMES = ("uvicorn", "uvicorn.access")


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
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.propagate = False
        _replace_named_handler(uvicorn_logger, file_handler)
