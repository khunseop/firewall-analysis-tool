# app/services/deletion_workflow/processors/duplicate_policy_classifier.py
"""
중복정책 분류 프로세서 (Tasks 8-9).
fpat/fpat/policy_deletion_processor/processors/duplicate_policy_classifier.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class DuplicatePolicyClassifier(BaseProcessor):
    """중복정책 분류 및 상태 업데이트 기능을 제공하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        mode = kwargs.get('mode', 'classify')
        if mode == 'classify':
            return self.organize_redundant_file(file_manager)
        return self.add_duplicate_status(file_manager)

    def organize_redundant_file(self, file_manager) -> bool:
        """중복정책 파일을 분류하여 공지용/삭제용으로 분리합니다."""
        try:
            selected_file = file_manager.select_files()
            if not selected_file:
                return False

            info_file = file_manager.select_files()
            if not info_file:
                return False

            info_df = pd.read_excel(info_file)
            auto_extension_id = info_df[info_df['REQUEST_STATUS'] == 99]['REQUEST_ID'].drop_duplicates()

            df = pd.read_excel(selected_file)

            df['자동연장'] = df['Request ID'].isin(auto_extension_id)
            df['늦은종료일'] = df.groupby('No')['End Date'].transform(
                lambda x: (x == x.max()) & (~x.duplicated(keep='first'))
            )
            df['신청자검증'] = df.groupby('No')['Request User'].transform(lambda x: x.nunique() == 1)
            target_rule_true = df[(df['Type'] == 'Upper') & (df['늦은종료일'])]['No'].unique()
            df['날짜검증'] = df['No'].isin(target_rule_true)
            df['작업구분'] = df['늦은종료일'].apply(lambda x: '유지' if x else '삭제')
            df['공지여부'] = ~df['신청자검증']
            df['미사용예외'] = (~df['날짜검증']) & df['늦은종료일']

            # 자동연장 그룹 예외 처리
            extensioned_df = df.groupby('No').filter(lambda x: x['자동연장'].any())
            extensioned_group = extensioned_df[extensioned_df['Request Type'] == 'GROUP']
            exception_target = extensioned_group.groupby('No').filter(
                lambda x: len(x['Request ID'].unique()) >= 2
            )
            exception_id = exception_target[
                (exception_target['자동연장']) & (exception_target['작업구분'] == '삭제')
            ]['No']
            df = df[~df['No'].isin(exception_id)]

            filtered_no = df.groupby('No').filter(
                lambda x: (x['Request Type'] != 'GROUP').any()
                          and (x['작업구분'] == '삭제').any()
                          and (x['자동연장']).any()
            )['No'].unique()
            df = df[~df['No'].isin(filtered_no)]

            filtered_no_2 = df.groupby('No').filter(
                lambda x: (x['작업구분'] != '유지').all()
            )['No'].unique()
            df = df[~df['No'].isin(filtered_no_2)]

            target_types = ["PAM", "SERVER", "Unknown"]
            target_nos = df[df['Request Type'].isin(target_types)]['No'].drop_duplicates()
            df = df[~df['No'].isin(target_nos)]

            notice_df = df[df['공지여부']].copy()
            delete_df = df[~df['공지여부']].copy()

            for target_df in [notice_df, delete_df]:
                col = target_df.pop('작업구분')
                target_df.insert(0, '작업구분', col)

            cols_to_drop = ['Request Type', 'Ruleset ID', 'MIS ID', 'Start Date', 'End Date',
                            '늦은종료일', '신청자검증', '날짜검증', '공지여부', '미사용예외', '자동연장']
            notice_df.drop(columns=cols_to_drop, inplace=True, errors='ignore')
            delete_df.drop(columns=cols_to_drop, inplace=True, errors='ignore')

            filename = file_manager.remove_extension(selected_file)
            output_path = f'{filename}_정리.xlsx'
            notice_path = f'{filename}_공지.xlsx'
            delete_path = f'{filename}_삭제.xlsx'

            df.to_excel(output_path, index=False, engine='openpyxl')
            notice_df.to_excel(notice_path, index=False, engine='openpyxl')
            delete_df.to_excel(delete_path, index=False, engine='openpyxl')

            logger.info(f"중복정책 분류 완료: {output_path}, {notice_path}, {delete_path}")
            return True
        except Exception as e:
            logger.exception(f"중복정책 분류 오류: {e}")
            return False

    def add_duplicate_status(self, file_manager) -> bool:
        """중복정책 분류 결과(작업구분)를 정책 파일에 추가합니다."""
        try:
            policy_file = file_manager.select_files()
            if not policy_file:
                return False

            duplicate_file = file_manager.select_files()
            if not duplicate_file:
                return False

            policy_df = pd.read_excel(policy_file)
            duplicate_df = pd.read_excel(duplicate_file)

            if '중복여부' not in policy_df.columns:
                policy_df['중복여부'] = ''

            if 'Rule Name' not in duplicate_df.columns or '작업구분' not in duplicate_df.columns:
                logger.error("중복정책 파일에 'Rule Name' 또는 '작업구분' 컬럼이 없습니다.")
                return False

            duplicate_map = duplicate_df[['Rule Name', '작업구분']].set_index('Rule Name').to_dict()['작업구분']
            updated_count = 0
            for idx, row in policy_df.iterrows():
                if row['Rule Name'] in duplicate_map:
                    policy_df.at[idx, '중복여부'] = duplicate_map[row['Rule Name']]
                    updated_count += 1

            cols = policy_df.columns.tolist()
            cols.insert(1, cols.pop(cols.index('중복여부')))
            policy_df = policy_df[cols]

            output_file = file_manager.update_version(policy_file)
            policy_df.to_excel(output_file, index=False, engine='openpyxl')
            logger.info(f"중복여부 {updated_count}개 추가 완료: '{output_file}'")
            return True
        except Exception as e:
            logger.exception(f"중복여부 추가 오류: {e}")
            return False
