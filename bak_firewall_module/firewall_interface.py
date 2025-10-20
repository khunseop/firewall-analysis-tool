# firewall/firewall_interface.py
from abc import ABC, abstractmethod
import pandas as pd
from typing import Optional, Dict, Any
import logging

class FirewallInterface(ABC):
    """방화벽 연동을 위한 추상 인터페이스
    
    모든 방화벽 벤더 구현체는 이 인터페이스를 상속받아 구현해야 합니다.
    """
    
    def __init__(self, hostname: str, username: str, password: str):
        """기본 초기화
        
        Args:
            hostname: 방화벽 호스트명 또는 IP 주소
            username: 로그인 사용자명
            password: 로그인 비밀번호
        """
        self.hostname = hostname
        self.username = username
        self._password = password  # 보안을 위해 _ 접두사 사용
        self.logger = logging.getLogger(f"{self.__class__.__module__}.{self.__class__.__name__}")
        self._connected = False
        self._connection_info = {}
    
    def is_connected(self) -> bool:
        """연결 상태 확인
        
        Returns:
            bool: 연결 상태
        """
        return self._connected
    
    def get_connection_info(self) -> Dict[str, Any]:
        """연결 정보 반환 (비밀번호 제외)
        
        Returns:
            Dict[str, Any]: 연결 정보
        """
        return {
            'hostname': self.hostname,
            'username': self.username,
            'connected': self._connected,
            **self._connection_info
        }
    
    @abstractmethod
    def connect(self) -> bool:
        """방화벽 연결
        
        Returns:
            bool: 연결 성공 여부
            
        Raises:
            FirewallConnectionError: 연결 실패 시
            FirewallAuthenticationError: 인증 실패 시
        """
        pass
    
    @abstractmethod
    def disconnect(self) -> bool:
        """방화벽 연결 해제
        
        Returns:
            bool: 연결 해제 성공 여부
        """
        pass
    
    @abstractmethod
    def test_connection(self) -> bool:
        """연결 테스트
        
        Returns:
            bool: 연결 테스트 성공 여부
        """
        pass
    @abstractmethod
    def get_system_info(self) -> pd.DataFrame:
        """시스템 정보를 DataFrame으로 반환합니다."""
        pass

    @abstractmethod
    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        """보안 규칙 데이터를 DataFrame으로 반환합니다."""
        pass

    @abstractmethod
    def export_network_objects(self) -> pd.DataFrame:
        """네트워크 객체 정보를 DataFrame으로 반환합니다.
        Returns:
            pd.DataFrame: Name, Type, Value 컬럼을 가진 DataFrame
        """
        pass

    @abstractmethod
    def export_network_group_objects(self) -> pd.DataFrame:
        """네트워크 그룹 객체 정보를 DataFrame으로 반환합니다.
        Returns:
            pd.DataFrame: Group Name, Entry 컬럼을 가진 DataFrame
        """
        pass

    @abstractmethod
    def export_service_objects(self) -> pd.DataFrame:
        """서비스 객체 정보를 DataFrame으로 반환합니다.
        Returns:
            pd.DataFrame: Name, Protocol, Port 컬럼을 가진 DataFrame
        """
        pass

    @abstractmethod
    def export_service_group_objects(self) -> pd.DataFrame:
        """서비스 그룹 객체 정보를 DataFrame으로 반환합니다.
        Returns:
            pd.DataFrame: Group Name, Entry 컬럼을 가진 DataFrame
        """
        pass

    @abstractmethod
    def export_usage_logs(self, days: Optional[int] = None) -> pd.DataFrame:
        """정책 사용이력을 DataFrame으로 반환합니다.
        Args:
            days: 조회할 기간 (일), None인 경우 전체 기간
        Returns:
            pd.DataFrame: Rule Name, Last Hit Date, Unused Days 컬럼을 가진 DataFrame
        """
        pass