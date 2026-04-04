# firewall_manager/app/services/firewall/vendors/ngf.py
import json
import logging
import requests
import pandas as pd
from contextlib import contextmanager
from typing import Optional
from datetime import datetime

from ..interface import FirewallInterface
from ..exceptions import FirewallAuthenticationError

# SSL 인증서 경고 비활성화: 자체 서명된 인증서를 사용하는 방화벽 장비와의 통신을 위함입니다.
requests.packages.urllib3.disable_warnings()

# 로깅 설정
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')

class NGFClient:
    """
    SECUI NGF REST API 연동 클라이언트입니다.
    
    주요 기능:
    - ID/Secret 기반의 토큰 인증 및 관리 (Login/Logout)
    - 정책 및 객체 데이터의 RESTful API 요청 처리
    - 복잡한 JSON 응답 구조의 평면화(Normalization) 및 표준화
    """
    def __init__(self, hostname: str, username: str, password: str, timeout: int = 60):
        self.hostname = hostname
        self.ext_clnt_id = username        # API Client ID
        self.ext_clnt_secret = password    # API Client Secret
        self.timeout = timeout
        self.token = None
        # 브라우저 요청처럼 보이기 위한 User-Agent 설정
        self.user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/54.0.2840.99 Safari/537.6"
        )

    @contextmanager
    def session(self):
        """
        API 세션을 관리하는 컨텍스트 매니저입니다.
        블록 시작 시 로그인하여 토큰을 획득하고, 블록 종료 시 로그아웃을 보장합니다.
        """
        try:
            self.login()
            yield
        finally:
            self.logout()

    def _get_headers(self, token: str = None) -> dict:
        """API 요청에 필요한 공통 헤더를 생성합니다."""
        headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': self.user_agent,
        }
        if token:
            # 인증 토큰이 있는 경우 Authorization 헤더에 추가
            headers['Authorization'] = str(token)
        return headers

    def login(self) -> str:
        """
        NGF API 서버에 인증을 시도하고 액세스 토큰(api_token)을 획득합니다.
        
        인증 프로세스:
        1. /api/au/external/login 엔드포인트로 POST 요청.
        2. Client ID/Secret을 포함한 JSON 본문 전송.
        3. 성공 시 반환된 api_token을 내부 상태에 저장.
        """
        if self.token:
            return self.token

        url = f"https://{self.hostname}/api/au/external/login"
        data = {
            "ext_clnt_id": self.ext_clnt_id,
            "ext_clnt_secret": self.ext_clnt_secret,
            "lang": "ko",
            "force": 1  # 기존 세션이 있더라도 강제 로그인
        }
        try:
            response = requests.post(
                url, headers=self._get_headers(), data=json.dumps(data),
                verify=False, timeout=5
            )
            if response.status_code == 200:
                # 응답 JSON의 result.api_token 경로에서 토큰 추출
                self.token = response.json().get("result", {}).get("api_token")
                return self.token
            else:
                logging.error(f"NGF 로그인 실패 (HTTP {response.status_code}): {response.text}")
        except Exception as e:
            logging.error(f"NGF 로그인 중 예외 발생: {e}")
        return None

    def logout(self) -> bool:
        """획득한 API 토큰을 무효화하고 세션을 종료합니다."""
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
            logging.error(f"NGF 로그아웃 중 예외 발생: {e}")
        return False

    def _get(self, endpoint: str) -> dict:
        """인증된 토큰을 사용하여 GET API 요청을 수행합니다."""
        url = f"https://{self.hostname}{endpoint}"
        try:
            response = requests.get(
                url, headers=self._get_headers(token=self.token),
                verify=False, timeout=self.timeout
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logging.error(f"NGF GET {endpoint} 요청 중 예외 발생: {e}")
        return None

    # 엔드포인트별 데이터 수집 메서드 정의
    def get_fw4_rules(self) -> dict: return self._get("/api/po/fw/4/rules")
    def get_host_objects(self) -> dict: return self._get("/api/op/host/4/objects")
    def get_network_objects(self) -> dict: return self._get("/api/op/network/4/objects")
    def get_domain_objects(self) -> dict: return self._get("/api/op/domain/4/objects")
    def get_group_objects(self) -> dict: return self._get("/api/op/group/4/objects")
    def get_service_objects(self) -> dict: return self._get("/api/op/service/objects")
    def get_service_group_objects(self) -> dict: return self._get("/api/op/service-group/objects")

    def get_service_group_objects_information(self, service_group_name: str) -> dict:
        """특정 서비스 그룹의 상세 멤버 정보를 조회합니다 (POST 요청 필요)."""
        url = f"https://{self.hostname}/api/op/service-group/get/objects"
        try:
            response = requests.post(
                url, headers=self._get_headers(token=self.token),
                verify=False, timeout=self.timeout, json={'name': service_group_name}
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logging.error(f"서비스 그룹 상세 정보 조회 실패: {e}")
        return None

    @staticmethod
    def list_to_string(list_data) -> str:
        """리스트 형태의 데이터를 콤마로 구분된 단일 문자열로 변환합니다."""
        if isinstance(list_data, list):
            return ','.join(str(s) for s in list_data)
        return list_data

    def export_security_rules(self) -> pd.DataFrame:
        """
        NGF 보안 정책 목록을 수집하여 표준 데이터프레임 형식으로 변환합니다.
        
        응답 JSON 파싱:
        - 'result' 리스트 내의 각 룰 객체를 순회.
        - 'src', 'dst', 'srv' 등 리스트 형태의 필드에서 이름(name)을 추출하여 통합.
        - 활성화 상태(use) 및 액션(action) 값을 사람이 읽기 쉬운 형태로 변환.
        """
        try:
            if not self.login(): raise Exception("NGF 로그인 실패")
            rules_data = self.get_fw4_rules()
            if not rules_data: raise Exception("규칙 데이터를 가져올 수 없습니다")

            security_rules = []
            for rule in rules_data.get("result", []):
                # 기본 정책(암묵적 거부 등) 스킵
                if rule.get("name") == "default": continue

                info = {
                    "seq": rule.get("seq"),
                    "rule_name": rule.get("fw_rule_id"),
                    "enable": "Y" if rule.get("use") == 1 else "N",
                    "action": "allow" if rule.get("action") == 1 else "deny",
                    # 멤버 리스트에서 'name' 속성만 추출하여 합침
                    "source": self.list_to_string([src.get("name") for src in rule.get("src", [])] or "any"),
                    "user": self.list_to_string([list(user.values())[0] for user in rule.get("user", [])] or "any"),
                    "destination": self.list_to_string([dst.get("name") for dst in rule.get("dst", [])] or "any"),
                    "service": self.list_to_string([srv.get("name") for srv in rule.get("srv", [])] or "any"),
                    "application": self.list_to_string([app.get("name") for app in rule.get("app", [])] or "any"),
                    "last_hit_date": rule.get("last_hit_time"),
                    "description": rule.get("desc")
                }
                security_rules.append(info)
            return pd.DataFrame(security_rules)
        except Exception as e:
            raise Exception(f"NGF 규칙 데이터 수집 실패: {e}")
        finally:
            self.logout()

    def export_objects(self, object_type: str, use_session: bool = True) -> pd.DataFrame:
        """
        다양한 타입의 객체 데이터를 수집하고 pandas json_normalize를 통해 정규화합니다.
        
        로직:
        1. 지정된 타입에 맞는 Getter 함수 호출.
        2. pd.json_normalize를 사용하여 중첩된 JSON 응답을 평면화(Flattend)된 컬럼 구조로 변환.
        3. 리스트나 딕셔너리 형태의 컬럼 값을 통합 문자열로 후처리.
        """
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

            # 중첩된 JSON 구조를 언더스코어(_) 구분자를 사용하는 컬럼으로 평면화
            df = pd.json_normalize(data.get("result", []), sep='_')
            # 복합 구조 필드들에 대한 데이터 정제
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
        """서비스 그룹과 그룹 내 포함된 서비스 멤버들을 매핑하여 반환합니다."""
        with self.session():
            # ID기반 조회를 위해 전체 서비스 목록 선출
            service_df = self.export_objects('service', use_session=False)
            service_lookup = {str(row['srv_obj_id']): row['name'] for _, row in service_df.iterrows() if 'srv_obj_id' in row and 'name' in row}

            group_df = self.export_objects('service_group', use_session=False)
            if group_df.empty: return pd.DataFrame()

            group_details = []
            for _, group in group_df.iterrows():
                # 개별 그룹 상세 API 호출을 통해 멤버 ID 획득
                object_data = self.get_service_group_objects_information(group['name'])
                if object_data and 'result' in object_data and object_data.get('result'):
                    detail = pd.json_normalize(object_data.get('result'), sep='_').iloc[0]
                    member_ids = str(detail.get('mem_id', '')).split(';')
                    # ID를 서비스 이름으로 치환
                    member_names = [service_lookup.get(mid.strip(), f'Unknown_{mid.strip()}') for mid in member_ids if mid.strip()]
                    group_details.append({'Group Name': group['name'], 'Entry': ','.join(member_names)})
            return pd.DataFrame(group_details)

    def export_network_group_objects_with_members(self) -> pd.DataFrame:
        """네트워크 주소 그룹에 포함된 모든 하위 객체들을 재귀적으로 분석하여 반환합니다."""
        with self.session():
            host_df = self.export_objects('host', use_session=False)
            network_df = self.export_objects('network', use_session=False)
            group_df = self.export_objects('group', use_session=False)
            if group_df.empty: return pd.DataFrame(columns=['Group Name', 'Entry'])

            # 주소 ID 매핑 생성
            object_lookup = {str(row['addr_obj_id']): row['name'] for _, row in pd.concat([host_df, network_df]).iterrows() if 'addr_obj_id' in row and 'name' in row}

            # 그룹 간의 포함 관계 구조 생성
            group_membership = {
                str(group['addr_obj_id']): {
                    'name': group['name'], 
                    'direct_members': [mid.strip() for mid in str(group.get('mmbr_obj_id', '')).split(';') if mid.strip()],
                    'all_members': set()
                } for _, group in group_df.iterrows()
            }

            def resolve_group_membership(group_id: str, processed_groups: set = None):
                """그룹 내에 다른 그룹이 포함된 경우를 해결하기 위한 재귀 함수입니다."""
                if processed_groups is None: processed_groups = set()
                if group_id in processed_groups: return set()  # 순환 참조 방지
                if group_id not in group_membership: return set()
                if group_membership[group_id]['all_members']: return group_membership[group_id]['all_members']

                processed_groups.add(group_id)
                all_members = set()
                for member_id in group_membership[group_id]['direct_members']:
                    if member_id in object_lookup:
                        all_members.add(object_lookup[member_id])
                    elif member_id in group_membership:
                        # 하위 그룹인 경우 재귀 호출
                        all_members.update(resolve_group_membership(member_id, processed_groups))
                    else:
                        all_members.add(f'Unknown_{member_id}')
                processed_groups.remove(group_id)
                group_membership[group_id]['all_members'] = all_members
                return all_members

            # 모든 그룹에 대해 멤버 해석 수행
            for group_id in group_membership:
                if not group_membership[group_id]['all_members']:
                    resolve_group_membership(group_id)

            return pd.DataFrame([{'Group Name': info['name'], 'Entry': ','.join(sorted(info['all_members']))} for info in group_membership.values()])

class NGFCollector(FirewallInterface):
    """
    FirewallInterface를 구현한 TrusGuard NGF 연동 어댑터입니다.
    """
    def __init__(self, hostname: str, ext_clnt_id: str, ext_clnt_secret: str):
        super().__init__(hostname, ext_clnt_id, ext_clnt_secret)
        self.client = NGFClient(hostname, ext_clnt_id, ext_clnt_secret)

    def connect(self) -> bool:
        """API 토큰을 발급받아 연결을 수립합니다."""
        token = self.client.login()
        if token:
            self._connected = True
            self._connection_info = {"token": token}
            return True
        self._connected = False
        raise FirewallAuthenticationError("NGF 로그인 실패")

    def disconnect(self) -> bool:
        """세션을 종료합니다."""
        self.client.logout()
        self._connected = False
        return True

    def test_connection(self) -> bool:
        """로그인 가능 여부를 확인합니다."""
        try:
            if self.client.login():
                self.client.logout()
                return True
        except Exception:
            pass
        return False

    def get_system_info(self) -> pd.DataFrame:
        """NGF 장비는 API를 통한 시스템 정보 조회를 지원하지 않습니다."""
        raise NotImplementedError("NGF 장비는 시스템 정보 조회를 지원하지 않습니다.")

    def export_security_rules(self, **kwargs) -> pd.DataFrame:
        """보안 정책 목록을 추출합니다."""
        return self.client.export_security_rules()

    def export_network_objects(self) -> pd.DataFrame:
        """호스트, 네트워크, 도메인 객체들을 모두 수집하여 통합 반환합니다."""
        with self.client.session():
            # 1. 호스트 객체 수집
            host_df = self.client.export_objects('host', use_session=False)
            host_df = host_df[['name', 'ip_list']].rename(columns={'name': 'Name', 'ip_list': 'Value'}) if not host_df.empty else pd.DataFrame(columns=['Name', 'Value'])
            host_df['Type'] = 'ip-netmask'

            # 2. 네트워크 객체 수집 및 마스크/범위 포맷 변환
            network_df = self.client.export_objects('network', use_session=False)
            if not network_df.empty:
                network_df = network_df[['name', 'ip_list_ip_info1', 'ip_list_ip_info2']].rename(columns={'name': 'Name', 'ip_list_ip_info1': 'ip1', 'ip_list_ip_info2': 'ip2'})
                # ip2 값이 넷마스크 형식이면 '/'를, IP 형식이면 '-'를 사용하여 결합
                network_df['Value'] = network_df.apply(lambda row: f"{row['ip1']}-{row['ip2']}" if '.' in str(row.get('ip2', '')) else f"{row['ip1']}/{row['ip2']}", axis=1)
                network_df['Type'] = network_df['Value'].apply(lambda x: 'ip-range' if '-' in x else 'ip-netmask')
                network_df = network_df.drop(columns=['ip1', 'ip2'])
            else: network_df = pd.DataFrame(columns=['Name', 'Type', 'Value'])

            # 3. 도메인(FQDN) 객체 수집
            domain_df = self.client.export_objects('domain', use_session=False)
            domain_df = domain_df[['name', 'dmn_name']].rename(columns={'name': 'Name', 'dmn_name': 'Value'}) if not domain_df.empty else pd.DataFrame(columns=['Name', 'Value'])
            domain_df['Type'] = 'fqdn'

            return pd.concat([host_df, network_df, domain_df], ignore_index=True)

    def export_network_group_objects(self) -> pd.DataFrame:
        """네트워크 주소 그룹을 수집합니다."""
        return self.client.export_network_group_objects_with_members()

    def export_service_objects(self) -> pd.DataFrame:
        """포트/프로토콜 서비스 객체들을 수집합니다."""
        service_df = self.client.export_objects('service')
        if not service_df.empty:
            service_df = service_df[['name', 'prtc_name', 'srv_port']].rename(columns={'name': 'Name', 'prtc_name': 'Protocol', 'srv_port': 'Port'})
            service_df['Protocol'] = service_df['Protocol'].str.lower()
            return service_df
        return pd.DataFrame(columns=['Name', 'Protocol', 'Port'])

    def export_service_group_objects(self) -> pd.DataFrame:
        """서비스 그룹을 수집합니다."""
        return self.client.export_service_group_objects_with_members()

    def export_last_hit_date(self, vsys: Optional[list[str] | set[str]] = None) -> pd.DataFrame:
        """Palo Alto 전용 확장 기능으로, NGF에서는 지원하지 않습니다."""
        return pd.DataFrame(columns=["vsys", "rule_name", "last_hit_date"])
