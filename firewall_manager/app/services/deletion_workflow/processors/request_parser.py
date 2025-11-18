"""
Step 1: RequestParser - 정책 description에서 신청정보 파싱
"""
import re
import logging
from typing import Dict, Any, Optional, Tuple
from datetime import datetime
import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Policy
from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class RequestParser:
    """신청 정보 파싱 프로세서"""
    
    def __init__(
        self,
        db: AsyncSession,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        RequestParser 초기화
        
        Args:
            db: 데이터베이스 세션
            device_id: 장비 ID
            config_manager: 설정 관리자
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
        """
        self.db = db
        self.device_id = device_id
        self.config = config_manager
        self.file_manager = file_manager
        self.excel_manager = excel_manager
    
    def convert_to_date(self, date_str: str) -> str:
        """
        날짜 문자열을 날짜 형식으로 변환합니다.
        
        Args:
            date_str: 날짜 문자열 (YYYYMMDD 형식)
            
        Returns:
            변환된 날짜 문자열 (YYYY-MM-DD 형식)
        """
        try:
            date_obj = datetime.strptime(date_str, '%Y%m%d')
            return date_obj.strftime('%Y-%m-%d')
        except ValueError:
            return date_str
    
    def extract_group_version(self, request_id: str) -> Tuple[str, Optional[str]]:
        """
        Request ID에서 GROUP_VERSION을 분리합니다.
        예: PS12345678-1-v12 -> (PS12345678-1, 12)
        
        Args:
            request_id: Request ID 문자열
            
        Returns:
            (request_id_without_version, group_version) 튜플
        """
        if not request_id:
            return request_id, None
        
        # -v숫자 패턴 찾기 (예: -v12, -v1, -v123)
        import re
        version_pattern = r'-v(\d+)$'
        match = re.search(version_pattern, request_id)
        
        if match:
            version = match.group(1)
            request_id_without_version = request_id[:match.start()]
            return request_id_without_version, version
        else:
            return request_id, None
    
    def parse_request_info(self, rule_name: str, description: Optional[str]) -> Dict[str, Any]:
        """
        규칙 이름과 설명에서 신청 정보를 파싱합니다.
        
        Args:
            rule_name: 규칙 이름
            description: 설명
            
        Returns:
            파싱된 신청 정보 딕셔너리
        """
        data_dict = {
            "Request Type": "Unknown",
            "Request ID": None,
            "Group Version": None,
            "Ruleset ID": None,
            "MIS ID": None,
            "Request User": None,
            "Start Date": self.convert_to_date('19000101'),
            "End Date": self.convert_to_date('19000101'),
        }
        
        # description이 없어도 rule_name으로 파싱 시도
        description = description if description and not pd.isna(description) else ""
        
        # GSAMS1 rulename 패턴 처리 (description보다 우선)
        gsams1_rulename_config = self.config.get('parsing_patterns.gsams1_rulename', {})
        # 하위 호환성: 문자열로 저장된 경우도 처리
        if isinstance(gsams1_rulename_config, str):
            pattern_gsams_1_rulename_str = gsams1_rulename_config if gsams1_rulename_config else None
            gsams1_rulename_config = {}
        else:
            pattern_gsams_1_rulename_str = gsams1_rulename_config.get('pattern') if isinstance(gsams1_rulename_config, dict) else None
        
        gsams1_name_match = None
        if pattern_gsams_1_rulename_str and rule_name:
            try:
                pattern_gsams_1_rulename = re.compile(pattern_gsams_1_rulename_str)
                gsams1_name_match = pattern_gsams_1_rulename.match(str(rule_name))
                if gsams1_name_match:
                    group_mapping = gsams1_rulename_config.get('group_mapping', {}) if isinstance(gsams1_rulename_config, dict) else {}
                    request_id_idx = group_mapping.get('request_id', 1) - 1
                    
                    if gsams1_name_match.groups() and len(gsams1_name_match.groups()) > request_id_idx:
                        request_id_full = gsams1_name_match.group(request_id_idx + 1)
                        request_id_clean, group_version = self.extract_group_version(request_id_full)
                        data_dict['Request Type'] = "OLD"
                        data_dict['Request ID'] = request_id_clean
                        data_dict['Group Version'] = group_version
            except Exception as e:
                logger.warning(f"GSAMS1 rulename 패턴 처리 실패: {e}")
        
        # GSAMS3 패턴 처리 (description이 있을 때만)
        gsams3_config = self.config.get('parsing_patterns.gsams3', {})
        # 하위 호환성: 문자열로 저장된 경우도 처리
        if isinstance(gsams3_config, str):
            pattern_gsams_3_str = gsams3_config if gsams3_config else None
            gsams3_config = {}
        else:
            pattern_gsams_3_str = gsams3_config.get('pattern') if isinstance(gsams3_config, dict) else None
        
        gsams3_match = None
        if pattern_gsams_3_str and description:
            try:
                pattern_gsams_3 = re.compile(pattern_gsams_3_str)
                gsams3_match = pattern_gsams_3.match(description)
                if gsams3_match:
                    # 그룹 매핑 정보 가져오기
                    group_mapping = gsams3_config.get('group_mapping', {}) if isinstance(gsams3_config, dict) else {}
                    groups = gsams3_match.groups()
                    
                    # 그룹 인덱스는 0-based이므로 -1 해야 함
                    ruleset_id_idx = group_mapping.get('ruleset_id', 1) - 1
                    start_date_idx = group_mapping.get('start_date', 2) - 1
                    end_date_idx = group_mapping.get('end_date', 3) - 1
                    request_user_idx = group_mapping.get('request_user', 4) - 1
                    request_id_idx = group_mapping.get('request_id', 5) - 1
                    mis_id_idx = group_mapping.get('mis_id', 6) - 1
                    
                    if len(groups) > max(ruleset_id_idx, start_date_idx, end_date_idx, request_user_idx, request_id_idx, mis_id_idx):
                        request_id_full = groups[request_id_idx] if request_id_idx < len(groups) else None
                        request_id_clean, group_version = self.extract_group_version(request_id_full) if request_id_full else (None, None)
                        
                        data_dict = {
                            "Request Type": None,
                            "Request ID": request_id_clean,
                            "Group Version": group_version,
                            "Ruleset ID": groups[ruleset_id_idx] if ruleset_id_idx < len(groups) else None,
                            "MIS ID": groups[mis_id_idx] if mis_id_idx < len(groups) and groups[mis_id_idx] else None,
                            "Request User": groups[request_user_idx] if request_user_idx < len(groups) else None,
                            "Start Date": self.convert_to_date(groups[start_date_idx]) if start_date_idx < len(groups) else self.convert_to_date('19000101'),
                            "End Date": self.convert_to_date(groups[end_date_idx]) if end_date_idx < len(groups) else self.convert_to_date('19000101'),
                        }
                        
                        # Request ID의 타입 분류
                        request_type_mapping = self.config.get('parsing_patterns.request_type_mapping', {})
                        if isinstance(request_type_mapping, dict):
                            request_type_mapping = {k: v for k, v in request_type_mapping.items() if k != 'description'}
                        
                        if data_dict["Request ID"]:
                            type_code = data_dict["Request ID"][:1]
                            data_dict["Request Type"] = request_type_mapping.get(type_code, "Unknown")
            except Exception as e:
                logger.warning(f"GSAMS3 패턴 매칭 처리 실패: {e}")
        
        # GSAMS3가 매칭되지 않은 경우에만 GSAMS1 패턴 처리
        if not gsams3_match and description:
        
            # GSAMS1 user 패턴 처리
            gsams1_user_config = self.config.get('parsing_patterns.gsams1_user', {})
            # 하위 호환성: 문자열로 저장된 경우도 처리
            if isinstance(gsams1_user_config, str):
                pattern_gsams_1_user_str = gsams1_user_config if gsams1_user_config else None
                gsams1_user_config = {}
            else:
                pattern_gsams_1_user_str = gsams1_user_config.get('pattern') if isinstance(gsams1_user_config, dict) else None
            
            gsams1_user_match = None
            if pattern_gsams_1_user_str:
                try:
                    gsams1_user_match = re.search(pattern_gsams_1_user_str, description)
                    if gsams1_user_match:
                        group_mapping = gsams1_user_config.get('group_mapping', {}) if isinstance(gsams1_user_config, dict) else {}
                        request_user_idx = group_mapping.get('request_user', 1) - 1
                        remove_prefix = gsams1_user_config.get('remove_prefix', '') if isinstance(gsams1_user_config, dict) else ''
                        
                        if gsams1_user_match.groups() and len(gsams1_user_match.groups()) > request_user_idx:
                            user_value = gsams1_user_match.group(request_user_idx + 1)
                            if remove_prefix and user_value:
                                user_value = user_value.replace(remove_prefix, "")
                            data_dict['Request User'] = user_value
                except Exception as e:
                    logger.warning(f"GSAMS1 user 패턴 처리 실패: {e}")
            
            # GSAMS1 date 패턴 처리
            gsams1_date_config = self.config.get('parsing_patterns.gsams1_date', {})
            # 하위 호환성: 문자열로 저장된 경우도 처리
            if isinstance(gsams1_date_config, str):
                pattern_gsams_1_date_str = gsams1_date_config if gsams1_date_config else None
                gsams1_date_config = {}
            else:
                pattern_gsams_1_date_str = gsams1_date_config.get('pattern') if isinstance(gsams1_date_config, dict) else None
            
            if pattern_gsams_1_date_str:
                try:
                    gsams1_date_match = re.search(pattern_gsams_1_date_str, description)
                    if gsams1_date_match:
                        date_str = gsams1_date_match.group(0)
                        if '~' in date_str:
                            date_parts = date_str.split('~')
                            if len(date_parts) == 2:
                                start_date = date_parts[0].replace('[', '').replace('-', '').strip()
                                end_date = date_parts[1].replace(']', '').replace('-', '').strip()
                                data_dict['Start Date'] = self.convert_to_date(start_date)
                                data_dict['End Date'] = self.convert_to_date(end_date)
                except Exception as e:
                    logger.warning(f"GSAMS1 date 패턴 처리 실패: {e}")
            
            # GSAMS1 description 패턴 처리 (rulename 매칭이 없고, user/date 매칭이 있는 경우)
            if not gsams1_name_match:
                gsams1_desc_config = self.config.get('parsing_patterns.gsams1_description', {})
                # 하위 호환성: 문자열로 저장된 경우도 처리
                if isinstance(gsams1_desc_config, str):
                    pattern_gsams_1_desc_str = gsams1_desc_config if gsams1_desc_config else None
                    gsams1_desc_config = {}
                else:
                    pattern_gsams_1_desc_str = gsams1_desc_config.get('pattern') if isinstance(gsams1_desc_config, dict) else None
                
                if pattern_gsams_1_desc_str:
                    try:
                        gsams1_desc_match = re.search(pattern_gsams_1_desc_str, description)
                        if gsams1_desc_match:
                            group_mapping = gsams1_desc_config.get('group_mapping', {}) if isinstance(gsams1_desc_config, dict) else {}
                            request_id_idx = group_mapping.get('request_id', 1) - 1
                            
                            if gsams1_desc_match.groups() and len(gsams1_desc_match.groups()) > request_id_idx:
                                # 날짜 파싱
                                date = description.split(';')[0]
                                start_date = date.split('~')[0].replace('[', '').replace('-', '')
                                end_date = date.split('~')[1].replace(']', '').replace('-', '')
                                
                                # Request ID 추출 (group(1).split('-')[1])
                                request_id_full = gsams1_desc_match.group(request_id_idx + 1)
                                request_id_with_dash = request_id_full.split('-')[1] if '-' in request_id_full else request_id_full
                                
                                # GROUP_VERSION 분리 (-v12 형식 제거)
                                request_id_clean, group_version = self.extract_group_version(request_id_with_dash)
                                
                                # 사용자 정보 (이미 파싱된 경우 사용)
                                request_user = data_dict.get('Request User')
                                
                                data_dict = {
                                    "Request Type": "OLD",
                                    "Request ID": request_id_clean,
                                    "Group Version": group_version,
                                    "Ruleset ID": None,
                                    "MIS ID": None,
                                    "Request User": request_user,
                                    "Start Date": self.convert_to_date(start_date),
                                    "End Date": self.convert_to_date(end_date),
                                }
                    except Exception as e:
                        logger.warning(f"GSAMS1 description 패턴 처리 실패: {e}")
        
        return data_dict
    
    async def parse_policies(self) -> str:
        """
        DB에서 정책을 가져와서 신청정보를 파싱하고 엑셀 파일로 저장합니다.
        
        Returns:
            생성된 파일 경로
        """
        try:
            logger.info(f"Step 1: 정책 신청정보 파싱 시작 (device_id={self.device_id})")
            
            # DB에서 정책 조회
            stmt = select(Policy).where(
                Policy.device_id == self.device_id,
                Policy.is_active == True
            ).order_by(Policy.seq)
            
            result = await self.db.execute(stmt)
            policies = result.scalars().all()
            
            logger.info(f"총 {len(policies)}개의 정책을 조회했습니다.")
            
            if not policies:
                raise ValueError("파싱할 정책이 없습니다.")
            
            # DataFrame 생성
            data_rows = []
            for policy in policies:
                # 신청정보 파싱 (rule_name과 description 모두 사용)
                parsed_info = self.parse_request_info(policy.rule_name, policy.description)
                
                # 기본 정책 정보
                row = {
                    "Rule Name": policy.rule_name,
                    "Enable": "Y" if policy.enable else "N",
                    "Action": policy.action,
                    "Source": policy.source,
                    "User": policy.user or "",
                    "Destination": policy.destination,
                    "Service": policy.service,
                    "Application": policy.application or "",
                    "Security Profile": policy.security_profile or "",
                    "Category": policy.category or "",
                    "Description": policy.description or "",
                }
                
                # 신청정보 추가 (파싱된 정보)
                row.update(parsed_info)
                
                data_rows.append(row)
            
            # DataFrame 생성
            df = pd.DataFrame(data_rows)
            
            # 컬럼 순서 정리 (설정 파일의 columns.all 순서 기준)
            column_order = self.config.get('columns.all', [])
            # 존재하는 컬럼만 순서대로 정렬
            existing_columns = [col for col in column_order if col in df.columns]
            # 순서에 없는 컬럼은 뒤에 추가
            remaining_columns = [col for col in df.columns if col not in existing_columns]
            df = df[existing_columns + remaining_columns]
            
            # 파일 경로 생성
            file_path = self.file_manager.create_step_file_path(self.device_id, 1)
            
            # Excel 파일로 저장
            success = self.excel_manager.save_dataframe_to_excel(
                df=df,
                file_path=file_path,
                sheet_name="정책_신청정보",
                index=False,
                style=True
            )
            
            if not success:
                raise Exception("Excel 파일 저장 실패")
            
            logger.info(f"Step 1 완료: 파일 저장됨 - {file_path}")
            return file_path
            
        except Exception as e:
            logger.error(f"Step 1 실패: {e}", exc_info=True)
            raise

