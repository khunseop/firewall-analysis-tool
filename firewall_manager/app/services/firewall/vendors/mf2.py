# firewall_manager/app/services/firewall/vendors/mf2.py
import os
import re
import logging
import paramiko
from scp import SCPClient
import pandas as pd
from typing import Optional

from ..interface import FirewallInterface
from ..exceptions import FirewallConnectionError

# Paramiko 로깅 설정: 불필요한 디버그 로그를 방지하기 위해 WARNING 레벨로 설정합니다.
logging.getLogger("paramiko").setLevel(logging.WARNING)

# SECUI MF2 장비 제어를 위한 상용 상수 및 쉘 명령 정의
POLICY_DIRECTORY = 'ls -ls *.fwrules'  # 최신 보안 정책 파일(.fwrules)을 찾기 위한 명령
CONF_DIRECTORY = 'ls *.conf'           # 객체 설정 파일(.conf) 목록을 확인하기 위한 명령
INFO_FILE = 'cat /etc/SECUIMF2.info'   # 장비 하드웨어 정보를 담고 있는 파일 경로

# SECUI MF2 설정 파일 파싱을 위한 정규표현식(Regex) 패턴 모음
# MF2는 독자적인 텍스트 기반 설정 구조를 사용하므로, 각 필드별 패턴 매칭이 필수적입니다.
HOST_PATTERN = {
    'id': r'id = (\d+)',
    'name': r'name = "([^"]+)"',
    'zone': r'zone = "([^"]+)"',
    'user': r'user = "([^"]+)"',
    'date': r'date = "([^"]+)"',
    'ip': r'ip = "([^"]+)"',
    'description': r'd = "([^"]+)"',
}
MASK_PATTERN = {
    'id': r'id = (\d+)',
    'name': r'name = "([^"]+)"',
    'zone': r'zone = "([^"]+)"',
    'user': r'user = "([^"]+)"',
    'date': r'date = "([^"]+)"',
    'ip/start': r'ip="([^"]+)"',
    'mask/end': r'mask="([^"]+)"',
    'description': r'd = "([^"]+)"',
}
RANGE_PATTERN = {
    'id': r'id = (\d+)',
    'name': r'name = "([^"]+)"',
    'zone': r'zone = "([^"]+)"',
    'user': r'user = "([^"]+)"',
    'date': r'date = "([^"]+)"',
    'ip/start': r'rangestart="([^"]+)"',
    'mask/end': r'rangeend="([^"]+)"',
    'description': r'd = "([^"]+)"',
}
GROUP_PATTERN = {
    'id': r'id = (\d+)',
    'name': r'name = "([^"]+)"',
    'zone': r'zone = "([^"]+)"',
    'user': r'user = "([^"]+)"',
    'date': r'date = "([^"]+)"',
    'count': r'count = \{(.*?)\},',
    'hosts': r'hosts=\{(.*?)\},',
    'networks': r'networks=\{(.*?)\},',
    'description': r'd = "([^"]+)"',
}
SERVICE_PATTERN = {
    'id': r'id = (\d+)',
    'name': r'name = "([^"]+)"',
    'protocol': r'protocol="([^"]+)",',
    'str_src_port': r'str_src_port="([^"]+)",',
    'str_svc_port': r'str_svc_port="([^"]+)",',
    'svc_type': r'svc_type="([^"]+)",',
    'description': r'd = "([^"]+)"',
}

def create_ssh_client(host: str, port: int, username: str, password: str) -> paramiko.SSHClient:
    """
    Paramiko를 사용하여 방화벽 장비에 대한 SSH 클라이언트를 생성하고 연결합니다.
    """
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    # 알려지지 않은 호스트 키라도 자동으로 수락하도록 설정 (내부망 장비 연동 편의성)
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port, username, password)
    return client

def exec_remote_command(ssh: paramiko.SSHClient, command: str, remote_directory: str = None):
    """
    연결된 SSH 세션을 통해 원격 명령을 실행합니다.
    디렉토리가 지정된 경우 해당 경로로 이동(cd) 후 명령을 실행합니다.
    """
    full_command = f'cd {remote_directory} && {command}' if remote_directory else command
    return ssh.exec_command(full_command)

def download_object_files(host: str, port: int, username: str, password: str,
                          remote_directory: str, local_directory: str, conf_types: list = None) -> list:
    """
    원격 장비의 설정 디렉토리에서 객체 정의 파일들을 탐색하고 SCP를 통해 로컬로 다운로드합니다.
    """
    if conf_types is None:
        conf_types = ['groupobject.conf', 'hostobject.conf', 'networkobject.conf', 'serviceobject.conf']

    downloaded_files = []
    ssh = create_ssh_client(host, port, username, password)
    try:
        # 설정 디렉토리 파일 목록 확인
        _, stdout, _ = exec_remote_command(ssh, CONF_DIRECTORY, remote_directory)
        conf_lines = stdout.readlines()
        # SCP 클라이언트를 열어 지정된 파일들만 선별적으로 다운로드
        with SCPClient(ssh.get_transport()) as scp:
            for line in conf_lines:
                conf_file = line.strip()
                if conf_file in conf_types:
                    download_name = f"{host}_{conf_file}"
                    local_path = os.path.join(local_directory, download_name)
                    # 동일한 파일이 이미 존재하지 않는 경우에만 다운로드 수행
                    if not os.path.exists(local_path):
                        scp.get(os.path.join(remote_directory, conf_file), local_path)
                    downloaded_files.append(local_path)
    finally:
        ssh.close()
    return downloaded_files

def show_system_info(host: str, username: str, password: str) -> pd.DataFrame:
    """
    SSH를 통해 장비에 접속하여 호스트명, 가동 시간, 하드웨어 모델명 등 시스템 정보를 수집합니다.
    """
    ssh = create_ssh_client(host, 22, username, password)
    try:
        _, stdout, _ = ssh.exec_command('hostname')
        hostname = stdout.readline().strip()

        _, stdout, _ = ssh.exec_command('uptime')
        uptime_parts = stdout.readline().rstrip().split(' ')
        uptime = f"{uptime_parts[3]} {uptime_parts[4].rstrip(',')}" if len(uptime_parts) >= 5 else ""

        _, stdout, _ = ssh.exec_command(INFO_FILE)
        info_lines = stdout.readlines()

        _, stdout, _ = ssh.exec_command('rpm -q mf2')
        version = stdout.readline().strip()

        # SECUIMF2.info 파일 내용 파싱 (키=값 형태)
        model = info_lines[0].split('=')[1].strip() if len(info_lines) > 0 else ""
        mac_address = info_lines[2].split('=')[1].strip() if len(info_lines) > 2 else ""
        hw_serial = info_lines[3].split('=')[1].strip() if len(info_lines) > 3 else ""

        data = {
            "hostname": hostname, "ip_address": host, "mac_address": mac_address,
            "uptime": uptime, "model": model, "serial_number": hw_serial, "sw_version": version,
        }
        return pd.DataFrame(data, index=[0])
    finally:
        ssh.close()

def delete_files(file_paths):
    """임시로 다운로드한 설정 파일들을 삭제합니다."""
    if not isinstance(file_paths, list):
        file_paths = [file_paths]
    for path in file_paths:
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                logging.error(f"파일 삭제 실패 ({path}): {e}")

def host_parsing(file_path: str) -> pd.DataFrame:
    """
    호스트 객체 설정 파일을 정규식으로 파싱합니다.
    중첩된 중괄호({}) 구조를 분해하여 개별 객체 데이터를 추출합니다.
    """
    content = _remove_newlines_from_file(file_path)
    # 중첩 깊이 2 이상의 중괄호 블록을 추출 (개별 객체 단위)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    if depth_braces:
        depth_braces.pop(0)  # 최상위 메타 데이터 블록 제거

    data_list = []
    for text in depth_braces:
        data = {}
        for key, pattern in HOST_PATTERN.items():
            match = re.search(pattern, text)
            if match:
                data[key] = match.group(1)
        data_list.append(data)
    return pd.DataFrame(data_list)

def network_parsing(file_path: str) -> pd.DataFrame:
    """
    네트워크(서브넷/범위) 객체 설정 파일을 파싱합니다.
    IP 범위(Range) 형태와 서브넷 마스크(Mask) 형태를 구분하여 처리합니다.
    """
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    if depth_braces:
        depth_braces.pop(0)

    data_list = []
    for text in depth_braces:
        data = {}
        # 블록 내 키워드에 따라 정규식 패턴 세트 선택
        pattern = RANGE_PATTERN if "range" in text else MASK_PATTERN
        for key, pat in pattern.items():
            match = re.search(pat, text)
            if match:
                data[key] = match.group(1)
        data_list.append(data)
    return pd.DataFrame(data_list)

def combine_mask_end(row: pd.Series) -> str:
    """IP 주소와 마스크/범위 종료값을 결합하여 '주소/마스크' 또는 '시작-종료' 포맷으로 생성합니다."""
    mask_val = row.get('mask/end', '')
    if str(mask_val).isdigit():
        return f"{row.get('ip/start')}/{mask_val}"
    else:
        return f"{row.get('ip/start')}-{mask_val}"

def export_address_objects(group_file: str, host_file: str, network_file: str) -> tuple:
    """호스트, 네트워크, 그룹 파일을 각각 파싱한 후 상호 참조 관계를 해결하여 통합 반환합니다."""
    group_df = _group_parsing(group_file)
    network_df = network_parsing(network_file)
    host_df = host_parsing(host_file)

    if not network_df.empty:
        network_df['Value'] = network_df.apply(combine_mask_end, axis=1)
    
    # ID 기반 매핑 생성 (그룹 내에서 참조하기 위함)
    network_ids = dict(zip(network_df['id'].astype(str), network_df['Value'])) if 'id' in network_df and 'Value' in network_df else {}
    host_ids = dict(zip(host_df['id'].astype(str), host_df['ip'])) if 'id' in host_df and 'ip' in host_df else {}

    # 그룹 멤버들의 ID를 실제 주소 값으로 변환
    group_df['convert_networks'] = group_df['networks'].apply(lambda x: _replace_values(x, network_ids)) if 'networks' in group_df else ""
    group_df['convert_hosts'] = group_df['hosts'].apply(lambda x: _replace_values(x, host_ids)) if 'hosts' in group_df else ""
    group_df['Entry'] = group_df.apply(_combine_group_objects, axis=1)

    group_df = group_df[['name', 'Entry']]
    group_df.columns = ['Group Name', 'Entry']
    network_df = network_df[['name', 'Value']]
    network_df.columns = ['Name', 'Value']
    host_df = host_df[['name', 'ip']]
    host_df.columns = ['Name', 'Value']
    network_objects_df = pd.concat([host_df, network_df], axis=0, ignore_index=True)

    return network_objects_df, group_df

def service_parsing(file_path: str) -> pd.DataFrame:
    """서비스(포트) 객체 파일을 정규식으로 파싱합니다."""
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    # MF2 서비스 파일은 앞부분에 시스템 정의 서비스 블록들이 다수 존재하여 추가 스킵이 필요합니다.
    if depth_braces:
        depth_braces.pop(0)
    if depth_braces:
        depth_braces.pop(0)

    data_list = []
    for text in depth_braces:
        data = {}
        for key, pattern in SERVICE_PATTERN.items():
            match = re.search(pattern, text)
            if match:
                data[key] = match.group(1)
        data_list.append(data)
    return pd.DataFrame(data_list)

def export_security_rules(device_ip: str, username: str, password: str) -> pd.DataFrame:
    """방화벽 장비에서 최신 정책 파일(.fwrules)을 추출하여 정책 목록을 생성합니다."""
    # 정책 파일을 SSH/SCP로 임시 다운로드
    file_name = _download_rule_file(device_ip, 22, username, password, '/secui/etc/', './temp')
    if not file_name:
        logging.error("규칙 파일 다운로드 실패")
        return pd.DataFrame()
    
    # 다운로드된 바이너리/텍스트 혼합 형태의 파일을 텍스트 파싱 처리
    rule_df = _rule_parsing(file_name)
    delete_files(file_name)
    return rule_df

# 내부 헬퍼 함수: 복잡한 중괄호 텍스트 구조 분석 및 필터링
def _remove_newlines_from_file(file_path: str) -> str:
    """줄바꿈을 제거하여 정규식 매칭이 용이한 단일 문자열로 변환합니다."""
    with open(file_path, 'r', encoding='utf-8-sig') as file:
        return file.read().replace('\n', '')

def _extract_braces_of_depth_2_or_more_without_outer_braces(content: str) -> list:
    """중첩된 중괄호 구조에서 특정 깊이(Depth) 이상의 데이터 블록을 추출하는 로직입니다."""
    depth, results, temp = 0, [], ""
    for char in content:
        if char == '{':
            if depth >= 1: temp += char
            depth += 1
        elif char == '}':
            depth -= 1
            if depth >= 1:
                temp += char
                if depth == 1:
                    # 블록이 닫힐 때 내부 텍스트를 결과 리스트에 추가
                    results.append(temp[1:-1].strip())
                    temp = ""
        elif depth >= 2: temp += char
    return results

def _group_parsing(file_path: str) -> pd.DataFrame:
    """그룹 객체 파일 내 멤버 ID 리스트를 파싱합니다."""
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    if depth_braces: depth_braces.pop(0)

    data_list = []
    for text in depth_braces:
        data = {}
        for key, pattern in GROUP_PATTERN.items():
            match = re.search(pattern, text)
            if match:
                if key in ['hosts', 'networks']:
                    # [ID=N] 형태의 리스트에서 N 값만 추출
                    items = [item.split('=')[0].replace('[', '').replace(']', '') for item in match.group(1).split(',') if item]
                    data[key] = ','.join(items)
                elif key == 'count':
                    items = [item.split('=')[1] for item in match.group(1).split(',') if len(item.split('=')) > 1]
                    data[key] = ','.join(items)
                else:
                    data[key] = match.group(1)
        data_list.append(data)
    return pd.DataFrame(data_list)

def _replace_values(ids: str, mapping: dict) -> str:
    """ID 리스트 문자열을 실제 객체 이름/값 리스트로 치환합니다."""
    return ','.join(mapping.get(item.strip(), '') for item in ids.split(','))

def _combine_group_objects(row: pd.Series) -> str:
    """호스트 멤버와 네트워크 멤버를 하나의 엔트리 필드로 합칩니다."""
    values = [row.get('convert_hosts', ''), row.get('convert_networks', '')]
    return ','.join(val for val in values if val and val.strip())

def _download_rule_file(host: str, port: int, username: str, password: str,
                       remote_directory: str, local_directory: str) -> str:
    """장비 내 /secui/etc 디렉토리에서 가장 최근에 생성된 .fwrules 파일을 찾아 다운로드합니다."""
    ssh = create_ssh_client(host, port, username, password)
    try:
        _, stdout, _ = exec_remote_command(ssh, POLICY_DIRECTORY, remote_directory)
        fwrules_lines = stdout.readlines()
        if fwrules_lines:
            # ls -ls 출력 결과에서 파일명 부분 추출
            latest_file = fwrules_lines[0].split()[-1]
            return _download_file(ssh, remote_directory, latest_file, local_directory, host)
    finally:
        ssh.close()
    return ""

def _download_file(ssh: paramiko.SSHClient, remote_directory: str, file_name: str, local_directory: str, host: str) -> str:
    """SCP를 사용하여 특정 파일을 로컬로 복사합니다."""
    remote_path = os.path.join(remote_directory, file_name)
    download_name = f"{host}_{file_name}"
    local_path = os.path.join(local_directory, download_name)
    with SCPClient(ssh.get_transport()) as scp:
        scp.get(remote_path, local_path)
    return local_path

def _parse_object(input_str: str) -> str:
    """정책 설정 내 객체 참조 문자열(예: "host host_name")에서 실제 이름만 추출합니다."""
    cleaned = input_str.replace('"', '')
    parsed = []
    if "," in cleaned:
        for entry in cleaned.split(','):
            parts = entry.split(' ')
            if len(parts) > 1: parsed.append(parts[1])
    elif " " in cleaned:
        parts = cleaned.split(' ')
        if len(parts) > 1: parsed.append(parts[1])
    else:
        parsed.append(cleaned)
    return ','.join(parsed)

def _rule_parsing(file_path: str) -> pd.DataFrame:
    """
    정책 파일 전체 내용을 분석하여 각 룰별 세부 항목(Source, Dest, Service 등)을 정규식으로 추출합니다.
    """
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    if not depth_braces: return pd.DataFrame()

    # 정책 데이터가 담긴 첫 번째 큰 블록을 다시 1단계 중괄호 단위(개별 룰)로 쪼개기
    rule_blocks = _extract_braces_of_depth_1_or_more(depth_braces[0])
    policies = []
    for idx, block in enumerate(rule_blocks):
        policy = {
            "Seq": idx + 1,
            "Rule Name": _find_pattern(r"\{rid=(.*?), ", block),
            "Enable": _find_pattern(r"use=\"(.*?)\", action", block),
            "Action": _find_pattern(r"action=\"(.*?)\", group", block),
            "Source": _parse_object(_find_pattern(r"from = \{(.*?)\},  to", block)),
            "User": _parse_object(_find_pattern(r"ua = \{(.*?)\}, unuse", block)),
            "Destination": _parse_object(_find_pattern(r"to = \{(.*?)\},  service", block)),
            "Service": _parse_object(_find_pattern(r"service = \{(.*?)\},  vid", block)),
            "Application": "Any",
            "Security Profile": _get_schedule(_find_pattern(r"shaping_string=\"(.*?)\", bi_di", block)),
            "Description": _find_pattern(r"description=\"(.*?)\", use=", block),
        }
        policies.append(policy)

    df = pd.DataFrame(policies)
    # 비어있는 필드는 식별 용이성을 위해 'Any'로 채움
    for col in ['Source', 'Destination', 'Service', 'User']:
        df[col] = df[col].replace({'': 'Any', ' ': 'Any'})
    return df

def _find_pattern(pattern, text):
    """지정된 정규식 패턴에 매칭되는 첫 번째 그룹 문자열을 반환합니다."""
    match = re.search(pattern, text)
    return match.group(1) if match else ""

def _get_schedule(shaping_string):
    """정책에 설정된 시간 스케줄 정보를 추출합니다."""
    return shaping_string.split('=')[1].lstrip('"') if "time=" in shaping_string else ''

def _extract_braces_of_depth_1_or_more(content: str) -> list:
    """중괄호 1단계 수준의 모든 독립적인 블록들을 리스트로 추출합니다."""
    depth, results, temp = 0, [], ""
    for char in content:
        if char == '{':
            if depth == 0: temp = ""
            temp += char
            depth += 1
        elif char == '}':
            temp += char
            depth -= 1
            if depth == 0: results.append(temp.strip())
        elif depth >= 1: temp += char
    return results

class MF2Collector(FirewallInterface):
    """
    SECUI MF2 방화벽 장비에 특화된 데이터 수집기 클래스입니다.
    모든 통신은 SSH 및 SCP를 기반으로 합니다.
    """
    def __init__(self, hostname: str, username: str, password: str):
        super().__init__(hostname, username, password)
        # 임시 파일 처리를 위한 디렉토리 생성
        module_dir = os.path.dirname(os.path.abspath(__file__))
        self.temp_dir = os.path.join(module_dir, 'temp')
        os.makedirs(self.temp_dir, exist_ok=True)

    def connect(self) -> bool:
        """연결 테스트를 겸해 시스템 정보를 조회하여 성공 여부를 반환합니다."""
        try:
            show_system_info(self.hostname, self.username, self._password)
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise FirewallConnectionError(f"MF2 연결 실패: {e}") from e

    def disconnect(self) -> bool:
        """SSH 기반으로 별도의 영구 세션을 유지하지 않으므로 상태값만 변경합니다."""
        self._connected = False
        return True

    def test_connection(self) -> bool:
        """연결 상태를 테스트합니다."""
        try:
            show_system_info(self.hostname, self.username, self._password)
            return True
        except Exception:
            return False

    def get_system_info(self) -> pd.DataFrame:
        """시스템 기본 정보를 수집합니다."""
        return show_system_info(self.hostname, self.username, self._password)

    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        """보안 정책 목록을 추출합니다."""
        return export_security_rules(self.hostname, self.username, self._password)

    def export_network_objects(self) -> pd.DataFrame:
        """개별 네트워크(Host/Network) 객체들을 수집하여 DataFrame으로 반환합니다."""
        conf_types = ['hostobject.conf', 'networkobject.conf']
        files = download_object_files(self.hostname, 22, self.username, self._password, '/secui/etc/', self.temp_dir, conf_types)
        if len(files) < len(conf_types):
            return pd.DataFrame(columns=['Name', 'Type', 'Value'])

        host_file = os.path.join(self.temp_dir, f"{self.hostname}_hostobject.conf")
        network_file = os.path.join(self.temp_dir, f"{self.hostname}_networkobject.conf")

        host_df = host_parsing(host_file)
        host_df = host_df[['name', 'ip']].rename(columns={'name': 'Name', 'ip': 'Value'})
        host_df['Type'] = 'ip-netmask'

        network_df = network_parsing(network_file)
        network_df['Value'] = network_df.apply(combine_mask_end, axis=1)
        network_df = network_df[['name', 'Value']].rename(columns={'name': 'Name'})
        network_df['Type'] = 'ip-netmask'

        result_df = pd.concat([host_df, network_df], ignore_index=True)
        # 단일 IP와 범위 IP를 구분하여 Type 설정
        result_df['Type'] = result_df['Value'].apply(lambda v: 'ip-range' if '-' in str(v) else 'ip-netmask')

        delete_files(files)
        return result_df

    def export_network_group_objects(self) -> pd.DataFrame:
        """네트워크 주소 그룹 객체들을 수집합니다."""
        conf_types = ['hostobject.conf', 'networkobject.conf', 'groupobject.conf']
        files = download_object_files(self.hostname, 22, self.username, self._password, '/secui/etc/', self.temp_dir, conf_types)
        if len(files) < len(conf_types):
            return pd.DataFrame(columns=['Group Name', 'Entry'])

        group_file = os.path.join(self.temp_dir, f"{self.hostname}_groupobject.conf")
        host_file = os.path.join(self.temp_dir, f"{self.hostname}_hostobject.conf")
        network_file = os.path.join(self.temp_dir, f"{self.hostname}_networkobject.conf")

        _, group_df = export_address_objects(group_file, host_file, network_file)
        delete_files(files)
        return group_df[['Group Name', 'Entry']]

    def export_service_objects(self) -> pd.DataFrame:
        """포트/프로토콜 기반 서비스 객체들을 수집합니다."""
        conf_types = ['serviceobject.conf']
        files = download_object_files(self.hostname, 22, self.username, self._password, '/secui/etc/', self.temp_dir, conf_types)
        if len(files) < len(conf_types):
            return pd.DataFrame(columns=['Name', 'Protocol', 'Port'])

        service_file = os.path.join(self.temp_dir, f"{self.hostname}_serviceobject.conf")
        service_df = service_parsing(service_file)
        service_df = service_df[['name', 'protocol', 'str_svc_port']].rename(
            columns={'name': 'Name', 'protocol': 'Protocol', 'str_svc_port': 'Port'}
        )
        service_df['Protocol'] = service_df['Protocol'].apply(lambda x: x.lower() if isinstance(x, str) else x)

        delete_files(files)
        return service_df

    def export_service_group_objects(self) -> pd.DataFrame:
        """MF2 장비는 서비스 그룹 기능을 지원하지 않습니다."""
        raise NotImplementedError("MF2 장비는 서비스 그룹 기능을 지원하지 않습니다.")

    def export_usage_logs(self, days: Optional[int] = None) -> pd.DataFrame:
        """MF2 장비는 API를 통한 정책 사용 이력 조회를 지원하지 않습니다."""
        raise NotImplementedError("MF2 장비는 정책 사용 이력 조회를 지원하지 않습니다.")
