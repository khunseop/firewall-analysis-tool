from app.core.rate_limit import LoginRateLimiter


def _fake_clock():
    """테스트에서 시간을 직접 흘려보내기 위한 조작 가능한 클럭."""
    state = {"t": 0.0}

    def now() -> float:
        return state["t"]

    def advance(seconds: float) -> None:
        state["t"] += seconds

    now.advance = advance  # type: ignore[attr-defined]
    return now


def _make_limiter(max_attempts=3, window_seconds=100.0, lockout_seconds=50.0):
    clock = _fake_clock()
    limiter = LoginRateLimiter(
        max_attempts=max_attempts,
        window_seconds=window_seconds,
        lockout_seconds=lockout_seconds,
        clock=clock,
    )
    return limiter, clock


def test_not_locked_before_reaching_max_attempts():
    limiter, _ = _make_limiter(max_attempts=3)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is False


def test_locked_after_reaching_max_attempts():
    limiter, _ = _make_limiter(max_attempts=3)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is True


def test_unlocked_after_lockout_period_elapses():
    limiter, clock = _make_limiter(max_attempts=3, lockout_seconds=50.0)
    for _ in range(3):
        limiter.record_failure("alice")
    assert limiter.is_locked("alice") is True
    clock.advance(51.0)
    assert limiter.is_locked("alice") is False


def test_success_resets_attempt_count():
    limiter, _ = _make_limiter(max_attempts=3)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    limiter.record_success("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is False


def test_attempts_outside_window_are_not_counted():
    limiter, clock = _make_limiter(max_attempts=3, window_seconds=100.0)
    limiter.record_failure("alice")
    clock.advance(101.0)
    limiter.record_failure("alice")
    limiter.record_failure("alice")
    assert limiter.is_locked("alice") is False


def test_keys_are_independent():
    limiter, _ = _make_limiter(max_attempts=3)
    for _ in range(3):
        limiter.record_failure("alice")
    assert limiter.is_locked("alice") is True
    assert limiter.is_locked("bob") is False
