# app/services/deletion_workflow/processors/notification_classifier.py
"""
정리대상별 공지파일 분류 프로세서 (Task 13).
fpat/fpat/policy_deletion_processor/processors/notification_classifier.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class NotificationClassifier(BaseProcessor):
    """정리대상별 공지파일 분류 기능을 제공하는 클래스"""

    def __init__(self, config_manager):
        super().__init__(config_manager)
        self.columns = self.config.get('columns.all', [])
        self.columns_no_history = self.config.get('columns.no_history', [])
        self.date_columns = self.config.get('columns.date_columns', [])
        self.translated_columns = self.config.get('translated_columns', {})

    def run(self, file_manager, **kwargs) -> bool:
        excel_manager = kwargs.get('excel_manager')
        if not excel_manager:
            logger.error("NotificationClassifier는 excel_manager 인자가 필요합니다.")
            return False
        return self.classify_notifications(file_manager, excel_manager)

    def _save_to_excel(self, df, sheet_type: str, file_name: str, excel_manager):
        df.to_excel(file_name, index=False, na_rep='', sheet_name=sheet_type)
        excel_manager.save_to_excel(df, sheet_type, file_name)

    def _filter_and_save(self, df, mask, columns, sheet_type: str, filename: str,
                         file_manager, excel_manager, log_label: str):
        filtered_df = df[mask]
        if filtered_df.empty:
            logger.info(f"{log_label}: 해당 정책 없음")
            return

        selected_df = filtered_df[columns].copy().astype(str)
        for col in self.date_columns:
            if col in selected_df.columns:
                selected_df[col] = pd.to_datetime(selected_df[col], errors='coerce').dt.strftime('%Y-%m-%d')
        selected_df.rename(columns=self.translated_columns, inplace=True)
        selected_df.fillna('', inplace=True)
        selected_df.replace('nan', '', inplace=True)
        self._save_to_excel(selected_df, sheet_type, filename, excel_manager)
        logger.info(f"{log_label}: '{filename}' 저장 완료")

    def classify_notifications(self, file_manager, excel_manager) -> bool:
        try:
            selected_file = file_manager.select_files()
            if not selected_file:
                return False

            df = pd.read_excel(selected_file)
            base = file_manager.remove_extension(selected_file)

            # 1. 만료 + 사용 정책
            self._filter_and_save(
                df,
                mask=(
                    ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
                    (df['중복여부'].isna()) &
                    (df['신청이력'] != 'Unknown') &
                    (df['만료여부'] == '만료') &
                    (df['미사용여부'] == '사용')
                ),
                columns=self.columns,
                sheet_type='만료_사용정책',
                filename=f"{base}_기간만료(공지용).xlsx",
                file_manager=file_manager,
                excel_manager=excel_manager,
                log_label='기간만료_사용정책',
            )

            # 2. 만료 + 미사용 정책
            self._filter_and_save(
                df,
                mask=(
                    ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
                    (df['중복여부'].isna()) &
                    (df['신청이력'] != 'Unknown') &
                    (df['만료여부'] == '만료') &
                    (df['미사용여부'] == '미사용')
                ),
                columns=self.columns,
                sheet_type='만료_미사용정책',
                filename=f"{base}_만료_미사용정책(공지용).xlsx",
                file_manager=file_manager,
                excel_manager=excel_manager,
                log_label='만료_미사용정책',
            )

            # 3. 장기 미사용 정책
            self._filter_and_save(
                df,
                mask=(
                    (df['예외'].isna()) &
                    (df['중복여부'].isna()) &
                    (df['신청이력'].isin(['GROUP', 'GENERAL'])) &
                    (df['만료여부'] == '미만료') &
                    (df['미사용여부'] == '미사용')
                ),
                columns=self.columns,
                sheet_type='미만료_미사용정책',
                filename=f"{base}_장기미사용정책(공지용).xlsx",
                file_manager=file_manager,
                excel_manager=excel_manager,
                log_label='장기미사용정책',
            )

            # 4. 이력 없는 미사용 정책
            self._filter_and_save(
                df,
                mask=(
                    (df['예외'].isna()) &
                    (df['중복여부'].isna()) &
                    (df['신청이력'] == 'Unknown') &
                    (df['미사용여부'] == '미사용')
                ),
                columns=self.columns_no_history,
                sheet_type='이력없음_미사용정책',
                filename=f"{base}_이력없는_미사용정책.xlsx",
                file_manager=file_manager,
                excel_manager=excel_manager,
                log_label='이력없는_미사용정책',
            )

            logger.info("정책 분류 완료")
            return True
        except Exception as e:
            logger.exception(f"정책 분류 오류: {e}")
            return False
