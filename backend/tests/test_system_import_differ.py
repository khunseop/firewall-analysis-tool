from datetime import date
from types import SimpleNamespace

from app.schemas.system_import import DashboardRow
from app.services.system_import.differ import build_diff
from app.services.system_import.ha_pairing import HaInfo
from app.services.system_import.matcher import Match

_DEVICE_DEFAULTS = dict(
    id=1, name="FW-A", ip_address="10.0.0.1", vendor="paloalto", hostname=None, ha_peer_ip=None,
    model=None, serial_number=None, os_name=None, os_version=None, install_date=None, description=None,
    location_region=None, location_building=None, location_floor=None, location_room=None,
    location_x=None, location_y=None, location_z=None,
    hostname_manual=False, model_manual=False, serial_number_manual=False, os_version_manual=False,
)


def _dev(**kw):
    return SimpleNamespace(**{**_DEVICE_DEFAULTS, **kw})


def _row(**kw):
    return DashboardRow(**{"hostname": "fwa", "ip": "10.0.0.1", "vendor": "Paloalto", **kw})


def _diff(device, row, via="ip", ha=None, partner=None):
    return build_diff(Match(device, row, via), ha, partner)


def _changes(diff):
    return {c.field: c for c in diff.changes}


def test_hostname_difference_is_override_and_sets_manual_flag():
    c = _changes(_diff(_dev(hostname="old-name"), _row(hostname="fwa"))).get("hostname")
    assert (c.kind, c.old, c.new, c.set_manual) == ("override", "old-name", "fwa", True)


def test_ip_and_vendor_differences_are_connection_changes():
    diff = _diff(_dev(ip_address="10.0.0.9", vendor="mf2"), _row(ip="10.0.0.1", vendor="Paloalto"), via="hostname")
    changes = _changes(diff)
    assert (changes["ip_address"].kind, changes["ip_address"].old, changes["ip_address"].new) == ("connection", "10.0.0.9", "10.0.0.1")
    assert (changes["vendor"].kind, changes["vendor"].old, changes["vendor"].new) == ("connection", "mf2", "paloalto")


def test_unmapped_dashboard_vendor_never_changes_vendor():
    assert "vendor" not in _changes(_diff(_dev(), _row(vendor="Fortinet")))


def test_empty_fat_field_is_filled_without_touching_manual_flag():
    c = _changes(_diff(_dev(model=None), _row(model="PA-3220")))["model"]
    assert (c.kind, c.old, c.new, c.set_manual) == ("fill", None, "PA-3220", None)


def test_existing_fat_value_is_kept_and_reported_as_mismatch():
    diff = _diff(_dev(model="PA-5220"), _row(model="PA-3220"))
    assert "model" not in _changes(diff)
    assert [(m.field, m.fat_value, m.dashboard_value) for m in diff.mismatches] == [("model", "PA-5220", "PA-3220")]


def test_manual_flagged_empty_field_is_not_filled():
    assert "model" not in _changes(_diff(_dev(model=None, model_manual=True), _row(model="PA-3220")))


def test_blank_dashboard_values_never_change_or_clear_fat_values():
    diff = _diff(_dev(model="PA-5220", serial_number="S1", hostname="keep"), _row(model="  ", serial=None, hostname=" "))
    assert diff.changes == [] and diff.mismatches == []


def test_matching_values_produce_no_change_even_with_whitespace():
    diff = _diff(_dev(hostname="fwa", model="PA-3220"), _row(hostname=" fwa ", model="PA-3220 "))
    assert diff.changes == [] and diff.mismatches == []


def test_install_date_comes_from_os_install_date_and_accepts_common_separators():
    assert _changes(_diff(_dev(), _row(os_install_date="2023-05-01")))["install_date"].new == "2023-05-01"
    assert _changes(_diff(_dev(), _row(os_install_date="2023.5.1 00:00:00")))["install_date"].new == "2023-05-01"


def test_unparseable_install_date_is_not_proposed():
    diff = _diff(_dev(), _row(os_install_date="올해 초"))
    assert "install_date" not in _changes(diff) and diff.mismatches == []


def test_existing_install_date_is_compared_as_iso_text():
    diff = _diff(_dev(install_date=date(2022, 1, 1)), _row(os_install_date="2023-05-01"))
    assert [(m.field, m.fat_value, m.dashboard_value) for m in diff.mismatches] == [("install_date", "2022-01-01", "2023-05-01")]


def test_description_is_filled_from_task_name_only_when_empty():
    assert _changes(_diff(_dev(), _row(task_name="본사 인터넷 방화벽")))["description"].new == "본사 인터넷 방화벽"
    assert "description" not in _changes(_diff(_dev(description="직접 입력"), _row(task_name="본사 인터넷 방화벽")))


def test_location_fields_are_filled_from_dashboard_columns():
    changes = _changes(_diff(_dev(), _row(region="서울", building="A동", floor="3F", room="R1", coord_x="1", coord_y="2", coord_z="U10")))
    assert {f: changes[f].new for f in ("location_region", "location_building", "location_floor", "location_room",
                                        "location_x", "location_y", "location_z")} == {
        "location_region": "서울", "location_building": "A동", "location_floor": "3F", "location_room": "R1",
        "location_x": "1", "location_y": "2", "location_z": "U10"}


def test_paired_fills_empty_ha_peer_ip_from_partner_row():
    ha = HaInfo("paired", "fwb")
    diff = _diff(_dev(), _row(), ha=ha, partner=_row(hostname="fwb", ip="10.0.0.2"))
    c = _changes(diff)["ha_peer_ip"]
    # ha_peer_ip는 동기화가 실제로 접속하는 대상이라 연결 정보로 취급한다
    assert (c.kind, c.old, c.new) == ("connection", None, "10.0.0.2")
    assert diff.partner_hostname == "fwb"


def test_paired_with_different_ha_peer_ip_is_mismatch():
    ha = HaInfo("paired", "fwb")
    diff = _diff(_dev(ha_peer_ip="10.0.0.9"), _row(), ha=ha, partner=_row(hostname="fwb", ip="10.0.0.2"))
    assert "ha_peer_ip" not in _changes(diff)
    assert [(m.field, m.fat_value, m.dashboard_value) for m in diff.mismatches] == [("ha_peer_ip", "10.0.0.9", "10.0.0.2")]


def test_fat_ha_peer_with_single_dashboard_row_is_mismatch():
    diff = _diff(_dev(ha_peer_ip="10.0.0.2"), _row(), ha=HaInfo("single"))
    assert [(m.field, m.dashboard_value) for m in diff.mismatches] == [("ha_peer_ip", "(단독 장비)")]


def test_dashboard_retired_flag_and_metadata():
    diff = _diff(_dev(), _row(status="폐기 예정"), via="hostname")
    assert diff.dashboard_retired is True and diff.via == "hostname"
    assert (diff.device_id, diff.device_name) == (1, "FW-A")
    assert _diff(_dev(), _row(status="운영")).dashboard_retired is False


def test_malformed_ip_cells_are_not_proposed_and_are_reported_as_mismatch():
    diff = _diff(_dev(ip_address="10.0.0.3"), _row(ip="10.0.0.33\n10.0.0.34"), via="hostname")
    assert "ip_address" not in _changes(diff)
    assert [(m.field, m.fat_value) for m in diff.mismatches] == [("ip_address", "10.0.0.3")]


def test_malformed_partner_ip_is_not_proposed_as_ha_peer():
    diff = _diff(_dev(), _row(), ha=HaInfo("paired", "fwb"), partner=_row(hostname="fwb", ip="not an ip"))
    assert "ha_peer_ip" not in _changes(diff)
    assert [m.field for m in diff.mismatches] == ["ha_peer_ip"]


def test_secui_row_without_model_does_not_flip_registered_ngf_device_to_mf2():
    assert "vendor" not in _changes(_diff(_dev(vendor="ngf"), _row(vendor="SECUI", model=None)))
    assert "vendor" not in _changes(_diff(_dev(vendor="mf2"), _row(vendor="SECUI", model="  ")))
    # 다른 벤더로 등록된 장비는 여전히 mf2로 제안한다(연결 정보로 확인을 거침)
    assert _changes(_diff(_dev(vendor="mock"), _row(vendor="SECUI", model=None)))["vendor"].new == "mf2"
