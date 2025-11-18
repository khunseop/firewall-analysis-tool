#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
중복정책 분류 기능을 제공하는 모듈
"""

import logging
import pandas as pd
import os

logger = logging.getLogger(__name__)

class DuplicatePolicyClassifier:
    """중복정책 분류 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        중복정책 분류기를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
    
    def organize_redundant_file(self, file_manager):
        """
        중복정책 파일을 분류합니다.
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            # 예상되는 컬럼 정의
            expected_columns = ['No', 'Type', 'Seq', 'Rule Name', 'Enable', 'Action', 'Source', 'User', 'Destination', 'Service', 'Application', 'Security Profile', 'Category', 'Description', 'Request Type', 'Request ID', 'Ruleset ID', 'MIS ID', 'Request User', 'Start Date', 'End Date']
            expected_columns_2 = ['No', 'Type', 'Vsys', 'Seq', 'Rule Name', 'Enable', 'Action', 'Source', 'User', 'Destination', 'Service', 'Application', 'Security Profile', 'Category', 'Description', 'Request Type', 'Request ID', 'Ruleset ID', 'MIS ID', 'Request User', 'Start Date', 'End Date']
            
            print('중복정책 파일을 선택하세요:')
            selected_file = file_manager.select_files()
            if not selected_file:
                return False
            
            # 자동 연장 ID 찾기
            print('가공된 신청정보 파일을 선택하세요:')
            info_file = file_manager.select_files()
            if not info_file:
                return False
            
            info_df = pd.read_excel(info_file)
            # auto_extension_id = info_df[info_df['REQUEST_STATUS'].isin([98, 99])]['REQUEST_ID'].drop_duplicates()
            # 정책그룹만 자동연장 -> 연장제외 된 케이스를 예외하기 위함.
            auto_extension_id = info_df[
                ((info_df['REQUEST_STATUS'] == 98) & info_df['REQUEST_ID'].str.startswith('PS')) |
                (info_df['REQUEST_STATUS'] == 99)
            ]['REQUEST_ID'].drop_duplicates()

            # 중복정책 파일 로드
            df = pd.read_excel(selected_file)
            
            # 컬럼 확인
            current_columns = df.columns.tolist()
            if set(current_columns) >= set(expected_columns) or set(current_columns) >= set(expected_columns_2):
                logger.info("컬럼명이 일치합니다.")
            else:
                logger.warning("컬럼명이 일치하지 않습니다.")
                print("컬럼명이 일치하지 않습니다. 계속 진행하시겠습니까? (y/n)")
                if input().lower() != 'y':
                    return False
            
            # 자동연장 여부 표시
            df['자동연장'] = df['Request ID'].isin(auto_extension_id)
            
            # 늦은종료일 표시 (각 No 그룹에서 가장 늦은 종료일을 가진 행)
            df['늦은종료일'] = df.groupby('No')['End Date'].transform(lambda x: (x == x.max()) & (~x.duplicated(keep='first')))
            
            # 신청자 검증 (각 No 그룹의 신청자가 모두 동일한지)
            df['신청자검증'] = df.groupby('No')['Request User'].transform(lambda x: x.nunique() == 1)
            
            # 날짜 검증 대상 규칙 찾기
            target_rule_true = df[(df['Type'] == 'Upper') & (df['늦은종료일'] == True)]['No'].unique()
            
            # 날짜 검증 표시
            df['날짜검증'] = False
            df.loc[df['No'].isin(target_rule_true), '날짜검증'] = True
            
            # 작업구분 설정 (유지 또는 삭제)
            df['작업구분'] = '유지'
            df.loc[df['늦은종료일'] == False, '작업구분'] = '삭제'
            
            # 공지여부 설정
            df['공지여부'] = False
            df.loc[df['신청자검증'] == False, '공지여부'] = True
            
            # 미사용 예외 설정
            df['미사용예외'] = False
            df.loc[(df['날짜검증'] == False) & (df['늦은종료일'] == True), '미사용예외'] = True
            
            # 자동연장 그룹 정책 예외 처리
            extensioned_df = df.groupby('No').filter(lambda x: x['자동연장'].any())
            extensioned_group = extensioned_df[extensioned_df['Request Type'] == 'GROUP']
            exception_target = extensioned_group.groupby('No').filter(lambda x: len(x['Request ID'].unique()) >= 2)
            exception_id = exception_target[(exception_target['자동연장'] == True) & (exception_target['작업구분'] == '삭제')]['No']
            
            # 예외 ID 제외
            df = df[~df['No'].isin(exception_id)]
            
            # 자동연장 정책 중 삭제 대상 필터링
            filtered_no = df.groupby('No').filter(
                lambda x: (x['Request Type'] != 'GROUP').any() and
                        (x['작업구분'] == '삭제').any() and
                        (x['자동연장'] == True).any()
            )['No'].unique()
            
            df = df[~df['No'].isin(filtered_no)]
            
            # 모두 삭제 대상인 그룹 필터링
            filtered_no_2 = df.groupby('No').filter(
                lambda x: (x['작업구분'] != '유지').all()
            )['No'].unique()
            
            df = df[~df['No'].isin(filtered_no_2)]
            
            # 특정 타입 제외
            target_types = ["PAM", "SERVER", "Unknown"]
            target_nos = df[df['Request Type'].isin(target_types)]['No'].drop_duplicates()
            
            df = df[~df['No'].isin(target_nos)]
            
            # 공지용과 삭제용으로 분리
            notice_df = df[df['공지여부'] == True].copy()
            delete_df = df[df['공지여부'] == False].copy()
            
            # 작업구분 컬럼을 맨 앞으로 이동
            for target_df in [notice_df, delete_df]:
                column_to_move = target_df.pop('작업구분')
                target_df.insert(0, '작업구분', column_to_move)
            
            # 불필요한 컬럼 제거
            columns_to_drop = ['Request Type', 'Ruleset ID', 'MIS ID', 'Start Date', 'End Date', 
                              '늦은종료일', '신청자검증', '날짜검증', '공지여부', '미사용예외', '자동연장']
            
            notice_df.drop(columns=columns_to_drop, inplace=True, errors='ignore')
            delete_df.drop(columns=columns_to_drop, inplace=True, errors='ignore')
            
            # 결과 저장
            filename = file_manager.remove_extension(selected_file)
            output_excel_path = f'{filename}_정리.xlsx'
            notice_excel_path = f'{filename}_공지.xlsx'
            delete_excel_path = f'{filename}_삭제.xlsx'
            
            df.to_excel(output_excel_path, index=False, engine='openpyxl')
            notice_df.to_excel(notice_excel_path, index=False, engine='openpyxl')
            delete_df.to_excel(delete_excel_path, index=False, engine='openpyxl')
            
            logger.info(f"중복정책 분류 결과를 '{output_excel_path}'에 저장했습니다.")
            logger.info(f"공지용 중복정책을 '{notice_excel_path}'에 저장했습니다.")
            logger.info(f"삭제용 중복정책을 '{delete_excel_path}'에 저장했습니다.")
            
            print(f"중복정책 분류 결과가 다음 파일에 저장되었습니다:")
            print(f"- 전체 결과: {output_excel_path}")
            print(f"- 공지용: {notice_excel_path}")
            print(f"- 삭제용: {delete_excel_path}")
            
            return True
        
        except Exception as e:
            logger.exception(f"중복정책 분류 중 오류 발생: {e}")
            return False
    
    def add_duplicate_status(self, file_manager):
        """
        중복정책 분류 결과(작업구분)를 정책 파일에 추가합니다.
        
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
            
            print("중복정책 분류 결과 파일(_정리.xlsx)을 선택하세요:")
            duplicate_file = file_manager.select_files()
            if not duplicate_file:
                return False
            
            # 파일 로드
            policy_df = pd.read_excel(policy_file)
            duplicate_df = pd.read_excel(duplicate_file)
            
            # 중복여부 컬럼 추가 (없는 경우)
            if '중복여부' not in policy_df.columns:
                policy_df['중복여부'] = ''
            
            # 필요한 컬럼이 있는지 확인
            if 'Rule Name' not in duplicate_df.columns or '작업구분' not in duplicate_df.columns:
                logger.error("중복정책 파일에 'Rule Name' 또는 '작업구분' 컬럼이 없습니다.")
                print("중복정책 파일에 'Rule Name' 또는 '작업구분' 컬럼이 없습니다.")
                print("중복정책 파일의 컬럼:")
                for col in duplicate_df.columns:
                    print(f"- {col}")
                return False
            
            # 작업구분 데이터 매핑
            duplicate_map = duplicate_df[['Rule Name', '작업구분']].set_index('Rule Name').to_dict()['작업구분']
            
            # 정책 파일에 작업구분 데이터 추가
            updated_count = 0
            for idx, row in policy_df.iterrows():
                rule_name = row['Rule Name']
                if rule_name in duplicate_map:
                    policy_df.at[idx, '중복여부'] = duplicate_map[rule_name]
                    updated_count += 1

            # 컬럼 재배열: '중복여부'를 두 번째 위치(인덱스 1번)로 이동
            cols = policy_df.columns.tolist()
            cols.insert(1, cols.pop(cols.index('중복여부')))
            policy_df = policy_df[cols]
                        
            # 결과 저장
            output_file = file_manager.update_version(policy_file)
            policy_df.to_excel(output_file, index=False, engine='openpyxl')
            
            logger.info(f"중복여부 정보가 추가된 파일을 '{output_file}'에 저장했습니다.")
            logger.info(f"총 {updated_count}개의 정책에 중복여부 정보가 추가되었습니다.")
            
            print(f"중복여부 정보가 추가된 파일이 저장되었습니다: {output_file}")
            print(f"총 {updated_count}개의 정책에 중복여부 정보가 추가되었습니다.")
            
            return True
        
        except Exception as e:
            logger.exception(f"중복여부 정보 추가 중 오류 발생: {e}")
            return False 