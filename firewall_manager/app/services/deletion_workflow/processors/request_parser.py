"""
Step 1: RequestParser - 정책 description에서 신청정보 파싱
"""
import re
import logging
from typing import Dict, Any, Optional
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
            "Ruleset ID": None,
            "MIS ID": None,
            "Request User": None,
            "Start Date": self.convert_to_date('19000101'),
            "End Date": self.convert_to_date('19000101'),
        }
        
        if not description or pd.isna(description):
            return data_dict
        
        # 패턴은 설정 파일에서 가져오거나 기본값 사용
        # 실제 패턴은 사용 환경에 맞게 설정 파일에서 관리
        # 여기서는 기본 구조만 제공하고, 실제 패턴은 설정 파일에서 로드
        
        # GSAMS3 패턴 (예시 - 실제 패턴은 설정에서 관리)
        pattern_gsams_3_str = self.config.get('parsing_patterns.gsams3', None)
        if pattern_gsams_3_str:
            pattern_gsams_3 = re.compile(pattern_gsams_3_str)
            gsams3_match = pattern_gsams_3.match(description)
            if gsams3_match:
                # 그룹 수에 따라 처리 (설정에서 패턴과 함께 그룹 매핑 정보 제공 필요)
                # 일단 기본 구조만 제공
                try:
                    groups = gsams3_match.groups()
                    if len(groups) >= 5:
                        data_dict = {
                            "Request Type": None,
                            "Request ID": groups[4] if len(groups) > 4 else None,
                            "Ruleset ID": groups[0] if len(groups) > 0 else None,
                            "MIS ID": groups[5] if len(groups) > 5 else None,
                            "Request User": groups[3] if len(groups) > 3 else None,
                            "Start Date": self.convert_to_date(groups[1]) if len(groups) > 1 else self.convert_to_date('19000101'),
                            "End Date": self.convert_to_date(groups[2]) if len(groups) > 2 else self.convert_to_date('19000101'),
                        }
                        
                        # Request ID의 타입 분류
                        if data_dict["Request ID"]:
                            type_code = data_dict["Request ID"][:1]
                            if type_code == "P":
                                data_dict["Request Type"] = "GROUP"
                            elif type_code == "F":
                                data_dict["Request Type"] = "NORMAL"
                            elif type_code == "S":
                                data_dict["Request Type"] = "SERVER"
                            elif type_code == "M":
                                data_dict["Request Type"] = "PAM"
                            else:
                                data_dict["Request Type"] = "Unknown"
                except Exception as e:
                    logger.warning(f"GSAMS3 패턴 매칭 처리 실패: {e}")
        
        # GSAMS1 패턴 (예시)
        pattern_gsams_1_rulename_str = self.config.get('parsing_patterns.gsams1_rulename', None)
        if pattern_gsams_1_rulename_str:
            pattern_gsams_1_rulename = re.compile(pattern_gsams_1_rulename_str)
            gsams1_name_match = pattern_gsams_1_rulename.match(str(rule_name))
            if gsams1_name_match:
                data_dict['Request Type'] = "OLD"
                if gsams1_name_match.groups():
                    data_dict['Request ID'] = gsams1_name_match.group(1)
        
        # GSAMS1 description 패턴
        pattern_gsams_1_desc_str = self.config.get('parsing_patterns.gsams1_description', None)
        if pattern_gsams_1_desc_str:
            gsams1_desc_match = re.search(pattern_gsams_1_desc_str, description)
            if gsams1_desc_match:
                try:
                    date = description.split(';')[0]
                    start_date = date.split('~')[0].replace('[', '').replace('-', '')
                    end_date = date.split('~')[1].replace(']', '').replace('-', '')
                    
                    data_dict = {
                        "Request Type": "OLD",
                        "Request ID": gsams1_desc_match.group(1).split('-')[1] if gsams1_desc_match.groups() else None,
                        "Ruleset ID": None,
                        "MIS ID": None,
                        "Request User": None,
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
                row = {
                    "id": policy.id,
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
                    "Vsys": policy.vsys or "",
                    "Seq": policy.seq or 0,
                }
                
                # 신청정보 파싱
                parsed_info = self.parse_request_info(policy.rule_name, policy.description)
                row.update(parsed_info)
                
                data_rows.append(row)
            
            # DataFrame 생성
            df = pd.DataFrame(data_rows)
            
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

