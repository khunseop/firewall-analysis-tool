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
    
    def _normalize_column_name(self, col_name: str) -> str:
        """
        컬럼명을 정규화합니다 (매칭을 위해).
        - 앞뒤 공백 제거
        - 대소문자 통일 (대문자로)
        - 공백과 언더스코어 제거 (유연한 매칭을 위해)
        
        Args:
            col_name: 원본 컬럼명
            
        Returns:
            정규화된 컬럼명 (공백/언더스코어 제거, 대문자)
        """
        if not col_name:
            return ""
        # 앞뒤 공백 제거
        normalized = str(col_name).strip()
        # 대소문자 통일 (대문자로)
        normalized = normalized.upper()
        # 공백과 언더스코어 제거 (유연한 매칭을 위해)
        normalized = normalized.replace(' ', '').replace('_', '')
        return normalized
    
    def _find_matching_column(self, target_col: str, df_columns: list) -> str:
        """
        정규화된 컬럼명으로 매칭되는 실제 컬럼명을 찾습니다.
        
        매칭 우선순위:
        1. 정확 일치
        2. 정규화된 이름 일치 (공백/언더스코어 무시)
        3. 부분 매칭 (포함 관계)
        
        Args:
            target_col: 찾을 컬럼명 (정규화 전)
            df_columns: 데이터프레임의 실제 컬럼명 리스트
            
        Returns:
            매칭된 실제 컬럼명 (없으면 None)
        """
        # 정규화된 타겟 컬럼명
        normalized_target = self._normalize_column_name(target_col)
        
        # 1. 정확 일치 먼저 확인
        if target_col in df_columns:
            return target_col
        
        # 2. 정규화된 이름으로 매칭 시도 (공백/언더스코어 무시)
        for actual_col in df_columns:
            normalized_actual = self._normalize_column_name(actual_col)
            if normalized_target == normalized_actual:
                return actual_col
        
        # 3. 부분 매칭 시도 (정규화된 이름이 포함되는지)
        # 타겟이 실제 컬럼명에 포함되는 경우만 (단방향 매칭)
        for actual_col in df_columns:
            normalized_actual = self._normalize_column_name(actual_col)
            # 타겟이 실제 컬럼명에 포함되는 경우
            if normalized_target in normalized_actual:
                # 너무 짧은 매칭은 제외 (예: "ID"가 "REQUEST_ID"에 매칭되는 것 방지)
                if len(normalized_target) >= 5:  # 최소 5자 이상
                    return actual_col
        
        return None
    
    def normalize_column_names(self, df: pd.DataFrame, sheet_name: str = "") -> pd.DataFrame:
        """
        컬럼명을 표준화된 이름으로 매핑합니다.
        application_info_column_mapping의 키값(표준 컬럼명)으로 변환하고,
        내부 값 리스트의 원소들(원본 컬럼명)이 실제 엑셀 파일의 컬럼명과 일치하면 표준 컬럼명으로 변경합니다.
        
        설정 구조: {"표준컬럼명": ["원본컬럼명1", "원본컬럼명2", ...]}
        예: {"REQUEST_ID": ["REQUEST_ID", "Request ID", "요청ID", ...]}
        
        개선사항:
        - 정확 일치 우선
        - 정규화된 이름으로 매칭 (공백, 대소문자 무시)
        - 부분 매칭 지원
        
        Args:
            df: 원본 데이터프레임
            sheet_name: 시트 이름 (로깅용)
            
        Returns:
            컬럼명이 표준화된 데이터프레임
        """
        # 동기 방식으로 설정 가져오기 (ensure_loaded가 이미 호출되어 있어야 함)
        column_mapping_config = self.config.get_sync('application_info_column_mapping', {})
        
        # 설정이 제대로 로드되었는지 확인
        if not column_mapping_config:
            logger.error(f"시트 '{sheet_name}': application_info_column_mapping 설정이 비어있습니다!")
            logger.error(f"ConfigManager의 config_data 상태: {self.config.config_data is not None}")
            if self.config.config_data:
                logger.error(f"config_data의 키 목록: {list(self.config.config_data.keys())}")
        
        logger.info(f"시트 '{sheet_name}' 원본 컬럼명: {list(df.columns)}")
        logger.info(f"매핑 설정 키 개수: {len(column_mapping_config)}")
        if column_mapping_config:
            logger.debug(f"매핑 설정 키 목록 (처음 5개): {list(column_mapping_config.keys())[:5]}")
        
        # 처리된 컬럼들 기록
        processed_columns = []
        unmatched_original_cols = []  # 매칭되지 않은 원본 컬럼명들
        
        # 각 표준 컬럼명에 대해 원본 컬럼명 리스트를 순회하면서 매칭
        # application_info_column_mapping의 구조: {표준컬럼명: [원본컬럼명들]}
        for standard_col, original_cols_list in column_mapping_config.items():
            # 이미 표준 컬럼명이 있으면 스킵 (중복 방지)
            if standard_col in df.columns:
                logger.debug(f"시트 '{sheet_name}': 표준 컬럼 '{standard_col}' 이미 존재, 스킵")
                continue
            
            # 매칭된 컬럼명
            matched_col = None
            
            # 각 원본 컬럼명을 순회하면서 실제 엑셀 파일의 컬럼명과 매칭 시도
            for original_col in original_cols_list:
                matched = self._find_matching_column(original_col, list(df.columns))
                if matched:
                    matched_col = matched
                    logger.debug(f"시트 '{sheet_name}': 원본 컬럼명 '{original_col}'이 실제 컬럼명 '{matched}'와 매칭됨")
                    break
            
            # 매칭된 컬럼이 있으면 표준 컬럼명으로 변경
            if matched_col:
                df.rename(columns={matched_col: standard_col}, inplace=True)
                processed_columns.append((matched_col, standard_col))
                logger.info(f"시트 '{sheet_name}': '{matched_col}' -> '{standard_col}' 변환 성공")
            else:
                # 매칭되지 않은 원본 컬럼명들 기록
                unmatched_original_cols.append((standard_col, original_cols_list))
                logger.warning(f"시트 '{sheet_name}': 표준 컬럼 '{standard_col}'에 매칭되는 컬럼 없음")
                logger.debug(f"  시도한 원본 컬럼명들: {original_cols_list[:5]}")
                logger.debug(f"  실제 엑셀 컬럼명들: {list(df.columns)[:10]}")
        
        # 결과 로깅
        if processed_columns:
            logger.info(f"시트 '{sheet_name}' 변경된 컬럼 ({len(processed_columns)}개): {processed_columns}")
            logger.info(f"시트 '{sheet_name}' 변환 후 컬럼명: {list(df.columns)}")
        else:
            logger.warning(f"시트 '{sheet_name}': 변경된 컬럼 없음")
        
        # 매칭되지 않은 표준 컬럼이 있으면 경고
        if unmatched_original_cols:
            logger.warning(f"시트 '{sheet_name}': 매칭되지 않은 표준 컬럼 ({len(unmatched_original_cols)}개)")
            for standard_col, original_cols_list in unmatched_original_cols[:5]:  # 최대 5개만 표시
                logger.warning(f"  - '{standard_col}': 시도한 원본 컬럼명들 = {original_cols_list[:5]}")
        
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
            
            # 설정이 로드되었는지 확인
            if self.config.config_data is None:
                logger.error("ConfigManager의 설정이 로드되지 않았습니다! ensure_loaded가 먼저 호출되어야 합니다.")
                raise ValueError("설정이 로드되지 않았습니다. WorkflowManager에서 ensure_loaded를 먼저 호출하세요.")
            
            # application_info_column_mapping 설정 확인
            column_mapping = self.config.get_sync('application_info_column_mapping', {})
            if not column_mapping:
                logger.warning("application_info_column_mapping 설정이 비어있습니다. 기본 설정을 확인하세요.")
            
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
                # 각 시트를 순회하면서 원본 컬럼명에 해당하는 컬럼이 있으면 표준 컬럼명으로 변경
                df = self.normalize_column_names(df, sheet_name=sheet_name)
                
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
                column_mapping = self.config.get_sync('application_info_column_mapping', {})
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

