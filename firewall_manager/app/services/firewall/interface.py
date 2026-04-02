# firewall_manager/app/services/firewall/interface.py
from abc import ABC, abstractmethod
import pandas as pd
from typing import Optional, Dict, Any
import logging

class FirewallInterface(ABC):
    """방화벽 연동을 위한 추상 인터페이스 (Abstract Base Class)

    모든 방화벽 벤더 구현체(Palo Alto, SECUI 등)는 이 인터페이스를 상속받아 
    데이터 수집 로직을 표준화된 방식으로 구현해야 합니다.
    """

    def __init__(self, hostname: str, username: str, password: str):
        """방화벽 접속 정보 초기화

        Args:
            hostname (str): 방화벽 호스트명 또는 IP 주소
            username (str): API/SSH 접속 사용자명
            password (str): API/SSH 접속 비밀번호
        """
        self.hostname = hostname
        self.username = username
        self._password = password  # 보안을 위해 내부 변수로 관리
        self.logger = logging.getLogger(f"{self.__class__.__module__}.{self.__class__.__name__}")
        self._connected = False
        self._connection_info = {}

    def is_connected(self) -> bool:
        """현재 방화벽과의 세션 연결 상태를 확인합니다.

        Returns:
            bool: 연결되어 있으면 True, 아니면 False
        """
        return self._connected

    def get_connection_info(self) -> Dict[str, Any]:
        """방화벽 연결 관련 메타데이터를 반환합니다. (보안을 위해 비밀번호는 제외)

        Returns:
            Dict[str, Any]: hostname, username, connected 상태 등을 포함한 딕셔너리
        """
        return {
            'hostname': self.hostname,
            'username': self.username,
            'connected': self._connected,
            **self._connection_info
        }

    @abstractmethod
    def connect(self) -> bool:
        """방화벽 장비에 연결하거나 세션을 생성합니다.

        Returns:
            bool: 연결 성공 여부

        Raises:
            FirewallConnectionError: 네트워크 오류 등으로 연결 불가 시
            FirewallAuthenticationError: 인증 실패 시
        """
        pass

    @abstractmethod
    def disconnect(self) -> bool:
        """방화벽 세션을 종료하고 리소스를 해제합니다.

        Returns:
            bool: 해제 성공 여부
        """
        pass

    @abstractmethod
    def test_connection(self) -> bool:
        """설정된 정보로 실제 장비에 접속이 가능한지 간단히 테스트합니다.

        Returns:
            bool: 접속 가능 여부
        """
        pass

    @abstractmethod
    def get_system_info(self) -> pd.DataFrame:
        """방화벽의 시스템 정보(모델명, OS 버전, 일련번호 등)를 조회합니다.

        Returns:
            pd.DataFrame: 'hostname', 'model', 'sw_version', 'serial' 등의 컬럼을 포함
        """
        pass

    @abstractmethod
    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        """방화벽의 보안 정책(Security Rules) 목록을 수집합니다.

        Returns:
            pd.DataFrame: 'rule_name', 'source', 'destination', 'service', 'action' 등 
                         DB 모델(Policy)과 매핑되는 표준 컬럼 구성
        """
        pass

    @abstractmethod
    def export_network_objects(self) -> pd.DataFrame:
        """방화벽에 정의된 네트워크 주소 객체(Address Objects) 정보를 수집합니다.

        Returns:
            pd.DataFrame: 
                - name: 객체명
                - type: 객체 타입 (ip-netmask, ip-range, fqdn 등)
                - ip_address: 실제 IP 주소 또는 범위 문자열
        """
        pass

    @abstractmethod
    def export_network_group_objects(self) -> pd.DataFrame:
        """방화벽에 정의된 네트워크 주소 그룹(Address Groups) 정보를 수집합니다.

        Returns:
            pd.DataFrame:
                - name: 그룹 객체명
                - members: 그룹 멤버 리스트 (쉼표로 구분된 문자열)
        """
        pass

    @abstractmethod
    def export_service_objects(self) -> pd.DataFrame:
        """방화벽에 정의된 서비스/포트 객체(Service Objects) 정보를 수집합니다.

        Returns:
            pd.DataFrame:
                - name: 객체명
                - protocol: 프로토콜 (tcp, udp 등)
                - port: 포트 번호 또는 범위
        """
        pass

    @abstractmethod
    def export_service_group_objects(self) -> pd.DataFrame:
        """방화벽에 정의된 서비스 그룹(Service Groups) 정보를 수집합니다.

        Returns:
            pd.DataFrame:
                - name: 그룹 객체명
                - members: 그룹 멤버 리스트 (쉼표로 구분된 문자열)
        """
        pass

    def export_last_hit_date(self, vsys: Optional[list[str] | set[str]] = None) -> pd.DataFrame:
        """정책별 최근 매칭(Hit) 일자 정보를 수집합니다.

        Args:
            vsys (Optional[list[str] | set[str]]): 특정 가상 시스템(Virtual System)만 필터링할 경우 지정

        Returns:
            pd.DataFrame: 'vsys', 'rule_name', 'last_hit_date' 컬럼 포함

        Note:
            모든 벤더가 지원하지는 않으며, 기본적으로 NotImplementedError를 발생시킵니다.
            지원하는 벤더(예: Palo Alto)에서만 오버라이딩하여 구현합니다.
        """
        raise NotImplementedError("export_last_hit_date는 해당 벤더에서 지원하지 않습니다.")
