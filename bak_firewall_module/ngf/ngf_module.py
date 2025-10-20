import json
import logging
import requests
import pandas as pd
from contextlib import contextmanager

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
        if self.token:  # 이미 로그인된 경우
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
                url,
                headers=self._get_headers(),
                data=json.dumps(data),
                verify=False,
                timeout=3
            )
            if response.status_code == 200:
                logging.info("Login Success")
                self.token = response.json().get("result", {}).get("api_token")
                return self.token
            else:
                logging.error("Login Failed, status code: %s", response.status_code)
                return None
        except Exception as e:
            logging.error("Exception during login: %s", e)
            return None

    def logout(self) -> bool:
        """NGF에서 로그아웃"""
        if not self.token:
            return True

        url = f"https://{self.hostname}/api/au/external/logout"
        try:
            response = requests.delete(
                url,
                headers=self._get_headers(token=self.token),
                verify=False,
                timeout=3
            )
            if response.status_code == 200:
                logging.info("Logout Success")
                self.token = None
                return True
            else:
                logging.error("Logout Failed, status code: %s", response.status_code)
                return False
        except Exception as e:
            logging.error("Exception during logout: %s", e)
            return False

    def _get(self, endpoint: str) -> dict:
        """
        내부적으로 GET 요청을 수행합니다.
        """
        url = f"https://{self.hostname}{endpoint}"
        try:
            response = requests.get(
                url,
                headers=self._get_headers(token=self.token),
                verify=False,
                timeout=self.timeout
            )
            if response.status_code == 200:
                logging.info("GET %s Success", endpoint)
                return response.json()
            else:
                logging.error("GET %s Failed, status code: %s", endpoint, response.status_code)
                return None
        except Exception as e:
            logging.error("Exception during GET %s: %s", endpoint, e)
            return None


    def get_fw4_rules(self) -> dict:
        """
        FW4 규칙 데이터를 조회합니다.
        """
        return self._get("/api/po/fw/4/rules")

    def get_host_objects(self) -> dict:
        """
        호스트 객체 데이터를 조회합니다.
        """
        return self._get("/api/op/host/4/objects")

    def get_network_objects(self) -> dict:
        """
        네트워크 객체 데이터를 조회합니다.
        """
        return self._get("/api/op/network/4/objects")

    def get_domain_objects(self) -> dict:
        """
        도메인 객체 데이터를 조회합니다.
        """
        return self._get("/api/op/domain/4/objects")

    def get_group_objects(self) -> dict:
        """
        그룹 객체 데이터를 조회합니다.
        """
        return self._get("/api/op/group/4/objects")

    def get_service_objects(self) -> dict:
        """
        서비스 객체 데이터를 조회합니다.
        """
        return self._get("/api/op/service/objects")

    def get_service_group_objects(self) -> dict:
        """
        서비스 그룹 객체 데이터를 조회합니다.
        """
        return self._get("/api/op/service-group/objects")
    
    def get_service_group_objects_information(self, service_group_name: str) -> dict:
        """서비스 그룹 객체의 상세 정보를 조회합니다."""
        url = f"https://{self.hostname}/api/op/service-group/get/objects"
        try:
            response = requests.post(
                url,
                headers=self._get_headers(token=self.token),
                verify=False,
                timeout=self.timeout,
                json={'name': service_group_name}
            )
            if response.status_code == 200:
                return response.json()
            else:
                logging.error("Failed to get service group info, status code: %s", response.status_code)
                return None
        except Exception as e:
            logging.error("Exception during get service group info: %s", e)
            return None

    @staticmethod
    def list_to_string(list_data) -> str:
        """
        리스트 데이터를 콤마로 구분된 문자열로 변환합니다.
        """
        if isinstance(list_data, list):
            return ','.join(str(s) for s in list_data)
        return list_data

    def export_security_rules(self) -> pd.DataFrame:
        """
        NGF 규칙 데이터를 파싱하여 pandas DataFrame으로 반환합니다.
        """
        try:
            token = self.login()
            if not token:
                raise Exception("NGF 로그인 실패")
            
            rules_data = self.get_fw4_rules()
            if not rules_data:
                raise Exception("규칙 데이터를 가져올 수 없습니다")
            
            security_rules = []
            rules = rules_data.get("result", [])
            for rule in rules:
                seq = rule.get("seq")
                fw_rule_id = rule.get("fw_rule_id")
                name = rule.get("name")
                # default rule은 건너뜁니다.
                if name == "default":
                    continue
                use = "Y" if rule.get("use") == 1 else "N"
                action = "allow" if rule.get("action") == 1 else "deny"

                src_list = rule.get("src")
                if not src_list:
                    src_list = "any"
                else:
                    src_list = [src.get("name") for src in src_list]

                user_list = rule.get("user")
                if not user_list:
                    user_list = "any"
                else:
                    user_list = [list(user.values())[0] for user in user_list]

                dst_list = rule.get("dst")
                if not dst_list:
                    dst_list = "any"
                else:
                    dst_list = [dst.get("name") for dst in dst_list]

                srv_list = rule.get("srv")
                if not srv_list:
                    srv_list = "any"
                else:
                    srv_list = [srv.get("name") for srv in srv_list]

                app_list = rule.get("app")
                if not app_list:
                    app_list = "any"
                else:
                    app_list = [app.get("name") for app in app_list]

                last_hit_time = rule.get("last_hit_time")
                desc = rule.get("desc")

                info = {
                    "Seq": seq,
                    "Rule Name": fw_rule_id,
                    "Enable": use,
                    "Action": action,
                    "Source": self.list_to_string(src_list),
                    "User": self.list_to_string(user_list),
                    "Destination": self.list_to_string(dst_list),
                    "Service": self.list_to_string(srv_list),
                    "Application": self.list_to_string(app_list),
                    "Last Hit Date": last_hit_time,
                    "Description": desc
                }
                security_rules.append(info)

            return pd.DataFrame(security_rules)
        
        except Exception as e:
            logging.error(f"NGF 규칙 데이터 수집 중 오류 발생: {str(e)}")
            raise Exception(f"NGF 규칙 데이터 수집 실패: {str(e)}")
        finally:
            self.logout()

    def export_objects(self, object_type: str, use_session: bool = True) -> pd.DataFrame:
        """
        NGF 객체 데이터를 파싱하여 pandas DataFrame으로 반환합니다.
        
        Parameters:
            object_type (str): 조회할 객체 타입
            use_session (bool): 세션 관리 여부. True면 내부에서 로그인/로그아웃,
                              False면 외부 세션 사용
        """
        if not object_type:
            raise ValueError("object_type 파라미터를 지정해야 합니다.")

        def _get_data():
            try:
                type_to_getter = {
                    "host": self.get_host_objects,
                    "network": self.get_network_objects,
                    "domain": self.get_domain_objects,
                    "group": self.get_group_objects,
                    "service": self.get_service_objects,
                    "service_group": self.get_service_group_objects,
                }

                getter = type_to_getter.get(object_type)
                if not getter:
                    raise ValueError(f"유효하지 않은 객체 타입: {object_type}")
                
                data = getter()
                if not data:
                    raise Exception(f"데이터를 가져올 수 없습니다: {object_type}")
                
                results = data.get("result", [])
                if not results:
                    logging.warning(f"결과 데이터가 없습니다: {object_type}")
                    return pd.DataFrame()
                
                df = pd.json_normalize(results, sep='_')
                
                for col in df.columns:
                    df[col] = df[col].apply(lambda x: self.list_to_string(x)
                                        if isinstance(x, list)
                                        else (','.join(map(str, x.values()))
                                                if isinstance(x, dict) else x))
                return df

            except Exception as e:
                logging.error(f"NGF {object_type} 객체 데이터 수집 중 오류 발생: {str(e)}")
                raise Exception(f"NGF {object_type} 객체 데이터 수집 실패: {str(e)}")

        try:
            if use_session:
                with self.session():
                    return _get_data()
            else:
                return _get_data()
        except Exception as e:
            raise Exception(f"NGF {object_type} 객체 데이터 수집 실패: {str(e)}")

    def export_service_group_objects_with_members(self) -> pd.DataFrame:
        """
        서비스 그룹 객체와 해당 멤버들의 정보를 포함한 DataFrame을 반환합니다.
        """
        with self.session():
            # 세션 내에서는 use_session=False로 호출
            service_df = self.export_objects('service', use_session=False)
            service_lookup = {}
            if not service_df.empty:
                for _, row in service_df.iterrows():
                    if 'srv_obj_id' in row and 'name' in row:
                        service_lookup[str(row['srv_obj_id'])] = row['name']
            
            group_df = self.export_objects('service_group', use_session=False)
            if group_df.empty:
                return pd.DataFrame()
            
            # 3. 각 그룹의 상세 정보를 저장할 리스트
            group_details = []
            
            # 4. 각 서비스 그룹에 대해 멤버 정보 조회
            for _, group in group_df.iterrows():
                object_data = self.get_service_group_objects_information(group['name'])
                if object_data and 'result' in object_data:
                    result_data = object_data.get('result', [])
                    if result_data:
                        detail = pd.json_normalize(result_data, sep='_').iloc[0]
                        member_ids = str(detail['mem_id']).split(';') if detail['mem_id'] else []
                        member_names = []
                        for member_id in member_ids:
                            member_id = member_id.strip()
                            if member_id:
                                member_name = service_lookup.get(member_id)
                                if member_name:
                                    member_names.append(member_name)
                                else:
                                    member_names.append(f'Unknown_{member_id}')
                        
                        group_details.append({
                            'Group Name': group['name'],
                            'Entry': ','.join(member_names) if member_names else ''
                        })
            
            return pd.DataFrame(group_details)

    def export_network_group_objects_with_members(self) -> pd.DataFrame:
        """
        네트워크 그룹 객체와 해당 멤버들의 정보를 포함한 DataFrame을 반환합니다.
        중첩된 그룹을 재귀적으로 처리합니다.
        """
        with self.session():
            # 1. 모든 객체 정보 가져오기
            host_df = self.export_objects('host', use_session=False)
            network_df = self.export_objects('network', use_session=False)
            group_df = self.export_objects('group', use_session=False)

            if group_df.empty:
                return pd.DataFrame(columns=['Group Name', 'Entry'])

            # 2. 호스트, 네트워크 객체의 매핑 딕셔너리 생성
            object_lookup = {}
            
            # 호스트 객체 매핑
            if not host_df.empty:
                for _, row in host_df.iterrows():
                    if 'addr_obj_id' in row and 'name' in row:
                        object_lookup[str(row['addr_obj_id'])] = row['name']

            # 네트워크 객체 매핑
            if not network_df.empty:
                for _, row in network_df.iterrows():
                    if 'addr_obj_id' in row and 'name' in row:
                        object_lookup[str(row['addr_obj_id'])] = row['name']

            # 3. 그룹 멤버십 매핑 생성
            group_membership = {}
            for _, group in group_df.iterrows():
                group_id = str(group['addr_obj_id'])
                member_ids = str(group['mmbr_obj_id']).split(';') if group['mmbr_obj_id'] else []
                group_membership[group_id] = {
                    'name': group['name'],
                    'direct_members': [mid.strip() for mid in member_ids if mid.strip()],
                    'all_members': set()  # 모든 하위 멤버를 저장할 set
                }

            # 4. 그룹 멤버십 순환 처리
            def resolve_group_membership(group_id: str, processed_groups: set = None):
                """그룹의 모든 멤버를 재귀적으로 해석하여 all_members에 저장"""
                if processed_groups is None:
                    processed_groups = set()
                
                if group_id in processed_groups:
                    logging.warning(f"순환 참조 감지: {group_id}")
                    return set()
                
                if group_id not in group_membership:
                    return set()

                # 이미 계산된 경우 반환
                if group_membership[group_id]['all_members']:
                    return group_membership[group_id]['all_members']

                processed_groups.add(group_id)
                all_members = set()

                # 직접 멤버 처리
                for member_id in group_membership[group_id]['direct_members']:
                    if member_id in object_lookup:
                        # 일반 객체인 경우
                        all_members.add(object_lookup[member_id])
                    elif member_id in group_membership:
                        # 그룹인 경우 재귀적으로 처리
                        sub_members = resolve_group_membership(member_id, processed_groups)
                        all_members.update(sub_members)
                    else:
                        all_members.add(f'Unknown_{member_id}')

                processed_groups.remove(group_id)
                group_membership[group_id]['all_members'] = all_members
                return all_members

            # 5. 모든 그룹에 대해 멤버십 해석
            for group_id in group_membership:
                if not group_membership[group_id]['all_members']:
                    resolve_group_membership(group_id)

            # 6. 결과 DataFrame 생성
            group_details = []
            for group_id, group_info in group_membership.items():
                group_details.append({
                    'Group Name': group_info['name'],
                    'Entry': ','.join(sorted(group_info['all_members'])) if group_info['all_members'] else ''
                })

            return pd.DataFrame(group_details)
        
# ────────────── 모듈 테스트 예시 ──────────────
if __name__ == '__main__':
    # NGFClient 객체 생성 후 보안 규칙 DataFrame을 출력하는 예시
    device_ip = "your_device_ip"
    client = NGFClient(device_ip, "your_ext_clnt_id", "your_ext_clnt_secret")
    df_rules = client.export_security_rules()
    if not df_rules.empty:
        logging.info("Exported Security Rules:\n%s", df_rules.head())
    else:
        logging.error("Security Rules export 실패")