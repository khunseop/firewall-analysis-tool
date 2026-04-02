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
# Palo Alto 장비와의 통신을 위해 레거시 암호화 스위트(DES-CBC3-SHA)를 허용하도록 설정합니다.
try:
    requests.packages.urllib3.util.ssl_.DEFAULT_CIPHERS += ':DES-CBC3-SHA'
except AttributeError:
    pass
# 자체 서명된 인증서를 사용하는 경우가 많으므로 SSL 경고를 비활성화합니다.
requests.packages.urllib3.disable_warnings()


class PaloAltoAPI(FirewallInterface):
    """
    Palo Alto 차세대 방화벽(PAN-OS)을 위한 연동 클래스입니다.
    XML API와 SSH(Paramiko)를 모두 사용하여 데이터를 추출합니다.
    """
    def __init__(self, hostname: str, username: str, password: str) -> None:
        super().__init__(hostname, username, password)
        self.base_url = f'https://{hostname}/api/'
        self.api_key = None

    def connect(self) -> bool:
        """
        방화벽에 연결하고 API 키를 발급받습니다.
        """
        try:
            self.api_key = self._get_api_key(self.username, self._password)
            self._connected = True
            return True
        except Exception as e:
            self.logger.error(f"Palo Alto 연결 실패: {e}")
            self._connected = False
            return False

    def disconnect(self) -> bool:
        """
        연결을 종료합니다. Palo Alto API는 상태 유지가 아니므로 키를 무효화합니다.
        """
        self.api_key = None
        self._connected = False
        return True

    def test_connection(self) -> bool:
        """연결 상태를 테스트합니다."""
        return self.connect()

    @staticmethod
    def _get_member_texts(xml_elements) -> list:
        """XML 요소 리스트에서 텍스트 값만 추출하여 리스트로 반환합니다."""
        try:
            return [element.text for element in xml_elements if element.text is not None]
        except Exception:
            return []

    @staticmethod
    def list_to_string(list_data: list) -> str:
        """리스트 요소를 콤마(,)로 구분된 문자열로 변환합니다."""
        return ','.join(str(item) for item in list_data)

    def get_api_data(self, parameters, timeout: int = 10000):
        """
        Palo Alto XML API에 HTTP GET 요청을 보냅니다.
        
        Args:
            parameters: API 요청 파라미터 (dict 또는 tuple)
            timeout: 요청 타임아웃 (초)
        """
        try:
            response = requests.get(
                self.base_url,
                params=parameters,
                verify=False,  # SSL 인증서 검증 비활성화
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
        """
        XML API 사용을 위한 API 키를 생성합니다.
        
        Palo Alto는 'type=keygen' 요청을 통해 사용자 인증 후 세션 대신 사용할 키를 발급합니다.
        """
        try:
            keygen_params = (
                ('type', 'keygen'),
                ('user', username),
                ('password', password)
            )
            response = self.get_api_data(keygen_params)
            tree = ET.fromstring(response.text)
            # 결과 XML에서 /result/key 경로의 텍스트를 추출
            key_element = tree.find('./result/key')
            if key_element is None:
                raise FirewallAuthenticationError("API 키를 찾을 수 없습니다")
            return key_element.text
        except ET.ParseError:
            raise FirewallAPIError("API 응답 XML 파싱 실패")
        except Exception as e:
            raise FirewallAuthenticationError(f"API 키 생성 실패: {str(e)}")

    def get_config(self, config_type: str = 'running') -> str:
        """
        방화벽의 설정을 XML 형태로 가져옵니다.
        
        xpath='/config'를 사용하여 전체 설정 트리를 요청합니다.
        """
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
        """장비의 시스템 정보를 조회합니다."""
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
        """
        보안 정책(Security Rules)을 추출하여 DataFrame으로 변환합니다.
        
        Palo Alto XML 구조 분석:
        1. /config/devices/entry/vsys/entry 경로를 통해 각 가상 시스템(VSYS)에 접근합니다.
        2. 각 VSYS 내부의 rulebase/security/rules/entry 경로를 순회하며 개별 정책을 파싱합니다.
        3. <disabled> 태그 존재 여부에 따라 정책의 활성화 상태를 판단합니다.
        """
        config_type = kwargs.get('config_type', 'running')
        config_xml = self.get_config(config_type)
        tree = ET.fromstring(config_xml)
        
        # 모든 VSYS 항목 탐색
        vsys_entries = tree.findall('./result/config/devices/entry/vsys/entry')
        security_rules = []

        for vsys in vsys_entries:
            vsys_name = vsys.attrib.get('name')
            # 해당 VSYS의 보안 정책 기지(rulebase) 탐색
            rulebase = vsys.findall('./rulebase/security/rules/entry')
            for idx, rule in enumerate(rulebase):
                rule_name = str(rule.attrib.get('name'))
                
                # PAN-OS XML: <disabled>yes</disabled> 이면 비활성 상태입니다.
                disabled_list = self._get_member_texts(rule.findall('./disabled'))
                is_disabled = (self.list_to_string(disabled_list).strip().lower() == "yes")
                # 내부 표준에 따라 활성은 'Y', 비활성은 'N'으로 변환
                disabled_status = "Y" if not is_disabled else "N"
                
                # 각 정책 구성 요소(객체)들을 콤마 구분 문자열로 추출
                action = self.list_to_string(self._get_member_texts(rule.findall('./action')))
                source = self.list_to_string(self._get_member_texts(rule.findall('./source/member')))
                user = self.list_to_string(self._get_member_texts(rule.findall('./source-user/member')))
                destination = self.list_to_string(self._get_member_texts(rule.findall('./destination/member')))
                service = self.list_to_string(self._get_member_texts(rule.findall('./service/member')))
                application = self.list_to_string(self._get_member_texts(rule.findall('./application/member')))
                
                # 보안 프로필 및 카테고리 정보 추출
                url_filtering = self.list_to_string(self._get_member_texts(rule.findall('./profile-setting/profiles/url-filtering/member')))
                category = self.list_to_string(self._get_member_texts(rule.findall('./category/member')))
                category = "any" if not category else category
                
                # 설명(Description) 필드 줄바꿈 제거
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
        """네트워크 주소 객체를 추출합니다."""
        config_xml = self.get_config()
        tree = ET.fromstring(config_xml)
        address_entries = tree.findall('./result/config/devices/entry/vsys/entry/address/entry')
        address_objects = []

        for address in address_entries:
            address_name = address.attrib.get('name')
            # ip-netmask, ip-range, fqdn 중 하나를 가짐
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
        """네트워크 주소 그룹 객체를 추출합니다."""
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
        """서비스(포트) 객체를 추출합니다."""
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
        """서비스 그룹 객체를 추출합니다."""
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

    def export_last_hit_date(self, vsys: list[str] | set[str] | None = None) -> pd.DataFrame:
        """
        XML API를 사용하여 정책별 마지막 히트 일시를 조회합니다.
        
        Palo Alto XML API 응답 분석:
        - <rule-hit-count> 명령의 응답 XML에서 각 정책(<entry>)의 하위 텍스트 노드를 파싱합니다.
        - 일반적으로 인덱스 2 위치에 Epoch Timestamp(초 단위 문자열)가 포함되어 있습니다.
        - 이 값을 datetime 객체로 변환하여 표준 포맷(%Y-%m-%d %H:%M:%S)으로 제공합니다.
        """
        results: list[dict] = []

        def _fetch_vsys_hit(vsys_name: str) -> list[dict]:
            # 특정 VSYS의 모든 보안 정책 히트 카운트를 요청하는 조작 명령(Operational Command)
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
                # 해당 XML 노드의 모든 텍스트 멤버를 가져옵니다.
                member_texts = self._get_member_texts(rule)
                
                try:
                    # Palo Alto API 구조상 3번째(index 2) 텍스트가 last-hit-timestamp인 경우가 많습니다.
                    last_hit_ts = member_texts[2] if len(member_texts) > 2 else None
                    
                    # 0 또는 빈 값인 경우 히트 이력이 없는 것으로 간주합니다.
                    if last_hit_ts in [None, '', 0, '0']:
                        last_hit_date = None
                    else:
                        try:
                            ts_int = int(last_hit_ts)
                            if ts_int == 0:
                                last_hit_date = None
                            else:
                                # Epoch(1970-01-01) 기반 정수를 날짜 문자열로 변환
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

        # 조회 대상 VSYS 목록 설정 (기본값 vsys1)
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

        return pd.DataFrame(results)

    def export_last_hit_date_ssh(self, vsys: list[str] | set[str] | None = None) -> pd.DataFrame:
        """
        SSH 인터랙티브 쉘을 사용하여 정책 히트 정보를 정밀하게 추출합니다.
        API 응답이 부정확하거나 누락된 데이터가 있을 때 대안으로 사용됩니다.
        
        주요 로직:
        1. Paramiko를 통한 SSH 세션 수립 및 인터랙티브 쉘(invoke_shell) 실행.
        2. 프롬프트('>', '#')가 나타날 때까지 버퍼를 읽는 `read_until_prompt` 구현.
        3. CLI 환경 설정을 조정: scripting-mode ON(파싱 최적화), pager OFF(중단 없는 출력).
        4. 정책 정보를 출력하는 CLI 명령 실행 및 수천 줄에 달하는 출력을 수집.
        5. 복합 정규식(Regex)을 사용하여 정책 이름, 히트 수, 타임스탬프를 한 줄씩 파싱.
           - 타임스탬프 포맷(예: Tue Nov 4 00:50:48 2025)을 정규화하여 처리.
        """
        target_vsys_list: list[str] = ['vsys1']
        if vsys:
            target_vsys_list = [str(v) for v in vsys]

        self.logger.info(f"Palo Alto SSH 기반 히트 정보 수집 시작 (VSYS: {target_vsys_list})")
        all_results = []

        ssh = None
        try:
            # SSH 클라이언트 설정 및 접속
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                self.hostname, port=22, 
                username=self.username, password=self._password, 
                timeout=20, look_for_keys=False, allow_agent=False
            )

            # 인터랙티브 쉘 채널 획득
            channel = ssh.invoke_shell()

            def read_until_prompt(prompt_pattern: str = r'>\s*$', timeout: int = 10) -> str:
                """쉘 프롬프트가 나타날 때까지 데이터를 계속해서 읽어들입니다."""
                output = ""
                start_time = time.time()
                while True:
                    if channel.recv_ready():
                        # 수신된 바이트를 UTF-8로 디코딩, 오류 무시
                        output += channel.recv(65535).decode('utf-8', errors='ignore')
                        # 프롬프트 기호(>, #)로 끝나면 수신 완료로 판단
                        if output.strip().endswith(('>', '#')):
                            return output

                    if time.time() - start_time > timeout:
                        raise TimeoutError(f"쉘 프롬프트 대기 시간 초과. 현재 출력:\n{output}")

                    time.sleep(0.5)

            # 로그인 배너 및 초기 프롬프트 대기
            read_until_prompt(timeout=20)

            # CLI 자동화 설정: 스크립팅 모드 활성화 및 페이징 비활성화
            channel.send("set cli scripting-mode on\n")
            read_until_prompt()
            channel.send("set cli pager off\n")
            read_until_prompt()

            for vsys_name in target_vsys_list:
                command = f"show rule-hit-count vsys vsys-name {vsys_name} rule-base security rules all\n"
                self.logger.info(f"VSYS {vsys_name} 명령 실행: {command.strip()}")
                channel.send(command)

                # 대량의 정책 정보 출력을 고려하여 긴 타임아웃(3600초) 적용
                output = read_until_prompt(timeout=3600)
                self.logger.info(f"VSYS {vsys_name} 데이터 수신 완료, 파싱 시작.")

                lines = output.splitlines()
                parsing_started = False
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue

                    # CLI 출력에서 데이터 섹션을 알리는 구분선(----------) 확인
                    if '----------' in line:
                        parsing_started = True
                        continue

                    if not parsing_started:
                        continue

                    # 기본 정책이 나타나면 사용자 정의 정책 영역 종료로 간주
                    if line.startswith('intrazone-default'):
                        break

                    # 정규식 패턴 분석: [룰이름] [히트수] [날짜문자열 또는 '-']
                    # 날짜 예시: "Tue Nov  4 00:50:48 2025"
                    match = re.match(r'^([a-zA-Z0-9/._-]+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}|-)', line)
                    if match:
                        rule_name = match.group(1)
                        timestamp_str = match.group(3).strip()

                        last_hit_date = None
                        if timestamp_str != '-':
                            try:
                                # 날짜 사이의 중복 공백(한 자리 일자 대비)을 단일 공백으로 치환
                                normalized_ts = re.sub(r'\s+', ' ', timestamp_str)
                                # "%a %b %d %H:%M:%S %Y" 형식으로 파싱
                                dt_obj = datetime.datetime.strptime(normalized_ts, '%a %b %d %H:%M:%S %Y')
                                last_hit_date = dt_obj.strftime('%Y-%m-%d %H:%M:%S')
                            except ValueError:
                                self.logger.warning(f"규칙 '{rule_name}'의 타임스탬프 파싱 실패: '{timestamp_str}'")

                        all_results.append({
                            "vsys": vsys_name,
                            "rule_name": rule_name,
                            "last_hit_date": last_hit_date
                        })

        except paramiko.AuthenticationException:
            self.logger.error(f"SSH 인증 실패: {self.hostname}")
            raise FirewallAuthenticationError(f"SSH 인증 실패: {self.hostname}")
        except paramiko.SSHException as e:
            self.logger.error(f"SSH 연결 오류: {self.hostname}, {e}")
            raise FirewallConnectionError(f"SSH 연결 오류: {self.hostname}")
        except TimeoutError as e:
            self.logger.error(f"SSH 명령 타임아웃: {self.hostname}, {e}")
            raise FirewallConnectionError(f"SSH 명령 타임아웃: {self.hostname}")
        except Exception as e:
            self.logger.error(f"SSH 수집 중 예기치 않은 오류 발생: {self.hostname}, {e}", exc_info=True)
            raise FirewallAPIError(f"SSH 수집 중 오류: {str(e)}")
        finally:
            if ssh:
                ssh.close()
                self.logger.info(f"SSH 연결 종료: {self.hostname}")

        return pd.DataFrame(all_results)
