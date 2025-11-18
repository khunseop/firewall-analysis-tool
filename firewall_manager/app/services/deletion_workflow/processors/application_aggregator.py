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
        application_info_column_mapping의 키값(표준 컬럼명)으로 변환하고,
        내부 값 리스트의 원소들(원본 컬럼명)이 실제 엑셀 파일의 컬럼명과 일치하면 표준 컬럼명으로 변경합니다.
        
        설정 구조: {"표준컬럼명": ["원본컬럼명1", "원본컬럼명2", ...]}
        예: {"REQUEST_ID": ["REQUEST_ID", "Request ID", "요청ID", ...]}
        
        Args:
            df: 원본 데이터프레임
            
        Returns:
            컬럼명이 표준화된 데이터프레임
        """
        column_mapping_config = self.config.get('application_info_column_mapping', {})
        
        logger.info(f"원본 컬럼명: {list(df.columns)}")
        logger.info(f"매핑 설정: {list(column_mapping_config.keys())}")
        
        # {원본컬럼명: 표준컬럼명} 형태의 매핑 딕셔너리 생성
        # application_info_column_mapping의 구조: {표준컬럼명: [원본컬럼명들]}
        column_mapping = {}
        for standard_col, original_cols_list in column_mapping_config.items():
            # 리스트의 각 원본 컬럼명을 표준 컬럼명으로 매핑
            for original_col in original_cols_list:
                column_mapping[original_col] = standard_col
        
        logger.info(f"생성된 매핑 딕셔너리 키 개수: {len(column_mapping)}")
        
        # 처리된 컬럼들 기록
        processed_columns = []
        
        # 실제 엑셀 파일의 컬럼명이 매핑 딕셔너리에 있으면 표준 컬럼명으로 변경
        # 원본 코드 방식: for old_col, new_col in column_mapping.items()
        for old_col, new_col in column_mapping.items():
            if old_col in df.columns:
                df.rename(columns={old_col: new_col}, inplace=True)
                processed_columns.append((old_col, new_col))
                logger.info(f"컬럼명 변환: {old_col} -> {new_col}")
        
        if processed_columns:
            logger.info(f"변경된 컬럼: {processed_columns}")
            logger.info(f"변환 후 컬럼명: {list(df.columns)}")
        else:
            logger.warning("변경된 컬럼 없음 - 원본 컬럼명과 매핑 설정이 일치하지 않을 수 있습니다.")
            logger.info(f"원본 컬럼명: {list(df.columns)}")
            logger.info(f"매핑 가능한 원본 컬럼명 예시: {list(column_mapping.keys())[:10]}")
        
        return df
    
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
                
                # 컬럼명 표준화 (application_info_column_mapping 기반)
                df = self.normalize_column_names(df)
                logger.info(f"표준화된 컬럼: {list(df.columns)}")
                
                # 이메일 생성 로직 (원본 코드 참조)
                # WRITE_PERSON_EMAIL이 비어있고 WRITE_PERSON_ID가 있으면 자동 생성
                if 'WRITE_PERSON_ID' in df.columns and 'REQUESTER_EMAIL' in df.columns:
                    if 'WRITE_PERSON_EMAIL' not in df.columns:
                        df['WRITE_PERSON_EMAIL'] = ""
                    
                    df['WRITE_PERSON_EMAIL'] = df.apply(
                        lambda row: f"{row['WRITE_PERSON_ID']}@{row['REQUESTER_EMAIL'].split('@')[1]}" 
                        if (pd.isna(row.get('WRITE_PERSON_EMAIL', '')) or str(row.get('WRITE_PERSON_EMAIL', '')) == "") 
                        and pd.notna(row.get('WRITE_PERSON_ID')) 
                        and pd.notna(row.get('REQUESTER_EMAIL')) 
                        and '@' in str(row.get('REQUESTER_EMAIL', ''))
                        else row.get('WRITE_PERSON_EMAIL', ''), 
                        axis=1
                    )
                
                # APPROVAL_PERSON_EMAIL이 비어있고 APPROVAL_PERSON_ID가 있으면 자동 생성
                if 'APPROVAL_PERSON_ID' in df.columns and 'REQUESTER_EMAIL' in df.columns:
                    if 'APPROVAL_PERSON_EMAIL' not in df.columns:
                        df['APPROVAL_PERSON_EMAIL'] = ""
                    
                    df['APPROVAL_PERSON_EMAIL'] = df.apply(
                        lambda row: f"{row['APPROVAL_PERSON_ID']}@{row['REQUESTER_EMAIL'].split('@')[1]}" 
                        if (pd.isna(row.get('APPROVAL_PERSON_EMAIL', '')) or str(row.get('APPROVAL_PERSON_EMAIL', '')) == "") 
                        and pd.notna(row.get('APPROVAL_PERSON_ID')) 
                        and pd.notna(row.get('REQUESTER_EMAIL')) 
                        and '@' in str(row.get('REQUESTER_EMAIL', ''))
                        else row.get('APPROVAL_PERSON_EMAIL', ''), 
                        axis=1
                    )
                
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
                
                # 표준 컬럼 순서 정의 (application_info_column_mapping의 키값 순서)
                column_mapping = self.config.get('application_info_column_mapping', {})
                standard_columns = list(column_mapping.keys())
                
                # 존재하는 표준 컬럼만 순서대로 정렬하고, 없는 컬럼은 공백으로 채움
                # 원본 코드의 reindex 방식 참조
                existing_standard_cols = [col for col in standard_columns if col in final_df.columns]
                missing_standard_cols = [col for col in standard_columns if col not in final_df.columns]
                
                # 표준 컬럼에 없는 나머지 컬럼들
                remaining_cols = [col for col in final_df.columns if col not in standard_columns]
                
                # 표준 컬럼 순서에 맞춰서 재정렬하고 부족한 컬럼은 공백으로 채움
                final_df = final_df.reindex(columns=existing_standard_cols + missing_standard_cols + remaining_cols, fill_value="")
                
                logger.info(f"최종 데이터프레임에 {len(final_df)}개의 행이 포함됨")
                logger.info(f"표준 컬럼 순서: {existing_standard_cols}")
                if missing_standard_cols:
                    logger.info(f"누락된 표준 컬럼 (공백으로 채움): {missing_standard_cols}")
                
                # 결과를 새로운 엑셀 파일로 저장 (스타일 미적용 - 일반 step 결과)
                output_file_path = self.file_manager.create_step_file_path(self.device_id, 4)
                self.excel_manager.save_dataframe_to_excel(
                    df=final_df,
                    file_path=output_file_path,
                    sheet_name="신청정보",
                    index=False,
                    style=False  # 일반 step 결과에는 스타일 미적용
                )
                
                logger.info(f"Step 4 완료: 파일 저장됨 - {output_file_path}")
                return output_file_path
            else:
                raise ValueError("처리할 시트가 없습니다.")
                
        except Exception as e:
            logger.error(f"Step 4 실패: {e}", exc_info=True)
            raise

