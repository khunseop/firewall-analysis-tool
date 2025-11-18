#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
GSAMS에서 전달받은 신청 정보를 취합하는 모듈
"""

import logging
import pandas as pd

logger = logging.getLogger(__name__)

class ApplicationAggregator:
    """신청 정보를 취합하는 클래스"""
    
    def __init__(self, config_manager):
        """
        모듈을 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager

    
    def format_date(self, date):
        """
        날짜 형식을 20250306 -> 2025-03-06로 변환하는 함수

        """
        try:
            # 숫자나 문자열 형태의 날짜 (예: 20250306) 처리
            if isinstance(date, (int, str)) and len(str(date)) == 8:
                return f"{str(date)[:4]}-{str(date)[4:6]}-{str(date)[6:]}"
            # 이미 2025-03-06 형식일 경우 그대로 반환
            elif isinstance(date, str) and len(date) == 10 and date[4] == '-' and date[7] == '-':
                return date
            # 처리할 수 없는 날짜 형식일 경우 NaN 처리
            else:
                return ""
        except Exception as e:
            logging.error(f"날짜 포맷 변환 중 오류 발생: {e}")
            return ""

    # 여러 시트가 있는 엑셀 파일 읽기
    def process_applications(self, input_file, output_file):
        # 엑셀 파일을 읽어 시트별로 순회
        xls = pd.ExcelFile(input_file)  # 엑셀 파일 열기
        all_sheets = xls.sheet_names  # 모든 시트 이름 가져오기
        logging.info(f"시트 목록: {all_sheets}")

        # 최종 컬럼 정보 정의 (최종 컬럼을 미리 정의)
        final_columns = [
            '마스킹'
            ]

        # 컬럼명 매핑 규칙 정의 (각 시트에서 사용되는 컬럼명을 최종 컬럼명에 맞게 매핑)
        column_mapping = {
            '마스킹': '마스킹'
        }

        # 시트 데이터 저장 리스트
        processed_sheets = []

        # 각 시트를 순차적으로 처리
        for sheet_name in all_sheets:
            logging.info(f"처리 중: {sheet_name}")

            # 각 시트 데이터를 읽기
            df = pd.read_excel(xls, sheet_name=sheet_name)

            # 처리된 컬럼들 기록
            processed_columns = []

            # 컬럼명을 매핑하여 최종 컬럼에 맞게 변경
            for old_col, new_col in column_mapping.items():
                if old_col in df.columns:
                    df.rename(columns={old_col: new_col}, inplace=True)
                    processed_columns.append((old_col, new_col))
                    logging.info(f"시트 '{sheet_name}': {old_col} -> {new_col} 변환")

            if processed_columns:
                logging.info(f"변경된 컬럼: {processed_columns}")
            else:
                logging.info(f"변경된 컬럼 없음")

            # 최종 컬럼에 맞춰서 데이터를 재정렬하고 부족한 컬럼은 공백으로 채움
            df = df.reindex(columns=final_columns, fill_value="")  # 공백으로 채우기

            # 이메일 생성 로직 추가
            df['WRITE_PERSON_EMAIL'] = df.apply(
                lambda row: f"{row['WRITE_PERSON_ID']}@{row['REQUESTER_EMAIL'].split('@')[1]}" 
                if row['WRITE_PERSON_EMAIL'] == "" and pd.notna(row['WRITE_PERSON_ID']) else row['WRITE_PERSON_EMAIL'], 
                axis=1
            )

            df['APPROVAL_PERSON_EMAIL'] = df.apply(
                lambda row: f"{row['APPROVAL_PERSON_ID']}@{'마스킹.com' if row['REQUESTER_EMAIL'].split('@')[1] == '마스킹2.com' else row['REQUESTER_EMAIL'].split('@')[1]}" 
                if row['APPROVAL_PERSON_EMAIL'] == "" and pd.notna(row['APPROVAL_PERSON_ID']) else row['APPROVAL_PERSON_EMAIL'], 
                axis=1
            )

            # 날짜 포맷 수정 ('REQUEST_START_DATE', 'REQUEST_END_DATE' 컬럼)
            for date_column in ['REQUEST_START_DATE', 'REQUEST_END_DATE']:
                if date_column in df.columns:
                    # 날짜 형식 변환: 20250306 -> 2025-03-06, 이미 2025-03-06인 경우는 그대로 두기
                    df[date_column] = df[date_column].apply(lambda x: self.format_date(x))

            # 처리된 데이터를 리스트에 추가
            processed_sheets.append(df)

            logging.info(f"시트 '{sheet_name}' 처리 완료")

        # 모든 시트를 하나로 합침
        final_df = pd.concat(processed_sheets, ignore_index=True)

        # REQUEST_END_DATE 컬럼 내림차순 정렬
        if 'REQUEST_END_DATE' in final_df.columns:
            final_df = final_df.sort_values(by='REQUEST_END_DATE', ascending=False)

        # 최종 데이터프레임 정보 로깅
        logging.info(f"최종 데이터프레임에 {len(final_df)}개의 행이 포함됨")

        # 결과를 새로운 엑셀 파일로 저장
        final_df.to_excel(output_file, index=False)
        logging.info(f"결과 파일 '{output_file}'로 저장 완료")

    def collect_applications(self, file_manager):
        """
        신청 정보를 수집하는 함수
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print("신청정보 파일을 선택하세요:")
            file_name = file_manager.select_files()
            if not file_name:
                return False

            self.process_applications(file_name, f"Conv_{file_name}")

            return True
        except Exception as e:
            logger.exception(f"Merge 중 오류 발생: {e}")
            return False 