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
    """방화벽 Collector 인스턴스를 동적으로 생성하는 팩토리 클래스

    방화벽 장비의 벤더 타입(vendor)에 따라 적절한 수집기 구현체(Collector)를 
    인스턴스화하여 반환합니다.

    지원되는 방화벽 벤더:
    - paloalto: Palo Alto Networks (XML API 및 SSH 지원)
    - mf2: SECUI MF2 (SSH 및 CLI 파싱 지원)
    - ngf: SECUI NGF (REST API 지원)
    - mock: 테스트용 가상 방화벽 (임의의 데이터 생성)
    """
    # 벤더별 필수 접속 파라미터 정의
    REQUIRED_PARAMS: Dict[str, list] = {
        'paloalto': ['hostname', 'username', 'password'],
        'mf2': ['hostname', 'username', 'password'],
        'ngf': ['hostname', 'username', 'password'],
        'mock': ['hostname', 'username', 'password']
    }

    @staticmethod
    def get_collector(source_type: str, **kwargs) -> FirewallInterface:
        """방화벽 타입에 매칭되는 Collector 객체를 생성하여 반환합니다.

        Args:
            source_type (str): 방화벽 벤더 명칭 ('paloalto', 'mf2', 'ngf', 'mock' 등)
            **kwargs: 방화벽 접속에 필요한 설정값
                - hostname (str): 장비 IP 주소
                - username (str): 접속 ID (SECUI NGF의 경우 클라이언트 ID)
                - password (str): 접속 PW (SECUI NGF의 경우 클라이언트 시크릿)
                - 기타 벤더별 특화 파라미터

        Returns:
            FirewallInterface: 요청된 벤더에 최적화된 수집기 인스턴스

        Raises:
            FirewallUnsupportedError: 지원하지 않는 방화벽 벤더가 입력된 경우
            FirewallConfigurationError: 필수 파라미터가 누락되었을 경우
        """
        logger = logging.getLogger(__name__)

        source_type = source_type.lower()
        if source_type not in FirewallCollectorFactory.REQUIRED_PARAMS:
            logger.error(f"지원하지 않는 방화벽 타입 요청: {source_type}")
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 타입입니다: {source_type}")

        # 벤더별 필수 파라미터 유효성 검사 (기본 공통 필드만 체크)
        hostname = kwargs.get('hostname')
        username = kwargs.get('username')
        password = kwargs.get('password')

        # 벤더별 구현체 매핑 및 생성
        if source_type == 'paloalto':
            # Palo Alto는 API와 SSH를 병행하여 사용할 수 있음
            return PaloAltoAPI(hostname=hostname, username=username, password=password)
        elif source_type == 'mf2':
            # SECUI MF2는 주로 SSH를 통한 CLI 파싱 방식을 사용
            return MF2Collector(hostname=hostname, username=username, password=password)
        elif source_type == 'ngf':
            # SECUI NGF는 REST API(ext_clnt_id, secret) 방식을 사용
            return NGFCollector(hostname=hostname, ext_clnt_id=username, ext_clnt_secret=password)
        elif source_type == 'mock':
            # 시연 및 테스트용 모의 객체 반환
            return MockCollector(hostname=hostname, username=username, password=password)
        else:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 타입입니다: {source_type}")

    @staticmethod
    def get_supported_vendors() -> list:
        """현재 시스템에서 지원하는 방화벽 벤더 목록을 반환합니다.

        Returns:
            list: 지원 벤더 문자열 리스트 (예: ['paloalto', 'mf2', ...])
        """
        return list(FirewallCollectorFactory.REQUIRED_PARAMS.keys())

    @staticmethod
    def get_vendor_requirements(vendor: str) -> list:
        """특정 벤더의 Collector 생성을 위해 필요한 필수 파라미터 목록을 반환합니다.

        Args:
            vendor (str): 확인 대상 벤더명

        Returns:
            list: 필수 파라미터 명칭 리스트

        Raises:
            FirewallUnsupportedError: 지원하지 않는 벤더인 경우
        """
        vendor = vendor.lower()
        if vendor not in FirewallCollectorFactory.REQUIRED_PARAMS:
            raise FirewallUnsupportedError(f"지원하지 않는 방화벽 벤더입니다: {vendor}")
        return FirewallCollectorFactory.REQUIRED_PARAMS[vendor]
