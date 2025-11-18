"""
Step 2: RequestExtractor - Request Type과 Request ID 추출 및 중복제거
"""
import logging
from typing import Dict, Any
import pandas as pd

from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class RequestExtractor:
    """Request ID 추출 프로세서"""
    
    def __init__(
        self,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        RequestExtractor 초기화
        
        Args:
            device_id: 장비 ID
            config_manager: 설정 관리자
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
        """
        self.device_id = device_id
        self.config = config_manager
        self.file_manager = file_manager
        self.excel_manager = excel_manager
    
    def extract_request_ids(self, step1_file_path: str) -> str:
        """
        Step 1 결과 파일에서 Request Type과 Request ID를 추출하여 중복제거합니다.
        
        Args:
            step1_file_path: Step 1 결과 파일 경로
            
        Returns:
            생성된 파일 경로
        """
        try:
            logger.info(f"Step 2: Request ID 추출 시작 (device_id={self.device_id})")
            
            # Step 1 결과 파일 읽기
            df = pd.read_excel(step1_file_path)
            
            # 필요한 컬럼 확인
            if 'Request Type' not in df.columns or 'Request ID' not in df.columns:
                raise ValueError("Step 1 결과 파일에 'Request Type' 또는 'Request ID' 컬럼이 없습니다.")
            
            # 'Unknown' 값을 제외하고 고유한 Request Type 값 추출
            unique_types = df[df['Request Type'] != 'Unknown']['Request Type'].unique()
            
            # 고유한 Request Type 값을 최대 5개 선택
            selected_types = unique_types[:5]
            
            if len(selected_types) == 0:
                logger.warning("추출할 신청 유형이 없습니다.")
                # 빈 파일 생성
                empty_df = pd.DataFrame(columns=['Request ID'])
                file_path = self.file_manager.create_step_file_path(self.device_id, 2)
                self.excel_manager.save_dataframe_to_excel(
                    df=empty_df,
                    file_path=file_path,
                    sheet_name="Empty",
                    index=False
                )
                return file_path
            
            # 선택된 Request Type에 해당하는 데이터 추출
            selected_data = df[df['Request Type'].isin(selected_types)]
            
            if len(selected_data) == 0:
                logger.warning("추출할 신청 ID가 없습니다.")
                empty_df = pd.DataFrame(columns=['Request ID'])
                file_path = self.file_manager.create_step_file_path(self.device_id, 2)
                self.excel_manager.save_dataframe_to_excel(
                    df=empty_df,
                    file_path=file_path,
                    sheet_name="Empty",
                    index=False
                )
                return file_path
            
            # 각 Request Type별로 Request ID 값만 추출하여 중복 제거 후 Excel의 각 시트로 저장
            request_id_prefix = self.config.get('file_naming.request_id_prefix', 'request_id_')
            file_path = self.file_manager.create_step_file_path(self.device_id, 2)
            
            sheets_dict = {}
            for request_type in selected_types:
                type_data = selected_data[selected_data['Request Type'] == request_type]
                unique_ids = type_data[['Request ID']].drop_duplicates()
                sheets_dict[request_type] = unique_ids
                logger.info(f"신청 유형 '{request_type}'에서 {len(unique_ids)}개의 신청 ID를 추출했습니다.")
            
            # 여러 시트로 저장
            self.excel_manager.save_to_excel_with_sheets(
                data_dict=sheets_dict,
                file_path=file_path,
                style=True
            )
            
            logger.info(f"Step 2 완료: 파일 저장됨 - {file_path}")
            return file_path
            
        except Exception as e:
            logger.error(f"Step 2 실패: {e}", exc_info=True)
            raise

