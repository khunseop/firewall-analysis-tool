from types import SimpleNamespace

from app.schemas.system_import import DashboardRow
from app.services.system_import.matcher import match_devices


def _dev(id, name, ip, hostname=None, ha_peer_ip=None):
    return SimpleNamespace(id=id, name=name, ip_address=ip, hostname=hostname, ha_peer_ip=ha_peer_ip)


def _row(hostname=None, ip=None, **kw):
    return DashboardRow(hostname=hostname, ip=ip, **kw)


def test_ip_match_has_via_ip():
    result = match_devices([_dev(1, "FW-A", "10.0.0.1")], [_row("fwa", "10.0.0.1")])
    assert [(m.device.id, m.row.hostname, m.via) for m in result.matches] == [(1, "fwa", "ip")]
    assert result.unmatched_devices == [] and result.unmatched_rows == []


def test_ip_comparison_ignores_surrounding_whitespace():
    result = match_devices([_dev(1, "FW-A", " 10.0.0.1 ")], [_row("x", "10.0.0.1  ")])
    assert result.matches[0].via == "ip"


def test_hostname_fallback_matches_fat_name_or_collected_hostname_case_insensitively():
    by_name = match_devices([_dev(1, "Main-FW", "10.0.0.1")], [_row("main-fw", "10.0.0.99")])
    assert [(m.device.id, m.via) for m in by_name.matches] == [(1, "hostname")]
    by_host = match_devices([_dev(1, "Other", "10.0.0.1", hostname="MainFW")], [_row("mainfw", "10.0.0.99")])
    assert [(m.device.id, m.via) for m in by_host.matches] == [(1, "hostname")]


def test_ip_match_wins_over_hostname_and_row_is_not_reused():
    devices = [_dev(1, "FW-A", "10.0.0.1"), _dev(2, "fwa", "10.0.0.2")]
    result = match_devices(devices, [_row("fwa", "10.0.0.1")])
    assert [(m.device.id, m.via) for m in result.matches] == [(1, "ip")]
    assert [d.id for d in result.unmatched_devices] == [2]


def test_two_hostname_candidates_do_not_match_and_warn():
    result = match_devices([_dev(1, "fwa", "10.0.0.1")], [_row("fwa", "10.0.0.8"), _row("FWA", "10.0.0.9")])
    assert result.matches == []
    assert [d.id for d in result.unmatched_devices] == [1]
    assert len(result.warnings) == 1


def test_duplicate_ip_rows_are_not_matched_and_warn():
    result = match_devices([_dev(1, "FW-A", "10.0.0.1")], [_row("a", "10.0.0.1"), _row("b", "10.0.0.1")])
    assert result.matches == []
    assert [d.id for d in result.unmatched_devices] == [1]
    assert result.unmatched_rows == []  # 중복 IP 행은 "대시보드에만 있음"으로 오인되지 않게 경고로만 알린다
    assert len(result.warnings) == 1


def test_rows_without_ip_and_hostname_are_ignored_without_error():
    rows = [_row(None, None), _row("  ", None), _row("  ", "  ")]
    result = match_devices([_dev(1, "FW-A", "10.0.0.1")], rows)
    assert result.matches == [] and result.unmatched_rows == []
    assert [d.id for d in result.unmatched_devices] == [1]


def test_row_with_only_hostname_can_match_by_hostname():
    result = match_devices([_dev(1, "fwa", "10.0.0.1")], [_row("fwa", None)])
    assert [(m.device.id, m.via) for m in result.matches] == [(1, "hostname")]


def test_unmatched_devices_and_rows_are_listed():
    result = match_devices([_dev(1, "FW-A", "10.0.0.1"), _dev(2, "FW-B", "10.0.0.2")],
                           [_row("fwa", "10.0.0.1"), _row("new", "10.0.0.50")])
    assert [d.id for d in result.unmatched_devices] == [2]
    assert [r.hostname for r in result.unmatched_rows] == ["new"]


def test_row_matching_only_ha_peer_ip_is_not_a_match_and_not_unregistered():
    device = _dev(1, "FW-A", "10.0.0.1", ha_peer_ip="10.0.0.2")
    result = match_devices([device], [_row("fwa1", "10.0.0.1"), _row("fwa2", "10.0.0.2")])
    assert [(m.device.id, m.row.hostname) for m in result.matches] == [(1, "fwa1")]
    assert result.unmatched_rows == []
