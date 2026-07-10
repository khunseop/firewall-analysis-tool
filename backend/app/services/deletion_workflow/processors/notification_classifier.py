# app/services/deletion_workflow/processors/notification_classifier.py
"""
정책 파일에 통보대상 분류 컬럼을 추가하는 프로세서 (Task 18).
fpat/fpat/policy_deletion_processor/processors/notification_classifier.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class NotificationClassifier(BaseProcessor):
    """정책 파일에 통보대상 분류 컬럼을 추가하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.classify_notifications(file_manager)

    def classify_notifications(self, file_manager) -> bool:
        try:
            selected_file = file_manager.select_files()
            if not selected_file:
                return False

            df = pd.read_excel(selected_file)

            duplicate_kept = df['중복여부'] == '유지'
            duplicate_deleted = df['중복여부'] == '삭제'

            expired_used = (
                ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
                (df['중복여부'].isna()) &
                (df['신청이력'] != 'Unknown') &
                (df['만료여부'] == '만료') &
                (df['미사용여부'] == '사용')
            )
            expired_unused = (
                ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
                (df['중복여부'].isna()) &
                (df['신청이력'] != 'Unknown') &
                (df['만료여부'] == '만료') &
                (df['미사용여부'] == '미사용')
            )
            # GROUP(신청이력) 정책은 공지대상에서 제외. GENERAL: 예외 비어있거나 '자동연장정책'
            long_unused = (
                (df['중복여부'].isna()) &
                (df['만료여부'] == '미만료') &
                (df['미사용여부'] == '미사용') &
                (df['신청이력'] == 'GENERAL') &
                (df['예외'].isna() | (df['예외'] == '자동연장정책'))
            )
            no_history_unused = (
                (df['예외'].isna()) &
                (df['중복여부'].isna()) &
                (df['신청이력'] == 'Unknown') &
                (df['미사용여부'] == '미사용')
            )

            notice_target = pd.Series('', index=df.index, dtype=object)
            notice_target[duplicate_kept] = '유지정책'
            notice_target[duplicate_deleted] = '중복정책 삭제대상'
            notice_target[expired_used] = '기간만료'
            notice_target[expired_unused] = '만료미사용'
            notice_target[long_unused] = '장기미사용'
            notice_target[no_history_unused] = '이력없음미사용'

            df.insert(0, '통보대상', notice_target)

            output_file = file_manager.update_version(selected_file, final_version=True)
            df.to_excel(output_file, index=False, engine='openpyxl')

            logger.info(f"통보대상 분류 완료: '{output_file}'")
            return True
        except Exception as e:
            logger.exception(f"정책 분류 오류: {e}")
            return False
