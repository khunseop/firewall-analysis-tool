"""
Step 5: RequestInfoAdder - 정책과 신청건 매핑
"""
import logging
import pandas as pd

from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class RequestInfoAdder:
    """신청정보 추가 프로세서"""
    
    def __init__(
        self,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        RequestInfoAdder 초기화
        
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
    
    def add_request_info(self, master_file_path: str, info_file_path: str) -> str:
        """
        신청정보를 정책 파일에 매핑하여 추가합니다.
        
        Args:
            master_file_path: 마스터 파일 경로 (Step 1 또는 Step 3 결과)
            info_file_path: 신청정보 파일 경로 (Step 4 결과)
            
        Returns:
            업데이트된 파일 경로
        """
        try:
            logger.info(f"Step 5: 신청정보 매핑 시작 (device_id={self.device_id})")
            
            # 파일 읽기
            rule_df = pd.read_excel(master_file_path)
            info_df = pd.read_excel(info_file_path)
            
            # 날짜 형식 변환
            rule_df['End Date'] = pd.to_datetime(rule_df['End Date'], errors='coerce').dt.date
            info_df['REQUEST_END_DATE'] = pd.to_datetime(info_df['REQUEST_END_DATE'], errors='coerce').dt.date
            
            # 정렬
            info_df = info_df.sort_values(by='REQUEST_END_DATE', ascending=False)
            
            # 자동 연장 ID 찾기
            auto_extension_id = self._find_auto_extension_id(info_df)
            
            # 매칭 및 업데이트
            total = len(rule_df)
            for idx, row in rule_df.iterrows():
                if row['Request Type'] == 'GROUP':
                    matched_row = info_df[
                        ((info_df['REQUEST_ID'] == row['Request ID']) & (info_df['MIS_ID'] == row['MIS ID'])) |
                        ((info_df['REQUEST_ID'] == row['Request ID']) & (info_df['REQUEST_END_DATE'] == row['End Date']) & (info_df['WRITE_PERSON_ID'] == row['Request User'])) |
                        ((info_df['REQUEST_ID'] == row['Request ID']) & (info_df['REQUEST_END_DATE'] == row['End Date']) & (info_df['REQUESTER_ID'] == row['Request User']))
                    ]
                else:
                    matched_row = info_df[info_df['REQUEST_ID'] == row['Request ID']]
                
                if not matched_row.empty:
                    for col in matched_row.columns:
                        if col in ['REQUEST_START_DATE', 'REQUEST_END_DATE', 'Start Date', 'End Date']:
                            rule_df.at[idx, col] = pd.to_datetime(matched_row[col].values[0], errors='coerce')
                        else:
                            rule_df.at[idx, col] = matched_row[col].values[0]
                elif row['Request Type'] != 'nan' and row['Request Type'] != 'Unknown':
                    rule_df.at[idx, 'REQUEST_ID'] = row['Request ID']
                    rule_df.at[idx, 'REQUEST_START_DATE'] = row['Start Date']
                    rule_df.at[idx, 'REQUEST_END_DATE'] = row['End Date']
                    rule_df.at[idx, 'REQUESTER_ID'] = row['Request User']
                    if row['Request User']:
                        rule_df.at[idx, 'REQUESTER_EMAIL'] = f"{row['Request User']}@samsung.com"
            
            # 자동 연장 상태 설정
            if not auto_extension_id.empty:
                rule_df.loc[rule_df['REQUEST_ID'].isin(auto_extension_id), 'REQUEST_STATUS'] = '99'
            
            # 파일 저장
            updated_file_path = self.file_manager.create_step_file_path(self.device_id, 5)
            self.excel_manager.save_dataframe_to_excel(
                df=rule_df,
                file_path=updated_file_path,
                sheet_name="정책_신청정보",
                index=False,
                style=True
            )
            
            logger.info(f"Step 5 완료: 파일 저장됨 - {updated_file_path}")
            return updated_file_path
            
        except Exception as e:
            logger.error(f"Step 5 실패: {e}", exc_info=True)
            raise
    
    def _find_auto_extension_id(self, info_df: pd.DataFrame) -> pd.Series:
        """
        자동 연장 ID를 찾습니다.
        
        Args:
            info_df: 신청정보 DataFrame
            
        Returns:
            자동 연장 ID 시리즈
        """
        if 'REQUEST_STATUS' not in info_df.columns:
            return pd.Series(dtype=str)
        
        if not pd.api.types.is_numeric_dtype(info_df['REQUEST_STATUS']):
            try:
                info_df['REQUEST_STATUS'] = pd.to_numeric(info_df['REQUEST_STATUS'], errors='coerce')
            except Exception:
                return pd.Series(dtype=str)
        
        # 정책그룹만 자동연장
        filtered_df = info_df[
            ((info_df['REQUEST_STATUS'] == 98) & info_df['REQUEST_ID'].str.startswith('PS', na=False)) |
            (info_df['REQUEST_STATUS'] == 99)
        ]['REQUEST_ID'].drop_duplicates()
        
        logger.info(f"자동 연장 ID {len(filtered_df)}개를 찾았습니다.")
        return filtered_df

