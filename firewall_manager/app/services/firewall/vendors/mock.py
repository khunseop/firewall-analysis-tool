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
        random.seed(42) # Ensure deterministic mock data for consistent testing
        zones = ['Internal', 'External', 'DMZ', 'Guest', 'Management']
        applications = ['Web', 'File Transfer', 'Remote Access', 'Email', 'Database', 'VoIP', 'Streaming']
        protocols = ['tcp', 'udp', 'icmp']

        # 1. Generate network objects
        net_obj_count = random.randint(5, 15)
        self.network_objects = pd.DataFrame({
            'Name': [f"Host_{i}" for i in range(1, net_obj_count + 1)],
            'Type': [random.choice(['host', 'network', 'range']) for _ in range(net_obj_count)],
            'Value': [self._generate_random_ip() if random.random() < 0.7 else self._generate_random_subnet() for _ in range(net_obj_count)]
        })
        # Ensure '1.1.1.1' is always present for testing
        self.network_objects = pd.concat([
            self.network_objects,
            pd.DataFrame([{'Name': 'Test-Host-1', 'Type': 'host', 'Value': '1.1.1.1'}])
        ], ignore_index=True).drop_duplicates(subset=['Name'])


        # 2. Generate network groups
        net_group_count = random.randint(3, 8)
        self.network_groups = pd.DataFrame({
            'Group Name': [f"Group_{random.choice(['Servers', 'Clients', 'Network'])}_{i}" for i in range(1, net_group_count + 1)],
            'Entry': [','.join(random.sample(self.network_objects['Name'].tolist(), random.randint(1, min(4, len(self.network_objects))))) for _ in range(net_group_count)]
        })
        # Ensure a group containing the test host exists
        self.network_groups = pd.concat([
            self.network_groups,
            pd.DataFrame([{'Group Name': 'Test-Group-1', 'Entry': 'Test-Host-1'}])
        ], ignore_index=True).drop_duplicates(subset=['Group Name'])

        # 3. Generate service objects
        svc_obj_count = random.randint(5, 12)
        ports_for_rules = [self._generate_random_port() for _ in range(svc_obj_count)]
        self.service_objects = pd.DataFrame({
            'Name': [f"Svc_{p.replace('-', '_')}" for p in ports_for_rules],
            'Protocol': [random.choice(protocols) for _ in range(svc_obj_count)],
            'Port': ports_for_rules
        })
        # Ensure '80' and '443' are always present for testing
        self.service_objects = pd.concat([
            self.service_objects,
            pd.DataFrame([
                {'Name': 'Svc_80', 'Protocol': 'tcp', 'Port': '80'},
                {'Name': 'Svc_443', 'Protocol': 'tcp', 'Port': '443'}
            ])
        ], ignore_index=True).drop_duplicates(subset=['Name'])

        # 4. Generate service groups
        svc_group_count = random.randint(2, 6)
        self.service_groups = pd.DataFrame({
            'Group Name': [f"ServiceGroup_{random.choice(['Web', 'Admin', 'App'])}_{i}" for i in range(1, svc_group_count + 1)],
            'Entry': [','.join(random.sample(self.service_objects['Name'].tolist(), random.randint(1, min(3, len(self.service_objects))))) for _ in range(svc_group_count)]
        })
        self.service_groups = pd.concat([
            self.service_groups,
            pd.DataFrame([{'Group Name': 'Test-Svc-Group', 'Entry': 'Svc_80,Svc_443'}])
        ], ignore_index=True).drop_duplicates(subset=['Group Name'])

        # 5. Generate rules using the objects created above
        valid_addr_objects = self.network_objects['Name'].tolist() + self.network_groups['Group Name'].tolist() + ['any']
        valid_svc_objects = self.service_objects['Name'].tolist() + self.service_groups['Group Name'].tolist() + ['any']

        rule_count = random.randint(10, 20)
        base_rules = {
            'seq': range(1, rule_count + 1),
            'rule_name': [f"Rule_{random.choice(['Allow', 'Block', 'Permit'])}_{i}" for i in range(1, rule_count + 1)],
            'enable': [random.choice(['Y', 'Y', 'Y', 'N']) for _ in range(rule_count)],
            'action': [random.choice(['allow', 'deny']) for _ in range(rule_count)],
            'source': [', '.join(random.sample(valid_addr_objects, random.randint(1, 2))) for _ in range(rule_count)],
            'user': ['any' if random.random() < 0.7 else f"user_group_{random.randint(1,5)}" for _ in range(rule_count)],
            'destination': [', '.join(random.sample(valid_addr_objects, random.randint(1, 2))) for _ in range(rule_count)],
            'service': [', '.join(random.sample(valid_svc_objects, random.randint(1, 2))) for _ in range(rule_count)],
            'application': [', '.join(random.sample(applications, random.randint(1, 2))) for _ in range(rule_count)],
            'description': [f"자동 생성된 규칙 설명 {i}" for i in range(1, rule_count + 1)],
            'last_hit_date': [
                random.choice([
                    (datetime.now() - timedelta(days=random.randint(0, 90))).strftime('%Y-%m-%d %H:%M:%S'),
                    (datetime.now() - timedelta(seconds=random.randint(0, 86400))).timestamp(), # Numeric timestamp
                    "-",
                    None,
                    "Invalid Date",
                    ""
                ]) for _ in range(rule_count)
            ]
        }
        self.rules = pd.DataFrame(base_rules)

        # Add specific rules for deterministic testing
        self.network_objects = pd.concat([
            self.network_objects,
            pd.DataFrame([{'Name': 'Test-Combined-Host', 'Type': 'host', 'Value': '192.168.1.100'}])
        ], ignore_index=True).drop_duplicates(subset=['Name'])

        test_rules = pd.DataFrame([
            # Rule for single IP and service search
            {
                'seq': rule_count + 1,
                'rule_name': 'Test-Search-Rule-IP',
                'enable': 'Y', 'action': 'allow',
                'source': 'Test-Host-1', # 1.1.1.1
                'user': 'any', 'destination': 'any',
                'service': 'Test-Svc-Group', # tcp/80, tcp/443
                'application': 'Web', 'description': 'IP 및 서비스 검색 테스트용 규칙',
                'last_hit_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            },
            # Rule for combined search (192.168.1.100, tcp/80)
            {
                'seq': rule_count + 2,
                'rule_name': 'Test-Search-Rule-Combined',
                'enable': 'Y', 'action': 'allow',
                'source': 'Test-Combined-Host', # 192.168.1.100
                'user': 'any', 'destination': 'any',
                'service': 'Svc_80', # tcp/80
                'application': 'Web', 'description': '복합 검색 테스트용 규칙',
                'last_hit_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            },
            # Rule to guarantee a policy with tcp/443 exists for testing
            {
                'seq': rule_count + 3,
                'rule_name': 'Test-Search-Rule-Direct-HTTPS',
                'enable': 'Y', 'action': 'allow',
                'source': 'any',
                'user': 'any', 'destination': 'Test-Host-1', # 1.1.1.1
                'service': 'Svc_443', # tcp/443
                'application': 'Web', 'description': 'Direct HTTPS service search test',
                'last_hit_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        ])
        self.rules = pd.concat([self.rules, test_rules], ignore_index=True)

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
        time.sleep(random.uniform(0.5, 2.0))  # 연결 시뮬레이션
        self._connected = True
        return True

    def disconnect(self) -> bool:
        self._connected = False
        return True

    def test_connection(self) -> bool:
        return True

    def export_security_rules(self, **kwargs):
        time.sleep(random.uniform(3.1, 5.5))
        return self.client.export_security_rules()

    def export_network_objects(self, **kwargs):
        time.sleep(random.uniform(3.1, 5.5))
        return self.client.export_network_objects()

    def export_network_group_objects(self, **kwargs):
        time.sleep(random.uniform(3.1, 5.5))
        return self.client.export_network_group_objects()

    def export_service_objects(self, **kwargs):
        time.sleep(random.uniform(3.1, 5.5))
        return self.client.export_service_objects()

    def export_service_group_objects(self, **kwargs):
        time.sleep(random.uniform(3.1, 5.5))
        return self.client.export_service_group_objects()

    def get_system_info(self, **kwargs):
        time.sleep(random.uniform(0.1, 0.5))
        return pd.DataFrame({
            'hostname': [self.client.hostname], 'version': ['1.0.0'], 'model': ['Mock Firewall'],
            'serial': ['MOCK-12345'], 'uptime': ['365 days'], 'status': ['running']
        })

    # export_usage_logs는 인터페이스에서 제거되었습니다.

    # PaloAlto 전용 확장: 모의 구현 제공
    def export_last_hit_date(self, vsys: Optional[list[str] | set[str]] = None) -> pd.DataFrame:
        rules_df = self.export_security_rules()
        # Mock에는 VSYS 개념이 없으므로 Vsys=None
        result = []
        now = datetime.now()
        for _, rule in rules_df.iterrows():
            rule_name = rule.get('rule_name', rule.get('name'))
            lhd = (now - timedelta(days=random.randint(0, 30))).strftime('%Y-%m-%d') if random.random() < 0.8 else None
            result.append({"vsys": None, "rule_name": rule_name, "last_hit_date": lhd})
        return pd.DataFrame(result)
