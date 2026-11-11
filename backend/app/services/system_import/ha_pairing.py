"""hostname 끝 글자 규칙으로 HA 쌍을 판정한다 (p/s 또는 1/2, 앞부분 동일)."""
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal, Optional, Sequence

from app.schemas.system_import import DashboardRow

# 허용되는 쌍: 마지막 글자 집합이 정확히 이 중 하나여야 한다
_PAIR_SUFFIXES = (frozenset("ps"), frozenset("12"))
_CANDIDATE_SUFFIXES = frozenset("ps12")


@dataclass(frozen=True)
class HaInfo:
    kind: Literal["single", "paired", "orphan", "ambiguous"]
    partner_hostname: Optional[str] = None


def _norm(hostname: Optional[str]) -> str:
    return (hostname or "").strip().lower()


def classify_ha(rows: Sequence[DashboardRow]) -> dict[str, HaInfo]:
    """행들을 hostname(소문자·공백 제거)으로 분류한다. 키는 `hostname.strip().lower()`."""
    result: dict[str, HaInfo] = {}
    groups: dict[str, list[str]] = defaultdict(list)  # 앞부분 → 원래 표기의 hostname들
    for row in rows:
        name = (row.hostname or "").strip()
        key = _norm(name)
        if len(key) < 2 or key[-1] not in _CANDIDATE_SUFFIXES:
            result[key] = HaInfo("single")
        else:
            groups[key[:-1]].append(name)

    for names in groups.values():
        suffixes = {_norm(n)[-1] for n in names}
        if len(names) >= 3:
            kind: Literal["paired", "orphan", "ambiguous"] = "ambiguous"
        elif len(names) == 2 and suffixes in _PAIR_SUFFIXES:
            kind = "paired"
        else:
            kind = "orphan"  # 혼합 규칙이거나 짝이 없음
        for name in names:
            partner = None
            if kind == "paired":
                partner = next(n for n in names if _norm(n) != _norm(name))
            result[_norm(name)] = HaInfo(kind, partner)
    return result
