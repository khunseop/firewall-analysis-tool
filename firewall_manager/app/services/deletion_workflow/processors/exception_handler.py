# app/services/deletion_workflow/processors/exception_handler.py
"""
방화벽 정책 예외처리 프로세서 (Tasks 6-7).
fpat/fpat/policy_deletion_processor/processors/exception_handler.py 이식.
"""

import logging
import pandas as pd
from datetime import datetime, timedelta

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class ExceptionHandler(BaseProcessor):
    """벤더별 정책 예외 분류 기능을 제공하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        vendor = kwargs.get('vendor', 'paloalto')
        if vendor == 'paloalto':
            return self.paloalto_exception(file_manager)
        return self.secui_exception(file_manager)

    def _check_date(self, row) -> str:
        try:
            end_date = pd.to_datetime(row['REQUEST_END_DATE']).date()
            return '미만료' if end_date >= datetime.now().date() else '만료'
        except Exception:
            return '만료'

    def _reorder_cols(self, df: pd.DataFrame) -> pd.DataFrame:
        """예외/신청이력/만료여부/미사용여부 컬럼 순서를 조정합니다."""
        cols = list(df.columns)
        # 예외 맨 앞으로
        cols = ['예외'] + [c for c in cols if c != '예외']
        df = df[cols]
        # 만료여부를 예외 바로 뒤로
        if '만료여부' in cols:
            cols.insert(cols.index('예외') + 1, cols.pop(cols.index('만료여부')))
            df = df[cols]
        # 신청이력을 예외 바로 뒤로
        if '신청이력' in cols:
            cols.insert(cols.index('예외') + 1, cols.pop(cols.index('신청이력')))
            df = df[cols]
        # 미사용여부를 만료여부 바로 뒤로
        if '미사용여부' in cols and '만료여부' in cols:
            cols.insert(cols.index('만료여부') + 1, cols.pop(cols.index('미사용여부')))
            df = df[cols]
        return df

    def paloalto_exception(self, file_manager) -> bool:
        try:
            rule_file = file_manager.select_files()
            if not rule_file:
                return False

            df = pd.read_excel(rule_file)
            current_date = datetime.now()
            three_months_ago = current_date - timedelta(days=self.config.get('timeframes.recent_policy_days', 90))

            df['예외'] = ''
            df['REQUEST_ID'] = df['REQUEST_ID'].fillna('')

            req_mask = df.apply(lambda r: self.config.is_excepted('request_ids', str(r['REQUEST_ID'])), axis=1)
            df.loc[req_mask, '예외'] = '예외신청정책'

            rule_mask = df.apply(lambda r: self.config.is_excepted('policy_rules', str(r['Rule Name'])), axis=1)
            df.loc[rule_mask, '예외'] = '예외정책'

            # 신규정책 (Rule Name 날짜 추출)
            df['날짜'] = df['Rule Name'].str.extract(r'(\d{8})', expand=False)
            df['날짜'] = pd.to_datetime(df['날짜'], format='%Y%m%d', errors='coerce')
            df.loc[(df['날짜'] >= three_months_ago) & (df['날짜'] <= current_date), '예외'] = '신규정책'

            # 자동연장
            df.loc[df['REQUEST_STATUS'] == 99, '예외'] = '자동연장정책'

            # 인프라정책
            marker_conf = 'policy_processing.analysis_markers.paloalto'
            deny_std_rule = self.config.get(f'{marker_conf}.deny_standard_rule_name', '')
            infra_label = self.config.get(f'{marker_conf}.infrastructure_exception_label', '인프라정책')
            try:
                idx = df[df['Rule Name'] == deny_std_rule].index[0]
                df.loc[df.index < idx, '예외'] = infra_label
            except (IndexError, KeyError):
                logger.warning(f"기준 정책({deny_std_rule})을 찾을 수 없습니다.")

            # 특수 접두사
            infra_prefixes = tuple(self.config.get(f'{marker_conf}.infrastructure_prefixes', []))
            special_label = self.config.get(f'{marker_conf}.special_policy_label', 'XX정책')
            if infra_prefixes:
                df.loc[df['Rule Name'].str.startswith(infra_prefixes), '예외'] = special_label

            df.loc[df['Enable'] == 'N', '예외'] = '비활성화정책'
            df.loc[(df['Rule Name'].str.endswith('_Rule', na=False)) & (df['Enable'] == 'N'), '예외'] = '기준정책'
            df.loc[df['Action'] == 'deny', '예외'] = '차단정책'

            df['예외'].fillna('', inplace=True)
            df['만료여부'] = df.apply(self._check_date, axis=1)
            df.rename(columns={'Request Type': '신청이력'}, inplace=True)
            df.drop(columns=['Request ID', 'Ruleset ID', 'MIS ID', 'Request User', 'Start Date', 'End Date', '날짜'],
                    inplace=True, errors='ignore')
            df['미사용여부'] = ''
            df = self._reorder_cols(df)

            new_file = file_manager.update_version(rule_file, False)
            df.to_excel(new_file, index=False, engine='openpyxl')
            logger.info(f"PaloAlto 예외처리 완료: '{new_file}'")
            return True
        except Exception as e:
            logger.exception(f"PaloAlto 예외처리 오류: {e}")
            return False

    def secui_exception(self, file_manager) -> bool:
        try:
            rule_file = file_manager.select_files()
            if not rule_file:
                return False

            df = pd.read_excel(rule_file)
            current_date = datetime.now()
            three_months_ago = current_date - timedelta(days=self.config.get('timeframes.recent_policy_days', 90))

            df['예외'] = ''
            df['REQUEST_ID'] = df['REQUEST_ID'].fillna('')

            req_mask = df.apply(lambda r: self.config.is_excepted('request_ids', str(r['REQUEST_ID'])), axis=1)
            df.loc[req_mask, '예외'] = '예외신청정책'

            name_col = 'Rule Name' if 'Rule Name' in df.columns else 'Description'
            rule_mask = df.apply(lambda r: self.config.is_excepted('policy_rules', str(r[name_col])), axis=1)
            df.loc[rule_mask, '예외'] = '예외정책'

            df.loc[df['REQUEST_STATUS'] == 99, '예외'] = '자동연장정책'

            marker_conf = 'policy_processing.analysis_markers.secui'
            deny_keyword = self.config.get(f'{marker_conf}.deny_standard_description_keyword', '')
            infra_label = self.config.get(f'{marker_conf}.infrastructure_exception_label', '인프라정책')
            try:
                idx = df[df['Description'].str.contains(deny_keyword, na=False)].index[0]
                df.loc[df.index < idx, '예외'] = infra_label
            except (IndexError, KeyError):
                logger.warning(f"기준 정책 키워드({deny_keyword})를 찾을 수 없습니다.")

            df['Start Date'] = pd.to_datetime(df['Start Date'], errors='coerce')
            df.loc[(df['Start Date'] >= three_months_ago) & (df['Start Date'] <= current_date), '예외'] = '신규정책'

            df.loc[df['Enable'] == 'N', '예외'] = '비활성화정책'
            df.loc[(df['Description'].str.contains('기준룰', na=False)) & (df['Enable'] == 'N'), '예외'] = '기준정책'
            df.loc[df['Action'] == 'deny', '예외'] = '차단정책'

            df['예외'].fillna('', inplace=True)
            df['만료여부'] = df.apply(self._check_date, axis=1)
            df.rename(columns={'Request Type': '신청이력'}, inplace=True)
            df.drop(columns=['Request ID', 'Ruleset ID', 'MIS ID', 'Request User', 'Start Date', 'End Date'],
                    inplace=True, errors='ignore')
            df['미사용여부'] = ''
            df = self._reorder_cols(df)

            new_file = file_manager.update_version(rule_file, False)
            df.to_excel(new_file, index=False, engine='openpyxl')
            logger.info(f"SECUI 예외처리 완료: '{new_file}'")
            return True
        except Exception as e:
            logger.exception(f"SECUI 예외처리 오류: {e}")
            return False
