from app.services.policy_builder.live_verify import _normalize_diff_value


def test_enable_true_normalizes_to_Y():
    assert _normalize_diff_value("enable", True) == "Y"


def test_enable_false_normalizes_to_N():
    assert _normalize_diff_value("enable", False) == "N"


def test_enable_already_string_passthrough():
    # candidate_row 쪽은 이미 "Y"/"N" 문자열이라 그대로 통과해야 한다.
    assert _normalize_diff_value("enable", "Y") == "Y"
    assert _normalize_diff_value("enable", "N") == "N"


def test_enable_none_becomes_empty_string():
    assert _normalize_diff_value("enable", None) == ""


def test_non_enable_field_falls_back_to_plain_str():
    assert _normalize_diff_value("action", "allow") == "allow"
    assert _normalize_diff_value("action", None) == ""


def test_true_and_Y_are_now_treated_as_equal_after_normalization():
    # 이 테스트가 실제 버그를 재현·고정한다: 정규화 전에는
    # str(True) == "True" != "Y" 라서 항상 불일치로 오판했다.
    assert _normalize_diff_value("enable", True) == _normalize_diff_value("enable", "Y")
    assert _normalize_diff_value("enable", False) == _normalize_diff_value("enable", "N")
