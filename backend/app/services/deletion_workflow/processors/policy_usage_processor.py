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

            # 멀티시트 파일(DB 추출 형식) 대응: 'usage' 시트 우선 읽기
            xl = pd.ExcelFile(usage_file)
            if 'usage' in xl.sheet_names:
                usage_df = xl.parse('usage')
            else:
                usage_df = xl.parse(0)

            if '미사용여부' not in policy_df.columns:
                policy_df['미사용여부'] = ''

            if 'Rule Name' not in usage_df.columns:
                raise ValueError("미사용 정보 파일에 'Rule Name' 컬럼이 없습니다.")

            # 미사용여부 없으면 Unused Days로 계산 (DB 추출 usage 시트 형식 대응)
            if '미사용여부' not in usage_df.columns:
                if 'Unused Days' not in usage_df.columns:
                    raise ValueError("미사용 정보 파일에 '미사용여부' 또는 'Unused Days' 컬럼이 없습니다.")
                threshold = self.config.get('analysis_criteria.unused_threshold_days', 90)
                unused_days_numeric = pd.to_numeric(usage_df['Unused Days'], errors='coerce')
                # Unused Days가 전부 비어있으면 히트카운트 동기화가 안 된 것 — 전부
                # '미사용'으로 잘못 분류하지 않도록 여기서 명확히 에러 처리한다.
                if unused_days_numeric.isna().all():
                    raise ValueError(
                        "이 장비는 사용이력(히트카운트) 데이터가 없습니다. "
                        "먼저 사용이력을 동기화하거나 사용이력 파일을 업로드한 뒤 다시 실행하세요."
                    )
                usage_df['미사용여부'] = unused_days_numeric.apply(
                    lambda x: '미사용' if pd.isna(x) or x > threshold else '사용'
                )

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
        except ValueError:
            raise
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
