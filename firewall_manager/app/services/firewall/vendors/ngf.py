# firewall/vendors/ngf.py
import json
import logging
import requests
import pandas as pd
from contextlib import contextmanager
from typing import Optional
from datetime import datetime

from ..interface import FirewallInterface
from ..exceptions import FirewallAuthenticationError

# SSL 경고 비활성화
requests.packages.urllib3.disable_warnings()

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')

class NGFClient:
    """
    NGF API와 연동하여 로그인, 데이터 조회, 규칙 파싱 등의 기능을 제공하는 클라이언트입니다.
    """
    def __init__(self, hostname: str, username: str, password: str, timeout: int = 60):
        self.hostname = hostname
        self.ext_clnt_id = username
        self.ext_clnt_secret = password
        self.timeout = timeout
        self.token = None
        self.user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/54.0.2840.99 Safari/537.6"
        )

    @contextmanager
    def session(self):
        """세션 컨텍스트 매니저"""
        try:
            self.login()
            yield
        finally:
            self.logout()

    def _get_headers(self, token: str = None) -> dict:
        headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': self.user_agent,
        }
        if token:
            headers['Authorization'] = str(token)
        return headers

    def login(self) -> str:
        """NGF에 로그인"""
        if self.token:
            return self.token

        url = f"https://{self.hostname}/api/au/external/login"
        data = {
            "ext_clnt_id": self.ext_clnt_id,
            "ext_clnt_secret": self.ext_clnt_secret,
            "lang": "ko",
            "force": 1
        }
        try:
            response = requests.post(
                url, headers=self._get_headers(), data=json.dumps(data),
                verify=False, timeout=3
            )
            if response.status_code == 200:
                self.token = response.json().get("result", {}).get("api_token")
                return self.token
        except Exception as e:
            logging.error(f"Exception during login: {e}")
        return None

    def logout(self) -> bool:
        """NGF에서 로그아웃"""
        if not self.token:
            return True

        url = f"https://{self.hostname}/api/au/external/logout"
        try:
            response = requests.delete(
                url, headers=self._get_headers(token=self.token),
                verify=False, timeout=3
            )
            if response.status_code == 200:
                self.token = None
                return True
        except Exception as e:
            logging.error(f"Exception during logout: {e}")
        return False

    def _get(self, endpoint: str) -> dict:
        url = f"https://{self.hostname}{endpoint}"
        try:
            response = requests.get(
                url, headers=self._get_headers(token=self.token),
                verify=False, timeout=self.timeout
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logging.error(f"Exception during GET {endpoint}: {e}")
        return None

    def get_fw4_rules(self) -> dict:
        return self._get("/api/po/fw/4/rules")

    def get_host_objects(self) -> dict:
        return self._get("/api/op/host/4/objects")

    def get_network_objects(self) -> dict:
        return self._get("/api/op/network/4/objects")

    def get_domain_objects(self) -> dict:
        return self._get("/api/op/domain/4/objects")

    def get_group_objects(self) -> dict:
        return self._get("/api/op/group/4/objects")

    def get_service_objects(self) -> dict:
        return self._get("/api/op/service/objects")

    def get_service_group_objects(self) -> dict:
        return self._get("/api/op/service-group/objects")

    def get_service_group_objects_information(self, service_group_name: str) -> dict:
        url = f"https://{self.hostname}/api/op/service-group/get/objects"
        try:
            response = requests.post(
                url, headers=self._get_headers(token=self.token),
                verify=False, timeout=self.timeout, json={'name': service_group_name}
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logging.error(f"Exception during get service group info: {e}")
        return None

    @staticmethod
    def list_to_string(list_data) -> str:
        if isinstance(list_data, list):
            return ','.join(str(s) for s in list_data)
        return list_data

    def export_security_rules(self) -> pd.DataFrame:
        try:
            if not self.login(): raise Exception("NGF 로그인 실패")
            rules_data = self.get_fw4_rules()
            if not rules_data: raise Exception("규칙 데이터를 가져올 수 없습니다")

            security_rules = []
            for rule in rules_data.get("result", []):
                if rule.get("name") == "default": continue

                info = {
                    "Seq": rule.get("seq"),
                    "Rule Name": rule.get("fw_rule_id"),
                    "Enable": "Y" if rule.get("use") == 1 else "N",
                    "Action": "allow" if rule.get("action") == 1 else "deny",
                    "Source": self.list_to_string([src.get("name") for src in rule.get("src", [])] or "any"),
                    "User": self.list_to_string([list(user.values())[0] for user in rule.get("user", [])] or "any"),
                    "Destination": self.list_to_string([dst.get("name") for dst in rule.get("dst", [])] or "any"),
                    "Service": self.list_to_string([srv.get("name") for srv in rule.get("srv", [])] or "any"),
                    "Application": self.list_to_string([app.get("name") for app in rule.get("app", [])] or "any"),
                    "Last Hit Date": rule.get("last_hit_time"),
                    "Description": rule.get("desc")
                }
                security_rules.append(info)
            return pd.DataFrame(security_rules)
        except Exception as e:
            raise Exception(f"NGF 규칙 데이터 수집 실패: {e}")
        finally:
            self.logout()

    def export_objects(self, object_type: str, use_session: bool = True) -> pd.DataFrame:
        if not object_type: raise ValueError("object_type 파라미터를 지정해야 합니다.")

        def _get_data():
            type_to_getter = {
                "host": self.get_host_objects, "network": self.get_network_objects,
                "domain": self.get_domain_objects, "group": self.get_group_objects,
                "service": self.get_service_objects, "service_group": self.get_service_group_objects,
            }
            getter = type_to_getter.get(object_type)
            if not getter: raise ValueError(f"유효하지 않은 객체 타입: {object_type}")

            data = getter()
            if not data: return pd.DataFrame()

            df = pd.json_normalize(data.get("result", []), sep='_')
            for col in df.columns:
                df[col] = df[col].apply(lambda x: self.list_to_string(x) if isinstance(x, list) else (','.join(map(str, x.values())) if isinstance(x, dict) else x))
            return df

        try:
            if use_session:
                with self.session(): return _get_data()
            else: return _get_data()
        except Exception as e:
            raise Exception(f"NGF {object_type} 객체 데이터 수집 실패: {e}")

    def export_service_group_objects_with_members(self) -> pd.DataFrame:
        with self.session():
            service_df = self.export_objects('service', use_session=False)
            service_lookup = {str(row['srv_obj_id']): row['name'] for _, row in service_df.iterrows() if 'srv_obj_id' in row and 'name' in row}

            group_df = self.export_objects('service_group', use_session=False)
            if group_df.empty: return pd.DataFrame()

            group_details = []
            for _, group in group_df.iterrows():
                object_data = self.get_service_group_objects_information(group['name'])
                if object_data and 'result' in object_data and object_data.get('result'):
                    detail = pd.json_normalize(object_data.get('result'), sep='_').iloc[0]
                    member_ids = str(detail.get('mem_id', '')).split(';')
                    member_names = [service_lookup.get(mid.strip(), f'Unknown_{mid.strip()}') for mid in member_ids if mid.strip()]
                    group_details.append({'Group Name': group['name'], 'Entry': ','.join(member_names)})
            return pd.DataFrame(group_details)

    def export_network_group_objects_with_members(self) -> pd.DataFrame:
        with self.session():
            host_df = self.export_objects('host', use_session=False)
            network_df = self.export_objects('network', use_session=False)
            group_df = self.export_objects('group', use_session=False)
            if group_df.empty: return pd.DataFrame(columns=['Group Name', 'Entry'])

            object_lookup = {str(row['addr_obj_id']): row['name'] for _, row in pd.concat([host_df, network_df]).iterrows() if 'addr_obj_id' in row and 'name' in row}

            group_membership = {str(group['addr_obj_id']): {'name': group['name'], 'direct_members': [mid.strip() for mid in str(group.get('mmbr_obj_id', '')).split(';') if mid.strip()], 'all_members': set()} for _, group in group_df.iterrows()}

            def resolve_group_membership(group_id: str, processed_groups: set = None):
                if processed_groups is None: processed_groups = set()
                if group_id in processed_groups: return set()
                if group_id not in group_membership: return set()
                if group_membership[group_id]['all_members']: return group_membership[group_id]['all_members']

                processed_groups.add(group_id)
                all_members = set()
                for member_id in group_membership[group_id]['direct_members']:
                    if member_id in object_lookup:
                        all_members.add(object_lookup[member_id])
                    elif member_id in group_membership:
                        all_members.update(resolve_group_membership(member_id, processed_groups))
                    else:
                        all_members.add(f'Unknown_{member_id}')
                processed_groups.remove(group_id)
                group_membership[group_id]['all_members'] = all_members
                return all_members

            for group_id in group_membership:
                if not group_membership[group_id]['all_members']:
                    resolve_group_membership(group_id)

            return pd.DataFrame([{'Group Name': info['name'], 'Entry': ','.join(sorted(info['all_members']))} for info in group_membership.values()])

class NGFCollector(FirewallInterface):
    def __init__(self, hostname: str, ext_clnt_id: str, ext_clnt_secret: str):
        super().__init__(hostname, ext_clnt_id, ext_clnt_secret)
        self.client = NGFClient(hostname, ext_clnt_id, ext_clnt_secret)

    def connect(self) -> bool:
        token = self.client.login()
        if token:
            self._connected = True
            self._connection_info = {"token": token}
            return True
        self._connected = False
        raise FirewallAuthenticationError("NGF 로그인 실패")

    def disconnect(self) -> bool:
        self.client.logout()
        self._connected = False
        return True

    def test_connection(self) -> bool:
        try:
            if self.client.login():
                self.client.logout()
                return True
        except Exception:
            pass
        return False

    def get_system_info(self) -> pd.DataFrame:
        """NGF 장비는 시스템 정보 조회를 지원하지 않습니다."""
        raise NotImplementedError("NGF 장비는 시스템 정보 조회를 지원하지 않습니다.")

    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        return self.client.export_security_rules()

    def export_network_objects(self) -> pd.DataFrame:
        with self.client.session():
            host_df = self.client.export_objects('host', use_session=False)
            host_df = host_df[['name', 'ip_list']].rename(columns={'name': 'Name', 'ip_list': 'Value'}) if not host_df.empty else pd.DataFrame(columns=['Name', 'Value'])
            host_df['Type'] = 'ip-netmask'

            network_df = self.client.export_objects('network', use_session=False)
            if not network_df.empty:
                network_df = network_df[['name', 'ip_list_ip_info1', 'ip_list_ip_info2']].rename(columns={'name': 'Name', 'ip_list_ip_info1': 'ip1', 'ip_list_ip_info2': 'ip2'})
                network_df['Value'] = network_df.apply(lambda row: f"{row['ip1']}-{row['ip2']}" if '.' in str(row.get('ip2', '')) else f"{row['ip1']}/{row['ip2']}", axis=1)
                network_df['Type'] = network_df['Value'].apply(lambda x: 'ip-range' if '-' in x else 'ip-netmask')
                network_df = network_df.drop(columns=['ip1', 'ip2'])
            else: network_df = pd.DataFrame(columns=['Name', 'Type', 'Value'])

            domain_df = self.client.export_objects('domain', use_session=False)
            domain_df = domain_df[['name', 'dmn_name']].rename(columns={'name': 'Name', 'dmn_name': 'Value'}) if not domain_df.empty else pd.DataFrame(columns=['Name', 'Value'])
            domain_df['Type'] = 'fqdn'

            return pd.concat([host_df, network_df, domain_df], ignore_index=True)

    def export_network_group_objects(self) -> pd.DataFrame:
        return self.client.export_network_group_objects_with_members()

    def export_service_objects(self) -> pd.DataFrame:
        service_df = self.client.export_objects('service')
        if not service_df.empty:
            service_df = service_df[['name', 'prtc_name', 'srv_port']].rename(columns={'name': 'Name', 'prtc_name': 'Protocol', 'srv_port': 'Port'})
            service_df['Protocol'] = service_df['Protocol'].str.lower()
            return service_df
        return pd.DataFrame(columns=['Name', 'Protocol', 'Port'])

    def export_service_group_objects(self) -> pd.DataFrame:
        return self.client.export_service_group_objects_with_members()

    def export_usage_logs(self, days: Optional[int] = None) -> pd.DataFrame:
        security_rules = self.export_security_rules()
        if security_rules.empty or 'Last Hit Date' not in security_rules.columns:
            return pd.DataFrame(columns=['Rule Name', 'Last Hit Date', 'Unused Days', '미사용여부'])

        result_df = security_rules[['Rule Name', 'Last Hit Date']].copy()
        current_date = datetime.now()

        def calculate_unused_days(last_hit_date):
            if pd.isna(last_hit_date) or not last_hit_date: return None
            try:
                return (current_date - datetime.strptime(last_hit_date, '%Y-%m-%d %H:%M:%S')).days
            except (ValueError, TypeError): return None

        result_df['Unused Days'] = result_df['Last Hit Date'].apply(calculate_unused_days)

        def determine_usage_status(unused_days):
            if pd.isna(unused_days): return '미사용'
            if days is not None and unused_days > days: return '미사용'
            return '사용'

        result_df['미사용여부'] = result_df['Unused Days'].apply(determine_usage_status)
        return result_df
