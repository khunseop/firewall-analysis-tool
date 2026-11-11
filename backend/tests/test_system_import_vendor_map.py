import pytest

from app.services.system_import.vendor_map import map_vendor


@pytest.mark.parametrize("vendor, model", [
    ("Palo Alto ", None),
    ("PALOALTO", "PA-3220"),
    ("paloalto", None),
    ("Palo-Alto", "PA-850"),
])
def test_map_vendor_paloalto_ignores_spacing_and_case(vendor, model):
    assert map_vendor(vendor, model) == "paloalto"


@pytest.mark.parametrize("vendor, model", [
    ("SECUI", "NGF-5000"),
    ("secui", "secui-NGF"),
    (" SECUI ", "ngf1000"),
])
def test_map_vendor_secui_with_ngf_in_model_is_ngf(vendor, model):
    assert map_vendor(vendor, model) == "ngf"


@pytest.mark.parametrize("vendor, model", [
    ("SECUI", "MF2-1000"),
    ("SECUI", None),
    ("SECUI", ""),
])
def test_map_vendor_secui_without_ngf_is_mf2(vendor, model):
    assert map_vendor(vendor, model) == "mf2"


@pytest.mark.parametrize("vendor, model", [
    ("Fortinet", "x"),
    (None, "x"),
    ("", "x"),
    ("   ", "x"),
])
def test_map_vendor_other_vendors_are_excluded(vendor, model):
    assert map_vendor(vendor, model) is None
