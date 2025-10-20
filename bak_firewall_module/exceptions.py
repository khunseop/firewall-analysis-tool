"""
Firewall 모듈용 커스텀 예외 클래스들
"""

class FirewallError(Exception):
    """방화벽 모듈의 기본 예외 클래스"""
    pass

class FirewallConnectionError(FirewallError):
    """방화벽 연결 실패 시 발생하는 예외"""
    pass

class FirewallAuthenticationError(FirewallError):
    """방화벽 인증 실패 시 발생하는 예외"""
    pass

class FirewallTimeoutError(FirewallError):
    """방화벽 응답 타임아웃 시 발생하는 예외"""
    pass

class FirewallAPIError(FirewallError):
    """방화벽 API 호출 실패 시 발생하는 예외"""
    pass

class FirewallConfigurationError(FirewallError):
    """방화벽 설정 오류 시 발생하는 예외"""
    pass

class FirewallDataError(FirewallError):
    """방화벽 데이터 파싱/검증 오류 시 발생하는 예외"""
    pass

class FirewallUnsupportedError(FirewallError):
    """지원하지 않는 방화벽 기능 사용 시 발생하는 예외"""
    pass 