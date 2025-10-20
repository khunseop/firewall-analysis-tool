"""
방화벽 모듈 - 다양한 방화벽 벤더와 연동하는 통합 인터페이스를 제공합니다.

지원 벤더:
- PaloAlto Networks
- NGF (Next Generation Firewall)
- MF2 (Multi-Function Firewall 2)
- Mock (테스트용)

주요 기능:
- 방화벽 추상 인터페이스 (FirewallInterface)
- 벤더별 컬렉터 팩토리 (CollectorFactory)
- 데이터 익스포터 (Exporter)
- 로깅 및 예외 처리 시스템
- 입력 검증 및 성능 최적화
"""

# 핵심 클래스
from .firewall_interface import FirewallInterface
from .collector_factory import FirewallCollectorFactory
from .exporter import export_policy_to_excel

# 예외 클래스
from .exceptions import (
    FirewallError,
    FirewallConnectionError,
    FirewallAuthenticationError,
    FirewallTimeoutError,
    FirewallAPIError,
    FirewallConfigurationError,
    FirewallDataError,
    FirewallUnsupportedError
)

# 유틸리티
from .validators import FirewallValidator
from .utils import (
    setup_firewall_logger,
    retry_on_failure,
    performance_monitor,
    ProgressTracker
)

# 버전 정보
__version__ = "1.2.0"

__all__ = [
    # 핵심 클래스
    'FirewallInterface',
    'FirewallCollectorFactory', 
    'export_policy_to_excel',
    
    # 예외 클래스
    'FirewallError',
    'FirewallConnectionError',
    'FirewallAuthenticationError',
    'FirewallTimeoutError',
    'FirewallAPIError',
    'FirewallConfigurationError',
    'FirewallDataError',
    'FirewallUnsupportedError',
    
    # 유틸리티
    'FirewallValidator',
    'setup_firewall_logger',
    'retry_on_failure',
    'performance_monitor',
    'ProgressTracker',
    
    # 버전
    '__version__'
]
