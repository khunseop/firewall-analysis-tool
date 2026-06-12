# app/services/deletion_workflow/processors/auto_renewal_checker.py
"""
자동연장 정책 탐지 및 날짜 업데이트 프로세서 (Task 9).
fpat/fpat/policy_deletion_processor/processors/auto_renewal_checker.py 이식.
"""

import re
import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class AutoRenewalChecker(BaseProcessor):
    """자동연장 체인을 분석하고 정책 파일의 날짜를 최신화하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.renewal_check(file_manager)

    def renewal_check(self, file_manager) -> bool:
        try:
            policy_file = file_manager.select_files()
            if not policy_file:
                return False

            conv_file = file_manager.select_files()
            if not conv_file:
                return False

            renew_df = self._analyze_chains_precision(conv_file)

            if renew_df is None or renew_df.empty:
                # 연장 체인 없음 — 정책 파일 버전만 올려 Task 10/11 입력으로 전달
                policy_df = pd.read_excel(policy_file)
                out = file_manager.update_version(policy_file)
                policy_df.to_excel(out, index=False, engine='openpyxl')
                logger.info("자동연장 체인 없음 — 정책 파일 버전 업데이트만 수행")
                return True

            return self._update_policy_dates(file_manager, policy_file, renew_df)

        except Exception as e:
            logger.exception(f"자동연장 처리 오류: {e}")
            return False

    def _remove_bracket_prefix(self, text: str) -> str:
        """[괄호] 머리말을 반복 제거합니다."""
        bracket_pattern = self.config.get(
            'policy_processing.aggregation.title_bracket_pattern',
            r'^\[([^\[\]]{1,8})\]'
        )
        if isinstance(text, str) and text.startswith('['):
            while True:
                m = re.match(bracket_pattern, text)
                if m:
                    text = text[len(m.group(0)):].strip()
                else:
                    break
        return text

    def _safe_to_datetime(self, val) -> pd.Timestamp:
        """날짜 값을 안전하게 Timestamp로 변환합니다. Excel serial date, 경계값 처리 포함."""
        sentinel = pd.Timestamp("1900-01-01")
        if pd.isna(val):
            return sentinel
        str_val = str(val).strip()
        if str_val in ("1900-01-01", "1900-01-00", "0", "00:00:00", "1899-12-30", ""):
            return sentinel
        try:
            if isinstance(val, (int, float)):
                return pd.to_datetime(val, unit='D', origin='1899-12-30').normalize()
            return pd.to_datetime(val).normalize()
        except Exception:
            return sentinel

    def _analyze_chains_precision(self, conv_file) -> pd.DataFrame:
        """종료일-시작일 매칭 및 작성자/제목 검증으로 자동연장 체인을 탐지합니다."""
        logger.info(f"연장 체인 분석: {conv_file}")
        df = pd.read_excel(conv_file)

        required = ['REQUEST_ID', 'TITLE', 'REQUEST_START_DATE', 'REQUEST_END_DATE', 'WRITE_PERSON_ID']
        missing = [c for c in required if c not in df.columns]
        if missing:
            logger.error(f"필수 컬럼 누락: {missing}")
            return pd.DataFrame()

        df['REQUEST_START_DATE'] = df['REQUEST_START_DATE'].apply(self._safe_to_datetime)
        df['REQUEST_END_DATE']   = df['REQUEST_END_DATE'].apply(self._safe_to_datetime)

        # 앞 건 종료일 == 뒤 건 시작일 self-merge
        merged = pd.merge(
            df, df,
            left_on=['REQUEST_ID', 'REQUEST_END_DATE'],
            right_on=['REQUEST_ID', 'REQUEST_START_DATE'],
            suffixes=('_prev', '_next')
        )
        if merged.empty:
            return pd.DataFrame()

        merged['TITLE_prev_clean'] = merged['TITLE_prev'].apply(self._remove_bracket_prefix)
        merged['TITLE_next_clean'] = merged['TITLE_next'].apply(self._remove_bracket_prefix)

        valid = merged[
            (merged['WRITE_PERSON_ID_prev'] == merged['WRITE_PERSON_ID_next']) &
            (merged['TITLE_prev_clean'] == merged['TITLE_next_clean'])
        ].copy()

        return valid

    def _update_policy_dates(self, file_manager, policy_file: str, renew_df: pd.DataFrame) -> bool:
        """분석된 연장 체인을 정책 파일의 날짜에 반영합니다."""
        logger.info(f"날짜 업데이트 반영: {policy_file}")
        policy_df = pd.read_excel(policy_file)
        policy_df.columns = [c.strip() for c in policy_df.columns]

        for col in ['REQUEST_START_DATE', 'REQUEST_END_DATE', 'Start Date', 'End Date']:
            if col in policy_df.columns:
                policy_df[col] = policy_df[col].apply(self._safe_to_datetime)

        renew_df['key_lookup'] = renew_df['REQUEST_ID'].astype(str) + renew_df['TITLE_prev_clean'].astype(str)
        lookup_map = (
            renew_df.sort_values('REQUEST_END_DATE_next', ascending=False)
                    .drop_duplicates('key_lookup', keep='first')
                    .set_index('key_lookup')[['REQUEST_START_DATE_next', 'REQUEST_END_DATE_next']]
                    .to_dict('index')
        )

        updated_count = 0
        total = len(policy_df)
        for idx, row in policy_df.iterrows():
            print(f"\r날짜 반영 중: {idx + 1}/{total}", end='', flush=True)

            clean_title = self._remove_bracket_prefix(str(row.get('TITLE', '')))
            key = str(row.get('REQUEST_ID', '')) + clean_title
            info = lookup_map.get(key)
            if not info:
                continue

            new_start = self._safe_to_datetime(info['REQUEST_START_DATE_next'])
            new_end   = self._safe_to_datetime(info['REQUEST_END_DATE_next'])

            curr_req_start  = row.get('REQUEST_START_DATE', pd.Timestamp("1900-01-01"))
            curr_req_end    = row.get('REQUEST_END_DATE',   pd.Timestamp("1900-01-01"))
            curr_base_start = row.get('Start Date',         pd.Timestamp("1900-01-01"))
            curr_base_end   = row.get('End Date',           pd.Timestamp("1900-01-01"))

            updated = False
            if new_start > curr_req_start and new_start > curr_base_start:
                policy_df.at[idx, 'REQUEST_START_DATE'] = new_start
                updated = True
            if new_end > curr_req_end and new_end > curr_base_end:
                policy_df.at[idx, 'REQUEST_END_DATE'] = new_end
                updated = True
            if updated:
                updated_count += 1
        print()

        out = file_manager.update_version(policy_file)
        policy_df.to_excel(out, index=False, engine='openpyxl')
        logger.info(f"날짜 업데이트 완료: {updated_count}건 → {out}")
        return True
