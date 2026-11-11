"""FAT 장비와 대시보드 행을 짝짓는다: IP 일치 우선, 없으면 hostname 보조 매칭."""
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Literal, Optional, Sequence

from app.schemas.system_import import DashboardRow


@dataclass
class Match:
    device: Any
    row: DashboardRow
    via: Literal["ip", "hostname"]


@dataclass
class MatchResult:
    matches: list[Match] = field(default_factory=list)
    unmatched_devices: list = field(default_factory=list)
    unmatched_rows: list[DashboardRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _ip(value: Optional[str]) -> str:
    return (value or "").strip()


def _host(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def match_devices(devices: Sequence, rows: Sequence[DashboardRow]) -> MatchResult:
    """장비 기준으로 행을 찾는다. 모호한 경우(같은 IP 행 중복, hostname 후보 다수)는 매칭하지 않고 경고한다."""
    result = MatchResult()
    # ip도 hostname도 없는 행은 아무것도 매칭할 수 없어 처음부터 제외한다
    usable = [i for i, r in enumerate(rows) if _ip(r.ip) or _host(r.hostname)]

    by_ip: dict[str, list[int]] = defaultdict(list)
    by_host: dict[str, list[int]] = defaultdict(list)
    for i in usable:
        if _ip(rows[i].ip):
            by_ip[_ip(rows[i].ip)].append(i)
        if _host(rows[i].hostname):
            by_host[_host(rows[i].hostname)].append(i)

    duplicate_rows: set[int] = set()
    for ip, idxs in by_ip.items():
        if len(idxs) > 1:
            duplicate_rows.update(idxs)
            result.warnings.append(f"대시보드에 같은 IP({ip})가 {len(idxs)}행 있어 매칭하지 않았습니다.")

    used: set[int] = set()
    pending = []
    for device in devices:
        idxs = by_ip.get(_ip(device.ip_address), [])
        if len(idxs) == 1:
            result.matches.append(Match(device, rows[idxs[0]], "ip"))
            used.add(idxs[0])
        else:
            pending.append(device)

    # IP로 못 찾은 장비만 hostname으로 다시 찾는다 (이미 다른 장비가 쓴 행은 제외)
    for device in pending:
        candidates = {
            i for key in {_host(device.name), _host(getattr(device, "hostname", None))} if key
            for i in by_host.get(key, []) if i not in used and i not in duplicate_rows
        }
        if len(candidates) == 1:
            idx = candidates.pop()
            result.matches.append(Match(device, rows[idx], "hostname"))
            used.add(idx)
        else:
            if len(candidates) > 1:
                result.warnings.append(f"장비 '{device.name}'과 hostname이 같은 대시보드 행이 여러 개라 매칭하지 않았습니다.")
            result.unmatched_devices.append(device)

    peer_ips = {_ip(getattr(d, "ha_peer_ip", None)) for d in devices} - {""}
    result.unmatched_rows = [
        rows[i] for i in usable
        if i not in used and i not in duplicate_rows and _ip(rows[i].ip) not in peer_ips
    ]
    return result
