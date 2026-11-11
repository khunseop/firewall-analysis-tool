"""대시보드 벤더 표기 → FAT `vendor` 코드 변환."""
from typing import Optional


def _key(value: Optional[str]) -> str:
    """비교용 키: 소문자로 바꾸고 공백·`-`·`_`를 제거한다."""
    return "".join(ch for ch in (value or "").lower() if ch not in " -_\t")


def map_vendor(vendor: Optional[str], model: Optional[str]) -> Optional[str]:
    """Paloalto→paloalto, SECUI(모델명에 ngf 포함)→ngf, 그 외 SECUI→mf2, 나머지는 제외(None)."""
    vendor_key = _key(vendor)
    if vendor_key == "paloalto":
        return "paloalto"
    if vendor_key == "secui":
        return "ngf" if "ngf" in _key(model) else "mf2"
    return None
