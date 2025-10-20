"""
Firewall 모듈용 입력 검증 유틸리티
"""

import re
import ipaddress
from typing import Any, Dict, List, Optional
from .exceptions import FirewallConfigurationError

class FirewallValidator:
    """방화벽 관련 입력 검증 클래스"""
    
    @staticmethod
    def validate_hostname(hostname: str) -> str:
        """호스트명 또는 IP 주소 검증
        
        Args:
            hostname: 검증할 호스트명 또는 IP 주소
            
        Returns:
            str: 검증된 호스트명
            
        Raises:
            FirewallConfigurationError: 잘못된 호스트명인 경우
        """
        if not hostname or not isinstance(hostname, str):
            raise FirewallConfigurationError("hostname은 비어있지 않은 문자열이어야 합니다")
        
        hostname = hostname.strip()
        
        if not hostname:
            raise FirewallConfigurationError("hostname은 빈 문자열일 수 없습니다")
        
        # IP 주소 형식 검사
        try:
            ipaddress.ip_address(hostname)
            return hostname
        except ValueError:
            pass
        
        # 호스트명 형식 검사 (RFC 1123)
        if len(hostname) > 253:
            raise FirewallConfigurationError("hostname이 너무 깁니다 (최대 253자)")
        
        hostname_pattern = re.compile(
            r'^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$'
        )
        
        if not hostname_pattern.match(hostname):
            raise FirewallConfigurationError(f"잘못된 hostname 형식입니다: {hostname}")
        
        return hostname
    
    @staticmethod
    def validate_credentials(username: str, password: str) -> tuple[str, str]:
        """사용자 인증 정보 검증
        
        Args:
            username: 사용자명
            password: 비밀번호
            
        Returns:
            tuple[str, str]: 검증된 (username, password)
            
        Raises:
            FirewallConfigurationError: 잘못된 인증 정보인 경우
        """
        if not username or not isinstance(username, str):
            raise FirewallConfigurationError("username은 비어있지 않은 문자열이어야 합니다")
        
        if not password or not isinstance(password, str):
            raise FirewallConfigurationError("password는 비어있지 않은 문자열이어야 합니다")
        
        username = username.strip()
        
        if not username:
            raise FirewallConfigurationError("username은 빈 문자열일 수 없습니다")
        
        if len(username) > 64:
            raise FirewallConfigurationError("username이 너무 깁니다 (최대 64자)")
        
        if len(password) > 256:
            raise FirewallConfigurationError("password가 너무 깁니다 (최대 256자)")
        
        return username, password
    
    @staticmethod
    def validate_source_type(source_type: str, supported_types: List[str]) -> str:
        """방화벽 소스 타입 검증
        
        Args:
            source_type: 방화벽 타입
            supported_types: 지원되는 타입 리스트
            
        Returns:
            str: 검증된 소스 타입 (소문자)
            
        Raises:
            FirewallConfigurationError: 지원되지 않는 타입인 경우
        """
        if not source_type or not isinstance(source_type, str):
            raise FirewallConfigurationError("source_type은 비어있지 않은 문자열이어야 합니다")
        
        source_type = source_type.lower().strip()
        
        if source_type not in supported_types:
            raise FirewallConfigurationError(
                f"지원하지 않는 방화벽 타입입니다: {source_type}. "
                f"지원되는 타입: {', '.join(supported_types)}"
            )
        
        return source_type
    
    @staticmethod
    def validate_config_type(config_type: str, valid_types: List[str] = None) -> str:
        """설정 타입 검증
        
        Args:
            config_type: 설정 타입
            valid_types: 유효한 타입 리스트 (기본값: ['running', 'candidate'])
            
        Returns:
            str: 검증된 설정 타입
            
        Raises:
            FirewallConfigurationError: 잘못된 설정 타입인 경우
        """
        if valid_types is None:
            valid_types = ['running', 'candidate']
        
        if not config_type or not isinstance(config_type, str):
            raise FirewallConfigurationError("config_type은 비어있지 않은 문자열이어야 합니다")
        
        config_type = config_type.lower().strip()
        
        if config_type not in valid_types:
            raise FirewallConfigurationError(
                f"지원하지 않는 설정 타입입니다: {config_type}. "
                f"지원되는 타입: {', '.join(valid_types)}"
            )
        
        return config_type
    
    @staticmethod
    def validate_export_type(export_type: str) -> str:
        """익스포트 타입 검증
        
        Args:
            export_type: 익스포트 타입
            
        Returns:
            str: 검증된 익스포트 타입
            
        Raises:
            FirewallConfigurationError: 잘못된 익스포트 타입인 경우
        """
        valid_types = ['policy', 'address', 'address_group', 'service', 'service_group', 'usage', 'all']
        
        if not export_type or not isinstance(export_type, str):
            raise FirewallConfigurationError("export_type은 비어있지 않은 문자열이어야 합니다")
        
        export_type = export_type.lower().strip()
        
        if export_type not in valid_types:
            raise FirewallConfigurationError(
                f"지원하지 않는 익스포트 타입입니다: {export_type}. "
                f"지원되는 타입: {', '.join(valid_types)}"
            )
        
        return export_type
    
    @staticmethod
    def validate_file_path(file_path: str) -> str:
        """파일 경로 검증
        
        Args:
            file_path: 파일 경로
            
        Returns:
            str: 검증된 파일 경로
            
        Raises:
            FirewallConfigurationError: 잘못된 파일 경로인 경우
        """
        if not file_path or not isinstance(file_path, str):
            raise FirewallConfigurationError("file_path는 비어있지 않은 문자열이어야 합니다")
        
        file_path = file_path.strip()
        
        if not file_path:
            raise FirewallConfigurationError("file_path는 빈 문자열일 수 없습니다")
        
        # 위험한 문자 검사
        dangerous_chars = ['<', '>', ':', '"', '|', '?', '*']
        for char in dangerous_chars:
            if char in file_path:
                raise FirewallConfigurationError(f"파일 경로에 허용되지 않는 문자가 포함되어 있습니다: {char}")
        
        return file_path
    
    @staticmethod
    def validate_timeout(timeout: Optional[int]) -> int:
        """타임아웃 값 검증
        
        Args:
            timeout: 타임아웃 값 (초)
            
        Returns:
            int: 검증된 타임아웃 값
            
        Raises:
            FirewallConfigurationError: 잘못된 타임아웃 값인 경우
        """
        if timeout is None:
            return 30  # 기본값
        
        if not isinstance(timeout, int):
            raise FirewallConfigurationError("timeout은 정수여야 합니다")
        
        if timeout <= 0:
            raise FirewallConfigurationError("timeout은 0보다 큰 값이어야 합니다")
        
        if timeout > 3600:  # 1시간
            raise FirewallConfigurationError("timeout은 3600초(1시간)를 초과할 수 없습니다")
        
        return timeout 