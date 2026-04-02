"""
위험 포트 분석에서 사용하는 순수 유틸리티 함수 모음.
클래스 상태에 의존하지 않는 포트 파싱/범위 계산 로직.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.services.normalize import parse_port_numeric

logger = logging.getLogger(__name__)


def parse_service_token(token: str) -> Tuple[Optional[str], Optional[int], Optional[int]]:
    """
    서비스 토큰 문자열을 파싱하여 프로토콜과 숫자형 포트 범위를 추출합니다.
    예: "tcp/80" -> ("tcp", 80, 80), "any" -> ("any", 0, 65535)
    """
    token_lower = token.lower()
    if '/' in token_lower:
        parts = token_lower.split('/', 1)
        protocol = parts[0].strip()
        port_str = parts[1].strip()
        port_start, port_end = parse_port_numeric(port_str)
        return protocol, port_start, port_end
    elif token_lower == 'any':
        return 'any', 0, 65535
    return None, None, None


def split_port_range(
    protocol: str,
    port_start: int,
    port_end: int,
    risky_ports_in_range: List[int],
) -> List[Dict[str, Any]]:
    """
    포트 범위에서 위험 포트들을 제외하고 남은 안전한 구간들을 반환합니다.
    예: 10-20 범위에서 15가 위험 포트인 경우 -> [10-14, 16-20]
    """
    if not risky_ports_in_range:
        return [{"protocol": protocol, "port_start": port_start, "port_end": port_end}]

    risky_ports_sorted = sorted(set(risky_ports_in_range))
    safe_ranges = []
    current_start = port_start

    for risky_port in risky_ports_sorted:
        if risky_port < port_start:
            continue
        if risky_port > port_end:
            break
        if current_start < risky_port:
            safe_ranges.append({
                "protocol": protocol,
                "port_start": current_start,
                "port_end": risky_port - 1,
            })
        current_start = risky_port + 1

    if current_start <= port_end:
        safe_ranges.append({
            "protocol": protocol,
            "port_start": current_start,
            "port_end": port_end,
        })

    return safe_ranges


def calculate_port_range_size(tokens: List[str]) -> int:
    """토큰 리스트의 전체 포트 개수를 계산합니다 (중복 제거 포함)."""
    protocol_ranges: Dict[str, List[Tuple[int, int]]] = {}

    for token in tokens:
        protocol, p_start, p_end = parse_service_token(token)
        if protocol and p_start is not None and p_end is not None:
            protocol_ranges.setdefault(protocol, []).append((p_start, p_end))

    total_size = 0
    for ranges in protocol_ranges.values():
        sorted_ranges = sorted(ranges)
        merged: List[Tuple[int, int]] = []
        for start, end in sorted_ranges:
            if not merged:
                merged.append((start, end))
            else:
                last_start, last_end = merged[-1]
                if start <= last_end + 1:
                    merged[-1] = (last_start, max(last_end, end))
                else:
                    merged.append((start, end))
        for start, end in merged:
            total_size += end - start + 1

    return total_size
