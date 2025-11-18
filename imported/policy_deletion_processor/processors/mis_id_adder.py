#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
MIS ID 추가 기능을 제공하는 모듈
"""

import logging
import pandas as pd

logger = logging.getLogger(__name__)

class MisIdAdder:
    """MIS ID 추가 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        MIS ID 추가기를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
    
    def add_mis_id(self, file_manager):
        """
        파일에 MIS ID를 추가합니다.
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print("정책 파일을 선택하세요:")
            file = file_manager.select_files()
            if not file:
                return False
            
            print("MIS ID 파일을 선택하세요:")
            csv_extension = self.config.get('file_extensions.csv', '.csv')
            mis_file = file_manager.select_files(csv_extension)
            if not mis_file:
                return False
            
            rule_df = pd.read_excel(file)
            mis_df = pd.read_csv(mis_file)
            
            # 중복 제거
            mis_df_unique = mis_df.drop_duplicates(subset=['ruleset_id'], keep='first')
            
            # MIS ID 매핑 생성
            mis_id_map = mis_df_unique.set_index('ruleset_id')['mis_id']
            
            # MIS ID 업데이트
            total = len(rule_df)
            updated_count = 0
            
            for idx, row in rule_df.iterrows():
                print(f"\rMIS ID 업데이트 중: {idx + 1}/{total}", end='', flush=True)
                
                ruleset_id = row['Ruleset ID']
                current_mis_id = row['MIS ID']
                
                if (pd.isna(current_mis_id) or current_mis_id == '') and ruleset_id in mis_id_map:
                    rule_df.at[idx, 'MIS ID'] = mis_id_map.get(ruleset_id)
                    updated_count += 1
            
            print()  # 줄바꿈
            
            new_file_name = file_manager.update_version(file)
            rule_df.to_excel(new_file_name, index=False, engine='openpyxl')
            
            logger.info(f"{updated_count}개의 정책에 MIS ID를 추가했습니다.")
            logger.info(f"MIS ID 추가 결과를 '{new_file_name}'에 저장했습니다.")
            print(f"{updated_count}개의 정책에 MIS ID를 추가했습니다.")
            print(f"MIS ID 추가 결과가 '{new_file_name}'에 저장되었습니다.")
            return True
        except Exception as e:
            logger.exception(f"MIS ID 추가 중 오류 발생: {e}")
            return False 