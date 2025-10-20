# firewall/paloalto/paloalto_collector.py
import pandas as pd
from typing import Optional
from ..firewall_interface import FirewallInterface
from .paloalto_module import PaloAltoAPI

from ..exceptions import FirewallConnectionError


class PaloAltoCollector(FirewallInterface):
    def __init__(self, hostname: str, username: str, password: str):
        super().__init__(hostname, username, password)
        self.api = PaloAltoAPI(hostname, username, password)

    def connect(self) -> bool:
        """방화벽 연결 테스트 및 상태 갱신"""
        try:
            self.api.get_system_info()
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise FirewallConnectionError(f"PaloAlto 연결 실패: {e}") from e

    def disconnect(self) -> bool:
        """연결 해제"""
        self._connected = False
        return True

    def test_connection(self) -> bool:
        """연결 가능 여부 확인"""
        try:
            self.api.get_system_info()
            return True
        except Exception:
            return False

    def get_system_info(self) -> pd.DataFrame:
        """시스템 정보를 반환합니다."""
        return self.api.get_system_info()

    def export_security_rules(self, config_type: str = "running") -> pd.DataFrame:
        """
        보안 규칙을 반환합니다.
        Args:
        config_type (str): 'running' 또는 'candidate' 중 하나. 기본은 'running'.
        """
        return self.api.export_security_rules(config_type=config_type)

    def export_network_objects(self) -> pd.DataFrame:
        """네트워크 객체 정보를 반환합니다."""
        return self.api.export_network_objects()

    def export_network_group_objects(self) -> pd.DataFrame:
        """네트워크 그룹 객체 정보를 반환합니다."""
        return self.api.export_network_group_objects()

    def export_service_objects(self) -> pd.DataFrame:
        """서비스 객체 정보를 반환합니다."""
        return self.api.export_service_objects()

    def export_service_group_objects(self) -> pd.DataFrame:
        """서비스 그룹 객체 정보를 반환합니다."""
        return self.api.export_service_group_objects()
    
    def export_usage_logs(self, days: Optional[int] = None) -> pd.DataFrame:
        """정책 사용이력을 DataFrame으로 반환합니다.
        
        Args:
            days: 미사용 기준 일수 (예: 30일 이상 미사용 시 '미사용'으로 표시)
            
        Returns:
            pd.DataFrame: Rule Name, Last Hit Date, Unused Days, 미사용여부 컬럼을 가진 DataFrame
        """
        # 모든 vsys의 히트 카운트 정보를 수집
        vsys_list = self.api.get_vsys_list()
        hit_counts = []
        
        for vsys in vsys_list:
            df = self.api.export_hit_count(vsys)
            hit_counts.append(df)
        
        # 모든 vsys의 데이터를 하나로 합침
        result_df = pd.concat(hit_counts, ignore_index=True)
        
        # 필요한 컬럼만 선택
        result_df = result_df[['Rule Name', 'Last Hit Date', 'Unused Days']]
        
        # 미사용여부 컬럼 추가
        def determine_usage_status(unused_days):
            if pd.isna(unused_days):
                return '미사용'  # 사용 기록이 없는 경우
            if days is not None and unused_days > days:
                return '미사용'  # 기준일 이상 미사용
            return '사용'  # 기준일 이내 사용
        
        result_df['미사용여부'] = result_df['Unused Days'].apply(determine_usage_status)
        
        return result_df