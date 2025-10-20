# firewall/collector_factory.py
from typing import Dict, Any
import logging
from .firewall_interface import FirewallInterface
from .paloalto.paloalto_collector import PaloAltoCollector
from .mf2.mf2_collector import MF2Collector
from .ngf.ngf_collector import NGFCollector
from .mock.mock_collector import MockCollector
from .validators import FirewallValidator
from .utils import setup_firewall_logger, format_connection_info
from .exceptions import (
    FirewallConfigurationError,
    FirewallConnectionError,
    FirewallUnsupportedError
)

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
        logger = setup_firewall_logger(__name__)
        
        try:
            # 입력 검증
            supported_types = list(FirewallCollectorFactory.REQUIRED_PARAMS.keys())
            source_type = FirewallValidator.validate_source_type(source_type, supported_types)
            
            # 필수 파라미터 검증
            required_params = FirewallCollectorFactory.REQUIRED_PARAMS[source_type]
            missing_params = [param for param in required_params if param not in kwargs]
            if missing_params:
                raise FirewallConfigurationError(
                    f"{source_type} 방화벽에 필요한 파라미터가 누락되었습니다: {', '.join(missing_params)}"
                )
            
            # 개별 파라미터 검증
            hostname = FirewallValidator.validate_hostname(kwargs['hostname'])
            username, password = FirewallValidator.validate_credentials(
                kwargs['username'], kwargs['password']
            )
            timeout = FirewallValidator.validate_timeout(kwargs.get('timeout'))
            
            # 연결 정보 로깅 (비밀번호 제외)
            connection_info = format_connection_info(hostname, username, source_type)
            logger.info(f"방화벽 Collector 생성 시도: {connection_info}")
            
            # Collector 객체 생성
            collector = None
            if source_type == 'paloalto':
                collector = PaloAltoCollector(hostname, username, password)
            elif source_type == 'mf2':
                collector = MF2Collector(hostname, username, password)
            elif source_type == 'ngf':
                collector = NGFCollector(hostname, username, password)
            elif source_type == 'mock':
                collector = MockCollector(hostname, username, password)
            else:
                raise FirewallUnsupportedError(f"지원하지 않는 방화벽 타입입니다: {source_type}")
            
            # 연결 테스트 (선택사항)
            if kwargs.get('test_connection', True):
                try:
                    if hasattr(collector, 'test_connection'):
                        if not collector.test_connection():
                            logger.warning(f"방화벽 연결 테스트 실패: {connection_info}")
                    logger.info(f"방화벽 Collector 생성 성공: {connection_info}")
                except Exception as e:
                    logger.warning(f"방화벽 연결 테스트 중 오류 (무시됨): {e}")
            
            return collector
            
        except (FirewallConfigurationError, FirewallUnsupportedError) as e:
            logger.error(f"방화벽 Collector 생성 실패: {e}")
            raise
        except Exception as e:
            logger.error(f"방화벽 Collector 생성 중 예상치 못한 오류: {e}")
            raise FirewallConfigurationError(f"Collector 생성 실패: {e}")
    
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