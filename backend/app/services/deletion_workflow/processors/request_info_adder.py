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

    def _safe_to_datetime(self, val):
        """날짜 형식을 안전하게 변환합니다. (1900-01-01 이전/오류 데이터 처리 강화)"""
        if pd.isna(val) or val == "" or str(val).strip() in (
            "1900-01-01", "1900-01-01 00:00:00", "1900-01-00", "1900-01-00 00:00:00",
            "0", "00:00:00", "1899-12-30",
        ):
            return pd.Timestamp("1900-01-01")
        try:
            if isinstance(val, (int, float)):
                return pd.to_datetime(val, unit='D', origin='1899-12-30').normalize()
            dt = pd.to_datetime(val).normalize()
            if dt < pd.Timestamp("1900-01-01"):
                return pd.Timestamp("1900-01-01")
            return dt
        except Exception:
            return pd.Timestamp("1900-01-01")

    def match_and_update_df(self, rule_df: pd.DataFrame, info_df: pd.DataFrame):
        rule_df['End Date'] = rule_df['End Date'].apply(self._safe_to_datetime)
        info_df['REQUEST_END_DATE'] = info_df['REQUEST_END_DATE'].apply(self._safe_to_datetime)

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
                        rule_df.at[idx, col] = self._safe_to_datetime(first[col])
                    else:
                        rule_df.at[idx, col] = first[col]
            elif row['Request Type'] not in ('nan', 'Unknown', 'None'):
                rule_df.at[idx, 'REQUEST_ID'] = row['Request ID']
                rule_df.at[idx, 'REQUEST_START_DATE'] = self._safe_to_datetime(row['Start Date'])
                rule_df.at[idx, 'REQUEST_END_DATE'] = self._safe_to_datetime(row['End Date'])
                rule_df.at[idx, 'REQUESTER_ID'] = row['Request User']
                default_domain = self.config.get('policy_processing.default_email_domain', 'samsung.com')
                rule_df.at[idx, 'REQUESTER_EMAIL'] = row['Request User'] + '@' + default_domain
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
