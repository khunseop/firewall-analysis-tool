# app/services/deletion_workflow/processors/mis_id_adder.py
"""
MIS ID 추가 프로세서 (Task 3).
fpat/fpat/policy_deletion_processor/processors/mis_id_adder.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class MisIdAdder(BaseProcessor):
    """CSV에서 MIS ID를 읽어 정책 파일에 추가하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.add_mis_id(file_manager)

    def add_mis_id(self, file_manager) -> bool:
        try:
            file = file_manager.select_files()
            if not file:
                return False

            csv_extension = self.config.get('file_extensions.csv', '.csv')
            mis_file = file_manager.select_files(csv_extension)
            if not mis_file:
                return False

            rule_df = pd.read_excel(file)
            mis_df = pd.read_csv(mis_file)

            mis_df_unique = mis_df.drop_duplicates(subset=['ruleset_id'], keep='first')
            mis_id_map = mis_df_unique.set_index('ruleset_id')['mis_id']

            total = len(rule_df)
            updated_count = 0

            for idx, row in rule_df.iterrows():
                print(f"\rMIS ID 업데이트 중: {idx + 1}/{total}", end='', flush=True)
                ruleset_id = row['Ruleset ID']
                current_mis_id = row['MIS ID']
                if (pd.isna(current_mis_id) or current_mis_id == '') and ruleset_id in mis_id_map:
                    rule_df.at[idx, 'MIS ID'] = mis_id_map.get(ruleset_id)
                    updated_count += 1
            print()

            new_file_name = file_manager.update_version(file)
            rule_df.to_excel(new_file_name, index=False, engine='openpyxl')
            logger.info(f"MIS ID {updated_count}개 추가 완료: '{new_file_name}'")
            return True
        except Exception as e:
            logger.exception(f"MIS ID 추가 중 오류: {e}")
            return False
