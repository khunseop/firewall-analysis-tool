import logging
from typing import Optional

logger = logging.getLogger(__name__)


class RiskyPortDefinition:
    """
    위험 포트 정의(예: tcp/80, udp/10-20)를 관리하고 매칭 여부를 확인하는 클래스입니다.
    """

    def __init__(self, definition: str):
        """
        위험 포트 문자열을 파싱하여 프로토콜과 포트 범위를 추출합니다.
        """
        self.definition = definition.strip()
        self.protocol = None
        self.port_start = None
        self.port_end = None

        if '/' in self.definition:
            parts = self.definition.split('/', 1)
            self.protocol = parts[0].strip().lower()
            port_str = parts[1].strip()

            if '-' in port_str:
                port_parts = port_str.split('-', 1)
                try:
                    self.port_start = int(port_parts[0].strip())
                    self.port_end = int(port_parts[1].strip())
                except ValueError:
                    logger.warning(f"Invalid port range format: {port_str}")
            else:
                try:
                    port = int(port_str)
                    self.port_start = port
                    self.port_end = port
                except ValueError:
                    logger.warning(f"Invalid port format: {port_str}")

    def matches(self, protocol: Optional[str], port_start: Optional[int], port_end: Optional[int]) -> bool:
        """
        주어진 프로토콜 및 포트 범위가 정의된 위험 포트와 겹치는지 확인합니다.

        매칭 조건:
        1. 프로토콜이 일치해야 함.
        2. 분석 대상 포트 범위와 위험 포트 범위 사이에 교집합이 존재해야 함.
        """
        if not protocol or port_start is None or port_end is None:
            return False

        if self.protocol != protocol.lower():
            return False

        # (Start1 <= End2) AND (End1 >= Start2) 조건을 만족하면 겹침
        return not (port_end < self.port_start or port_start > self.port_end)

    def __repr__(self):
        return f"RiskyPortDefinition({self.definition})"
