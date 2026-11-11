from app.schemas.system_import import DashboardRow
from app.services.system_import.ha_pairing import classify_ha


def _rows(*hostnames):
    return [DashboardRow(hostname=h) for h in hostnames]


def test_ps_suffix_pair_is_paired_and_points_to_each_other():
    result = classify_ha(_rows("mainfwp", "mainfws"))
    assert result["mainfwp"].kind == "paired"
    assert result["mainfwp"].partner_hostname == "mainfws"
    assert result["mainfws"].kind == "paired"
    assert result["mainfws"].partner_hostname == "mainfwp"


def test_12_suffix_pair_is_paired():
    result = classify_ha(_rows("dmzfw1", "dmzfw2"))
    assert result["dmzfw1"].kind == "paired"
    assert result["dmzfw2"].partner_hostname == "dmzfw1"


def test_pairing_ignores_case_and_keeps_original_partner_spelling():
    result = classify_ha(_rows("MAINFWP", "mainfws"))
    assert result["mainfwp"].kind == "paired"
    assert result["mainfwp"].partner_hostname == "mainfws"
    assert result["mainfws"].partner_hostname == "MAINFWP"


def test_mixed_rules_are_not_a_pair():
    result = classify_ha(_rows("fwp", "fw2"))
    assert result["fwp"].kind == "orphan"
    assert result["fw2"].kind == "orphan"
    assert result["fwp"].partner_hostname is None


def test_lone_candidate_hostname_is_orphan():
    assert classify_ha(_rows("dmzfw1"))["dmzfw1"].kind == "orphan"


def test_three_rows_with_same_prefix_are_ambiguous():
    result = classify_ha(_rows("edgefwp", "edgefws", "edgefws"))
    assert result["edgefwp"].kind == "ambiguous"
    assert result["edgefws"].kind == "ambiguous"


def test_non_candidate_or_empty_hostnames_are_single():
    result = classify_ha(_rows("core-sw", None, "", "  "))
    assert result["core-sw"].kind == "single"
    assert result[""].kind == "single"


def test_unrelated_prefixes_do_not_pair():
    result = classify_ha(_rows("afw1", "bfw2"))
    assert result["afw1"].kind == "orphan"
    assert result["bfw2"].kind == "orphan"
