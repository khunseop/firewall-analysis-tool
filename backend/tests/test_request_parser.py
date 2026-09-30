from app.services.deletion_workflow.core.config_manager import ConfigManager
from app.services.deletion_workflow.processors.request_parser import RequestParser

# 아래 정규식은 실제 운영 패턴이 아니라, group 추출 → 필드 매핑 → 타입 코드 변환
# 조립 로직만 검증하기 위한 합성(synthetic) 패턴이다.
_SYNTHETIC_PATTERN = r"^RS(\d+)_(\d{8})_(\d{8})_([^_]+)_([A-Za-z0-9v-]+)(?:_(\d+))?$"


def _parser(pattern: str | None = None) -> RequestParser:
    config_dict = {}
    if pattern is not None:
        config_dict = {
            "policy_processing": {
                "request_parsing": {"gsams_3_pattern": pattern}
            }
        }
    return RequestParser(ConfigManager(config_dict=config_dict))


def test_convert_to_date_valid_format():
    assert _parser().convert_to_date("20240101") == "2024-01-01"


def test_convert_to_date_invalid_format_returns_unchanged():
    assert _parser().convert_to_date("not-a-date") == "not-a-date"


def test_parse_request_info_returns_unknown_default_when_no_patterns_configured():
    result = _parser().parse_request_info("any-rule", "any description")
    assert result["Request Type"] == "Unknown"
    assert result["Request ID"] is None


def test_parse_request_info_returns_default_for_null_description():
    result = _parser().parse_request_info("any-rule", None)
    assert result["Request Type"] == "Unknown"


def test_parse_request_info_extracts_fields_and_maps_type_code():
    parser = _parser(_SYNTHETIC_PATTERN)

    result = parser.parse_request_info("rule-1", "RS100_20240101_20241231_alice_F123_5555")

    assert result["Ruleset ID"] == "100"
    assert result["Start Date"] == "2024-01-01"
    assert result["End Date"] == "2024-12-31"
    assert result["Request User"] == "alice"
    assert result["Request ID"] == "F123"
    assert result["Request Type"] == "GENERAL"
    assert result["MIS ID"] == "5555"


def test_parse_request_info_unknown_type_code_maps_to_unknown():
    parser = _parser(_SYNTHETIC_PATTERN)

    result = parser.parse_request_info("rule-1", "RS100_20240101_20241231_alice_Z999")

    assert result["Request Type"] == "Unknown"


def test_parse_request_info_truncates_after_version_marker():
    parser = _parser(r"^RS(\d+)_(\d{8})_(\d{8})_([^_]+)_([A-Za-z0-9v-]+)(?:_(\d+))?$")

    result = parser.parse_request_info("rule-1", "RS100_20240101_20241231_alice_P1v2-99-88")

    # "v"가 포함된 Request ID는 첫 두 '-' 구간만 남기고 잘린다.
    assert result["Request ID"] == "P1v2-99"
    assert result["Request Type"] == "GROUP"  # type_code "P"
