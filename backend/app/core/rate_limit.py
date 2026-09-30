"""로그인 무차별 대입 방지용 in-memory rate limiter.

단일 uvicorn 프로세스를 전제로 한다 (워커를 여러 개로 늘리면 프로세스별로
카운터가 분리되어 효과가 줄어든다 — 현재 배포 방식(단일 프로세스)에서는 문제 없음).
"""
import time
from collections import defaultdict
from threading import Lock
from typing import Callable


class LoginRateLimiter:
    def __init__(
        self,
        max_attempts: int = 5,
        window_seconds: float = 15 * 60,
        lockout_seconds: float = 15 * 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_attempts = max_attempts
        self._window_seconds = window_seconds
        self._lockout_seconds = lockout_seconds
        self._clock = clock
        self._lock = Lock()
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._locked_until: dict[str, float] = {}

    def is_locked(self, key: str) -> bool:
        with self._lock:
            until = self._locked_until.get(key)
            if until is None:
                return False
            if self._clock() >= until:
                del self._locked_until[key]
                self._attempts.pop(key, None)
                return False
            return True

    def record_failure(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            window_start = now - self._window_seconds
            attempts = [t for t in self._attempts[key] if t >= window_start]
            attempts.append(now)
            self._attempts[key] = attempts
            if len(attempts) >= self._max_attempts:
                self._locked_until[key] = now + self._lockout_seconds

    def record_success(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)
            self._locked_until.pop(key, None)


login_rate_limiter = LoginRateLimiter()
