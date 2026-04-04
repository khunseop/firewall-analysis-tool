# app/services/deletion_workflow/processors/policy_usage_processor.py
"""
미사용 정책 사용현황 처리 프로세서 (Tasks 11-12).
fpat/fpat/policy_deletion_processor/processors/policy_usage_processor.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class PolicyUsageProcessor(BaseProcessor):
    """미사용 정책 상태 추가 및 예외 업데이트 기능을 제공하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        mode = kwargs.get('mode', 'add')
        if mode == 'add':
            return self.add_usage_status(file_manager)
        return self.update_excepted_usage(file_manager)

    def add_usage_status(self, file_manager) -> bool:
        """미사용 정책 정보를 정책 파일에 추가합니다."""
        try:
            policy_file = file_manager.select_files()
            if not policy_file:
                return False

            usage_file = file_manager.select_files()
            if not usage_file:
                return False

            policy_df = pd.read_excel(policy_file)
            usage_df = pd.read_excel(usage_file)

            if '미사용여부' not in policy_df.columns:
                policy_df['미사용여부'] = ''

            if 'Rule Name' not in usage_df.columns or '미사용여부' not in usage_df.columns:
                logger.error("미사용 정보 파일에 'Rule Name' 또는 '미사용여부' 컬럼이 없습니다.")
                return False

            usage_map = usage_df[['Rule Name', '미사용여부']].set_index('Rule Name').to_dict()['미사용여부']
            updated_count = 0
            total = len(policy_df)

            for idx, row in policy_df.iterrows():
                print(f"\r미사용 정보 업데이트 중: {idx + 1}/{total}", end='', flush=True)
                if row['Rule Name'] in usage_map:
                    policy_df.at[idx, '미사용여부'] = usage_map[row['Rule Name']]
                    updated_count += 1
            print()

            output_file = file_manager.update_version(policy_file)
            policy_df.to_excel(output_file, index=False, engine='openpyxl')
            logger.info(f"미사용여부 {updated_count}개 추가 완료: '{output_file}'")
            return True
        except Exception as e:
            logger.exception(f"미사용여부 추가 오류: {e}")
            return False

    def update_excepted_usage(self, file_manager) -> bool:
        """중복정책 분류 결과의 미사용예외를 정책 파일에 반영합니다."""
        try:
            policy_file = file_manager.select_files()
            if not policy_file:
                return False

            duplicate_file = file_manager.select_files()
            if not duplicate_file:
                return False

            policy_df = pd.read_excel(policy_file)
            duplicate_df = pd.read_excel(duplicate_file)

            if '미사용여부' not in policy_df.columns:
                policy_df['미사용여부'] = ''

            if 'Rule Name' not in duplicate_df.columns or '미사용예외' not in duplicate_df.columns:
                logger.error("중복정책 파일에 'Rule Name' 또는 '미사용예외' 컬럼이 없습니다.")
                return False

            exception_rules = set(duplicate_df.loc[duplicate_df['미사용예외'] == True, 'Rule Name'])
            updated_count = 0
            total = len(policy_df)

            for idx, row in policy_df.iterrows():
                print(f"\r미사용예외 업데이트 중: {idx + 1}/{total}", end='', flush=True)
                if row['Rule Name'] in exception_rules and policy_df.at[idx, '미사용여부'] != '미사용예외':
                    policy_df.at[idx, '미사용여부'] = '미사용예외'
                    updated_count += 1
            print()

            output_file = file_manager.update_version(policy_file)
            policy_df.to_excel(output_file, index=False, engine='openpyxl')
            logger.info(f"미사용예외 {updated_count}개 업데이트 완료: '{output_file}'")
            return True
        except Exception as e:
            logger.exception(f"미사용예외 업데이트 오류: {e}")
            return False
