"""
중복정책 중 모든 정책이 만료된 건을 분류·정리하는 모듈
fpat/processors/duplicate_expired_cleaner.py 이식.
"""
import logging
import yaml
import pandas as pd
from datetime import datetime, timedelta
from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class DuplicateExpiredCleaner(BaseProcessor):
    """중복정책 만료 건을 자동으로 정리하는 클래스"""

    def run(self, file_manager, **kwargs):
        try:
            # 파일 선택 순서: 정책원본 → 중복정리 → 중복공지 → 중복삭제
            logger.info("파일 선택 시작: 정책원본 → 중복정리 → 중복공지 → 중복삭제")
            policy_file  = file_manager.select_files()
            if not policy_file:  return False
            summary_file = file_manager.select_files()
            if not summary_file: return False
            notice_file  = file_manager.select_files()
            if not notice_file:  return False
            delete_file  = file_manager.select_files()
            if not delete_file:  return False

            df_policy  = pd.read_excel(policy_file)
            df_summary = pd.read_excel(summary_file)
            df_notice  = pd.read_excel(notice_file)
            df_delete  = pd.read_excel(delete_file)

            if '만료여부' not in df_policy.columns:
                logger.error("정책 원본 파일에 '만료여부' 컬럼이 없습니다.")
                return False

            expiry_map = df_policy.set_index('Rule Name')['만료여부'].to_dict()
            df_summary['만료여부'] = df_summary['Rule Name'].map(expiry_map).fillna('확인필요')

            # 모든 행이 만료인 중복 세트
            expired_series = df_summary.groupby('No')['만료여부'].apply(lambda g: (g == '만료').all())
            expired_nos = expired_series[expired_series].index.tolist()

            # 하단최신정책 → 차단 영향 세트
            bottom_req_ids = set(
                df_policy[df_policy.get('미사용여부', pd.Series(dtype=str)) == '하단최신정책']['REQUEST_ID'].dropna().unique()
            ) if '미사용여부' in df_policy.columns else set()
            deny_seqs = sorted(df_policy[df_policy['Action'].str.lower() == 'deny']['Seq'].tolist())

            blocking_nos = []
            for no in df_summary[df_summary['Request ID'].isin(bottom_req_ids)]['No'].unique():
                grp = df_summary[df_summary['No'] == no]
                del_seqs  = grp[grp['작업구분'] == '삭제']['Seq']
                keep_seqs = grp[grp['작업구분'] == '유지']['Seq']
                if not del_seqs.empty and not keep_seqs.empty:
                    mn, mx = del_seqs.min(), keep_seqs.max()
                    if any(mn < s < mx for s in deny_seqs):
                        blocking_nos.append(no)

            all_exc = list(set(expired_nos + blocking_nos))
            df_summary['비고'] = ''
            df_summary.loc[df_summary['No'].isin(expired_nos), '비고'] = '전체만료'
            df_summary.loc[df_summary['No'].isin(blocking_nos), '비고'] = '차단영향위험'

            df_summary_main = df_summary[~df_summary['No'].isin(all_exc)].copy()
            df_summary_exc  = df_summary[df_summary['No'].isin(all_exc)].copy()
            df_notice_new   = df_notice[~df_notice['No'].isin(all_exc)].copy()
            df_delete_new   = df_delete[~df_delete['No'].isin(all_exc)].copy()

            summary_out = file_manager.update_version(summary_file, False)
            with pd.ExcelWriter(summary_out, engine='openpyxl') as writer:
                df_summary_main.to_excel(writer, sheet_name='중복정책정리', index=False)
                df_summary_exc.to_excel(writer, sheet_name='예외', index=False)

            notice_out = file_manager.update_version(notice_file, False)
            df_notice_new.to_excel(notice_out, index=False, engine='openpyxl')

            delete_out = file_manager.update_version(delete_file, False)
            df_delete_new.to_excel(delete_out, index=False, engine='openpyxl')

            # 예외 YAML 생성 (Task 17 자동 연결용 — API 레이어가 Settings duplicate_policies에 저장)
            if not df_summary_exc.empty:
                firewall_name = kwargs.get('firewall_name') or self.config.get('firewall_name', 'firewall')
                unused_threshold = self.config.get('analysis_criteria.unused_threshold_days', 90)
                today = self.config.get_reference_datetime()
                entries = [
                    {
                        'name': str(row['Rule Name']),
                        'reason': f"중복정책_{row['비고']}",
                        'registered_at': today.strftime('%Y-%m-%d'),
                        'expires_at': (today + timedelta(days=unused_threshold)).strftime('%Y-%m-%d'),
                    }
                    for _, row in df_summary_exc.drop_duplicates(subset=['Rule Name']).iterrows()
                ]
                with open("duplicate_exceptions.yaml", 'w', encoding='utf-8') as f:
                    yaml.dump({firewall_name: entries}, f, allow_unicode=True,
                              sort_keys=False, default_flow_style=False)
                logger.info(f"예외 YAML 생성: {len(entries)}건 → duplicate_exceptions.yaml")

            logger.info(f"완료: 예외 {len(all_exc)}건 (만료:{len(expired_nos)}, 차단:{len(blocking_nos)})")
            return True

        except Exception as e:
            logger.exception(f"중복 만료 정리 중 오류: {e}")
            return False
