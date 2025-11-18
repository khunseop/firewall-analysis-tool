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
            
            # 최종 컬럼 정보 정의 (실제 컬럼은 입력 파일에 따라 결정)
            # 여기서는 기본 구조만 제공
            
            # 시트 데이터 저장 리스트
            processed_sheets = []
            
            # 각 시트를 순차적으로 처리
            for sheet_name in all_sheets:
                logger.info(f"처리 중: {sheet_name}")
                
                # 각 시트 데이터를 읽기
                df = pd.read_excel(xls, sheet_name=sheet_name)
                
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

