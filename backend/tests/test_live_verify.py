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


from app.services.policy_builder.live_verify import _apply_create_defaults, _compare_field


def test_create_row_empty_fields_filled_with_defaults():
    # 버그 재현: 신규 정책의 빈 필드는 CLI 생성 시 policy_builder_defaults로 채워져 장비엔 any가
    # 들어가는데, 기대값은 빈값 그대로라 "FAT 빈값 vs 장비 any" 불일치로 오판했다.
    row = {"rule_name": "r1", "source": "", "destination": "10.0.0.1", "user": None, "log_setting": None}
    defaults = {"source": "any", "source_user": "any", "destination": "any", "log_setting": "fwd"}
    expected = _apply_create_defaults(row, defaults)
    assert expected["source"] == "any"
    assert expected["user"] == "any"
    assert expected["destination"] == "10.0.0.1"  # 값이 있으면 기본값을 덮어쓰지 않는다
    assert expected["log_setting"] == "fwd"
    assert expected["category"] == "any"
    assert _compare_field("source", expected["source"], "any")["match"]


def test_multi_value_compare_is_order_insensitive_with_counts():
    result = _compare_field("source", "a,b,c", "c,a,b")
    assert result["match"]
    assert result["expected_count"] == 3 and result["actual_count"] == 3


def test_multi_value_compare_detects_missing_member():
    result = _compare_field("destination", "a,b", "a")
    assert not result["match"]
    assert (result["expected_count"], result["actual_count"]) == (2, 1)


def test_single_value_field_has_no_count():
    result = _compare_field("action", "allow", "allow")
    assert result["match"] and result["expected_count"] is None


from app.services.policy_builder.live_verify import _compare_position


def _planned(*names, deleted=()):
    return [{"rule_name": n, "vsys": "vsys1", "pending_status": "deleted" if n in deleted else None} for n in names]


def test_position_match_when_neighbors_equal():
    planned = _planned("a", "moved", "b", "c", deleted=("c",))
    candidate = [{"rule_name": n, "vsys": "vsys1"} for n in ("a", "moved", "b")]
    result = _compare_position("moved", "vsys1", planned, candidate)
    assert result["match"]
    assert result["expected"] == "이전: a / 다음: b"


def test_position_mismatch_when_move_not_applied():
    planned = _planned("moved", "a", "b")
    candidate = [{"rule_name": n, "vsys": "vsys1"} for n in ("a", "b", "moved")]
    result = _compare_position("moved", "vsys1", planned, candidate)
    assert not result["match"]
    assert result["expected"] == "이전: (맨 위) / 다음: a"
    assert result["actual"] == "이전: b / 다음: (맨 아래)"


def test_position_ignores_other_vsys_and_includes_new_rows_without_vsys():
    planned = _planned("a") + [{"rule_name": "new1", "vsys": None, "pending_status": "new"}] + _planned("b")
    candidate = [{"rule_name": "x", "vsys": "vsys2"}] + [{"rule_name": n, "vsys": "vsys1"} for n in ("a", "new1", "b")]
    assert _compare_position("new1", "vsys1", planned, candidate)["match"]
