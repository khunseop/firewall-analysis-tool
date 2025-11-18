"""
Step 4: ApplicationAggregator - 신청정보 엑셀 가공
"""
import logging
import pandas as pd

from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class ApplicationAggregator:
    """신청정보 취합 프로세서"""
    
    def __init__(
        self,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        ApplicationAggregator 초기화
        
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
    
    def format_date(self, date) -> str:
        """
        날짜 형식을 20250306 -> 2025-03-06로 변환하는 함수
        
        Args:
            date: 날짜 (숫자, 문자열 등)
            
        Returns:
            변환된 날짜 문자열
        """
        try:
            # 숫자나 문자열 형태의 날짜 (예: 20250306) 처리
            if isinstance(date, (int, str)) and len(str(date)) == 8:
                date_str = str(date)
                return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
            # 이미 2025-03-06 형식일 경우 그대로 반환
            elif isinstance(date, str) and len(date) == 10 and date[4] == '-' and date[7] == '-':
                return date
            # 처리할 수 없는 날짜 형식일 경우 빈 문자열 반환
            else:
                return ""
        except Exception as e:
            logger.error(f"날짜 포맷 변환 중 오류 발생: {e}")
            return ""
    
    def normalize_column_names(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        컬럼명을 표준화된 이름으로 매핑합니다.
        
        Args:
            df: 원본 데이터프레임
            
        Returns:
            컬럼명이 표준화된 데이터프레임
        """
        column_mapping = self.config.get('application_info_column_mapping', {})
        
        # 역매핑 딕셔너리 생성: 예상 컬럼명 -> 표준 컬럼명
        reverse_mapping = {}
        for standard_col, possible_cols in column_mapping.items():
            for possible_col in possible_cols:
                reverse_mapping[possible_col.upper()] = standard_col
                reverse_mapping[possible_col.lower()] = standard_col
                reverse_mapping[possible_col] = standard_col
        
        # 컬럼명 매핑 적용
        df_renamed = df.rename(columns=lambda x: reverse_mapping.get(x, reverse_mapping.get(x.upper(), x)))
        
        return df_renamed
    
    def process_applications(self, input_file_path: str) -> str:
        """
        여러 시트가 있는 엑셀 파일을 읽어서 취합하고 가공합니다.
        
        Args:
            input_file_path: 입력 엑셀 파일 경로 (외부에서 받은 신청정보)
            
        Returns:
            가공된 파일 경로
        """
        try:
            logger.info(f"Step 4: 신청정보 가공 시작 (device_id={self.device_id})")
            
            # 엑셀 파일을 읽어 시트별로 순회
            xls = pd.ExcelFile(input_file_path)
            all_sheets = xls.sheet_names
            logger.info(f"시트 목록: {all_sheets}")
            
            # 시트 데이터 저장 리스트
            processed_sheets = []
            
            # 각 시트를 순차적으로 처리
            for sheet_name in all_sheets:
                logger.info(f"처리 중: {sheet_name}")
                
                # 각 시트 데이터를 읽기
                df = pd.read_excel(xls, sheet_name=sheet_name)
                
                # 컬럼명 표준화
                df = self.normalize_column_names(df)
                logger.info(f"표준화된 컬럼: {list(df.columns)}")
                
                # 날짜 포맷 수정 ('REQUEST_START_DATE', 'REQUEST_END_DATE' 컬럼)
                for date_column in ['REQUEST_START_DATE', 'REQUEST_END_DATE']:
                    if date_column in df.columns:
                        df[date_column] = df[date_column].apply(lambda x: self.format_date(x))
                
                # 처리된 데이터를 리스트에 추가
                processed_sheets.append(df)
                logger.info(f"시트 '{sheet_name}' 처리 완료")
            
            # 모든 시트를 하나로 합침
            if processed_sheets:
                final_df = pd.concat(processed_sheets, ignore_index=True)
                
                # REQUEST_END_DATE 컬럼 내림차순 정렬
                if 'REQUEST_END_DATE' in final_df.columns:
                    final_df = final_df.sort_values(by='REQUEST_END_DATE', ascending=False)
                
                # 표준 컬럼 순서 정의
                standard_columns = [
                    "REQUEST_ID", "REQUEST_START_DATE", "REQUEST_END_DATE", "TITLE",
                    "REQUESTER_ID", "REQUESTER_EMAIL", "REQUESTER_NAME", "REQUESTER_DEPT",
                    "WRITE_PERSON_ID", "WRITE_PERSON_EMAIL", "WRITE_PERSON_NAME", "WRITE_PERSON_DEPT",
                    "APPROVAL_PERSON_ID", "APPROVAL_PERSON_EMAIL", "APPROVAL_PERSON_NAME", "APPROVAL_PERSON_DEPT_NAME",
                    "REQUEST_DATE", "REQUEST_STATUS", "PROGRESS", "MIS_ID", "GROUP_VERSION"
                ]
                
                # 존재하는 표준 컬럼만 순서대로 정렬
                existing_standard_cols = [col for col in standard_columns if col in final_df.columns]
                # 표준 컬럼에 없는 나머지 컬럼들
                remaining_cols = [col for col in final_df.columns if col not in standard_columns]
                final_df = final_df[existing_standard_cols + remaining_cols]
                
                logger.info(f"최종 데이터프레임에 {len(final_df)}개의 행이 포함됨")
                
                # 결과를 새로운 엑셀 파일로 저장
                output_file_path = self.file_manager.create_step_file_path(self.device_id, 4)
                self.excel_manager.save_dataframe_to_excel(
                    df=final_df,
                    file_path=output_file_path,
                    sheet_name="신청정보",
                    index=False,
                    style=True
                )
                
                logger.info(f"Step 4 완료: 파일 저장됨 - {output_file_path}")
                return output_file_path
            else:
                raise ValueError("처리할 시트가 없습니다.")
                
        except Exception as e:
            logger.error(f"Step 4 실패: {e}", exc_info=True)
            raise

