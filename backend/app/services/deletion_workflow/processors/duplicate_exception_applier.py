"""
중복정책 미사용 예외를 정책 파일에 반영하는 모듈
fpat/processors/duplicate_exception_applier.py 이식 (YAML 인터랙티브 입력 제거)
예외 목록은 Settings DB(config.exceptions.duplicate_policies)에서 직접 조회
"""
import logging
import pandas as pd
from datetime import datetime
from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class DuplicateExceptionApplier(BaseProcessor):
    """중복정책 미사용 예외를 자동으로 적용하는 클래스"""

    def run(self, file_manager, **kwargs):
        try:
            policy_file = file_manager.select_files()
            if not policy_file:
                return False

            df_policy = pd.read_excel(policy_file)

            device_id = kwargs.get('device_id')
            items = self.config.get('exceptions.duplicate_policies', [])
            current_date = self.config.get_reference_date()

            valid_names = []
            for item in items:
                if device_id is not None and item.get('device_id') != device_id:
                    continue
                try:
                    expires_at    = datetime.strptime(item['expires_at'], '%Y-%m-%d').date()
                    registered_at = datetime.strptime(item['registered_at'], '%Y-%m-%d').date()
                except (ValueError, KeyError) as e:
                    logger.warning(f"예외 항목 날짜 파싱 실패 ({item.get('name', '?')}): {e}")
                    continue
                if expires_at >= current_date and registered_at >= current_date:
                    valid_names.append(item['name'])

            if not valid_names:
                logger.info("유효기간 내 예외 정책이 없습니다.")
                output_file = file_manager.update_version(policy_file, False)
                df_policy.to_excel(output_file, index=False, engine='openpyxl')
                return True

            if '미사용여부' not in df_policy.columns:
                df_policy['미사용여부'] = ''

            mask = df_policy['Rule Name'].isin(valid_names)
            df_policy.loc[mask, '미사용여부'] = '중복정책_미사용예외'

            output_file = file_manager.update_version(policy_file, False)
            df_policy.to_excel(output_file, index=False, engine='openpyxl')

            logger.info(f"예외 반영 완료: {mask.sum()}건 → {output_file}")
            return True

        except Exception as e:
            logger.exception(f"중복정책 예외 반영 중 오류: {e}")
            return False
