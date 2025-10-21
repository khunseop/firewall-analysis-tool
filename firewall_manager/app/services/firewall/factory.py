# firewall_manager/app/services/firewall/factory.py
from typing import Dict, Any
import logging
from .interface import FirewallInterface
from .vendors.paloalto import PaloAltoAPI
from .vendors.mf2 import MF2Collector
from .vendors.ngf import NGFCollector
from .vendors.mock import MockCollector
from .exceptions import FirewallUnsupportedError

class FirewallCollectorFactory:
    """방화벽 Collector 인스턴스를 생성하는 팩토리 클래스

    지원되는 방화벽 벤더:
    - paloalto: PaloAlto Networks 방화벽
    - mf2: SECUI MF2 방화벽
    - ngf: SECUI NGF 방화벽
    - mock: 테스트용 가상 방화벽
    """
    REQUIRED_PARAMS: Dict[str, list] = {
        'paloalto': ['hostname', 'username', 'password'],
        'mf2': ['hostname', 'username', 'password'],
        'ngf': ['hostname', 'username', 'password'],
        'mock': ['hostname', 'username', 'password']
    }

    @staticmethod
    def get_collector(source_type: str, **kwargs) -> FirewallInterface:
        """방화벽 타입에 따른 Collector 객체를 생성하여 반환합니다.

        Args:
            source_type (str): 방화벽 타입 ('paloalto', 'mf2', 'ngf', 'mock' 중 하나)
            **kwargs: 방화벽 인증에 필요한 파라미터
                - hostname: 장비 호스트명 또는 IP 주소
                - username: 접속 계정
                - password: 접속 비밀번호
                - timeout: 연결 타임아웃 (선택사항, 기본값: 30초)

        Returns:
            FirewallInterface: 방화벽 타입에 맞는 Collector 객체

        Raises:
            FirewallConfigurationError: 잘못된 설정값인 경우
            FirewallUnsupportedError: 지원하지 않는 방화벽 타입인 경우
            FirewallConnectionError: 방화벽 연결 실패 시
        """
        logger = logging.getLogger(__name__)

        source_type = source_type.lower()
        if source_type not in FirewallCollectorFactory.REQUIRED_PARAMS:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 타입입니다: {source_type}")

        hostname = kwargs.get('hostname')
        username = kwargs.get('username')
        password = kwargs.get('password')

        if source_type == 'paloalto':
            return PaloAltoAPI(hostname=hostname, username=username, password=password)
        elif source_type == 'mf2':
            return MF2Collector(hostname=hostname, username=username, password=password)
        elif source_type == 'ngf':
            return NGFCollector(hostname=hostname, ext_clnt_id=username, ext_clnt_secret=password)
        elif source_type == 'mock':
            return MockCollector(hostname=hostname, username=username, password=password)
        else:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 타입입니다: {source_type}")

    @staticmethod
    def get_supported_vendors() -> list:
        """지원되는 방화벽 벤더 목록 반환"""
        return list(FirewallCollectorFactory.REQUIRED_PARAMS.keys())

    @staticmethod
    def get_vendor_requirements(vendor: str) -> list:
        """특정 벤더의 필수 파라미터 목록 반환"""
        vendor = vendor.lower()
        if vendor not in FirewallCollectorFactory.REQUIRED_PARAMS:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 벤더입니다: {vendor}")
        return FirewallCollectorFactory.REQUIRED_PARAMS[vendor]
