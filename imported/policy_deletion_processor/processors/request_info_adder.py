#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
신청 정보 추가 기능을 제공하는 모듈
"""

import logging
import pandas as pd

logger = logging.getLogger(__name__)

class RequestInfoAdder:
    """신청 정보 추가 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        신청 정보 추가기를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
    
    def read_and_process_excel(self, file):
        """
        Excel 파일을 읽고 초기 처리합니다.
        
        Args:
            file (str): 파일 경로
            
        Returns:
            DataFrame: 처리된 DataFrame
        """
        df = pd.read_excel(file)
        df.replace({'nan': None}, inplace=True)
        return df.astype(str)
    
    def match_and_update_df(self, rule_df, info_df):
        """
        조건에 따라 DataFrame의 값을 매칭 및 업데이트합니다.
        
        Args:
            rule_df (DataFrame): 규칙 DataFrame
            info_df (DataFrame): 정보 DataFrame
        """
        
        rule_df['End Date'] = pd.to_datetime(rule_df['End Date']).dt.date
        info_df['REQUEST_END_DATE'] = pd.to_datetime(info_df['REQUEST_END_DATE']).dt.date

        total = len(rule_df)
        for idx, row in rule_df.iterrows():
            print(f"\r신청 정보 매칭 중: {idx + 1}/{total}", end='', flush=True)
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
                rule_df.at[idx, 'REQUESTER_EMAIL'] = row['Request User'] + '@samsung.com'
        
        print()  # 줄바꿈
    
    def find_auto_extension_id(self, info_df):
        """
        자동 연장 ID를 찾습니다.
        
        Args:
            info_df (DataFrame): 정보 DataFrame
            
        Returns:
            Series: 자동 연장 ID 시리즈
        """

        info_df['REQUEST_STATUS']
        if 'REQUEST_STATUS' not in info_df.columns:
            return f"Error: 'REQUEST_STATUS' 컬럼이 데이터프레임에 존재하지 않습니다."

        # 숫자형이 아닐 경우 변환 시도
        if not pd.api.types.is_numeric_dtype(info_df['REQUEST_STATUS']):
            try:
                info_df['REQUEST_STATUS'] = pd.to_numeric(info_df['REQUEST_STATUS'], errors='coerce')  # 숫자로 변환 (변환 불가능한 값은 NaN)
            except Exception as e:
                return f"Error: 'REQUEST_STATUS' 컬럼을 숫자로 변환할 수 없습니다. {e}"

        # filtered_df = info_df[info_df['REQUEST_STATUS'].isin([98, 99])]['REQUEST_ID'].drop_duplicates()
        # 정책그룹만 자동연장 -> 연장제외 된 케이스를 예외하기 위함.
        filtered_df = info_df[
            ((info_df['REQUEST_STATUS'] == 98) & info_df['REQUEST_ID'].str.startswith('PS')) |
            (info_df['REQUEST_STATUS'] == 99)
        ]['REQUEST_ID'].drop_duplicates()
        logger.info(f"자동 연장 ID {len(filtered_df)}개를 찾았습니다.")
        return filtered_df
    
    def add_request_info(self, file_manager):
        """
        파일에 신청 정보를 추가합니다.
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print('정책 파일을 선택하세요:')
            rule_file = file_manager.select_files()
            if not rule_file:
                return False
            
            print("정보 파일을 선택하세요:")
            info_file = file_manager.select_files()
            if not info_file:
                return False
            
            rule_df = self.read_and_process_excel(rule_file)
            info_df = self.read_and_process_excel(info_file)
            info_df = info_df.sort_values(by='REQUEST_END_DATE', ascending=False)
            
            auto_extension_id = self.find_auto_extension_id(info_df)
            
            self.match_and_update_df(rule_df, info_df)
            rule_df.replace({'nan': None}, inplace=True)
            
            if not auto_extension_id.empty:
                rule_df.loc[rule_df['REQUEST_ID'].isin(auto_extension_id), 'REQUEST_STATUS'] = '99'
                logger.info(f"{len(rule_df[rule_df['REQUEST_STATUS'] == '99'])}개의 정책에 자동 연장 상태를 설정했습니다.")
            
            new_file_name = file_manager.update_version(rule_file)
            rule_df.to_excel(new_file_name, index=False)
            logger.info(f"신청 정보 추가 결과를 '{new_file_name}'에 저장했습니다.")
            print(f"신청 정보 추가 결과가 '{new_file_name}'에 저장되었습니다.")
            return True
        except Exception as e:
            logger.exception(f"신청 정보 추가 중 오류 발생: {e}")
            return False 