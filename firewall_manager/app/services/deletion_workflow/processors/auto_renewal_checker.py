# app/services/deletion_workflow/processors/auto_renewal_checker.py
"""
자동연장 정책 탐지 프로세서 (Task 14).
fpat/fpat/policy_deletion_processor/processors/auto_renewal_checker.py 이식.
"""

import re
import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class AutoRenewalChecker(BaseProcessor):
    """신청 정보에서 자동 연장 데이터를 확인하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.renewal_check(file_manager)

    def renewal_check(self, file_manager) -> bool:
        bracket_pattern = self.config.get(
            'policy_processing.aggregation.title_bracket_pattern',
            r'^\[([^\[\]]{1,8})\]'
        )

        def remove_bracket_prefix(text: str) -> str:
            if isinstance(text, str) and text.startswith('['):
                while True:
                    m = re.match(bracket_pattern, text)
                    if m:
                        text = text[len(m.group(0)):]
                    else:
                        break
            return text

        try:
            file_name = file_manager.select_files()
            if not file_name:
                return False

            df = pd.read_excel(file_name)
            df['REQUEST_START_DATE'] = pd.to_datetime(df['REQUEST_START_DATE'])
            df['REQUEST_END_DATE'] = pd.to_datetime(df['REQUEST_END_DATE'])

            merged = pd.merge(
                df, df,
                left_on=['REQUEST_ID', 'REQUEST_END_DATE'],
                right_on=['REQUEST_ID', 'REQUEST_START_DATE'],
                suffixes=('_prev', '_next')
            )

            merged['TITLE_prev_clean'] = merged['TITLE_prev'].apply(remove_bracket_prefix)
            merged['TITLE_next_clean'] = merged['TITLE_next'].apply(remove_bracket_prefix)
            merged = merged[merged['WRITE_PERSON_ID_prev'] == merged['WRITE_PERSON_ID_next']]
            filtered_df = merged[merged['TITLE_prev_clean'] == merged['TITLE_next_clean']]

            output_file = f"auto_renewal_{file_name}"
            filtered_df.to_excel(output_file, index=False)
            logger.info(f"자동연장 탐지 완료: '{output_file}' ({len(filtered_df)}건)")
            return True
        except Exception as e:
            logger.exception(f"자동연장 탐지 오류: {e}")
            return False
