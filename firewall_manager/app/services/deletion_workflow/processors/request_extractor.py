# app/services/deletion_workflow/processors/request_extractor.py
"""
신청 ID 추출 프로세서 (Task 2).
fpat/fpat/policy_deletion_processor/processors/request_extractor.py 이식.
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class RequestExtractor(BaseProcessor):
    """고유 신청 ID 추출 기능을 제공하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.extract_request_id(file_manager)

    def extract_request_id(self, file_manager) -> bool:
        try:
            file_name = file_manager.select_files()
            if not file_name:
                return False

            df = pd.read_excel(file_name)

            unique_types = df[df['Request Type'] != 'Unknown']['Request Type'].unique()
            selected_types = unique_types[:5]

            if len(selected_types) == 0:
                logger.warning("추출할 신청 유형이 없습니다.")
                return False

            selected_data = df[df['Request Type'].isin(selected_types)]
            if len(selected_data) == 0:
                logger.warning("추출할 신청 ID가 없습니다.")
                return False

            request_id_prefix = self.config.get('file_naming.request_id_prefix', 'request_id_')
            output_file = f"{request_id_prefix}{file_name}"

            with pd.ExcelWriter(output_file) as writer:
                for request_type, group in selected_data.groupby('Request Type'):
                    unique_ids = group[['Request ID']].drop_duplicates()
                    unique_ids.to_excel(writer, sheet_name=request_type, index=False)
                    logger.info(f"'{request_type}': {len(unique_ids)}개 신청 ID 추출")

            logger.info(f"신청 ID 추출 완료: '{output_file}'")
            return True
        except Exception as e:
            logger.exception(f"신청 ID 추출 중 오류: {e}")
            return False
