from ..firewall_interface import FirewallInterface
from .mock_module import MockFirewall
import pandas as pd
from typing import Optional
from datetime import datetime, timedelta
import random
import time

class MockCollector(FirewallInterface):
    """테스트용 가상 방화벽 Collector"""
    
    def __init__(self, hostname: str, username: str, password: str):
        super().__init__(hostname, username, password)
        self.client = MockFirewall(hostname, username, password)

    def connect(self) -> bool:
        self._connected = True
        return True

    def disconnect(self) -> bool:
        self._connected = False
        return True

    def test_connection(self) -> bool:
        return True
    
    def export_security_rules(self):
        """보안 규칙 내보내기"""
        time.sleep(random.uniform(1, 3))  # 1~3초 랜덤 지연
        return self.client.export_security_rules()
    
    def export_network_objects(self):
        """네트워크 객체 내보내기"""
        time.sleep(random.uniform(1, 3))  # 1~3초 랜덤 지연
        return self.client.export_network_objects()
    
    def export_network_group_objects(self):
        """네트워크 그룹 내보내기"""
        time.sleep(random.uniform(1, 3))  # 1~3초 랜덤 지연
        return self.client.export_network_group_objects()
    
    def export_service_objects(self):
        """서비스 객체 내보내기"""
        time.sleep(random.uniform(1, 3))  # 1~3초 랜덤 지연
        return self.client.export_service_objects()
    
    def export_service_group_objects(self):
        """서비스 그룹 내보내기"""
        time.sleep(random.uniform(1, 3))  # 1~3초 랜덤 지연
        return self.client.export_service_group_objects()

    def get_system_info(self):
        """시스템 정보 조회 (Mock)"""
        time.sleep(random.uniform(1, 3))  # 1~3초 랜덤 지연
        return pd.DataFrame({
            'hostname': [self.client.hostname],
            'version': ['1.0.0'],
            'model': ['Mock Firewall'],
            'serial': ['MOCK-12345'],
            'uptime': ['365 days'],
            'status': ['running']
        })
        
    def export_usage_logs(self, days: Optional[int] = None) -> pd.DataFrame:
        """정책 사용 이력 조회 (Mock)
        
        Args:
            days: 미사용 기준 일수 (예: 30일 이상 미사용 시 '미사용'으로 표시)
            
        Returns:
            pd.DataFrame: Rule Name, Last Hit Date, Unused Days, 미사용여부 컬럼을 가진 DataFrame
        """
        time.sleep(random.uniform(1, 3))  # 1~3초 랜덤 지연
        
        # 보안 규칙 가져오기
        rules_df = self.export_security_rules()
        
        # 결과 DataFrame 초기화
        result = []
        
        # 현재 날짜
        now = datetime.now()
        
        for _, rule in rules_df.iterrows():
            rule_name = rule.get('Rule Name', rule.get('name'))  # name 또는 Rule Name 필드 사용
            
            # 랜덤하게 20%의 규칙을 미사용으로 설정
            if random.random() < 0.2:
                last_hit_date = None
                unused_days = 999  # 미사용 규칙의 경우 큰 값 설정
                usage_status = '미사용'
            else:
                # 최근 1~60일 사이의 랜덤한 날짜 생성
                days_ago = random.randint(1, 60)
                last_hit_date = (now - timedelta(days=days_ago)).strftime('%Y-%m-%d %H:%M:%S')
                unused_days = days_ago
                
                # 미사용 여부 결정
                if days is not None and unused_days > days:
                    usage_status = '미사용'
                else:
                    usage_status = '사용'
            
            result.append({
                'Rule Name': rule_name,
                'Last Hit Date': last_hit_date,
                'Unused Days': unused_days,
                '미사용여부': usage_status
            })
        
        return pd.DataFrame(result) 