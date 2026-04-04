# app/services/deletion_workflow/processors/request_info_adder.py
"""
신청 정보 매핑 프로세서 (Task 5).
fpat/fpat/policy_deletion_processor/processors/request_info_adder.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class RequestInfoAdder(BaseProcessor):
    """정책 파일에 외부 신청 정보를 매핑하여 추가하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.add_request_info(file_manager)

    def read_and_process_excel(self, file: str) -> pd.DataFrame:
        df = pd.read_excel(file)
        df.replace({'nan': None}, inplace=True)
        return df.astype(str)

    def match_and_update_df(self, rule_df: pd.DataFrame, info_df: pd.DataFrame):
        rule_df['End Date'] = pd.to_datetime(rule_df['End Date']).dt.normalize()
        info_df['REQUEST_END_DATE'] = pd.to_datetime(info_df['REQUEST_END_DATE']).dt.normalize()

        total = len(rule_df)
        for idx, row in rule_df.iterrows():
            print(f"\r신청 정보 매칭 중: {idx + 1}/{total}", end='', flush=True)
            matched_row = pd.DataFrame()

            if row['Request Type'] == 'GROUP':
                match_conditions = [
                    ((info_df['REQUEST_ID'] == row['Request ID']) & (info_df['MIS_ID'] == row['MIS ID'])),
                    ((info_df['REQUEST_ID'] == row['Request ID']) & (info_df['REQUEST_END_DATE'] == row['End Date']) & (info_df['WRITE_PERSON_ID'] == row['Request User'])),
                    ((info_df['REQUEST_ID'] == row['Request ID']) & (info_df['REQUEST_END_DATE'] == row['End Date']) & (info_df['REQUESTER_ID'] == row['Request User'])),
                ]
            else:
                match_conditions = [(info_df['REQUEST_ID'] == row['Request ID'])]

            for cond in match_conditions:
                subset = info_df[cond]
                if not subset.empty:
                    matched_row = subset.sort_index()
                    break

            if not matched_row.empty:
                first = matched_row.iloc[0]
                for col in matched_row.columns:
                    if col in ['REQUEST_START_DATE', 'REQUEST_END_DATE', 'Start Date', 'End Date']:
                        rule_df.at[idx, col] = pd.to_datetime(first[col], errors='coerce')
                    else:
                        rule_df.at[idx, col] = first[col]
            elif row['Request Type'] not in ('nan', 'Unknown'):
                rule_df.at[idx, 'REQUEST_ID'] = row['Request ID']
                rule_df.at[idx, 'REQUEST_START_DATE'] = row['Start Date']
                rule_df.at[idx, 'REQUEST_END_DATE'] = row['End Date']
                rule_df.at[idx, 'REQUESTER_ID'] = row['Request User']
                rule_df.at[idx, 'REQUESTER_EMAIL'] = row['Request User'] + '@samsung.com'
        print()

    def find_auto_extension_id(self, info_df: pd.DataFrame) -> pd.Series:
        if 'REQUEST_STATUS' not in info_df.columns:
            logger.error("'REQUEST_STATUS' 컬럼이 없습니다.")
            return pd.Series(dtype=str)

        if not pd.api.types.is_numeric_dtype(info_df['REQUEST_STATUS']):
            info_df['REQUEST_STATUS'] = pd.to_numeric(info_df['REQUEST_STATUS'], errors='coerce')

        filtered = info_df[info_df['REQUEST_STATUS'] == 99]['REQUEST_ID'].drop_duplicates()
        logger.info(f"자동 연장 ID {len(filtered)}개 발견")
        return filtered

    def add_request_info(self, file_manager) -> bool:
        try:
            rule_file = file_manager.select_files()
            if not rule_file:
                return False

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

            new_file_name = file_manager.update_version(rule_file)
            rule_df.to_excel(new_file_name, index=False)
            logger.info(f"신청 정보 매핑 완료: '{new_file_name}'")
            return True
        except Exception as e:
            logger.exception(f"신청 정보 매핑 중 오류: {e}")
            return False
