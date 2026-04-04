# app/services/deletion_workflow/processors/merge_hitcount.py
"""
HA 장비 히트카운트 병합 프로세서 (Task 10).
fpat/fpat/policy_deletion_processor/processors/merge_hitcount.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class MergeHitcount(BaseProcessor):
    """Primary/Secondary 장비에서 수집한 Hit 정보를 병합하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.mergehitcounts(file_manager)

    def mergehitcounts(self, file_manager) -> bool:
        try:
            first_file = file_manager.select_files()
            if not first_file:
                return False

            second_file = file_manager.select_files()
            if not second_file:
                return False

            df1 = pd.read_excel(first_file)
            df2 = pd.read_excel(second_file)

            merged_df = pd.merge(df1, df2, on='Rule Name', suffixes=('_df1', '_df2'))

            merged_df['Vsys'] = merged_df['Vsys_df1']
            merged_df['Hit Counts'] = merged_df['Hit Count_df1'] + merged_df['Hit Count_df2']
            merged_df['Last Hit Date'] = merged_df[['Last Hit Date_df1', 'Last Hit Date_df2']].max(axis=1)
            merged_df['Unused Days'] = merged_df[['Unused Days_df1', 'Unused Days_df2']].min(axis=1)

            drop_cols = [
                'Vsys_df1', 'Vsys_df2',
                'First Hit Date_df1', 'First Hit Date_df2',
                'Last Hit Date_df1', 'Last Hit Date_df2',
                'Unused Days_df1', 'Unused Days_df2',
                'Hit Count_df1', 'Hit Count_df2',
            ]
            merged_df.drop(columns=drop_cols, inplace=True, errors='ignore')

            unused_threshold = self.config.get('analysis_criteria.unused_threshold_days', 90)
            merged_df['미사용여부'] = merged_df['Unused Days'].apply(
                lambda x: '미사용' if x > unused_threshold else '사용'
            )

            output_file = f"Merged_{first_file}"
            merged_df.to_excel(output_file, index=False)
            logger.info(f"히트카운트 병합 완료: '{output_file}'")
            return True
        except Exception as e:
            logger.exception(f"히트카운트 병합 오류: {e}")
            return False
