"""
정책 간 조건(출발지/목적지/서비스/애플리케이션) 중첩 여부를 판정하는 순수 함수 모음입니다.

`ImpactAnalyzer`(정책 이동 영향분석)와 `insertion_analyzer`(신규 정책 삽입 검증)가
공유합니다. 여기 함수들은 인자로 받은 Policy(또는 그와 동일한 인터페이스를 갖는
가상 정책) 객체만으로 동작하며, 인스턴스 상태나 DB 세션에 의존하지 않습니다.
"""

import ipaddress
from typing import List, Dict, Any, Set, Tuple, Optional


def get_policy_ranges(policy) -> Tuple[Set[Tuple[int, int]], Set[Tuple[int, int]], Set[Tuple[str, int, int]]]:
    """
    정책에서 IP 및 서비스(포트) 범위를 추출합니다.

    - 출발지(source) IP 범위 리스트
    - 목적지(destination) IP 범위 리스트
    - 서비스(프로토콜, 시작 포트, 종료 포트) 리스트
    """
    src_ranges = set()
    dst_ranges = set()
    services = set()

    for member in policy.address_members:
        if member.direction == 'source' and member.ip_start is not None and member.ip_end is not None:
            src_ranges.add((member.ip_start, member.ip_end))
        elif member.direction == 'destination' and member.ip_start is not None and member.ip_end is not None:
            dst_ranges.add((member.ip_start, member.ip_end))

    for member in policy.service_members:
        if member.protocol and member.port_start is not None and member.port_end is not None:
            services.add((member.protocol.lower(), member.port_start, member.port_end))

    return src_ranges, dst_ranges, services


def ranges_overlap(range1: Tuple[int, int], range2: Tuple[int, int]) -> bool:
    """두 수치 범위(IP 또는 Port)가 서로 겹치는지 확인합니다."""
    return not (range1[1] < range2[0] or range2[1] < range1[0])


def services_overlap(svc1: Tuple[str, int, int], svc2: Tuple[str, int, int]) -> bool:
    """
    두 서비스 항목이 서로 겹치는지 확인합니다.
    프로토콜이 동일하거나 어느 한쪽이 'any'이면서 포트 범위가 겹칠 경우 True를 반환합니다.
    """
    if svc1[0] != svc2[0] and svc1[0] != 'any' and svc2[0] != 'any':
        return False
    return ranges_overlap((svc1[1], svc1[2]), (svc2[1], svc2[2]))


def applications_overlap(app1: str, app2: str) -> bool:
    """두 애플리케이션 목록이 서로 겹치는지 확인합니다."""
    if not app1 or app1.lower() == 'any' or app1.strip() == '':
        return True
    if not app2 or app2.lower() == 'any' or app2.strip() == '':
        return True

    apps1 = set(a.strip().lower() for a in app1.split(',') if a.strip())
    apps2 = set(a.strip().lower() for a in app2.split(',') if a.strip())

    return len(apps1 & apps2) > 0


def policies_overlap(policy1, policy2) -> bool:
    """
    두 정책의 조건(출발지, 목적지, 서비스, 애플리케이션)이 모두 중첩되는지 확인합니다.
    모든 조건이 겹칠 때에만 두 정책 간에 영향(Shadowing 등)이 발생할 수 있습니다.
    """
    src1, dst1, svc1 = get_policy_ranges(policy1)
    src2, dst2, svc2 = get_policy_ranges(policy2)

    src_overlap = len(src1) > 0 and len(src2) > 0 and any(
        ranges_overlap(r1, r2) for r1 in src1 for r2 in src2
    )
    dst_overlap = len(dst1) > 0 and len(dst2) > 0 and any(
        ranges_overlap(r1, r2) for r1 in dst1 for r2 in dst2
    )
    svc_overlap = len(svc1) > 0 and len(svc2) > 0 and any(
        services_overlap(s1, s2) for s1 in svc1 for s2 in svc2
    )

    if not src1 or not src2:
        src_overlap = True
    if not dst1 or not dst2:
        dst_overlap = True
    if not svc1 or not svc2:
        svc_overlap = True

    app_overlap = applications_overlap(policy1.application, policy2.application)

    return src_overlap and dst_overlap and svc_overlap and app_overlap


def get_policy_members(policy) -> Tuple[List, List, List]:
    """정책의 출발지/목적지/서비스 멤버 레코드를 방향별로 분류하여 반환합니다 (원본 멤버 객체 유지)."""
    src_members = [m for m in policy.address_members if m.direction == 'source' and m.ip_start is not None and m.ip_end is not None]
    dst_members = [m for m in policy.address_members if m.direction == 'destination' and m.ip_start is not None and m.ip_end is not None]
    svc_members = [m for m in policy.service_members if m.protocol and m.port_start is not None and m.port_end is not None]
    return src_members, dst_members, svc_members


def ranges_overlap_any(ranges1: List[Tuple[int, int]], ranges2: List[Tuple[int, int]]) -> bool:
    """멤버 리스트 중 하나라도 서로 겹치면 True (비어있으면 'any'로 간주)."""
    if not ranges1 or not ranges2:
        return True
    return any(ranges_overlap(r1, r2) for r1 in ranges1 for r2 in ranges2)


def services_overlap_any(svc1: List[Tuple[str, int, int]], svc2: List[Tuple[str, int, int]]) -> bool:
    """서비스 멤버 리스트 중 하나라도 서로 겹치면 True (비어있으면 'any'로 간주)."""
    if not svc1 or not svc2:
        return True
    return any(services_overlap(s1, s2) for s1 in svc1 for s2 in svc2)


def member_ranges_overlap(
    src1: List[Tuple[int, int]], dst1: List[Tuple[int, int]], svc1: List[Tuple[str, int, int]], app1: str,
    policy2,
) -> bool:
    """주어진 (가상의) 출발지/목적지/서비스/애플리케이션 조건이 policy2와 겹치는지 확인합니다."""
    src2_m, dst2_m, svc2_m = get_policy_members(policy2)
    src2 = [(m.ip_start, m.ip_end) for m in src2_m]
    dst2 = [(m.ip_start, m.ip_end) for m in dst2_m]
    svc2 = [(m.protocol.lower(), m.port_start, m.port_end) for m in svc2_m]
    return (
        ranges_overlap_any(src1, src2)
        and ranges_overlap_any(dst1, dst2)
        and services_overlap_any(svc1, svc2)
        and applications_overlap(app1, policy2.application)
    )


def overlap_details(policy1, policy2) -> Dict[str, List[Tuple[Any, Any]]]:
    """
    두 정책 간 실제로 교집합이 발생한 (policy1 멤버, policy2 멤버) 쌍을 카테고리별로 반환합니다.
    차단/Shadow 사유에 구체적인 겹치는 값을 표시하거나, 정책 분리 제안을 계산하는 데 사용됩니다.
    """
    src1_m, dst1_m, svc1_m = get_policy_members(policy1)
    src2_m, dst2_m, svc2_m = get_policy_members(policy2)

    details: Dict[str, List[Tuple[Any, Any]]] = {"src": [], "dst": [], "svc": []}

    for m1 in src1_m:
        for m2 in src2_m:
            if ranges_overlap((m1.ip_start, m1.ip_end), (m2.ip_start, m2.ip_end)):
                details["src"].append((m1, m2))

    for m1 in dst1_m:
        for m2 in dst2_m:
            if ranges_overlap((m1.ip_start, m1.ip_end), (m2.ip_start, m2.ip_end)):
                details["dst"].append((m1, m2))

    for m1 in svc1_m:
        for m2 in svc2_m:
            if services_overlap((m1.protocol.lower(), m1.port_start, m1.port_end), (m2.protocol.lower(), m2.port_start, m2.port_end)):
                details["svc"].append((m1, m2))

    return details


def format_ip_range(start: int, end: int) -> str:
    """IP 정수 범위를 사람이 읽을 수 있는 문자열로 변환합니다 (예: '192.168.1.0~192.168.1.255')."""
    try:
        start_ip = str(ipaddress.IPv4Address(start))
        end_ip = str(ipaddress.IPv4Address(end))
    except (ValueError, ipaddress.AddressValueError):
        return f"{start}-{end}"
    return start_ip if start == end else f"{start_ip}~{end_ip}"


def format_service(member) -> str:
    """서비스 멤버를 사람이 읽을 수 있는 문자열로 변환합니다 (원본 token 우선 사용)."""
    if getattr(member, "token", None):
        return member.token
    if member.protocol and member.protocol.lower() == "any":
        return "any"
    if member.port_start == member.port_end:
        return f"{member.protocol}/{member.port_start}"
    return f"{member.protocol}/{member.port_start}-{member.port_end}"


def describe_overlap(details: Dict[str, List[Tuple[Any, Any]]]) -> str:
    """
    겹치는 구체적인 값을 사람이 읽을 수 있는 문장으로 요약합니다.
    카테고리별로 겹치는 항목을 최대 10건까지 모두 나열합니다 (그 이상은 건수만 표시).
    """
    max_items = 10

    def _values(category: str, formatter) -> List[str]:
        seen = set()
        result = []
        for m1, m2 in details[category]:
            v = formatter(m1, m2)
            if v not in seen:
                seen.add(v)
                result.append(v)
        return result

    def _render(label: str, values: List[str]) -> Optional[str]:
        if not values:
            return None
        shown = values[:max_items]
        extra = f" 외 {len(values) - max_items}건" if len(values) > max_items else ""
        return f"{label} {', '.join(shown)}{extra}"

    def _ip_overlap(m1, m2) -> str:
        return format_ip_range(max(m1.ip_start, m2.ip_start), min(m1.ip_end, m2.ip_end))

    parts = [
        p for p in (
            _render("출발지", _values("src", _ip_overlap)),
            _render("목적지", _values("dst", _ip_overlap)),
            _render("서비스", _values("svc", lambda m1, m2: format_service(m2))),
        ) if p
    ]
    if not parts:
        return "겹치는 조건: 전체 범위(any) 포함"
    return "겹치는 조건 — " + ", ".join(parts)
