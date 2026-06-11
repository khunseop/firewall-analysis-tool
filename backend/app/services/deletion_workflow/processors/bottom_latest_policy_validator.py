"""
하단 최신 정책 검증 모듈
fpat/processors/bottom_latest_policy_validator.py 이식
"""
import logging
import pandas as pd
from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class BottomLatestPolicyValidator(BaseProcessor):
    """하단 최신 정책 검증 및 분류 클래스"""

    def run(self, file_manager, **kwargs):
        try:
            file_name = file_manager.select_files()
            if not file_name:
                return False

            df = pd.read_excel(file_name)

            required = {'신청이력', 'Seq', 'REQUEST_ID'}
            if not required.issubset(df.columns):
                logger.error(f"필수 컬럼 누락: {required - set(df.columns)}")
                return False

            analysis_df = df[
                df['신청이력'].notna() &
                (df['신청이력'].astype(str).str.upper() != 'UNKNOWN')
            ].copy()

            if analysis_df.empty:
                logger.warning("분석할 유효한 신청이력 데이터가 없습니다.")
                return False

            validation_results = self._find_seq_mismatches(analysis_df)

            if '미사용여부' not in df.columns:
                df['미사용여부'] = ''

            all_latest_seqs = []
            for seq_list in validation_results['latest_seq']:
                all_latest_seqs.extend(seq_list)

            target_ids = set(validation_results['REQUEST_ID'])
            df.loc[
                df['REQUEST_ID'].isin(target_ids) & df['Seq'].isin(all_latest_seqs),
                '미사용여부'
            ] = '하단최신정책'

            output_file = file_manager.update_version(file_name)

            save_v = validation_results.copy()
            save_v['latest_seq'] = save_v['latest_seq'].astype(str)

            with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='usage', index=False)
                save_v.to_excel(writer, sheet_name='검증', index=False)

            logger.info(f"검증 완료: {output_file} ({len(all_latest_seqs)}건)")
            return True

        except Exception as e:
            logger.exception(f"하단 최신 정책 검증 중 오류: {e}")
            return False

    def _find_seq_mismatches(self, df):
        df = df.copy()
        df['REQUEST_START_DATE'] = pd.to_datetime(df['REQUEST_START_DATE'], errors='coerce')
        results = []
        for rid, group in df.groupby('REQUEST_ID'):
            if pd.isna(rid):
                continue
            max_date = group['REQUEST_START_DATE'].max()
            if pd.isna(max_date):
                continue
            latest_seqs = group.loc[group['REQUEST_START_DATE'] == max_date, 'Seq'].unique().tolist()
            lowest_seq = group['Seq'].min()
            if lowest_seq not in latest_seqs:
                results.append({'REQUEST_ID': rid, 'lowest_seq': lowest_seq, 'latest_seq': latest_seqs})
        if results:
            return pd.DataFrame(results)
        return pd.DataFrame({'REQUEST_ID': [], 'lowest_seq': [], 'latest_seq': []})
