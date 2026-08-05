"""
정책 1건의 source/destination/service 문자열을 검색용 멤버 행(주소/서비스 범위)으로
변환하는 순수 로직. `app.services.policy_indexer.rebuild_policy_indices`(동기화 파이프라인)와
`policy_builder`의 가상 정책 삽입 분석이 공유합니다.
"""

from ipaddress import ip_network, ip_address, IPv4Address, IPv4Network
from typing import Dict, List, Optional, Set, Tuple

from app.services.normalize import parse_port_numeric

GROUP_MARKER_PREFIX = "__GROUP__:"


def _ip_str_to_numeric_range(ip_str: str) -> Optional[Tuple[int, int]]:
    """
    단일 IP, CIDR 또는 범위 문자열을 숫자형 시작-끝 튜플로 변환합니다.

    Args:
        ip_str: 변환할 IP 문자열 (예: '1.1.1.1', '1.1.1.0/24', '1.1.1.1-1.1.1.5')

    Returns:
        (시작_IP_숫자, 끝_IP_숫자) 형태의 튜플, 변환 실패 시 None
    """
    try:
        if '-' in ip_str:
            start_str, end_str = ip_str.split('-', 1)
            start_addr = ip_address(start_str.strip())
            end_addr = ip_address(end_str.strip())
            if not (isinstance(start_addr, IPv4Address) and isinstance(end_addr, IPv4Address)):
                return None
            return min(int(start_addr), int(end_addr)), max(int(start_addr), int(end_addr))
        elif '/' in ip_str:
            net = ip_network(ip_str, strict=False)
            if not isinstance(net, IPv4Network):
                return None
            return int(net.network_address), int(net.broadcast_address)
        else:
            addr = ip_address(ip_str.strip())
            if not isinstance(addr, IPv4Address):
                return None
            n = int(addr)
            return n, n
    except ValueError:
        return None


def merge_ip_ranges(ip_strings: Set[str]) -> List[Tuple[int, int]]:
    """
    IP 관련 문자열 집합을 최소한의 연속된 숫자 범위 리스트로 병합합니다.
    이 알고리즘은 중복되거나 인접한 IP 범위를 하나로 합쳐 인덱스 크기를 줄입니다.

    Args:
        ip_strings: IP 주소, CIDR, 범위 문자열 집합

    Returns:
        병합된 (시작_IP_숫자, 끝_IP_숫자) 튜플의 리스트
    """
    if not ip_strings:
        return []

    ranges = []
    for s in ip_strings:
        r = _ip_str_to_numeric_range(s)
        if r:
            ranges.append(r)

    if not ranges:
        return []

    ranges.sort(key=lambda x: x[0])

    merged = []
    current_start, current_end = ranges[0]

    for i in range(1, len(ranges)):
        next_start, next_end = ranges[i]
        if next_start <= current_end + 1:
            current_end = max(current_end, next_end)
        else:
            merged.append((current_start, current_end))
            current_start, current_end = next_start, next_end

    merged.append((current_start, current_end))

    return merged


def compute_policy_member_rows(
    source: str,
    destination: str,
    service: str,
    resolved_address_map: Dict[str, Set[str]],
    resolved_service_map: Dict[str, Set[str]],
    port_cache: Optional[Dict[str, Tuple[Optional[int], Optional[int]]]] = None,
) -> Tuple[List[dict], List[dict]]:
    """
    정책 1건의 source/destination/service 문자열을 주소/서비스 멤버 행으로 변환합니다.

    반환되는 dict에는 device_id/policy_id가 없습니다 — 실제 DB 저장용으로 쓸 때는
    호출자가 그 두 필드를 채워 넣고, 가상(미저장) 정책 분석에서는 그대로 사용합니다.

    Args:
        port_cache: 여러 정책에 걸쳐 포트 파싱 결과를 재사용하기 위한 캐시(선택).
                    넘기지 않으면 이 호출 범위에서만 쓰이는 캐시를 새로 만듭니다.
    """
    if port_cache is None:
        port_cache = {}

    src_members: Set[str] = set()
    for name in [s.strip() for s in (source or "").split(',') if s.strip()]:
        src_members.update(resolved_address_map.get(name, {name}))

    dst_members: Set[str] = set()
    for name in [s.strip() for s in (destination or "").split(',') if s.strip()]:
        dst_members.update(resolved_address_map.get(name, {name}))

    svc_members: Set[str] = set()
    for name in [s.strip() for s in (service or "").split(',') if s.strip()]:
        svc_members.update(resolved_service_map.get(name, {name}))

    addr_rows: List[dict] = []
    svc_rows: List[dict] = []

    for direction, members in [('source', src_members), ('destination', dst_members)]:
        ip_members = {m for m in members if not m.startswith(GROUP_MARKER_PREFIX)}
        group_markers = {m for m in members if m.startswith(GROUP_MARKER_PREFIX)}

        merged_ranges = merge_ip_ranges(ip_members)
        for start_ip, end_ip in merged_ranges:
            addr_rows.append({
                "direction": direction,
                "token_type": 'ipv4_range',
                "ip_start": start_ip, "ip_end": end_ip,
            })

        for marker in group_markers:
            group_name = marker.replace(GROUP_MARKER_PREFIX, "", 1)
            addr_rows.append({
                "direction": direction,
                "token": group_name,
                "token_type": 'unknown',
                "ip_start": None, "ip_end": None,
            })

    for token in filter(None, svc_members):
        if token.startswith(GROUP_MARKER_PREFIX):
            group_name = token.replace(GROUP_MARKER_PREFIX, "", 1)
            svc_rows.append({
                "token": group_name,
                "token_type": 'unknown',
                "protocol": None, "port_start": None, "port_end": None,
            })
            continue

        token_lower = token.lower()
        if '/' in token_lower:
            proto, port_str = token_lower.split('/', 1)
        else:
            proto, port_str = ('any' if token_lower == 'any' else None), token_lower

        if port_str in port_cache:
            start, end = port_cache[port_str]
        else:
            start, end = parse_port_numeric(port_str)
            port_cache[port_str] = (start, end)

        if start is None or end is None:
            continue

        svc_rows.append({
            "token": token,
            "token_type": 'proto_port',
            "protocol": proto, "port_start": start, "port_end": end,
        })

    return addr_rows, svc_rows
