# firewall/vendors/mock.py
import pandas as pd
from typing import Optional
from datetime import datetime, timedelta
import random
import time

from ..interface import FirewallInterface

class MockFirewall:
    """테스트용 가상 방화벽 클래스"""

    def __init__(self, hostname: str, username: str, password: str):
        self.hostname = hostname
        self.username = username
        self.password = password
        self._generate_sample_data()

    def _generate_random_ip(self) -> str:
        network = random.choice(['192.168', '172.16', '10.0'])
        return f"{network}.{random.randint(0, 255)}.{random.randint(0, 255)}"

    def _generate_random_subnet(self) -> str:
        network = random.choice(['192.168', '172.16', '10.0'])
        mask = random.choice([16, 24, 28])
        return f"{network}.0.0/{mask}"

    def _generate_random_port(self) -> str:
        common_ports = ['80', '443', '22', '21', '53', '3389', '8080', '8443']
        port_ranges = ['1024-2048', '3000-4000', '5000-6000']
        return random.choice(common_ports + port_ranges)

    def _generate_sample_data(self):
        zones = ['Internal', 'External', 'DMZ', 'Guest', 'Management']
        applications = ['Web', 'File Transfer', 'Remote Access', 'Email', 'Database', 'VoIP', 'Streaming']
        protocols = ['tcp', 'udp', 'icmp']

        rule_count = random.randint(10, 20)
        self.rules = pd.DataFrame({
            'Seq': range(1, rule_count + 1),
            'Rule Name': [f"Rule_{random.choice(['Allow', 'Block', 'Permit'])}_{i}" for i in range(1, rule_count + 1)],
            'Enable': [random.choice(['Y', 'Y', 'Y', 'N']) for _ in range(rule_count)],
            'Action': [random.choice(['allow', 'deny']) for _ in range(rule_count)],
            'Source': [', '.join(random.sample(zones, random.randint(1, 3))) for _ in range(rule_count)],
            'User': ['any' if random.random() < 0.7 else f"user_group_{random.randint(1,5)}" for _ in range(rule_count)],
            'Destination': [', '.join(random.sample(zones, random.randint(1, 3))) for _ in range(rule_count)],
            'Service': [f"Service_{random.randint(1,10)}" for _ in range(rule_count)],
            'Application': [', '.join(random.sample(applications, random.randint(1, 3))) for _ in range(rule_count)],
            'Description': [f"자동 생성된 규칙 설명 {i}" for i in range(rule_count)],
            'Last Hit Date': [(datetime.now() - timedelta(days=random.randint(0, 90))).strftime('%Y-%m-%d %H:%M:%S') for _ in range(rule_count)]
        })

        net_obj_count = random.randint(5, 15)
        self.network_objects = pd.DataFrame({
            'Name': [f"Host_{i}" for i in range(1, net_obj_count + 1)],
            'Type': [random.choice(['host', 'network', 'range']) for _ in range(net_obj_count)],
            'Value': [self._generate_random_ip() if random.random() < 0.7 else self._generate_random_subnet() for _ in range(net_obj_count)]
        })

        net_group_count = random.randint(3, 8)
        self.network_groups = pd.DataFrame({
            'Group Name': [f"Group_{random.choice(['Servers', 'Clients', 'Network'])}_{i}" for i in range(1, net_group_count + 1)],
            'Entry': [','.join(random.sample(self.network_objects['Name'].tolist(), random.randint(1, min(4, len(self.network_objects))))) for _ in range(net_group_count)]
        })

        svc_obj_count = random.randint(5, 12)
        self.service_objects = pd.DataFrame({
            'Name': [f"Service_{i}" for i in range(1, svc_obj_count + 1)],
            'Protocol': [random.choice(protocols) for _ in range(svc_obj_count)],
            'Port': [self._generate_random_port() for _ in range(svc_obj_count)]
        })

        svc_group_count = random.randint(2, 6)
        self.service_groups = pd.DataFrame({
            'Group Name': [f"ServiceGroup_{random.choice(['Web', 'Admin', 'App'])}_{i}" for i in range(1, svc_group_count + 1)],
            'Entry': [','.join(random.sample(self.service_objects['Name'].tolist(), random.randint(1, min(3, len(self.service_objects))))) for _ in range(svc_group_count)]
        })

    def export_security_rules(self) -> pd.DataFrame:
        return self.rules.copy()

    def export_network_objects(self) -> pd.DataFrame:
        return self.network_objects.copy()

    def export_network_group_objects(self) -> pd.DataFrame:
        return self.network_groups.copy()

    def export_service_objects(self) -> pd.DataFrame:
        return self.service_objects.copy()

    def export_service_group_objects(self) -> pd.DataFrame:
        return self.service_groups.copy()

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

    def export_security_rules(self, **kwargs):
        time.sleep(random.uniform(0.1, 0.5))
        return self.client.export_security_rules()

    def export_network_objects(self, **kwargs):
        time.sleep(random.uniform(0.1, 0.5))
        return self.client.export_network_objects()

    def export_network_group_objects(self, **kwargs):
        time.sleep(random.uniform(0.1, 0.5))
        return self.client.export_network_group_objects()

    def export_service_objects(self, **kwargs):
        time.sleep(random.uniform(0.1, 0.5))
        return self.client.export_service_objects()

    def export_service_group_objects(self, **kwargs):
        time.sleep(random.uniform(0.1, 0.5))
        return self.client.export_service_group_objects()

    def get_system_info(self, **kwargs):
        time.sleep(random.uniform(0.1, 0.5))
        return pd.DataFrame({
            'hostname': [self.client.hostname], 'version': ['1.0.0'], 'model': ['Mock Firewall'],
            'serial': ['MOCK-12345'], 'uptime': ['365 days'], 'status': ['running']
        })

    def export_usage_logs(self, days: Optional[int] = None) -> pd.DataFrame:
        time.sleep(random.uniform(0.1, 0.5))
        rules_df = self.export_security_rules()
        result = []
        now = datetime.now()

        for _, rule in rules_df.iterrows():
            rule_name = rule.get('Rule Name', rule.get('name'))
            if random.random() < 0.2:
                last_hit_date, unused_days, usage_status = None, 999, '미사용'
            else:
                days_ago = random.randint(1, 60)
                last_hit_date = (now - timedelta(days=days_ago)).strftime('%Y-%m-%d %H:%M:%S')
                unused_days = days_ago
                usage_status = '미사용' if days is not None and unused_days > days else '사용'

            result.append({'Rule Name': rule_name, 'Last Hit Date': last_hit_date, 'Unused Days': unused_days, '미사용여부': usage_status})

        return pd.DataFrame(result)
