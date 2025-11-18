#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
FPAT으로 추출된 Hit 정보 2개를 Merge하는 모듈
"""

import logging
import pandas as pd

logger = logging.getLogger(__name__)

class MergeHitcount:
    """FPAT으로 추출된 Hit 정보 2개를 Merge하는 클래스"""
    
    def __init__(self, config_manager):
        """
        Merge 모듈을 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager

    def mergehitcounts(self, file_manager):
        """
        Hit 정보 2개를 Merge합니다.
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print("첫 번째 Hit 파일을 선택하세요:")
            first_file = file_manager.select_files()
            if not first_file:
                return False

            print("두 번째 Hit 파일을 선택하세요:")
            second_file = file_manager.select_files()
            if not second_file:
                return False

            df1 = pd.read_excel(first_file)
            df2 = pd.read_excel(second_file)

            # Rule Name을 기준으로 두 데이터프레임을 병합하고,
            # 'Last Hit Date'는 더 큰 값으로, 'Unused Days'는 작은 값으로 설정
            merged_df = pd.merge(df1, df2, on='Rule Name', suffixes=('_df1', '_df2'))

            # 'Last Hit Date'와 'Unused Days' 컬럼을 각각 처리
            # merged_df['First Hit Date'] = merged_df[['First Hit Date_df1', 'First Hit Date_df2']].min(axis=1) # 세컨더리 장비의 First Hit Date를 가져와서 이상함.
            merged_df['Vsys'] = merged_df['Vsys_df1']
            merged_df['Hit Counts'] = merged_df['Hit Count_df1'] + merged_df['Hit Count_df2']
            merged_df['Last Hit Date'] = merged_df[['Last Hit Date_df1', 'Last Hit Date_df2']].max(axis=1)
            merged_df['Unused Days'] = merged_df[['Unused Days_df1', 'Unused Days_df2']].min(axis=1)
            
            # 필요 없는 중복 컬럼을 삭제
            merged_df.drop(['Vsys_df1', 'Vsys_df2', 'First Hit Date_df1', 'First Hit Date_df2', 'Last Hit Date_df1', 'Last Hit Date_df2', 'Unused Days_df1', 'Unused Days_df2', 'Hit Count_df1', 'Hit Count_df2'], axis=1, inplace=True)
            
            # 90일 기준에 따라 '미사용여부' 컬럼 생성
            merged_df['미사용여부'] = merged_df['Unused Days'].apply(lambda x: '미사용' if x > 90 else '사용')
            
            # 엑셀 파일로 결과 저장
            output_excel_file = f"Merged_{first_file}"
            merged_df.to_excel(output_excel_file, index=False)

            logger.info(f"데이터를 '{output_excel_file}'파일로 저장했습니다.")
            print(f"데이터를 {output_excel_file} 파일로 저장했습니다.")
            
            return True
        except Exception as e:
            logger.exception(f"Merge 중 오류 발생: {e}")
            return False 