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
        # 호스트/사용자 기반 시드로 실행마다 과도한 변동을 줄이되 다양성은 유지
        try:
            random.seed(f"{hostname}-{username}")
        except Exception:
            pass
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
        applications = ['Web', 'File Transfer', 'Remote Access', 'Email', 'Database', 'VoIP', 'Streaming', 'DNS', 'SSH']
        protocols = ['tcp', 'udp', 'icmp']

        # 1) 네트워크 객체 다양화
        net_obj_count = random.randint(10, 24)
        base_names = [f"Host_{i}" for i in range(1, net_obj_count + 1)]
        extra_names = ["AnyNet", "RFC1918", "Corp_DC", "Mgmt_Segment", "UnknownHost"]
        names = (base_names + random.sample(extra_names, k=min(len(extra_names), 3)))[:net_obj_count]

        types = []
        values = []
        for _ in names:
            t = random.choice(['host', 'network', 'range', 'fqdn'])
            types.append(t)
            if t == 'host':
                values.append(self._generate_random_ip())
            elif t == 'network':
                values.append(self._generate_random_subnet())
            elif t == 'range':
                ip1 = self._generate_random_ip()
                ip2 = self._generate_random_ip()
                values.append(f"{ip1}-{ip2}")
            else:  # fqdn
                values.append(random.choice([
                    'www.example.com', 'intranet.local', 'api.service.local', 'updates.vendor.com'
                ]))

        # 가끔 any 를 나타내는 특수 엔트리 추가
        if random.random() < 0.3:
            names.append('any')
            types.append('network')
            values.append('0.0.0.0/0')

        self.network_objects = pd.DataFrame({
            'Name': names,
            'Type': types,
            'Value': values
        })

        # 2) 네트워크 그룹: 객체 이름을 참조하도록 구성
        net_group_count = random.randint(4, 10)
        group_names = [f"Group_{random.choice(['Servers', 'Clients', 'Network', 'DB', 'Web'])}_{i}" for i in range(1, net_group_count + 1)]
        net_obj_names = self.network_objects['Name'].tolist()
        net_group_entries = []
        for _ in group_names:
            members = random.sample(net_obj_names, random.randint(1, min(6, len(net_obj_names))))
            if random.random() < 0.2:
                members.append('any')
            net_group_entries.append(','.join(members))
        self.network_groups = pd.DataFrame({
            'Group Name': group_names,
            'Entry': net_group_entries
        })

        # 3) 서비스 객체 다양화
        svc_obj_count = random.randint(10, 18)
        svc_names = [f"Service_{i}" for i in range(1, svc_obj_count + 1)]
        svc_protocols = []
        svc_ports = []
        for _ in svc_names:
            proto = random.choice(protocols)
            svc_protocols.append(proto)
            if proto in ['tcp', 'udp']:
                # 단일 포트/범위/리스트성 포트 문자열을 섞어서 생성
                choice = random.random()
                if choice < 0.5:
                    svc_ports.append(self._generate_random_port())
                elif choice < 0.8:
                    p1 = random.randint(1, 65535)
                    p2 = min(65535, p1 + random.randint(1, 2000))
                    svc_ports.append(f"{p1}-{p2}")
                else:
                    svc_ports.append(random.choice(['80,443', '53,853', '22,2222']))
            else:
                svc_ports.append('any')
        if random.random() < 0.3:
            svc_names.append('any')
            svc_protocols.append('tcp')
            svc_ports.append('any')
        self.service_objects = pd.DataFrame({
            'Name': svc_names,
            'Protocol': svc_protocols,
            'Port': svc_ports
        })

        # 4) 서비스 그룹: 서비스 객체 이름을 참조
        svc_group_count = random.randint(3, 8)
        svc_group_names = [f"ServiceGroup_{random.choice(['Web', 'Admin', 'App', 'DB'])}_{i}" for i in range(1, svc_group_count + 1)]
        svc_obj_names = self.service_objects['Name'].tolist()
        svc_group_entries = []
        for _ in svc_group_names:
            members = random.sample(svc_obj_names, random.randint(1, min(5, len(svc_obj_names))))
            if random.random() < 0.2:
                members.append('any')
            svc_group_entries.append(','.join(members))
        self.service_groups = pd.DataFrame({
            'Group Name': svc_group_names,
            'Entry': svc_group_entries
        })

        # 5) 보안 규칙: 실제 객체/그룹/서비스 명을 참조하도록 구성
        rule_count = random.randint(16, 32)
        all_source_candidates = net_obj_names + group_names + ['any']
        all_dest_candidates = net_obj_names + group_names + ['any']
        all_service_candidates = svc_obj_names + svc_group_names + ['any']

        rules_rows = []
        now = datetime.now()
        for i in range(1, rule_count + 1):
            rule_name = f"Rule_{random.choice(['Allow', 'Block', 'Permit', 'Drop'])}_{i}"
            enable = random.choice(['Y', 'Y', 'Y', 'N'])
            action = random.choice(['allow', 'deny'])
            source = ', '.join(random.sample(all_source_candidates, random.randint(1, min(4, len(all_source_candidates)))))
            destination = ', '.join(random.sample(all_dest_candidates, random.randint(1, min(4, len(all_dest_candidates)))))
            service = ', '.join(random.sample(all_service_candidates, random.randint(1, min(3, len(all_service_candidates)))))
            user = 'any' if random.random() < 0.7 else f"user_group_{random.randint(1,5)}"
            application = ', '.join(random.sample(applications, random.randint(1, 3)))
            description = f"자동 생성된 규칙 설명 {i}"
            last_hit_choice = random.choice([
                (now - timedelta(days=random.randint(0, 120))).strftime('%Y-%m-%d %H:%M:%S'),
                (now - timedelta(seconds=random.randint(0, 86400))).timestamp(),
                '-', None, 'Invalid Date', ''
            ])
            rules_rows.append({
                'Seq': i,
                'Rule Name': rule_name,
                'Enable': enable,
                'Action': action,
                'Source': source,
                'User': user,
                'Destination': destination,
                'Service': service,
                'Application': application,
                'Description': description,
                'Last Hit Date': last_hit_choice
            })

        self.rules = pd.DataFrame(rules_rows)

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

    # export_usage_logs는 인터페이스에서 제거되었습니다.

    # PaloAlto 전용 확장: 모의 구현 제공
    def export_last_hit_date(self, vsys: Optional[list[str] | set[str]] = None) -> pd.DataFrame:
        rules_df = self.export_security_rules()
        # Mock에는 VSYS 개념이 없으므로 Vsys=None
        result = []
        now = datetime.now()
        for _, rule in rules_df.iterrows():
            rule_name = rule.get('Rule Name', rule.get('name'))
            lhd = (now - timedelta(days=random.randint(0, 30))).strftime('%Y-%m-%d') if random.random() < 0.8 else None
            result.append({"Vsys": None, "Rule Name": rule_name, "Last Hit Date": lhd})
        return pd.DataFrame(result)
