# firewall_manager/app/services/firewall/factory.py
from typing import Dict, Any
import logging
from .interface import FirewallInterface
# from .vendors.paloalto import PaloAltoCollector # 추후 수정
# from .vendors.mf2 import MF2Collector # 추후 수정
# from .vendors.ngf import NGFCollector # 추후 수정
# from .vendors.mock import MockCollector # 추후 수정
# from .validators import FirewallValidator # 추후 수정
# from .utils import setup_firewall_logger, format_connection_info # 추후 수정
from .exceptions import FirewallUnsupportedError

class FirewallCollectorFactory:
    """방화벽 Collector 인스턴스를 생성하는 팩토리 클래스

    지원되는 방화벽 벤더:
    - paloalto: PaloAlto Networks 방화벽
    - mf2: SECUI MF2 방화벽
    - ngf: SECUI NGF 방화벽
    - mock: 테스트용 가상 방화벽
    """
    # 각 방화벽 타입별 필수 파라미터 정의
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
        # 로거 설정
        logger = logging.getLogger(__name__)

        source_type = source_type.lower()
        if source_type not in FirewallCollectorFactory.REQUIRED_PARAMS:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 타입입니다: {source_type}")

        # Collector 객체 생성
        if source_type == 'paloalto':
            from .vendors.paloalto import PaloAltoAPI
            return PaloAltoAPI(
                hostname=kwargs['hostname'],
                username=kwargs['username'],
                password=kwargs['password']
            )
        else:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 타입입니다: {source_type}")

    @staticmethod
    def get_supported_vendors() -> list:
        """지원되는 방화벽 벤더 목록 반환

        Returns:
            list: 지원되는 벤더 목록
        """
        return list(FirewallCollectorFactory.REQUIRED_PARAMS.keys())

    @staticmethod
    def get_vendor_requirements(vendor: str) -> list:
        """특정 벤더의 필수 파라미터 목록 반환

        Args:
            vendor: 벤더명

        Returns:
            list: 필수 파라미터 목록

        Raises:
            FirewallUnsupportedError: 지원하지 않는 벤더인 경우
        """
        vendor = vendor.lower()
        if vendor not in FirewallCollectorFactory.REQUIRED_PARAMS:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 벤더입니다: {vendor}")

        return FirewallCollectorFactory.REQUIRED_PARAMS[vendor]
