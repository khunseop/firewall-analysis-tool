# firewall_manager/app/services/firewall/vendors/paloalto.py
import time
import datetime
import logging
import requests
import xml.etree.ElementTree as ET
import paramiko
import re

import pandas as pd

from ..interface import FirewallInterface
from ..exceptions import FirewallAuthenticationError, FirewallConnectionError, FirewallAPIError

# SSL 설정 (urllib3 버전 호환성 고려)
try:
    requests.packages.urllib3.util.ssl_.DEFAULT_CIPHERS += ':DES-CBC3-SHA'
except AttributeError:
    pass
requests.packages.urllib3.disable_warnings()


class PaloAltoAPI(FirewallInterface):
    def __init__(self, hostname: str, username: str, password: str) -> None:
        super().__init__(hostname, username, password)
        self.base_url = f'https://{hostname}/api/'
        self.api_key = None

    def connect(self) -> bool:
        try:
            self.api_key = self._get_api_key(self.username, self._password)
            self._connected = True
            return True
        except Exception as e:
            self.logger.error(f"Palo Alto 연결 실패: {e}")
            self._connected = False
            return False

    def disconnect(self) -> bool:
        # Palo Alto API는 별도의 disconnect 절차가 없음
        self.api_key = None
        self._connected = False
        return True

    def test_connection(self) -> bool:
        return self.connect()

    @staticmethod
    def _get_member_texts(xml_elements) -> list:
        try:
            return [element.text for element in xml_elements if element.text is not None]
        except Exception:
            return []

    @staticmethod
    def list_to_string(list_data: list) -> str:
        return ','.join(str(item) for item in list_data)

    def get_api_data(self, parameters, timeout: int = 10000):
        try:
            response = requests.get(
                self.base_url,
                params=parameters,
                verify=False,
                timeout=timeout
            )
            if response.status_code != 200:
                raise FirewallAPIError(f"API 요청 실패 (상태 코드: {response.status_code}): {response.text}")
            return response
        except requests.exceptions.Timeout:
            raise FirewallConnectionError("API 요청 시간 초과")
        except requests.exceptions.ConnectionError:
            raise FirewallConnectionError(f"API 서버 연결 실패: {self.hostname}")
        except requests.exceptions.RequestException as e:
            raise FirewallAPIError(f"API 요청 중 오류 발생: {str(e)}")

    def _get_api_key(self, username: str, password: str) -> str:
        try:
            keygen_params = (
                ('type', 'keygen'),
                ('user', username),
                ('password', password)
            )
            response = self.get_api_data(keygen_params)
            tree = ET.fromstring(response.text)
            key_element = tree.find('./result/key')
            if key_element is None:
                raise FirewallAuthenticationError("API 키를 찾을 수 없습니다")
            return key_element.text
        except ET.ParseError:
            raise FirewallAPIError("API 응답 XML 파싱 실패")
        except Exception as e:
            raise FirewallAuthenticationError(f"API 키 생성 실패: {str(e)}")

    def get_config(self, config_type: str = 'running') -> str:
        action = 'show' if config_type == 'running' else 'get'
        params = (
            ('key', self.api_key),
            ('type', 'config'),
            ('action', action),
            ('xpath', '/config')
        )
        response = self.get_api_data(params)
        return response.text

    def get_system_info(self) -> pd.DataFrame:
        params = (
            ('type', 'op'),
            ('cmd', '<show><system><info/></system></show>'),
            ('key', self.api_key)
        )
        response = self.get_api_data(params)
        tree = ET.fromstring(response.text)
        uptime = tree.findtext("./result/system/uptime")
        info = {
            "hostname": tree.findtext("./result/system/hostname"),
            "ip_address": tree.findtext("./result/system/ip-address"),
            "mac_address": tree.findtext("./result/system/mac-address"),
            "uptime": uptime.split(" ")[0] if uptime else None,
            "model": tree.findtext("./result/system/model"),
            "serial_number": tree.findtext("./result/system/serial"),
            "sw_version": tree.findtext("./result/system/sw-version"),
            "app_version": tree.findtext("./result/system/app-version"),
        }
        return pd.DataFrame(info, index=[0])

    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        config_type = kwargs.get('config_type', 'running')
        config_xml = self.get_config(config_type)
        tree = ET.fromstring(config_xml)
        vsys_entries = tree.findall('./result/config/devices/entry/vsys/entry')
        security_rules = []

        for vsys in vsys_entries:
            vsys_name = vsys.attrib.get('name')
            rulebase = vsys.findall('./rulebase/security/rules/entry')
            for idx, rule in enumerate(rulebase):
                rule_name = str(rule.attrib.get('name'))
                # PAN-OS XML: <disabled>yes</disabled> 이면 비활성. Enable 컬럼은 Y/N로 표기(Y는 활성, N은 비활성)
                disabled_list = self._get_member_texts(rule.findall('./disabled'))
                is_disabled = (self.list_to_string(disabled_list).strip().lower() == "yes")
                disabled_status = "Y" if not is_disabled else "N"
                action = self.list_to_string(self._get_member_texts(rule.findall('./action')))
                source = self.list_to_string(self._get_member_texts(rule.findall('./source/member')))
                user = self.list_to_string(self._get_member_texts(rule.findall('./source-user/member')))
                destination = self.list_to_string(self._get_member_texts(rule.findall('./destination/member')))
                service = self.list_to_string(self._get_member_texts(rule.findall('./service/member')))
                application = self.list_to_string(self._get_member_texts(rule.findall('./application/member')))
                url_filtering = self.list_to_string(self._get_member_texts(rule.findall('./profile-setting/profiles/url-filtering/member')))
                category = self.list_to_string(self._get_member_texts(rule.findall('./category/member')))
                category = "any" if not category else category
                description_list = self._get_member_texts(rule.findall('./description'))
                description = self.list_to_string([desc.replace('\n', ' ') for desc in description_list])

                rule_info = {
                    "vsys": vsys_name,
                    "seq": idx + 1,
                    "rule_name": rule_name,
                    "enable": disabled_status,
                    "action": action,
                    "source": source,
                    "user": user,
                    "destination": destination,
                    "service": service,
                    "application": application,
                    "security_profile": url_filtering,
                    "category": category,
                    "description": description,
                }
                security_rules.append(rule_info)

        return pd.DataFrame(security_rules)

    def export_network_objects(self) -> pd.DataFrame:
        config_xml = self.get_config()
        tree = ET.fromstring(config_xml)
        address_entries = tree.findall('./result/config/devices/entry/vsys/entry/address/entry')
        address_objects = []

        for address in address_entries:
            address_name = address.attrib.get('name')
            address_type = address.find('*').tag if address.find('*') is not None else ""
            member_elements = address.findall(f'./{address_type}')
            members = [elem.text for elem in member_elements if elem.text is not None]

            object_info = {
                "Name": address_name,
                "Type": address_type,
                "Value": self.list_to_string(members)
            }
            address_objects.append(object_info)

        return pd.DataFrame(address_objects)

    def export_network_group_objects(self) -> pd.DataFrame:
        config_xml = self.get_config()
        tree = ET.fromstring(config_xml)
        group_entries = tree.findall('./result/config/devices/entry/vsys/entry/address-group/entry')
        group_objects = []

        for group in group_entries:
            group_name = group.attrib.get('name')
            member_elements = group.findall('./static/member')
            members = [elem.text for elem in member_elements if elem.text is not None]

            group_info = {
                "Group Name": group_name,
                "Entry": self.list_to_string(members)
            }
            group_objects.append(group_info)

        return pd.DataFrame(group_objects)

    def export_service_objects(self) -> pd.DataFrame:
        config_xml = self.get_config()
        tree = ET.fromstring(config_xml)
        service_entries = tree.findall('./result/config/devices/entry/vsys/entry/service/entry')
        service_objects = []

        for service in service_entries:
            service_name = service.attrib.get('name')
            protocol_elem = service.find('protocol')
            if protocol_elem is not None:
                for protocol in protocol_elem:
                    protocol_name = protocol.tag
                    port = protocol.find('port').text if protocol.find('port') is not None else None

                    service_info = {
                        "Name": service_name,
                        "Protocol": protocol_name,
                        "Port": port,
                    }
                    service_objects.append(service_info)

        return pd.DataFrame(service_objects)

    def export_service_group_objects(self) -> pd.DataFrame:
        config_xml = self.get_config()
        tree = ET.fromstring(config_xml)
        group_entries = tree.findall('./result/config/devices/entry/vsys/entry/service-group/entry')
        group_objects = []

        for group in group_entries:
            group_name = group.attrib.get('name')
            member_elements = group.findall('./members/member')
            members = [elem.text for elem in member_elements if elem.text is not None]

            group_info = {
                "Group Name": group_name,
                "Entry": self.list_to_string(members),
            }
            group_objects.append(group_info)

        return pd.DataFrame(group_objects)

    # export_usage_logs는 인터페이스에서 제거되었습니다.

    def export_last_hit_date(self, vsys: list[str] | set[str] | None = None) -> pd.DataFrame:
        """VSYS를 고려하여 각 규칙의 최근 히트 일자만 반환합니다.

        Returns:
            pd.DataFrame: columns = ["Vsys", "Rule Name", "Last Hit Date"]
        """
        results: list[dict] = []

        def _fetch_vsys_hit(vsys_name: str) -> list[dict]:
            params = (
                ('type', 'op'),
                (
                    'cmd',
                    f"<show><rule-hit-count><vsys><vsys-name><entry name='{vsys_name}'>"
                    "<rule-base><entry name='security'><rules><all/></rules></entry></rule-base>"
                    "</entry></vsys-name></vsys></rule-hit-count></show>"
                ),
                ('key', self.api_key)
            )
            response = self.get_api_data(params)
            tree = ET.fromstring(response.text)
            rule_entries = tree.findall('./result/rule-hit-count/vsys/entry/rule-base/entry/rules/entry')

            vsys_results: list[dict] = []
            for rule in rule_entries:
                rule_name = str(rule.attrib.get('name'))
                member_texts = self._get_member_texts(rule)
                # Palo Alto 응답에서 인덱스 2가 last-hit-timestamp인 구조를 가정
                try:
                    # Palo Alto는 epoch timestamp를 문자열로 반환
                    last_hit_ts = member_texts[2] if len(member_texts) > 2 else None
                    # None, 빈 문자열, 0, 또는 변환 불가능한 값일 때 None 반환
                    if last_hit_ts is None or last_hit_ts == '' or last_hit_ts == 0 or last_hit_ts == '0':
                        last_hit_date = None
                    else:
                        try:
                            ts_int = int(last_hit_ts)
                            if ts_int == 0:
                                last_hit_date = None
                            else:
                                last_hit_date = datetime.datetime.fromtimestamp(ts_int).strftime("%Y-%m-%d %H:%M:%S")
                        except (ValueError, TypeError):
                            last_hit_date = None
                except IndexError:
                    last_hit_date = None

                vsys_results.append({
                    "vsys": vsys_name,
                    "rule_name": rule_name,
                    "last_hit_date": last_hit_date,
                })
            return vsys_results

        # vsys 파라미터가 주어진 경우 그것만 조회, 없으면 기본 vsys1만 조회해 과도한 호출 방지
        target_vsys_list: list[str]
        if vsys:
            target_vsys_list = [str(v) for v in vsys]
        else:
            target_vsys_list = ['vsys1']

        for vsys_name in target_vsys_list:
            try:
                results.extend(_fetch_vsys_hit(vsys_name))
            except Exception as e:
                self.logger.warning("VSYS %s hit-date 조회 실패: %s", vsys_name, e)

        df = pd.DataFrame(results)
        return df

    def export_last_hit_date_ssh(self, vsys: list[str] | set[str] | None = None) -> pd.DataFrame:
        """SSH를 통해 각 규칙의 최근 히트 일자 정보를 수집하고 파싱하여 DataFrame으로 반환합니다."""
        target_vsys_list: list[str] = ['vsys1']
        if vsys:
            target_vsys_list = [str(v) for v in vsys]

        self.logger.info(f"Starting SSH last_hit_date collection for vsys: {target_vsys_list}")
        all_results = []

        ssh = None
        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(self.hostname, port=22, username=self.username, password=self._password, timeout=20, look_for_keys=False, allow_agent=False)

            channel = ssh.invoke_shell()

            def read_until_prompt(prompt_pattern: str = r'>\s*$', timeout: int = 10) -> str:
                output = ""
                start_time = time.time()
                while True:
                    if channel.recv_ready():
                        output += channel.recv(65535).decode('utf-8', errors='ignore')
                        # 프롬프트가 출력의 마지막 라인에 있는지 확인
                        if output.strip().endswith(('>', '#')):
                            return output

                    if time.time() - start_time > timeout:
                        raise TimeoutError(f"Timed out waiting for shell prompt. Output received:\n{output}")

                    time.sleep(0.5)

            # 초기 프롬프트 및 배너 메시지 처리
            read_until_prompt(timeout=20)

            channel.send("set cli scripting-mode on\n")
            read_until_prompt()

            channel.send("set cli pager off\n")
            read_until_prompt()

            for vsys_name in target_vsys_list:
                command = f"show rule-hit-count vsys vsys-name {vsys_name} rule-base security rules all\n"
                self.logger.info(f"Executing command for vsys {vsys_name}: {command.strip()}")
                channel.send(command)

                # 명령어 실행 결과를 충분히 기다려서 받음
                output = read_until_prompt(timeout=3600) # Long timeout for potentially large outputs
                self.logger.info(f"Raw output received for vsys {vsys_name}, attempting to parse.")

                lines = output.splitlines()
                parsing_started = False
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue

                    # 데이터 시작점 (헤더 구분선)을 찾음
                    if '----------' in line:
                        parsing_started = True
                        continue

                    # 파싱이 시작되지 않았으면 다음 라인으로
                    if not parsing_started:
                        continue

                    # 특정 규칙 이름 (종료 지점)에서 파싱 중단
                    if line.startswith('intrazone-default'):
                        break

                    # 정규식을 사용하여 룰 이름, 히트 카운트, 타임스탬프 문자열을 추출
                    match = re.match(r'^([a-zA-Z0-9/._-]+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}|-)', line)
                    if match:
                        rule_name = match.group(1)
                        hit_count = match.group(2)
                        timestamp_str = match.group(3).strip()

                        last_hit_date = None
                        if timestamp_str != '-':
                            try:
                                # 여러 공백을 단일 공백으로 정규화
                                normalized_timestamp_str = re.sub(r'\s+', ' ', timestamp_str)
                                # 포맷: "Tue Nov  4 00:50:48 2025" (일(day)이 한 자리일 경우 공백이 2개)
                                dt_obj = datetime.datetime.strptime(normalized_timestamp_str, '%a %b %d %H:%M:%S %Y')
                                last_hit_date = dt_obj.strftime('%Y-%m-%d %H:%M:%S')
                            except ValueError:
                                self.logger.warning(f"Could not parse timestamp '{timestamp_str}' for rule '{rule_name}'.")

                        all_results.append({
                            "vsys": vsys_name,
                            "rule_name": rule_name,
                            "last_hit_date": last_hit_date
                        })

        except paramiko.AuthenticationException:
            self.logger.error("SSH authentication failed for %s.", self.hostname)
            raise FirewallAuthenticationError(f"SSH authentication failed for {self.hostname}.")
        except paramiko.SSHException as e:
            self.logger.error(f"SSH connection error for %s: %s", self.hostname, e)
            raise FirewallConnectionError(f"SSH connection error for {self.hostname}: {e}")
        except TimeoutError as e:
            self.logger.error(f"SSH command timed out for %s: %s", self.hostname, e)
            raise FirewallConnectionError(f"SSH command timed out for {self.hostname}: {e}")
        except Exception as e:
            self.logger.error(f"An unexpected error occurred during SSH collection for %s: %s", self.hostname, e, exc_info=True)
            raise FirewallAPIError(f"An unexpected error occurred during SSH collection for {self.hostname}: {e}")
        finally:
            if ssh:
                ssh.close()
                self.logger.info("SSH connection closed for %s.", self.hostname)

        return pd.DataFrame(all_results)
