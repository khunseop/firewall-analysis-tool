import logging

import pytest

from app.core.logging_config import (
    setup_logging,
    _FILE_HANDLER_NAME,
    _CONSOLE_HANDLER_NAME,
)

_UVICORN_LOGGER_NAMES = ("uvicorn", "uvicorn.access")
_ALL_LOGGER_NAMES_FOR_CLEANUP = ("uvicorn", "uvicorn.error", "uvicorn.access")


def _count_named(handlers, name):
    return sum(1 for h in handlers if h.name == name)


@pytest.fixture(autouse=True)
def _cleanup_logging_handlers():
    loggers = [logging.getLogger()] + [logging.getLogger(n) for n in _ALL_LOGGER_NAMES_FOR_CLEANUP]
    original_propagate = {lg.name: lg.propagate for lg in loggers}
    yield
    for lg in loggers:
        for h in lg.handlers[:]:
            if h.name in (_FILE_HANDLER_NAME, _CONSOLE_HANDLER_NAME):
                lg.removeHandler(h)
                h.close()
        lg.propagate = original_propagate[lg.name]


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


def test_uvicorn_error_logs_are_not_written_twice(tmp_path):
    """uvicorn.error는 propagate=True라 uvicorn 로거로 전파된다.

    uvicorn.error에도 파일 핸들러를 직접 붙이면 전파된 레코드가 두 번
    기록되는 회귀가 있었다 — 이 테스트는 그 회귀를 잡기 위한 것이다.
    """
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)

    assert _count_named(logging.getLogger("uvicorn.error").handlers, _FILE_HANDLER_NAME) == 0

    logging.getLogger("uvicorn.error").info("uvicorn error marker line")
    for handler in logging.getLogger("uvicorn").handlers:
        handler.flush()

    log_file = log_dir / "backend.log"
    lines = log_file.read_text(encoding="utf-8").splitlines()
    matching = [line for line in lines if "uvicorn error marker line" in line]
    assert len(matching) == 1
