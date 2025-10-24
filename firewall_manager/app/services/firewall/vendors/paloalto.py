# firewall_manager/app/services/firewall/vendors/paloalto.py
import time
import datetime
import logging
import requests
import xml.etree.ElementTree as ET

import pandas as pd
from typing import Optional

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

    def get_api_data(self, parameters, timeout: int = 30):
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

    def get_config(self, config_type: str = 'running', timeout: int = 30) -> str:
        action = 'show' if config_type == 'running' else 'get'
        params = (
            ('key', self.api_key),
            ('type', 'config'),
            ('action', action),
            ('xpath', '/config')
        )
        response = self.get_api_data(params, timeout=timeout)
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
        """Export security rules, optionally merged with hit count data.

        kwargs:
            config_type: running or candidate
            include_hit: if True, merge last hit dates
            secondary_hostname: optional secondary HA member IP/hostname to fetch hit counts from
            vsys_filter: if provided, restrict to specific vsys name
            hit_timeout_seconds: per-request timeout seconds for hit APIs
        """
        config_type = kwargs.get('config_type', 'running')
        vsys_filter: Optional[str] = kwargs.get('vsys_filter')
        include_hit: bool = kwargs.get('include_hit', False)
        secondary_hostname: Optional[str] = kwargs.get('secondary_hostname')
        hit_timeout_seconds: int = int(kwargs.get('hit_timeout_seconds', 30))

        config_xml = self.get_config(config_type=config_type, timeout=hit_timeout_seconds)
        tree = ET.fromstring(config_xml)
        vsys_entries = tree.findall('./result/config/devices/entry/vsys/entry')
        security_rules = []

        for vsys in vsys_entries:
            vsys_name = vsys.attrib.get('name')
            rulebase = vsys.findall('./rulebase/security/rules/entry')
            for idx, rule in enumerate(rulebase):
                rule_name = str(rule.attrib.get('name'))
                disabled_list = self._get_member_texts(rule.findall('./disabled'))
                disabled_status = "N" if self.list_to_string(disabled_list) == "yes" else "Y"
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
                    "Vsys": vsys_name,
                    "Seq": idx + 1,
                    "Rule_Name": rule_name,
                    "Enable": disabled_status,
                    "Action": action,
                    "Source": source,
                    "User": user,
                    "Destination": destination,
                    "Service": service,
                    "Application": application,
                    "Security_Profile": url_filtering,
                    "Category": category,
                    "Description": description,
                }
                security_rules.append(rule_info)

        rules_df = pd.DataFrame(security_rules)

        if not include_hit or rules_df.empty:
            return rules_df

        # Merge primary hit counts
        try:
            hit_df_primary = self.export_hit_count(vsys_name=vsys_filter or 'vsys1', timeout=hit_timeout_seconds)
        except Exception as e:
            self.logger.warning("Hit count fetch failed on primary: %s", e)
            hit_df_primary = pd.DataFrame(columns=['Vsys', 'Rule Name', 'Last Hit Date'])

        if not hit_df_primary.empty:
            hit_df_primary = hit_df_primary[['Vsys', 'Rule Name', 'Last Hit Date']]
            rules_df = rules_df.merge(hit_df_primary, how='left', left_on=['Vsys', 'Rule_Name'], right_on=['Vsys', 'Rule Name'])
            # Drop helper column
            if 'Rule Name' in rules_df.columns:
                rules_df = rules_df.drop(columns=['Rule Name'])
            # Normalize to standard column for downstream mapper
            if 'Last Hit Date' in rules_df.columns:
                rules_df = rules_df.rename(columns={'Last Hit Date': 'last_hit_date'})

        # Merge secondary hit counts if provided
        if secondary_hostname:
            try:
                hit_df_secondary = self.export_hit_count_from_other_host(other_hostname=secondary_hostname, vsys_name=vsys_filter or 'vsys1', timeout=hit_timeout_seconds)
            except Exception as e:
                self.logger.warning("Secondary hit count fetch failed: %s", e)
                hit_df_secondary = pd.DataFrame(columns=['Vsys', 'Rule Name', 'Last Hit Date'])

            if not hit_df_secondary.empty:
                hit_df_secondary = hit_df_secondary[['Vsys', 'Rule Name', 'Last Hit Date']].rename(columns={'Last Hit Date': 'last_hit_date_secondary'})
                rules_df = rules_df.merge(hit_df_secondary, how='left', left_on=['Vsys', 'Rule_Name'], right_on=['Vsys', 'Rule Name'])
                if 'Rule Name' in rules_df.columns:
                    rules_df = rules_df.drop(columns=['Rule Name'])
        else:
            # If only primary available, ensure standard naming too
            if 'Last Hit Date' in rules_df.columns:
                rules_df = rules_df.rename(columns={'Last Hit Date': 'last_hit_date'})

        return rules_df

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

    def export_usage_logs(self, days: int = None) -> pd.DataFrame:
        # Palo Alto API는 특정 기간의 hit count 조회를 직접 지원하지 않음
        # export_hit_count 결과를 후처리하여 유사한 기능을 구현할 수 있음
        # 여기서는 export_hit_count를 호출하고, Unused Days로 필터링하는 방식을 제안
        hit_counts = self.export_hit_count()
        if days is not None and not hit_counts.empty:
            hit_counts = hit_counts[hit_counts['Unused Days'] <= days]
        return hit_counts

    def export_hit_count(self, vsys_name: str = 'vsys1', timeout: int = 30) -> pd.DataFrame:
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
        response = self.get_api_data(params, timeout=timeout)
        tree = ET.fromstring(response.text)
        rule_entries = tree.findall('./result/rule-hit-count/vsys/entry/rule-base/entry/rules/entry')

        hit_counts = []
        for rule in rule_entries:
            rule_name = str(rule.attrib.get('name'))
            member_texts = self._get_member_texts(rule)
            try:
                hit_count = member_texts[1]
                last_hit_ts = int(member_texts[2])
                first_hit_ts = int(member_texts[4])
            except (IndexError, ValueError) as error:
                self.logger.warning("히트 카운트 파싱 스킵 (rule=%s): %s", rule_name, error)
                continue

            no_unused_days = 99999
            no_hit_date = datetime.datetime(1900, 1, 1).strftime('%Y-%m-%d')

            if first_hit_ts == 0:
                unused_days = no_unused_days
            else:
                unused_days = (datetime.datetime.now() - datetime.datetime.fromtimestamp(last_hit_ts)).days

            last_hit_date = no_hit_date if last_hit_ts == 0 else datetime.datetime.fromtimestamp(last_hit_ts).strftime('%Y-%m-%d')
            first_hit_date = no_hit_date if first_hit_ts == 0 else datetime.datetime.fromtimestamp(first_hit_ts).strftime('%Y-%m-%d')

            hit_counts.append({
                "Vsys": vsys_name,
                "Rule Name": rule_name,
                "Hit Count": hit_count,
                "First Hit Date": first_hit_date,
                "Last Hit Date": last_hit_date,
                "Unused Days": unused_days
            })

        return pd.DataFrame(hit_counts)

    def export_hit_count_from_other_host(self, other_hostname: str, vsys_name: str = 'vsys1', timeout: int = 30) -> pd.DataFrame:
        """Fetch hit counts from a secondary HA member using same credentials."""
        other = PaloAltoAPI(hostname=other_hostname, username=self.username, password=self._password)
        if not other.connect():
            raise FirewallConnectionError(f"Secondary host connect failed: {other_hostname}")
        try:
            return other.export_hit_count(vsys_name=vsys_name, timeout=timeout)
        finally:
            other.disconnect()
