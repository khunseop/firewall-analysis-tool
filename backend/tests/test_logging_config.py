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
