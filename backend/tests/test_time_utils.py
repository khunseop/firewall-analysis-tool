from datetime import datetime

from app.core.time_utils import get_kst_now


def test_get_kst_now_returns_naive_datetime():
    result = get_kst_now()
    assert isinstance(result, datetime)
    assert result.tzinfo is None


def test_get_kst_now_is_close_to_utc_plus_9():
    from datetime import timezone

    result = get_kst_now()
    utc_now = datetime.now(timezone.utc).replace(tzinfo=None)
    # KST = UTC+9. 두 시각의 차이가 9시간에 근접해야 한다 (테스트 실행 지연 감안 오차 허용).
    delta_hours = (result - utc_now).total_seconds() / 3600
    assert 8.9 <= delta_hours <= 9.1
