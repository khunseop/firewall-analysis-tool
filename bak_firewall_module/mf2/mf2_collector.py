# firewall/mf2/mf2_collector.py
import pandas as pd
from typing import Optional
from ..firewall_interface import FirewallInterface
from ..exceptions import FirewallConnectionError
from .mf2_module import (
    show_system_info,
    export_security_rules,
    download_object_files,
    host_parsing,
    network_parsing,
    combine_mask_end,
    delete_files,
    export_address_objects,
    service_parsing,
)
import os

class MF2Collector(FirewallInterface):
    def __init__(self, hostname: str, username: str, password: str):
        super().__init__(hostname, username, password)
        self.device_ip = hostname
        module_dir = os.path.dirname(os.path.abspath(__file__))
        self.temp_dir = os.path.join(module_dir, 'temp')
        os.makedirs(self.temp_dir, exist_ok=True)

    def connect(self) -> bool:
        try:
            show_system_info(self.device_ip, self.username, self._password)
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise FirewallConnectionError(f"MF2 연결 실패: {e}") from e

    def disconnect(self) -> bool:
        self._connected = False
        return True

    def test_connection(self) -> bool:
        try:
            show_system_info(self.device_ip, self.username, self._password)
            return True
        except Exception:
            return False

    def get_system_info(self) -> pd.DataFrame:
        # 기본 포트 22 사용
        return show_system_info(self.device_ip, self.username, self.password)

    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        return export_security_rules(self.device_ip, self.username, self.password)

    def export_network_objects(self) -> pd.DataFrame:
        """네트워크 객체 정보를 PaloAlto 형식으로 변환하여 반환합니다."""
        conf_types = ['hostobject.conf', 'networkobject.conf']
        files = download_object_files(self.device_ip, 22, self.username, self.password, '/secui/etc/', self.temp_dir, conf_types)
        if len(files) < len(conf_types):
            return pd.DataFrame(columns=['Name', 'Type', 'Value'])

        host_file = os.path.join(self.temp_dir, f"{self.device_ip}_hostobject.conf")
        network_file = os.path.join(self.temp_dir, f"{self.device_ip}_networkobject.conf")

        # 호스트 객체 처리
        host_df = host_parsing(host_file)
        host_df = host_df[['name', 'ip']].rename(columns={'name': 'Name', 'ip': 'Value'})
        host_df['Type'] = 'ip-netmask'

        # 네트워크 객체 처리
        network_df = network_parsing(network_file)
        network_df['Value'] = network_df.apply(combine_mask_end, axis=1)
        network_df = network_df[['name', 'Value']].rename(columns={'name': 'Name'})
        network_df['Type'] = 'ip-netmask'

        # 결과 합치기
        result_df = pd.concat([host_df, network_df], ignore_index=True)
        # 'Value'에 '-'가 포함되어 있으면 ip-range, 그렇지 않으면 ip-netmask로 설정
        result_df['Type'] = result_df['Value'].apply(lambda v: 'ip-range' if '-' in str(v) else 'ip-netmask')

        delete_files(files)
        return result_df

    def export_network_group_objects(self) -> pd.DataFrame:
        """네트워크 그룹 객체 정보를 PaloAlto 형식으로 변환하여 반환합니다."""
        conf_types = ['hostobject.conf', 'networkobject.conf', 'groupobject.conf']
        files = download_object_files(self.device_ip, 22, self.username, self.password, '/secui/etc/', self.temp_dir, conf_types)
        if len(files) < len(conf_types):
            return pd.DataFrame(columns=['Group Name', 'Entry'])

        group_file = os.path.join(self.temp_dir, f"{self.device_ip}_groupobject.conf")
        host_file = os.path.join(self.temp_dir, f"{self.device_ip}_hostobject.conf")
        network_file = os.path.join(self.temp_dir, f"{self.device_ip}_networkobject.conf")

        address_df, group_df = export_address_objects(group_file, host_file, network_file)
        delete_files(files)
        return group_df[['Group Name', 'Entry']]

    def export_service_objects(self) -> pd.DataFrame:
        """서비스 객체 정보를 PaloAlto 형식으로 변환하여 반환합니다."""
        conf_types = ['serviceobject.conf']
        files = download_object_files(self.device_ip, 22, self.username, self.password, '/secui/etc/', self.temp_dir, conf_types)
        if len(files) < len(conf_types):
            return pd.DataFrame(columns=['Name', 'Protocol', 'Port'])

        service_file = os.path.join(self.temp_dir, f"{self.device_ip}_serviceobject.conf")
        service_df = service_parsing(service_file)
        service_df = service_df[['name', 'protocol', 'str_svc_port']].rename(
            columns={'name': 'Name', 'protocol': 'Protocol', 'str_svc_port': 'Port'}
        )
        service_df['Protocol'] = service_df['Protocol'].apply(lambda x: x.lower() if isinstance(x, str) else x)
        
        delete_files(files)
        return service_df

    def export_service_group_objects(self) -> pd.DataFrame:
        """서비스 그룹 객체 정보를 PaloAlto 형식으로 변환하여 반환합니다."""
        # MF2는 서비스 그룹 기능이 없으므로 빈 DataFrame 반환
        return pd.DataFrame(columns=['Group Name', 'Entry'])

    def export_usage_logs(self, days: Optional[int] = None) -> pd.DataFrame:
        """정책 사용이력을 DataFrame으로 반환합니다.
        
        Args:
            days: 미사용 기준 일수 (예: 30일 이상 미사용 시 '미사용'으로 표시)
            
        Returns:
            pd.DataFrame: Rule Name, Last Hit Date, Unused Days, 미사용여부 컬럼을 가진 DataFrame
            
        Note:
            MF2 방화벽은 정책 사용이력 정보를 제공하지 않으므로 빈 DataFrame을 반환합니다.
            모든 정책은 '미사용'으로 표시됩니다.
        """
        # MF2는 정책 사용이력 기능이 없으므로 빈 DataFrame 반환
        return pd.DataFrame(columns=['Rule Name', 'Last Hit Date', 'Unused Days', '미사용여부'])