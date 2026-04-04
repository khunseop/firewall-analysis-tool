# app/services/deletion_workflow/processors/application_aggregator.py
"""
신청 정보 취합 프로세서 (Task 4).
fpat/fpat/policy_deletion_processor/processors/application_aggregator.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class ApplicationAggregator(BaseProcessor):
    """외부 시스템(GSAMS 등)에서 전달받은 신청 정보를 취합하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.collect_applications(file_manager)

    def format_date(self, date) -> str:
        try:
            if isinstance(date, (int, str)) and len(str(date)) == 8:
                d = str(date)
                return f"{d[:4]}-{d[4:6]}-{d[6:]}"
            elif isinstance(date, str) and len(date) == 10 and date[4] == '-' and date[7] == '-':
                return date
            return ""
        except Exception as e:
            logger.error(f"날짜 포맷 변환 오류: {e}")
            return ""

    def process_applications(self, input_file: str, output_file: str):
        agg_conf = 'policy_processing.aggregation'
        final_columns = self.config.get(f'{agg_conf}.final_columns', [])
        column_mapping = self.config.get(f'{agg_conf}.column_mapping', {})
        domain_map = self.config.get(f'{agg_conf}.email_domain_map', {})

        xls = pd.ExcelFile(input_file)
        processed_sheets = []

        for sheet_name in xls.sheet_names:
            logger.info(f"처리 중: {sheet_name}")
            df = pd.read_excel(xls, sheet_name=sheet_name)

            if 'REQUEST_ID' in df.columns and '신청번호' in df.columns:
                df = df.drop(columns='신청번호')

            for old_col, new_col in column_mapping.items():
                if old_col in df.columns:
                    df.rename(columns={old_col: new_col}, inplace=True)

            df = df.reindex(columns=final_columns, fill_value="")

            df['WRITE_PERSON_EMAIL'] = df.apply(
                lambda row: f"{row['WRITE_PERSON_ID']}@{row['REQUESTER_EMAIL'].split('@')[1]}"
                if row.get('WRITE_PERSON_EMAIL') == "" and pd.notna(row.get('WRITE_PERSON_ID'))
                else row.get('WRITE_PERSON_EMAIL', ''),
                axis=1
            )

            def map_approval_email(row):
                if not row.get('REQUESTER_EMAIL') or '@' not in row['REQUESTER_EMAIL']:
                    return row.get('APPROVAL_PERSON_EMAIL', '')
                domain = row['REQUESTER_EMAIL'].split('@')[1]
                target_domain = domain_map.get(domain, domain)
                if row.get('APPROVAL_PERSON_EMAIL') == "" and pd.notna(row.get('APPROVAL_PERSON_ID')):
                    return f"{row['APPROVAL_PERSON_ID']}@{target_domain}"
                return row.get('APPROVAL_PERSON_EMAIL', '')

            df['APPROVAL_PERSON_EMAIL'] = df.apply(map_approval_email, axis=1)

            for date_column in ['REQUEST_START_DATE', 'REQUEST_END_DATE']:
                if date_column in df.columns:
                    df[date_column] = df[date_column].apply(self.format_date)

            processed_sheets.append(df)
            logger.info(f"시트 '{sheet_name}' 처리 완료")

        final_df = pd.concat(processed_sheets, ignore_index=True)
        if 'REQUEST_END_DATE' in final_df.columns:
            final_df = final_df.sort_values(by='REQUEST_END_DATE', ascending=False)

        final_df.to_excel(output_file, index=False)
        logger.info(f"취합 완료: '{output_file}' ({len(final_df)}행)")

    def collect_applications(self, file_manager) -> bool:
        try:
            file_name = file_manager.select_files()
            if not file_name:
                return False
            self.process_applications(file_name, f"Conv_{file_name}")
            return True
        except Exception as e:
            logger.exception(f"신청 정보 취합 중 오류: {e}")
            return False
