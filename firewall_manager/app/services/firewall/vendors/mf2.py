# firewall/vendors/mf2.py
import os
import re
import logging
import paramiko
from scp import SCPClient
import pandas as pd
from typing import Optional

from ..interface import FirewallInterface
from ..exceptions import FirewallConnectionError

# Paramiko 로깅 설정
logging.getLogger("paramiko").setLevel(logging.WARNING)

# 헬퍼 함수 및 상수
POLICY_DIRECTORY = 'ls -ls *.fwrules'
CONF_DIRECTORY = 'ls *.conf'
INFO_FILE = 'cat /etc/SECUIMF2.info'

# 정규표현식 패턴
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
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port, username, password)
    return client

def exec_remote_command(ssh: paramiko.SSHClient, command: str, remote_directory: str = None):
    full_command = f'cd {remote_directory} && {command}' if remote_directory else command
    return ssh.exec_command(full_command)

def download_object_files(host: str, port: int, username: str, password: str,
                          remote_directory: str, local_directory: str, conf_types: list = None) -> list:
    if conf_types is None:
        conf_types = ['groupobject.conf', 'hostobject.conf', 'networkobject.conf', 'serviceobject.conf']

    downloaded_files = []
    ssh = create_ssh_client(host, port, username, password)
    try:
        _, stdout, _ = exec_remote_command(ssh, CONF_DIRECTORY, remote_directory)
        conf_lines = stdout.readlines()
        with SCPClient(ssh.get_transport()) as scp:
            for line in conf_lines:
                conf_file = line.strip()
                if conf_file in conf_types:
                    download_name = f"{host}_{conf_file}"
                    local_path = os.path.join(local_directory, download_name)
                    if not os.path.exists(local_path):
                        scp.get(os.path.join(remote_directory, conf_file), local_path)
                    downloaded_files.append(local_path)
    finally:
        ssh.close()
    return downloaded_files

def show_system_info(host: str, username: str, password: str) -> pd.DataFrame:
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
    if not isinstance(file_paths, list):
        file_paths = [file_paths]
    for path in file_paths:
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                logging.error(f"파일 삭제 실패 ({path}): {e}")

def host_parsing(file_path: str) -> pd.DataFrame:
    """호스트 객체 파일을 파싱하여 DataFrame으로 반환합니다."""
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    if depth_braces:
        depth_braces.pop(0)

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
    """네트워크 객체 파일을 파싱하여 DataFrame으로 반환합니다."""
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    if depth_braces:
        depth_braces.pop(0)

    data_list = []
    for text in depth_braces:
        data = {}
        pattern = RANGE_PATTERN if "range" in text else MASK_PATTERN
        for key, pat in pattern.items():
            match = re.search(pat, text)
            if match:
                data[key] = match.group(1)
        data_list.append(data)
    return pd.DataFrame(data_list)

def combine_mask_end(row: pd.Series) -> str:
    """네트워크 객체에서 ip/start와 mask/end 값을 결합합니다."""
    if row.get('mask/end', '').isdigit():
        return f"{row.get('ip/start')}/{row.get('mask/end')}"
    else:
        return f"{row.get('ip/start')}-{row.get('mask/end')}"

def export_address_objects(group_file: str, host_file: str, network_file: str) -> tuple:
    group_df = _group_parsing(group_file)
    network_df = network_parsing(network_file)
    host_df = host_parsing(host_file)

    if not network_df.empty:
        network_df['Value'] = network_df.apply(combine_mask_end, axis=1)
    network_ids = dict(zip(network_df['id'].astype(str), network_df['Value'])) if 'id' in network_df and 'Value' in network_df else {}
    host_ids = dict(zip(host_df['id'].astype(str), host_df['ip'])) if 'id' in host_df and 'ip' in host_df else {}

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
    """서비스 객체 파일을 파싱하여 DataFrame으로 반환합니다."""
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
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
    """원격 장비에서 규칙 파일(fwrules)을 다운로드하여 파싱한 후 DataFrame으로 반환합니다."""
    # Note: temp directory needs to be handled appropriately.
    # Assuming the collector class will manage the temp directory.
    file_name = _download_rule_file(device_ip, 22, username, password, '/secui/etc/', './temp')
    if not file_name:
        logging.error("규칙 파일 다운로드 실패")
        return pd.DataFrame()
    rule_df = _rule_parsing(file_name)
    delete_files(file_name)
    return rule_df

# 헬퍼 함수 (비공개)
def _remove_newlines_from_file(file_path: str) -> str:
    with open(file_path, 'r', encoding='utf-8-sig') as file:
        return file.read().replace('\n', '')

def _extract_braces_of_depth_2_or_more_without_outer_braces(content: str) -> list:
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
                    results.append(temp[1:-1].strip())
                    temp = ""
        elif depth >= 2: temp += char
    return results

def _group_parsing(file_path: str) -> pd.DataFrame:
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
    return ','.join(mapping.get(item.strip(), '') for item in ids.split(','))

def _combine_group_objects(row: pd.Series) -> str:
    values = [row.get('convert_hosts', ''), row.get('convert_networks', '')]
    return ','.join(val for val in values if val and val.strip())

def _download_rule_file(host: str, port: int, username: str, password: str,
                       remote_directory: str, local_directory: str) -> str:
    ssh = create_ssh_client(host, port, username, password)
    try:
        _, stdout, _ = exec_remote_command(ssh, POLICY_DIRECTORY, remote_directory)
        fwrules_lines = stdout.readlines()
        if fwrules_lines:
            latest_file = fwrules_lines[0].split()[-1]
            return _download_file(ssh, remote_directory, latest_file, local_directory, host)
    finally:
        ssh.close()
    return ""

def _download_file(ssh: paramiko.SSHClient, remote_directory: str, file_name: str, local_directory: str, host: str) -> str:
    remote_path = os.path.join(remote_directory, file_name)
    download_name = f"{host}_{file_name}"
    local_path = os.path.join(local_directory, download_name)
    with SCPClient(ssh.get_transport()) as scp:
        scp.get(remote_path, local_path)
    return local_path

def _parse_object(input_str: str) -> str:
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
    content = _remove_newlines_from_file(file_path)
    depth_braces = _extract_braces_of_depth_2_or_more_without_outer_braces(content)
    if not depth_braces: return pd.DataFrame()

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
    for col in ['Source', 'Destination', 'Service', 'User']:
        df[col] = df[col].replace({'': 'Any', ' ': 'Any'})
    return df

def _find_pattern(pattern, text):
    match = re.search(pattern, text)
    return match.group(1) if match else ""

def _get_schedule(shaping_string):
    return shaping_string.split('=')[1].lstrip('"') if "time=" in shaping_string else ''

def _extract_braces_of_depth_1_or_more(content: str) -> list:
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
    def __init__(self, hostname: str, username: str, password: str):
        super().__init__(hostname, username, password)
        # 임시 디렉토리 설정
        module_dir = os.path.dirname(os.path.abspath(__file__))
        self.temp_dir = os.path.join(module_dir, 'temp')
        os.makedirs(self.temp_dir, exist_ok=True)

    def connect(self) -> bool:
        try:
            show_system_info(self.hostname, self.username, self._password)
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
            show_system_info(self.hostname, self.username, self._password)
            return True
        except Exception:
            return False

    def get_system_info(self) -> pd.DataFrame:
        return show_system_info(self.hostname, self.username, self._password)

    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        return export_security_rules(self.hostname, self.username, self._password)

    def export_network_objects(self) -> pd.DataFrame:
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
        result_df['Type'] = result_df['Value'].apply(lambda v: 'ip-range' if '-' in str(v) else 'ip-netmask')

        delete_files(files)
        return result_df

    def export_network_group_objects(self) -> pd.DataFrame:
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
        """MF2 장비는 정책 사용 이력 조회를 지원하지 않습니다."""
        raise NotImplementedError("MF2 장비는 정책 사용 이력 조회를 지원하지 않습니다.")
