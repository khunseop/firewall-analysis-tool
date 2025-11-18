#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
미사용 정책 처리 기능을 제공하는 모듈
"""

import logging
import pandas as pd

logger = logging.getLogger(__name__)

class PolicyUsageProcessor:
    """미사용 정책 처리 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        미사용 정책 처리기를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
    
    def add_usage_status(self, file_manager):
        """
        미사용 정책 정보를 정책 파일에 추가합니다.
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print("정책 파일을 선택하세요:")
            policy_file = file_manager.select_files()
            if not policy_file:
                return False
            
            print("미사용 정책 정보 파일을 선택하세요:")
            usage_file = file_manager.select_files()
            if not usage_file:
                return False
            
            # 파일 로드
            policy_df = pd.read_excel(policy_file)
            usage_df = pd.read_excel(usage_file)
            
            # 미사용여부 컬럼이 없으면 추가
            if '미사용여부' not in policy_df.columns:
                policy_df['미사용여부'] = ''
            
            # 필요한 컬럼이 있는지 확인
            if 'Rule Name' not in usage_df.columns or '미사용여부' not in usage_df.columns:
                logger.error("미사용 정보 파일에 'Rule Name' 또는 '미사용여부' 컬럼이 없습니다.")
                print("미사용 정보 파일에 'Rule Name' 또는 '미사용여부' 컬럼이 없습니다.")
                print("미사용 정보 파일의 컬럼:")
                for col in usage_df.columns:
                    print(f"- {col}")
                return False
            
            # 미사용여부 데이터 매핑
            usage_map = usage_df[['Rule Name', '미사용여부']].set_index('Rule Name').to_dict()['미사용여부']
            
            # 정책 파일에 미사용여부 데이터 추가
            updated_count = 0
            total = len(policy_df)
            
            for idx, row in policy_df.iterrows():
                print(f"\r미사용 정보 업데이트 중: {idx + 1}/{total}", end='', flush=True)
                rule_name = row['Rule Name']
                if rule_name in usage_map:
                    policy_df.at[idx, '미사용여부'] = usage_map[rule_name]
                    updated_count += 1
            
            print()  # 줄바꿈
            
            # 결과 저장
            output_file = file_manager.update_version(policy_file)
            policy_df.to_excel(output_file, index=False, engine='openpyxl')
            
            logger.info(f"미사용여부 정보가 추가된 파일을 '{output_file}'에 저장했습니다.")
            logger.info(f"총 {updated_count}개의 정책에 미사용여부 정보가 추가되었습니다.")
            
            print(f"미사용여부 정보가 추가된 파일이 저장되었습니다: {output_file}")
            print(f"총 {updated_count}개의 정책에 미사용여부 정보가 추가되었습니다.")
            
            return True
        
        except Exception as e:
            logger.exception(f"미사용여부 정보 추가 중 오류 발생: {e}")
            return False

    def update_excepted_usage(self, file_manager):
        """
        미사용 정책 정보를 정책 파일에 추가합니다.
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print("정책 파일을 선택하세요:")
            policy_file = file_manager.select_files()
            if not policy_file:
                return False
            
            print("3개월 내 분석된 중복정책 분류 결과 파일(_정리.xlsx)을 선택하세요:")
            duplicate_file = file_manager.select_files()
            if not duplicate_file:
                return False
            
            # 파일 로드
            policy_df = pd.read_excel(policy_file)
            duplicate_df = pd.read_excel(duplicate_file)
            
            # 미사용여부 컬럼이 없으면 추가
            if '미사용여부' not in policy_df.columns:
                policy_df['미사용여부'] = ''
            
            # 필요한 컬럼이 있는지 확인
            if 'Rule Name' not in duplicate_df.columns or '미사용예외' not in duplicate_df.columns:
                logger.error("중복정책 파일에 'Rule Name' 또는 '미사용예외' 컬럼이 없습니다.")
                print("중복정책 파일에 'Rule Name' 또는 '미사용예외' 컬럼이 없습니다.")
                print("중복정책 파일의 컬럼:")
                for col in duplicate_df.columns:
                    print(f"- {col}")
                return False
                        
            # '미사용예외'가 True인 'Rule Name'을 집합(set)으로 저장 (검색 속도 최적화)
            exception_rules = set(duplicate_df.loc[duplicate_df['미사용예외'] == True, 'Rule Name'])
            # 정책 파일에 미사용예외 데이터 추가
            updated_count = 0
            total = len(policy_df)

            # iterrows()를 사용하여 policy_df 순회하면서 변경
            for idx, row in policy_df.iterrows():
                print(f"\r미사용 정보 업데이트 중: {idx + 1}/{total}", end='', flush=True)
                if row['Rule Name'] in exception_rules:  # 'Rule Name'이 예외 목록에 있는지 확인
                    if policy_df.at[idx, '미사용여부'] != '미사용예외':  # 중복 변경 방지
                        policy_df.at[idx, '미사용여부'] = '미사용예외'
                        updated_count += 1  # 변경 개수 증가
                        
            print()  # 줄바꿈
            
            # 결과 저장
            output_file = file_manager.update_version(policy_file)
            policy_df.to_excel(output_file, index=False, engine='openpyxl')
            
            logger.info(f"미사용예외 정보가 업데이트된 파일을 '{output_file}'에 저장했습니다.")
            logger.info(f"총 {updated_count}개의 정책에 미사용예외 정보가 업데이트되었습니다.")
            
            print(f"미사용예외 정보가 업데이트된 파일이 저장되었습니다: {output_file}")
            print(f"총 {updated_count}개의 정책에 미사용예외 정보가 업데이트되었습니다.")
            
            return True
        
        except Exception as e:
            logger.exception(f"미사용예외 정보 업데이트 중 오류 발생: {e}")
            return False 