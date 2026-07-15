# app/services/deletion_workflow/processors/auto_renewal_exception_generator.py
"""
자동연장예외파일 생성 프로세서 (Task 19, Phase 3).
"""

import logging
import pandas as pd

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class AutoRenewalExceptionGenerator(BaseProcessor):
    """장기미사용/중복삭제/중복공지 결과에서 자동연장예외 대상 신청번호를 추출하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.generate(file_manager)

    def _extract_f_prefixed_ids(self, df: pd.DataFrame, id_col: str) -> pd.Series:
        if id_col not in df.columns:
            logger.error(f"'{id_col}' 컬럼이 없습니다.")
            return pd.Series(dtype=str)
        ids = df[id_col].dropna().astype(str)
        return ids[ids.str.startswith('F')]

    def generate(self, file_manager) -> bool:
        try:
            long_unused_file = file_manager.select_files()
            if not long_unused_file:
                return False

            duplicate_delete_file = file_manager.select_files()
            if not duplicate_delete_file:
                return False

            duplicate_notice_file = file_manager.select_files()
            if not duplicate_notice_file:
                return False

            conv_file = file_manager.select_files()
            if not conv_file:
                return False

            # 장기미사용 공지파일은 ExcelManager.save_to_excel()에서 1행에 집계 수식을 삽입하여
            # 실제 헤더가 2행부터 시작하므로 header=1로 읽어야 함
            long_unused_df = pd.read_excel(long_unused_file, header=1)
            duplicate_delete_df = pd.read_excel(duplicate_delete_file)
            duplicate_notice_df = pd.read_excel(duplicate_notice_file)
            conv_df = pd.read_excel(conv_file)

            for df, label in (
                (duplicate_delete_df, '중복정책_삭제'),
                (duplicate_notice_df, '중복정책_공지'),
            ):
                if '작업구분' not in df.columns:
                    logger.error(f"{label} 파일에 '작업구분' 컬럼이 없습니다.")
                    return False

            request_ids = pd.concat([
                self._extract_f_prefixed_ids(long_unused_df, 'REQUEST_ID'),
                self._extract_f_prefixed_ids(
                    duplicate_delete_df[duplicate_delete_df['작업구분'] == '삭제'], 'Request ID'
                ),
                self._extract_f_prefixed_ids(
                    duplicate_notice_df[duplicate_notice_df['작업구분'] == '삭제'], 'Request ID'
                ),
            ], ignore_index=True)

            if 'REQUEST_ID' not in conv_df.columns or 'REQUEST_STATUS' not in conv_df.columns:
                logger.error("Conv 파일에 'REQUEST_ID' 또는 'REQUEST_STATUS' 컬럼이 없습니다.")
                return False

            conv_status = pd.to_numeric(conv_df['REQUEST_STATUS'], errors='coerce')
            allowed_ids = set(conv_df.loc[conv_status.isin([91, 99]), 'REQUEST_ID'].dropna().astype(str))

            request_ids = request_ids[request_ids.isin(allowed_ids)]
            final_ids = sorted(request_ids.drop_duplicates().tolist())

            exception_df = pd.DataFrame({'신청번호': final_ids})

            output_file = "자동연장예외파일.xlsx"
            with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
                exception_df.to_excel(writer, sheet_name='자동연장예외', index=False)
                long_unused_df.to_excel(writer, sheet_name='장기미사용 결과내용', index=False)
                duplicate_delete_df.to_excel(writer, sheet_name='중복삭제 결과내용', index=False)
                duplicate_notice_df.to_excel(writer, sheet_name='중복공지 결과내용', index=False)

            logger.info(f"자동연장예외파일 생성 완료: '{output_file}' (신청번호 {len(final_ids)}건)")
            return True
        except Exception as e:
            logger.exception(f"자동연장예외파일 생성 오류: {e}")
            return False
