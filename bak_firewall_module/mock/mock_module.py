import pandas as pd
from datetime import datetime, timedelta
import random
import ipaddress

class MockFirewall:
    """테스트용 가상 방화벽 클래스"""
    
    def __init__(self, hostname: str, username: str, password: str):
        self.hostname = hostname
        self.username = username
        self.password = password
        self._generate_sample_data()
    
    def _generate_random_ip(self) -> str:
        """랜덤 IP 주소 생성"""
        network = random.choice(['192.168', '172.16', '10.0'])
        return f"{network}.{random.randint(0, 255)}.{random.randint(0, 255)}"
    
    def _generate_random_subnet(self) -> str:
        """랜덤 서브넷 생성"""
        network = random.choice(['192.168', '172.16', '10.0'])
        mask = random.choice([16, 24, 28])
        return f"{network}.0.0/{mask}"
    
    def _generate_random_port(self) -> str:
        """랜덤 포트 생성"""
        common_ports = ['80', '443', '22', '21', '53', '3389', '8080', '8443']
        port_ranges = ['1024-2048', '3000-4000', '5000-6000']
        return random.choice(common_ports + port_ranges)
    
    def _generate_sample_data(self):
        """샘플 데이터 생성"""
        # 기본 데이터 세트
        zones = ['Internal', 'External', 'DMZ', 'Guest', 'Management']
        applications = ['Web', 'File Transfer', 'Remote Access', 'Email', 'Database', 'VoIP', 'Streaming']
        protocols = ['tcp', 'udp', 'icmp']
        
        # 보안 규칙 생성 (10-20개 사이)
        rule_count = random.randint(10, 20)
        self.rules = pd.DataFrame({
            'Seq': range(1, rule_count + 1),
            'Rule Name': [f"Rule_{random.choice(['Allow', 'Block', 'Permit'])}_{i}" for i in range(1, rule_count + 1)],
            'Enable': [random.choice(['Y', 'Y', 'Y', 'N']) for _ in range(rule_count)],  # 75% 확률로 활성화
            'Action': [random.choice(['allow', 'deny']) for _ in range(rule_count)],
            'Source': [', '.join(random.sample(zones, random.randint(1, 3))) for _ in range(rule_count)],
            'User': ['any' if random.random() < 0.7 else f"user_group_{random.randint(1,5)}" for _ in range(rule_count)],
            'Destination': [', '.join(random.sample(zones, random.randint(1, 3))) for _ in range(rule_count)],
            'Service': [f"Service_{random.randint(1,10)}" for _ in range(rule_count)],
            'Application': [', '.join(random.sample(applications, random.randint(1, 3))) for _ in range(rule_count)],
            'Description': [f"자동 생성된 규칙 설명 {i}" for i in range(rule_count)],
            'Last Hit Date': [
                (datetime.now() - timedelta(days=random.randint(0, 90), 
                                           hours=random.randint(0, 23),
                                           minutes=random.randint(0, 59))).strftime('%Y-%m-%d %H:%M:%S')
                for _ in range(rule_count)
            ]
        })

        # 네트워크 객체 생성 (5-15개 사이)
        net_obj_count = random.randint(5, 15)
        self.network_objects = pd.DataFrame({
            'Name': [f"Host_{i}" for i in range(1, net_obj_count + 1)],
            'Type': [random.choice(['host', 'network', 'range']) for _ in range(net_obj_count)],
            'Value': [self._generate_random_ip() if random.random() < 0.7 else self._generate_random_subnet() 
                     for _ in range(net_obj_count)]
        })

        # 네트워크 그룹 생성 (3-8개 사이)
        net_group_count = random.randint(3, 8)
        self.network_groups = pd.DataFrame({
            'Group Name': [f"Group_{random.choice(['Servers', 'Clients', 'Network'])}_{i}" 
                         for i in range(1, net_group_count + 1)],
            'Entry': [
                ','.join(random.sample(self.network_objects['Name'].tolist(), 
                                     random.randint(1, min(4, len(self.network_objects)))))
                for _ in range(net_group_count)
            ]
        })

        # 서비스 객체 생성 (5-12개 사이)
        svc_obj_count = random.randint(5, 12)
        self.service_objects = pd.DataFrame({
            'Name': [f"Service_{i}" for i in range(1, svc_obj_count + 1)],
            'Protocol': [random.choice(protocols) for _ in range(svc_obj_count)],
            'Port': [self._generate_random_port() for _ in range(svc_obj_count)]
        })

        # 서비스 그룹 생성 (2-6개 사이)
        svc_group_count = random.randint(2, 6)
        self.service_groups = pd.DataFrame({
            'Group Name': [f"ServiceGroup_{random.choice(['Web', 'Admin', 'App'])}_{i}" 
                         for i in range(1, svc_group_count + 1)],
            'Entry': [
                ','.join(random.sample(self.service_objects['Name'].tolist(), 
                                     random.randint(1, min(3, len(self.service_objects)))))
                for _ in range(svc_group_count)
            ]
        })

    def export_security_rules(self) -> pd.DataFrame:
        """보안 규칙 내보내기"""
        return self.rules.copy()

    def export_network_objects(self) -> pd.DataFrame:
        """네트워크 객체 내보내기"""
        return self.network_objects.copy()

    def export_network_group_objects(self) -> pd.DataFrame:
        """네트워크 그룹 내보내기"""
        return self.network_groups.copy()

    def export_service_objects(self) -> pd.DataFrame:
        """서비스 객체 내보내기"""
        return self.service_objects.copy()

    def export_service_group_objects(self) -> pd.DataFrame:
        """서비스 그룹 내보내기"""
        return self.service_groups.copy() 